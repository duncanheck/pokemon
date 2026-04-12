import json
from datetime import date, timedelta
from itertools import groupby
from operator import itemgetter

from django.contrib.auth.decorators import login_required
from django.contrib import messages
from django.db.models import Count
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST

from .models import Card, CardPriceHistory
from .services import (
    search_cards, get_card_by_id, get_card_prices,
    get_or_create_card_from_api_data, refresh_card_prices_in_db,
)
from apps.collection.forms import AddToCollectionForm


# ── Search ────────────────────────────────────────────────────────────────────

def card_search(request):
    query = request.GET.get("q", "").strip()
    tcg   = request.GET.get("tcg", "")
    page  = int(request.GET.get("page", 1))

    result = search_cards(query, tcg, page) if query else {"results": [], "total": 0, "error": None}

    context = {
        "query":    query,
        "tcg":      tcg,
        "results":  result["results"],
        "total":    result["total"],
        "error":    result["error"],
        "page":     page,
        "has_next": result["total"] > page * 24,
        "TCG_CHOICES": Card.TCG_CHOICES,
    }
    return render(request, "cards/search.html", context)


# ── Detail ────────────────────────────────────────────────────────────────────

def card_detail(request, tcg_id):
    """Show card detail + add-to-collection form. Creates DB row if not yet synced."""
    card = Card.objects.filter(tcg_id=tcg_id).first()
    if card is None:
        api_data = get_card_by_id(tcg_id)
        if api_data:
            card, _ = get_or_create_card_from_api_data(api_data)
    if card:
        refresh_card_prices_in_db(card)
        card.refresh_from_db()
    add_form = AddToCollectionForm(initial={"card_tcg_id": tcg_id})
    context = {"card": card, "tcg_id": tcg_id, "add_form": add_form}
    return render(request, "cards/detail.html", context)


# ── Add to collection ─────────────────────────────────────────────────────────

@login_required
@require_POST
def add_to_collection(request):
    form = AddToCollectionForm(request.POST)
    if not form.is_valid():
        messages.error(request, "Invalid form data. Please try again.")
        return redirect(request.POST.get("next", "card_search"))

    tcg_id = form.cleaned_data["card_tcg_id"]

    card = Card.objects.filter(tcg_id=tcg_id).first()
    if card is None:
        card, _ = get_or_create_card_from_api_data({
            "tcg_id":       tcg_id,
            "tcg":          request.POST.get("card_tcg", ""),
            "name":         request.POST.get("card_name", ""),
            "set_name":     request.POST.get("card_set_name", ""),
            "image_url":    request.POST.get("card_image_url", ""),
            "market_price": request.POST.get("card_market_price") or None,
        })
        if card is None:
            messages.error(request, "Could not identify card. Please try again.")
            return redirect("card_search")
        refresh_card_prices_in_db(card)

    from apps.collection.models import CollectionItem
    item, created = CollectionItem.objects.get_or_create(
        user=request.user,
        card=card,
        condition=form.cleaned_data["condition"],
        is_foil=form.cleaned_data["is_foil"],
        defaults={
            "quantity":       form.cleaned_data["quantity"],
            "purchase_price": form.cleaned_data["purchase_price"],
            "purchase_date":  form.cleaned_data["purchase_date"],
            "is_hunted":      form.cleaned_data["is_hunted"],
            "notes":          form.cleaned_data["notes"],
        },
    )
    if not created:
        item.quantity += form.cleaned_data["quantity"]
        item.save(update_fields=["quantity", "updated_at"])
        messages.success(request, f"Updated quantity for {card.name} in your collection.")
    else:
        messages.success(request, f"{card.name} added to your {'Want List' if item.is_hunted else 'collection'}!")

    return redirect(request.POST.get("next", "collection_list"))


# ── JSON price endpoint (lazy loading) ───────────────────────────────────────

