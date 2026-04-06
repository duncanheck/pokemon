from django.contrib.auth.decorators import login_required
from django.db.models import Count, Sum
from django.shortcuts import render, get_object_or_404

from apps.collection.models import CollectionItem
from apps.collection.views import _portfolio_value
from .models import User


def home(request):
    if request.user.is_authenticated:
        from django.shortcuts import redirect
        return redirect("dashboard")

    features = [
        ("graph-up-arrow", "Live Portfolio", "See your collection's real-time market value with price history charts."),
        ("shop",           "P2P Marketplace", "List cards for sale or trade. Negotiate directly — no fees, no middleman."),
        ("bell",           "Price Alerts",    "Get notified when a card you own or want spikes in value."),
    ]
    return render(request, "home.html", {"features": features})


@login_required
def dashboard(request):
    user = request.user

    collection_qs = CollectionItem.objects.filter(user=user, is_hunted=False).select_related("card")

    stats = collection_qs.aggregate(
        total_cards=Sum("quantity"),
        unique_cards=Count("id"),
    )

    tcg_breakdown = (
        collection_qs
        .values("card__tcg")
        .annotate(count=Sum("quantity"))
        .order_by("-count")
    )

    want_count = CollectionItem.objects.filter(user=user, is_hunted=True).count()
    for_sale_count = collection_qs.filter(for_sale=True).count()
    recent = collection_qs.order_by("-created_at")[:6]

    top_value = [
        item for item in collection_qs.order_by("-card__market_price")[:10]
        if item.card.market_price
    ][:5]

    context = {
        "stats": stats,
        "tcg_breakdown": tcg_breakdown,
        "want_count": want_count,
        "for_sale_count": for_sale_count,
        "recent": recent,
        "top_value": top_value,
        "portfolio_value": _portfolio_value(user),
    }
    return render(request, "dashboard/index.html", context)


def public_profile(request, username):
    profile_user = get_object_or_404(User, username=username, is_public=True)

    collection_qs = CollectionItem.objects.filter(
        user=profile_user, is_hunted=False
    ).select_related("card")

    stats = collection_qs.aggregate(
        total_cards=Sum("quantity"),
        unique_cards=Count("id"),
    )

    tcg_breakdown = (
        collection_qs
        .values("card__tcg")
        .annotate(count=Sum("quantity"))
        .order_by("-count")
    )

    context = {
        "profile_user": profile_user,
        "stats": stats,
        "tcg_breakdown": tcg_breakdown,
        "collection": collection_qs.order_by("-created_at")[:20],
    }
    return render(request, "accounts/profile.html", context)
