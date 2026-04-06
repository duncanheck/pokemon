from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models


class Listing(models.Model):
    """A card listed for sale or trade on the marketplace."""

    STATUS_CHOICES = [
        ("active",    "Active"),
        ("reserved",  "Reserved"),
        ("sold",      "Sold"),
        ("cancelled", "Cancelled"),
    ]

    LISTING_TYPE_CHOICES = [
        ("sale",  "Sale"),
        ("trade", "Trade"),
        ("both",  "Sale or Trade"),
    ]

    seller = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="listings"
    )
    collection_item = models.ForeignKey(
        "collection.CollectionItem", on_delete=models.CASCADE, related_name="listings",
        help_text="Source item from seller's collection"
    )

    listing_type = models.CharField(max_length=5, choices=LISTING_TYPE_CHOICES, default="sale")
    asking_price = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True,
        validators=[MinValueValidator(0.01)],
        help_text="Required for sale/both listings"
    )
    accepts_offers = models.BooleanField(default=True)
    quantity_available = models.PositiveIntegerField(default=1)

    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="active", db_index=True)
    description = models.TextField(blank=True)

    # Trade preferences — free text, e.g. "Looking for Charizard ex"
    trade_wants = models.TextField(blank=True)

    views_count = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "listing_type"]),
            models.Index(fields=["seller"]),
        ]

    def __str__(self):
        return f"{self.seller.username} — {self.collection_item.card.name} @ ${self.asking_price}"


class Offer(models.Model):
    """A buyer's offer (price negotiation or trade proposal) on a Listing."""

    STATUS_CHOICES = [
        ("pending",    "Pending"),
        ("accepted",   "Accepted"),
        ("declined",   "Declined"),
        ("countered",  "Countered"),
        ("withdrawn",  "Withdrawn"),
        ("expired",    "Expired"),
    ]

    listing = models.ForeignKey(Listing, on_delete=models.CASCADE, related_name="offers")
    buyer = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="offers_made"
    )

    # Cash component (may be 0 for pure trade offers)
    offered_price = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True,
        validators=[MinValueValidator(0)]
    )
    # Trade component — buyer describes what they're offering
    trade_offer_description = models.TextField(blank=True)

    # Counter-offer from seller
    counter_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    counter_message = models.TextField(blank=True)

    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="pending", db_index=True)
    message = models.TextField(blank=True, help_text="Buyer's message to seller")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    expires_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Offer by {self.buyer.username} on {self.listing} — ${self.offered_price} [{self.status}]"
