from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.core.paginator import Paginator
from django.db import transaction
from django.db.models import Q
from django.http import HttpResponseForbidden
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.views.decorators.http import require_POST

from .forms import CounterOfferForm, ListingForm, OfferForm
from .models import Listing, Offer


# ── Browse ────────────────────────────────────────────────────────────────────

def marketplace_browse(request):
    qs = (
        Listing.objects
        .filter(status="active")
        .select_related("seller", "collection_item__card")
        .order_by("-created_at")
    )

    # Filters
    q        = request.GET.get("q", "").strip()
    tcg      = request.GET.get("tcg", "")
    ltype    = request.GET.get("type", "")
    min_p    = request.GET.get("min", "")
    max_p    = request.GET.get("max", "")

    if q:
        qs = qs.filter(collection_item__card__name__icontains=q)
    if tcg:
        qs = qs.filter(collection_item__card__tcg=tcg)
    if ltype:
        qs = qs.filter(listing_type=ltype)
    if min_p:
        qs = qs.filter(asking_price__gte=min_p)
    if max_p:
        qs = qs.filter(asking_price__lte=max_p)

    paginator = Paginator(qs, 24)
    page_obj  = paginator.get_page(request.GET.get("page", 1))

    from apps.cards.models import Card
    context = {
        "page_obj":        page_obj,
        "q": q, "tcg": tcg, "ltype": ltype, "min_p": min_p, "max_p": max_p,
        "TCG_CHOICES":     Card.TCG_CHOICES,
        "LISTING_CHOICES": Listing.LISTING_TYPE_CHOICES,
        "total":           paginator.count,
    }
    return render(request, "marketplace/browse.html", context)


# ── Listing detail ────────────────────────────────────────────────────────────

def listing_detail(request, pk):
    listing = get_object_or_404(
        Listing.objects.select_related("seller", "collection_item__card"),
        pk=pk,
    )
    # Increment view counter (best-effort, no locking needed)
    Listing.objects.filter(pk=pk).update(views_count=listing.views_count + 1)

    offer_form = None
    user_offer = None
    if request.user.is_authenticated and request.user != listing.seller:
        offer_form = OfferForm(listing=listing)
        user_offer = (
            Offer.objects.filter(listing=listing, buyer=request.user)
            .exclude(status__in=["withdrawn", "declined"])
            .first()
        )

    # Seller sees all pending offers
    pending_offers = []
    if request.user == listing.seller:
        pending_offers = (
            listing.offers
            .filter(status="pending")
            .select_related("buyer")
        )

    context = {
        "listing":       listing,
        "offer_form":    offer_form,
        "user_offer":    user_offer,
        "pending_offers": pending_offers,
    }
    return render(request, "marketplace/detail.html", context)


# ── Create / edit / cancel listing ───────────────────────────────────────────

@login_required
def listing_create(request):
    if request.method == "POST":
        form = ListingForm(request.user, request.POST)
        if form.is_valid():
            listing = form.save(commit=False)
            listing.seller = request.user
            listing.save()
            # Mark the collection item as for_sale
            ci = listing.collection_item
            ci.for_sale = True
            ci.save(update_fields=["for_sale", "updated_at"])
            messages.success(request, f"Listed {ci.card.name} on the marketplace!")
            return redirect("listing_detail", pk=listing.pk)
    else:
        # Pre-select item if ?item=pk passed from collection page
        initial = {}
        if item_pk := request.GET.get("item"):
            initial["collection_item"] = item_pk
        form = ListingForm(request.user, initial=initial)

    return render(request, "marketplace/listing_form.html", {"form": form, "action": "Create"})


@login_required
def listing_edit(request, pk):
    listing = get_object_or_404(Listing, pk=pk, seller=request.user)
    if listing.status not in ("active", "reserved"):
        messages.error(request, "Cannot edit a sold or cancelled listing.")
        return redirect("listing_detail", pk=pk)

    form = ListingForm(request.user, request.POST or None, instance=listing)
    if request.method == "POST" and form.is_valid():
        form.save()
        messages.success(request, "Listing updated.")
        return redirect("listing_detail", pk=pk)

    return render(request, "marketplace/listing_form.html", {"form": form, "action": "Edit", "listing": listing})


@login_required
@require_POST
def listing_cancel(request, pk):
    listing = get_object_or_404(Listing, pk=pk, seller=request.user)
    listing.status = "cancelled"
    listing.save(update_fields=["status", "updated_at"])
    listing.collection_item.for_sale = False
    listing.collection_item.save(update_fields=["for_sale", "updated_at"])
    messages.success(request, "Listing cancelled.")
    return redirect("my_listings")


