from django.contrib.auth.decorators import login_required
from django.contrib import messages
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST

from .models import Card
from .services import search_cards, get_or_create_card_from_api_data
from apps.collection.forms import AddToCollectionForm


def card_search(request):
    query = request.GET.get("q", "").strip()
    tcg   = request.GET.get("tcg", "")
    page  = int(request.GET.get("page", 1))

    result = search_cards(query, tcg, page) if query else {"results": [], "total": 0, "error": None}

    context = {
        "query":   query,
        "tcg":     tcg,
        "results": result["results"],
        "total":   result["total"],
        "error":   result["error"],
        "page":    page,
        "has_next": result["total"] > page * 24,
        "TCG_CHOICES": Card.TCG_CHOICES,
    }
    return render(request, "cards/search.html", context)


def card_detail(request, tcg_id):
    """Show card detail + add-to-collection form. Creates DB row if not yet synced."""
    card = Card.objects.filter(tcg_id=tcg_id).first()
    add_form = AddToCollectionForm(initial={"card_tcg_id": tcg_id})
    context = {"card": card, "tcg_id": tcg_id, "add_form": add_form}
    return render(request, "cards/detail.html", context)


@login_required
@require_POST
def add_to_collection(request):
    """
    Handles the Add-to-Collection form submitted from search results or card detail.
    If the card doesn't exist locally, upserts it from the submitted API data.
    """
    form = AddToCollectionForm(request.POST)
    if not form.is_valid():
        messages.error(request, "Invalid form data. Please try again.")
        return redirect(request.POST.get("next", "card_search"))

    tcg_id = form.cleaned_data["card_tcg_id"]

    # Try local DB first; if missing, build from POST data (API pre-filled hidden fields)
    card = Card.objects.filter(tcg_id=tcg_id).first()
    if card is None:
        card, _ = get_or_create_card_from_api_data({
            "tcg_id":     tcg_id,
            "tcg":        request.POST.get("card_tcg", ""),
            "name":       request.POST.get("card_name", ""),
            "set_name":   request.POST.get("card_set_name", ""),
            "image_url":  request.POST.get("card_image_url", ""),
            "market_price": request.POST.get("card_market_price") or None,
        })
        if card is None:
            messages.error(request, "Could not identify card. Please try again.")
            return redirect("card_search")

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
        # Increment quantity if duplicate condition/foil combo
        item.quantity += form.cleaned_data["quantity"]
        item.save(update_fields=["quantity", "updated_at"])
        messages.success(request, f"Updated quantity for {card.name} in your collection.")
    else:
        messages.success(request, f"{card.name} added to your {'Want List' if item.is_hunted else 'collection'}!")

    return redirect(request.POST.get("next", "collection_list"))
