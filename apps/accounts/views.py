from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth.decorators import login_required
from django.db.models import Count, Sum, F, OuterRef, Subquery
from django.shortcuts import render, get_object_or_404
from django.views.decorators.http import require_POST
from django.http import JsonResponse

from apps.collection.models import CollectionItem
from apps.collection.views import _portfolio_value
from .models import Notification, PortfolioSnapshot, User


# ── Home ──────────────────────────────────────────────────────────────────────

def home(request):
    if request.user.is_authenticated:
        from django.shortcuts import redirect
        return redirect("dashboard")
    features = [
        ("graph-up-arrow", "Live Portfolio", "Real-time market value with price history charts."),
        ("shop",           "P2P Marketplace", "Buy, sell, and trade — no middleman."),
        ("bell",           "Price Alerts",    "Get notified when your cards spike in value."),
    ]
    return render(request, "home.html", {"features": features})


# ── Dashboard ─────────────────────────────────────────────────────────────────

@login_required
def dashboard(request):
    user = request.user

    collection_qs = CollectionItem.objects.filter(user=user, is_hunted=False).select_related("card")

    stats = collection_qs.aggregate(total_cards=Sum("quantity"), unique_cards=Count("id"))
    tcg_breakdown = (
        collection_qs.values("card__tcg").annotate(count=Sum("quantity")).order_by("-count")
    )

    want_count    = CollectionItem.objects.filter(user=user, is_hunted=True).count()
    for_sale_count = collection_qs.filter(for_sale=True).count()
    recent        = collection_qs.order_by("-created_at")[:6]
    top_value     = [i for i in collection_qs.order_by("-card__market_price")[:10]
                     if i.card.market_price][:5]

    # Unread notifications (cap at 10 for panel)
    notifications = Notification.objects.filter(user=user, is_read=False)[:10]
    unread_count  = Notification.objects.filter(user=user, is_read=False).count()

    # Portfolio history — last 30 snapshots
    snapshots = list(
        PortfolioSnapshot.objects
        .filter(user=user)
        .order_by("-date")[:30]
    )
    snapshots.reverse()  # chronological for chart
    chart_labels = [s.date.strftime("%b %-d") for s in snapshots]
    chart_values = [float(s.value) for s in snapshots]

    # If no real snapshots yet, use current value as a single point
    if not chart_values:
        chart_labels = [date.today().strftime("%b %-d")]
        chart_values = [float(_portfolio_value(user))]

    context = {
        "stats":          stats,
        "tcg_breakdown":  tcg_breakdown,
        "want_count":     want_count,
        "for_sale_count": for_sale_count,
        "recent":         recent,
        "top_value":      top_value,
        "portfolio_value": _portfolio_value(user),
        "notifications":  notifications,
        "unread_count":   unread_count,
        "chart_labels":   chart_labels,
        "chart_values":   chart_values,
    }
    return render(request, "dashboard/index.html", context)


@login_required
@require_POST
def mark_notifications_read(request):
    Notification.objects.filter(user=request.user, is_read=False).update(is_read=True)
    return JsonResponse({"ok": True})


# ── Public profile ────────────────────────────────────────────────────────────

def public_profile(request, username):
    profile_user = get_object_or_404(User, username=username, is_public=True)
    collection_qs = CollectionItem.objects.filter(
        user=profile_user, is_hunted=False
    ).select_related("card")
    stats = collection_qs.aggregate(total_cards=Sum("quantity"), unique_cards=Count("id"))
    tcg_breakdown = (
        collection_qs.values("card__tcg").annotate(count=Sum("quantity")).order_by("-count")
    )
    context = {
        "profile_user":  profile_user,
        "stats":         stats,
        "tcg_breakdown": tcg_breakdown,
        "collection":    collection_qs.order_by("-created_at")[:20],
    }
    return render(request, "accounts/profile.html", context)


# ── Leaderboard ───────────────────────────────────────────────────────────────

def leaderboard(request):
    # Top 10 by current total_collection_value
    top_value = (
        User.objects
        .filter(is_public=True, show_on_leaderboard=True, total_collection_value__gt=0)
        .order_by("-total_collection_value")[:10]
    )

    # Top 10 by 30-day growth %
    # Compare today's snapshot vs 30 days ago snapshot
    today      = date.today()
    thirty_ago = today - timedelta(days=30)

    snap_today = PortfolioSnapshot.objects.filter(
        user=OuterRef("pk"), date=today
    ).values("value")[:1]
    snap_30    = PortfolioSnapshot.objects.filter(
        user=OuterRef("pk"), date__lte=thirty_ago
    ).order_by("-date").values("value")[:1]

    top_growth = (
        User.objects
        .filter(is_public=True, show_on_leaderboard=True)
        .annotate(
            val_today=Subquery(snap_today),
            val_30=Subquery(snap_30),
        )
        .exclude(val_today=None, val_30=None)
        # growth pct computed in Python — avoids db-specific division syntax
    )

    growth_rows = []
    for u in top_growth:
        if u.val_today and u.val_30 and u.val_30 > 0:
            pct = ((Decimal(str(u.val_today)) - Decimal(str(u.val_30)))
                   / Decimal(str(u.val_30)) * 100)
            growth_rows.append((u, pct))
    growth_rows.sort(key=lambda x: x[1], reverse=True)
    top_growth_final = growth_rows[:10]

    context = {
        "top_value":  top_value,
        "top_growth": top_growth_final,
    }
    return render(request, "accounts/leaderboard.html", context)
