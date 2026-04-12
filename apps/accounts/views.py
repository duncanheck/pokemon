import json
import time
from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth.decorators import login_required
from django.db.models import Count, Sum, F, OuterRef, Subquery
from django.http import JsonResponse, StreamingHttpResponse
from django.shortcuts import render, get_object_or_404
from django.views.decorators.http import require_POST

from apps.collection.models import CollectionItem
from apps.collection.views import _portfolio_value
from .models import Notification, PortfolioSnapshot, User


# ── Home ──────────────────────────────────────────────────────────────────────

def home(request):
    if request.user.is_authenticated:
        from django.shortcuts import redirect
        return redirect("dashboard")
    from apps.cards.models import Card
    features = [
        ("graph-up-arrow",  "Live Portfolio",    "Real-time market value with 30-day history charts and P&L per card.",  "#f5c518"),
        ("shop",            "P2P Marketplace",   "List cards for sale or trade. Negotiate directly — no fees.",           "#00d68f"),
        ("bell",            "Price Surge Alerts","Get notified when any card you own or hunt jumps in value.",            "#7c3aed"),
        ("shield-check",    "Condition Tracking","Track Mint through Damaged grades with purchase-price cost basis.",     "#3b82f6"),
        ("trophy",          "Leaderboard",       "See how your vault stacks up against other collectors.",                "#f97316"),
        ("arrow-left-right","Trade Offers",      "Send counter-offers, accept or decline — full negotiation flow.",       "#ec4899"),
    ]
    return render(request, "home.html", {
        "features":    features,
        "tcg_choices": Card.TCG_CHOICES,
    })


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


@login_required
def notification_stream(request):
    """
    Server-Sent Events endpoint.  Polls every 3 s for new unread notifications
    and pushes them to the browser.  Connection closes after 55 s; the client
    automatically reconnects via the EventSource retry mechanism.
    """
    user_id = request.user.pk

    def _generate():
        # Seed with IDs already present so we only send *new* ones
        seen_ids = set(
            Notification.objects
            .filter(user_id=user_id, is_read=False)
            .values_list("pk", flat=True)
        )
        yield "event: ping\ndata: connected\n\n"

        deadline = time.monotonic() + 55
        while time.monotonic() < deadline:
            time.sleep(3)
            new = list(
                Notification.objects
                .filter(user_id=user_id, is_read=False)
                .exclude(pk__in=seen_ids)
                .order_by("-created_at")[:10]
            )
            if new:
                for n in new:
                    seen_ids.add(n.pk)
                payload = json.dumps({
                    "count":   len(new),
                    "message": new[0].message,
                    "type":    new[0].notif_type,
                    "link":    new[0].link,
                })
                yield f"event: notification\ndata: {payload}\n\n"

    response = StreamingHttpResponse(_generate(), content_type="text/event-stream")
    response["Cache-Control"]    = "no-cache"
    response["X-Accel-Buffering"] = "no"   # disable nginx buffering
    return response


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