# ── Seller's dashboard ────────────────────────────────────────────────────────

@login_required
def my_listings(request):
    listings = (
        Listing.objects
        .filter(seller=request.user)
        .select_related("collection_item__card")
        .prefetch_related("offers")
        .order_by("-created_at")
    )
    return render(request, "marketplace/my_listings.html", {"listings": listings})


# ── Offers ────────────────────────────────────────────────────────────────────

@login_required
@require_POST
def make_offer(request, listing_pk):
    listing = get_object_or_404(Listing, pk=listing_pk, status="active")
    if listing.seller == request.user:
        return HttpResponseForbidden()
    if not listing.accepts_offers:
        messages.error(request, "This listing does not accept offers.")
        return redirect("listing_detail", pk=listing_pk)

    # One active offer per buyer per listing
    if Offer.objects.filter(
        listing=listing, buyer=request.user
    ).exclude(status__in=["withdrawn", "declined", "expired"]).exists():
        messages.warning(request, "You already have an active offer on this listing.")
        return redirect("listing_detail", pk=listing_pk)

    form = OfferForm(listing=listing, data=request.POST)
    if form.is_valid():
        offer = form.save(commit=False)
        offer.listing = listing
        offer.buyer   = request.user
        offer.expires_at = timezone.now() + timezone.timedelta(days=7)
        offer.save()
        messages.success(request, "Offer submitted! The seller will respond within 7 days.")
        return redirect("listing_detail", pk=listing_pk)

    # Re-render detail with form errors
    messages.error(request, "Please fix the errors in your offer.")
    return redirect("listing_detail", pk=listing_pk)


@login_required
@require_POST
def respond_offer(request, offer_pk):
    """Seller accepts, declines, or counters an offer."""
    offer = get_object_or_404(Offer, pk=offer_pk)
    if offer.listing.seller != request.user:
        return HttpResponseForbidden()

    action = request.POST.get("action")

    if action == "accept":
        with transaction.atomic():
            offer.status = "accepted"
            offer.save(update_fields=["status", "updated_at"])
            # Decline all other pending offers on same listing
            offer.listing.offers.filter(status="pending").exclude(pk=offer.pk).update(
                status="declined"
            )
            offer.listing.status = "reserved"
            offer.listing.save(update_fields=["status", "updated_at"])
        messages.success(request, f"Offer from {offer.buyer.username} accepted. Listing is now reserved.")

    elif action == "decline":
        offer.status = "declined"
        offer.save(update_fields=["status", "updated_at"])
        messages.info(request, f"Offer from {offer.buyer.username} declined.")

    elif action == "counter":
        form = CounterOfferForm(request.POST)
        if form.is_valid():
            offer.counter_price   = form.cleaned_data["counter_price"]
            offer.counter_message = form.cleaned_data["counter_message"]
            offer.status = "countered"
            offer.save(update_fields=["counter_price", "counter_message", "status", "updated_at"])
            messages.success(request, f"Counter-offer sent to {offer.buyer.username}.")
        else:
            messages.error(request, "Counter-offer invalid — please include a message.")

    return redirect("listing_detail", pk=offer.listing.pk)


@login_required
@require_POST
def withdraw_offer(request, offer_pk):
    offer = get_object_or_404(Offer, pk=offer_pk, buyer=request.user)
    if offer.status not in ("pending", "countered"):
        messages.error(request, "This offer can no longer be withdrawn.")
    else:
        offer.status = "withdrawn"
        offer.save(update_fields=["status", "updated_at"])
        messages.success(request, "Offer withdrawn.")
    return redirect("listing_detail", pk=offer.listing.pk)


@login_required
@require_POST
def accept_counter(request, offer_pk):
    """Buyer accepts a counter-offer from seller."""
    offer = get_object_or_404(Offer, pk=offer_pk, buyer=request.user, status="countered")
    with transaction.atomic():
        offer.status = "accepted"
        offer.offered_price = offer.counter_price  # buyer accepts the counter price
        offer.save(update_fields=["status", "offered_price", "updated_at"])
        offer.listing.offers.filter(status="pending").exclude(pk=offer.pk).update(status="declined")
        offer.listing.status = "reserved"
        offer.listing.save(update_fields=["status", "updated_at"])
    messages.success(request, "Counter-offer accepted! The seller will complete the transaction.")
    return redirect("listing_detail", pk=offer.listing.pk)


@login_required
def my_offers(request):
    offers = (
        Offer.objects
        .filter(buyer=request.user)
        .select_related("listing__collection_item__card", "listing__seller")
        .order_by("-created_at")
    )
    return render(request, "marketplace/my_offers.html", {"offers": offers})
