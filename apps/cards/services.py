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
        return _local_search(query, tcg)

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

        result = {
            "results": [_normalise_card(c) for c in data.get("data", [])],
            "total": data.get("total", 0),
            "error": None,
        }
        cache.set(cache_key, result, SEARCH_CACHE_TTL)
        return result

    except requests.HTTPError as e:
        if e.response and e.response.status_code == 401:
            logger.error("401 from JustTCG - check API key and header")
        else:
            logger.error("JustTCG HTTP error: %s", e)
        return {**_local_search(query, tcg), "error": "Pricing service unavailable."}

    except Exception as e:
        logger.exception("JustTCG error: %s", e)
        return {**_local_search(query, tcg), "error": "Unexpected error."}


def get_card_prices(tcg_id: str) -> dict | None:
    if not settings.JUSTTCG_API_KEY:
        return None

    cache_key = f"jtcg_prices:{tcg_id}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    try:
        resp = requests.get(
            f"{settings.JUSTTCG_BASE_URL}/cards/{tcg_id}/prices",
            headers=_headers(),
            timeout=API_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json().get("data", {})
        prices = {
            "market_price": _to_decimal(data.get("market")),
            "low_price": _to_decimal(data.get("low")),
            "mid_price": _to_decimal(data.get("mid")),
            "high_price": _to_decimal(data.get("high")),
            "foil_price": _to_decimal(data.get("foilMarket")),
        }
        cache.set(cache_key, prices, PRICE_CACHE_TTL)
        return prices
    except Exception as e:
        logger.warning("Price fetch failed for %s: %s", tcg_id, e)
        return None


# Keep the rest of your helper functions exactly as they were
def _local_search(query: str, tcg: str = "") -> dict:
    from apps.cards.models import Card
    qs = Card.objects.filter(name__icontains=query)
    if tcg:
        qs = qs.filter(tcg=tcg)
    cards = list(qs.values(
        "id", "tcg_id", "tcg", "name", "set_name", "number",
        "rarity", "image_url", "market_price", "foil_price",
    )[:48])
    for c in cards:
        c["_source"] = "local"
    return {"results": cards, "total": len(cards), "error": None}


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
    prices = get_card_prices(card.tcg_id)
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
