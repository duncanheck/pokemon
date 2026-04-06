from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models


class CollectionItem(models.Model):
    """A single card in a user's collection (Have list) or Want list."""

    CONDITION_CHOICES = [
        ("M",   "Mint"),
        ("NM",  "Near Mint"),
        ("LP",  "Lightly Played"),
        ("MP",  "Moderately Played"),
        ("HP",  "Heavily Played"),
        ("DMG", "Damaged"),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="collection_items"
    )
    card = models.ForeignKey(
        "cards.Card", on_delete=models.CASCADE, related_name="collection_items"
    )

    condition = models.CharField(max_length=3, choices=CONDITION_CHOICES, default="NM")
    quantity = models.PositiveIntegerField(default=1, validators=[MinValueValidator(1)])
    is_foil = models.BooleanField(default=False)

    # Financial tracking
    purchase_price = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True,
        help_text="What the user paid (for portfolio P&L)"
    )
    purchase_date = models.DateField(null=True, blank=True)

    # Flags
    is_hunted = models.BooleanField(default=False, help_text="On user's Want list")
    for_sale = models.BooleanField(default=False, help_text="User is willing to sell/trade")

    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        # A user can hold multiple copies of the same card in different conditions
        unique_together = ("user", "card", "condition", "is_foil")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user.username} — {self.card.name} x{self.quantity} ({self.condition})"

    @property
    def current_value(self):
        """Live value based on cached market price."""
        price = self.card.foil_price if self.is_foil else self.card.market_price
        if price:
            return price * self.quantity
        return None

    @property
    def gain_loss(self):
        """Unrealised P&L."""
        if self.purchase_price and self.current_value is not None:
            return self.current_value - (self.purchase_price * self.quantity)
        return None
