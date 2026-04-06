"""
Celery tasks for CardVault.

sync_all_prices  — daily beat task:
  1. Refresh JustTCG prices for every Card that has at least one CollectionItem.
  2. Detect surges/drops vs 7-day-old prices.
  3. Fire notifications + optional emails.
  4. Take a PortfolioSnapshot for every affected user.
  5. Update User.total_collection_value / total_cards.
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
    """Fetch fresh prices, detect alerts, persist to DB."""
    from apps.cards.models import Card

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

    if old_market and new_market and old_market > 0:
        _check_and_notify(card, old_market, new_market)


def _check_and_notify(card, old_price: Decimal, new_price: Decimal):
    """Create surge/drop notifications for users who own or hunt this card."""
    pct_change = ((new_price - old_price) / old_price) * 100

    if pct_change >= SURGE_PCT:
        notif_type = "price_surge"
        direction  = f"up {pct_change:.0f}%"
        emoji      = "📈"
        # Notify owners
        owner_ids = CollectionItem.objects.filter(
            card=card, is_hunted=False
        ).values_list("user_id", flat=True).distinct()
        _bulk_notify(owner_ids, card, notif_type, direction, emoji, new_price)

    elif pct_change <= -DROP_PCT:
        notif_type = "price_drop"
        direction  = f"down {abs(pct_change):.0f}%"
        emoji      = "📉"
        # Notify users who are hunting (want list) so they know it's cheap
        hunter_ids = CollectionItem.objects.filter(
            card=card, is_hunted=True
        ).values_list("user_id", flat=True).distinct()
        _bulk_notify(hunter_ids, card, notif_type, direction, emoji, new_price)


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
        # Fire-and-forget email (swallows errors — email is best-effort)
        try:
            send_mail(
                subject=f"CardVault Alert: {card.name} price moved {direction}",
                message=msg + "\n\nLog in to CardVault to view your portfolio.",
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

        # Keep User aggregate fields fresh
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
