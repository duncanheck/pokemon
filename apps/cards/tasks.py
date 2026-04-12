"""
Celery tasks for CardVault.

sync_all_prices  — daily beat task:
  1. Refresh JustTCG prices for every Card that has at least one CollectionItem.
  2. Record a daily CardPriceHistory row (drives sparklines).
  3. Detect surges/drops vs previous price, respecting per-card alert thresholds.
  4. Fire notifications + optional emails.
  5. Take a PortfolioSnapshot for every affected user.
  6. Update User.total_collection_value / total_cards.
"""
import logging
from datetime import date, timedelta
from decimal import Decimal

from celery import shared_task
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import send_mail
from django.db.models import Sum
from django.utils import timezone

from apps.cards.services import get_card_prices
from apps.collection.models import CollectionItem

logger = logging.getLogger(__name__)
User = get_user_model()

SURGE_PCT = getattr(settings, "PRICE_SURGE_PCT", 15)
DROP_PCT  = getattr(settings, "PRICE_DROP_PCT",  15)


@shared_task(bind=True, max_retries=2, default_retry_delay=300)
def sync_all_prices(self):
    """
    Main daily sync.  Runs inside a try/except so a partial failure
    never kills the whole beat schedule.
    """
    from apps.cards.models import Card

    # Cards that are actually in someone's collection or want list
    active_card_ids = (
        CollectionItem.objects
        .values_list("card_id", flat=True)
        .distinct()
    )
    cards = Card.objects.filter(pk__in=active_card_ids)
    logger.info("sync_all_prices: syncing %d cards", cards.count())

    refreshed = 0
    for card in cards.iterator(chunk_size=100):
        try:
            _refresh_single_card(card)
            refreshed += 1
        except Exception as exc:
            logger.warning("Failed to refresh card %s: %s", card.tcg_id, exc)

    logger.info("sync_all_prices: refreshed %d cards", refreshed)

    # Portfolio snapshots + user stat update
    _take_portfolio_snapshots()
    return f"Refreshed {refreshed} cards"


def _refresh_single_card(card):
    """Fetch fresh prices, record history, detect alerts, persist to DB."""
    from apps.cards.models import Card, CardPriceHistory

    prices = get_card_prices(card.tcg_id)
    if not prices:
        return

    old_market = card.market_price
    new_market  = prices.get("market_price")

    # Persist updated prices
    Card.objects.filter(pk=card.pk).update(
        **{k: v for k, v in prices.items() if v is not None},
        price_updated_at=timezone.now(),
    )

    # Daily price history snapshot (upsert — safe to run multiple times)
    CardPriceHistory.objects.update_or_create(
        card=card,
        date=date.today(),
        defaults={
            "market_price": new_market,
            "foil_price":   prices.get("foil_price"),
        },
    )

    if old_market and new_market and old_market > 0:
        _check_and_notify(card, old_market, new_market)


def _check_and_notify(card, old_price: Decimal, new_price: Decimal):
    """Create surge/drop notifications respecting per-card alert thresholds."""
    pct_change = ((new_price - old_price) / old_price) * 100

    if pct_change > 0:
        # Surge — check each owner's threshold individually
        surge_ids = []
        for item in (CollectionItem.objects
                     .filter(card=card, is_hunted=False)
                     .only("user_id", "alert_surge_pct")):
            threshold = item.alert_surge_pct if item.alert_surge_pct is not None else SURGE_PCT
            if pct_change >= threshold:
                surge_ids.append(item.user_id)
        if surge_ids:
            _bulk_notify(
                surge_ids, card, "price_surge",
                f"up {pct_change:.0f}%", "📈", new_price,
            )

    elif pct_change < 0:
        # Drop — check each hunter's threshold individually
        drop_ids = []
        for item in (CollectionItem.objects
                     .filter(card=card, is_hunted=True)
                     .only("user_id", "alert_drop_pct")):
            threshold = item.alert_drop_pct if item.alert_drop_pct is not None else DROP_PCT
            if abs(pct_change) >= threshold:
                drop_ids.append(item.user_id)
        if drop_ids:
            _bulk_notify(
                drop_ids, card, "price_drop",
                f"down {abs(pct_change):.0f}%", "📉", new_price,
            )


def _bulk_notify(user_ids, card, notif_type, direction, emoji, new_price):
    from apps.accounts.models import Notification

    users = User.objects.filter(pk__in=user_ids).only("pk", "email", "username")
    notifs = []
    for user in users:
        msg = (
            f"{emoji} {card.name} ({card.set_name}) price moved {direction} "
            f"to ${new_price:.2f}"
        )
        notifs.append(Notification(
            user=user,
            notif_type=notif_type,
            message=msg,
            link=f"/cards/{card.tcg_id}/",
        ))
        try:
            send_mail(
                subject=f"TCGLedger Alert: {card.name} price moved {direction}",
                message=msg + "\n\nLog in to TCGLedger to view your portfolio.",
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[user.email],
                fail_silently=True,
            )
        except Exception:
            pass

    if notifs:
        Notification.objects.bulk_create(notifs, ignore_conflicts=True)


def _take_portfolio_snapshots():
    """
    For every user with collection items, compute today's total value
    and save a PortfolioSnapshot, then update User aggregate fields.
    """
    from apps.accounts.models import PortfolioSnapshot
    from apps.collection.views import _portfolio_value

    today = date.today()
    users_with_items = User.objects.filter(
        collection_items__is_hunted=False
    ).distinct()

    for user in users_with_items.iterator(chunk_size=200):
        value = _portfolio_value(user)

        PortfolioSnapshot.objects.update_or_create(
            user=user, date=today,
            defaults={"value": value},
        )

        total_cards = (
            CollectionItem.objects
            .filter(user=user, is_hunted=False)
            .aggregate(n=Sum("quantity"))["n"] or 0
        )
        User.objects.filter(pk=user.pk).update(
            total_collection_value=value,
            total_cards=total_cards,
        )

    logger.info("_take_portfolio_snapshots: processed %d users", users_with_items.count())
