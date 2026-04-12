"""
JustTCG API client + caching layer.
"""

import logging
from decimal import Decimal
import requests
from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

logger = logging.getLogger(__name__)

PRICE_CACHE_TTL = 60 * 60 * 4  # 4 hours
SEARCH_CACHE_TTL = 60 * 30     # 30 minutes
API_TIMEOUT = 8
_CACHE_MISS = object()  # sentinel: distinguishes "not in cache" from a cached None (404)


def _headers() -> dict:
    key = settings.JUSTTCG_API_KEY
    if not key:
        logger.warning("JUSTTCG_API_KEY is missing!")
    return {
        "x-api-key": key,
        "Accept": "application/json"
    }


def search_cards(query: str, tcg: str = "", page: int = 1) -> dict:
    if not query.strip():
        return {"results": [], "total": 0, "error": None}

    cache_key = f"jtcg_search:{tcg}:{query.lower()}:p{page}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    if not settings.JUSTTCG_API_KEY:
        logger.warning("No API key - falling back to local DB")
        return _local_search(query, tcg, page)

    params = {"q": query, "page": page, "pageSize": 24}
    if tcg:
        params["game"] = tcg

    try:
        resp = requests.get(
            f"{settings.JUSTTCG_BASE_URL}/cards/search",
            params=params,
            headers=_headers(),
            timeout=API_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()

        normalised = [_normalise_card(c) for c in data.get("data", [])]
        _enrich_from_db(normalised)  # fill missing prices/images from local cache

        result = {
            "results": normalised,
            "total": data.get("total") or len(normalised),  # don't show 0 when results exist
            "error": None,
        }
        cache.set(cache_key, result, SEARCH_CACHE_TTL)
        return result

    except requests.HTTPError as e:
        if e.response and e.response.status_code == 401:
            logger.error("401 from JustTCG - check API key and header")
        else:
            logger.error("JustTCG HTTP error: %s", e)
        return {**_local_search(query, tcg, page), "error": "Pricing service unavailable."}

    except Exception as e:
        logger.exception("JustTCG error: %s", e)
        return {**_local_search(query, tcg, page), "error": "Unexpected error."}


def get_card_by_id(tcg_id: str) -> dict | None:
    """Fetch a single card's metadata from the API (for detail pages)."""
    if not settings.JUSTTCG_API_KEY:
        return None

    cache_key = f"jtcg_card:{tcg_id}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    try:
        resp = requests.get(
            f"{settings.JUSTTCG_BASE_URL}/cards/{tcg_id}",
            headers=_headers(),
            timeout=API_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json().get("data", {})
        if not data:
            return None
        normalised = _normalise_card(data)
        cache.set(cache_key, normalised, PRICE_CACHE_TTL)
        return normalised
    except Exception as e:
        logger.warning("Card fetch failed for %s: %s", tcg_id, e)
        return None


def get_card_prices(tcg_id: str, *, card_name: str = "", set_name: str = "", tcg: str = "") -> dict | None:
    """Primary: GET https://api.justtcg.com/v1/cards?cardId={slug}
    Fallback (Pokémon only): https://api.pokemontcg.io/v2/cards on 400/404 or empty price.
    JustTCG alt param: ?tcgplayerId={tcgplayer_id}
    """
    # Guard: empty tcg_id would hit /cards without cardId → JustTCG returns 400 "browse" error
    if not tcg_id or not tcg_id.strip():
        logger.warning("get_card_prices: empty tcg_id – skipping API call")
        return None

    if not settings.JUSTTCG_API_KEY:
        return get_pokemon_prices_fallback(card_name, set_name) if tcg == "pokemon" and card_name else None

    cache_key = f"jtcg_prices:{tcg_id}"
    cached = cache.get(cache_key, _CACHE_MISS)
    if cached is not _CACHE_MISS:
        return cached  # None = known 404 (don't retry); dict = valid prices

    try:
        resp = requests.get(
            f"{settings.JUSTTCG_BASE_URL}/cards",
            params={"cardId": tcg_id},
            headers=_headers(),
            timeout=API_TIMEOUT,
        )
        resp.raise_for_status()
        data_list = resp.json().get("data", [])
        if not data_list:
            logger.warning("Price fetch %s: no data in JustTCG response", tcg_id)
            result = get_pokemon_prices_fallback(card_name, set_name) if tcg == "pokemon" and card_name else None
            cache.set(cache_key, result, PRICE_CACHE_TTL)
            return result
        card_data   = data_list[0]
        variants    = card_data.get("variants", [])
        prices_raw  = variants[0].get("prices", {}) if variants else card_data.get("prices", {})
        prices = {
            "market_price": _to_decimal(prices_raw.get("market")),
            "low_price":    _to_decimal(prices_raw.get("low")),
            "mid_price":    _to_decimal(prices_raw.get("mid")),
            "high_price":   _to_decimal(prices_raw.get("high")),
            "foil_price":   _to_decimal(prices_raw.get("foilMarket")),
        }
        # No market price in JustTCG → try pokemontcg.io fallback for Pokémon cards
        if not prices["market_price"] and tcg == "pokemon" and card_name:
            fb = get_pokemon_prices_fallback(card_name, set_name)
            if fb:
                cache.set(cache_key, fb, PRICE_CACHE_TTL)
                return fb
        cache.set(cache_key, prices, PRICE_CACHE_TTL)
        return prices
    except requests.HTTPError as e:
        status = e.response.status_code if e.response else "?"
        logger.warning("Price fetch %s → HTTP %s (logged once; result cached)", tcg_id, status)
        fallback = None
        if status in (400, 404) and tcg == "pokemon" and card_name:
            fallback = get_pokemon_prices_fallback(card_name, set_name)
        cache.set(cache_key, fallback, PRICE_CACHE_TTL)  # cache to prevent retry storms
        return fallback
    except Exception as e:
        logger.warning("Price fetch failed for %s: %s", tcg_id, e)
        return None


def get_pokemon_prices_fallback(name: str, set_name: str = "") -> dict | None:
    """Fallback via https://api.pokemontcg.io/v2/cards — no API key required.
    Called when JustTCG returns 400/404 or no market price for a Pokémon card.
    """
    if not name:
        return None
    cache_key = f"ptcg_prices:{name.lower()}:{set_name.lower()}"
    cached = cache.get(cache_key, _CACHE_MISS)
    if cached is not _CACHE_MISS:
        return cached
    try:
        q = f'name:"{name}"' + (f' set.name:"{set_name}"' if set_name else "")
        resp = requests.get(
            "https://api.pokemontcg.io/v2/cards",
            params={"q": q, "pageSize": 5, "select": "id,name,tcgplayer"},
            timeout=API_TIMEOUT,
        )
        resp.raise_for_status()
        result = None
        for card in resp.json().get("data", []):
            p_map = card.get("tcgplayer", {}).get("prices", {})
            for variant in ("holofoil", "normal", "1stEditionHolofoil", "reverseHolofoil"):
                p = p_map.get(variant) or {}
                if p.get("market"):
                    result = {
                        "market_price": _to_decimal(p["market"]),
                        "low_price":    _to_decimal(p.get("low")),
                        "mid_price":    _to_decimal(p.get("mid")),
                        "high_price":   _to_decimal(p.get("high")),
                        "foil_price":   _to_decimal(p["market"]) if "holofoil" in variant.lower() else None,
                    }
                    break
            if result:
                break
        cache.set(cache_key, result, PRICE_CACHE_TTL)
        return result
    except Exception as e:
        logger.warning("pokemontcg.io fallback failed for '%s': %s", name, e)
        return None


def _local_search(query: str, tcg: str = "", page: int = 1) -> dict:
    from apps.cards.models import Card
    qs = Card.objects.filter(name__icontains=query)
    if tcg:
        qs = qs.filter(tcg=tcg)
    total = qs.count()
    offset = (page - 1) * 24
    cards = list(qs.values(
        "id", "tcg_id", "tcg", "name", "set_name", "number",
        "rarity", "image_url", "market_price", "foil_price",
    )[offset:offset + 24])
    for c in cards:
        c["_source"] = "local"
    return {"results": cards, "total": total, "error": None}


def _enrich_from_db(cards: list) -> None:
    """Fill missing prices and images from the local DB cache for API results."""
    from apps.cards.models import Card
    ids = [c["tcg_id"] for c in cards if c.get("tcg_id")]
    if not ids:
        return
    db_map = {
        row["tcg_id"]: row
        for row in Card.objects.filter(tcg_id__in=ids).values(
            "tcg_id", "market_price", "foil_price", "image_url"
        )
    }
    for card in cards:
        db = db_map.get(card.get("tcg_id"))
        if not db:
            continue
        if not card.get("market_price") and db.get("market_price"):
            card["market_price"] = db["market_price"]
        if not card.get("foil_price") and db.get("foil_price"):
            card["foil_price"] = db["foil_price"]
        if not card.get("image_url") and db.get("image_url"):
            card["image_url"] = db["image_url"]


def _normalise_card(api_card: dict) -> dict:
    images = api_card.get("images", {})
    prices = api_card.get("prices", {})
    return {
        "tcg_id": api_card.get("id", ""),
        "tcg": api_card.get("game", ""),
        "name": api_card.get("name", ""),
        "set_name": api_card.get("setName", ""),
        "set_code": api_card.get("setCode", ""),
        "number": api_card.get("number", ""),
        "rarity": api_card.get("rarity", ""),
        "image_url": images.get("small", ""),
        "image_url_hi": images.get("large", ""),
        "market_price": _to_decimal(prices.get("market")),
        "foil_price": _to_decimal(prices.get("foilMarket")),
        "_source": "api",
    }


def _to_decimal(value) -> Decimal | None:
    try:
        return Decimal(str(value)) if value is not None else None
    except Exception:
        return None


def refresh_card_prices_in_db(card) -> bool:
    from apps.cards.models import Card
    prices = get_card_prices(card.tcg_id, card_name=card.name, set_name=card.set_name, tcg=card.tcg)
    if prices is None:
        return False
    Card.objects.filter(pk=card.pk).update(**prices, price_updated_at=timezone.now())
    return True


def get_or_create_card_from_api_data(data: dict):
    from apps.cards.models import Card
    tcg_id = data.get("tcg_id", "").strip()
    if not tcg_id:
        return None, False
    defaults = {k: v for k, v in data.items()
                if k in {f.name for f in Card._meta.get_fields()} and k != "tcg_id"}
    defaults.pop("_source", None)
    defaults["price_updated_at"] = timezone.now()
    return Card.objects.update_or_create(tcg_id=tcg_id, defaults=defaults)