def card_price_json(request, tcg_id):
    """Return current prices as JSON — used by lazy price loader on search page."""
    card = Card.objects.filter(tcg_id=tcg_id).values(
        "market_price", "low_price", "high_price", "foil_price",
        "name", "set_name", "tcg"
    ).first()

    if card and card["market_price"]:
        price_keys = ("market_price", "low_price", "high_price", "foil_price")
        return JsonResponse({k: str(card[k]) if card[k] else None for k in price_keys})

    prices = get_card_prices(
        tcg_id,
        card_name=card.get("name", "") if card else "",
        set_name=card.get("set_name", "") if card else "",
        tcg=card.get("tcg", "") if card else "",
    )
    if prices:
        return JsonResponse({k: str(v) if v else None for k, v in prices.items()})

    return JsonResponse({"market_price": None, "error": "not_found"})


# ── Sparkline JSON (7-day history) ────────────────────────────────────────────

def card_sparkline_json(request, tcg_id):
    """Return 7-day price history for sparkline charts."""
    card = Card.objects.filter(tcg_id=tcg_id).first()
    if not card:
        return JsonResponse({"labels": [], "prices": []})

    since = date.today() - timedelta(days=6)
    history = list(
        CardPriceHistory.objects
        .filter(card=card, date__gte=since)
        .values("date", "market_price")
        .order_by("date")
    )
    return JsonResponse({
        "labels": [h["date"].strftime("%b %-d") for h in history],
        "prices": [float(h["market_price"]) if h["market_price"] else None for h in history],
    })


# ── Set browser ───────────────────────────────────────────────────────────────

def set_browser(request):
    """Browse all known sets, with per-user completion % if authenticated."""
    sets = (
        Card.objects
        .values("tcg", "set_name", "set_code")
        .annotate(total_cards=Count("id"))
        .order_by("tcg", "set_name")
    )

    user_counts = {}
    if request.user.is_authenticated:
        from apps.collection.models import CollectionItem
        for row in (CollectionItem.objects
                    .filter(user=request.user, is_hunted=False)
                    .values("card__tcg", "card__set_name")
                    .annotate(owned=Count("card", distinct=True))):
            user_counts[(row["card__tcg"], row["card__set_name"])] = row["owned"]

    set_list = []
    for s in sets:
        key    = (s["tcg"], s["set_name"])
        owned  = user_counts.get(key, 0)
        total  = s["total_cards"]
        pct    = round(owned / total * 100) if total > 0 else 0
        set_list.append({
            "tcg":        s["tcg"],
            "set_name":   s["set_name"],
            "set_code":   s["set_code"],
            "total_cards": total,
            "owned":      owned,
            "pct":        pct,
        })

    set_list.sort(key=itemgetter("tcg", "set_name"))
    tcg_label = dict(Card.TCG_CHOICES)
    # List of (display_name, sets) — avoids dict-key lookup in templates
    grouped_sets = [
        (tcg_label.get(k, k), list(v))
        for k, v in groupby(set_list, key=itemgetter("tcg"))
    ]

    return render(request, "cards/sets.html", {
        "grouped_sets": grouped_sets,
        "TCG_CHOICES":  Card.TCG_CHOICES,
    })


# ── Card comparison ───────────────────────────────────────────────────────────

def card_compare(request):
    """Compare 2–4 cards side by side with price history."""
    ids = request.GET.getlist("ids")[:4]

    cards = []
    for tcg_id in ids:
        card = Card.objects.filter(tcg_id=tcg_id).first()
        if not card:
            continue
        since   = date.today() - timedelta(days=6)
        history = list(
            CardPriceHistory.objects
            .filter(card=card, date__gte=since)
            .values("date", "market_price")
            .order_by("date")
        )
        cards.append({
            "card":           card,
            "history_labels": [h["date"].strftime("%b %-d") for h in history],
            "history_prices": [float(h["market_price"]) if h["market_price"] else None
                               for h in history],
        })

    return render(request, "cards/compare.html", {
        "cards":       cards,
        "ids":         ids,
        "TCG_CHOICES": Card.TCG_CHOICES,
    })
