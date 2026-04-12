from django.db import models


class Card(models.Model):
    """Master card catalogue — populated/updated via JustTCG API sync tasks."""

    TCG_CHOICES = [
        ("pokemon", "Pokémon"),
        ("mtg", "Magic: The Gathering"),
        ("yugioh", "Yu-Gi-Oh!"),
        ("onepiece", "One Piece"),
        ("lorcana", "Lorcana"),
    ]

    RARITY_CHOICES = [
        ("common", "Common"),
        ("uncommon", "Uncommon"),
        ("rare", "Rare"),
        ("holo_rare", "Holo Rare"),
        ("ultra_rare", "Ultra Rare"),
        ("secret_rare", "Secret Rare"),
        ("special", "Special"),
    ]

    # JustTCG identifiers
    tcg_id = models.CharField(max_length=100, unique=True, db_index=True,
                               help_text="Unique card ID from JustTCG API")
    tcg = models.CharField(max_length=20, choices=TCG_CHOICES, db_index=True)

    # Card metadata
    name = models.CharField(max_length=255, db_index=True)
    set_name = models.CharField(max_length=255)
    set_code = models.CharField(max_length=50, blank=True)
    number = models.CharField(max_length=20, blank=True, help_text="Card number within set")
    rarity = models.CharField(max_length=20, choices=RARITY_CHOICES, blank=True)
    artist = models.CharField(max_length=255, blank=True)

    # Images
    image_url = models.URLField(max_length=500, blank=True)
    image_url_hi = models.URLField(max_length=500, blank=True, help_text="High-res image")

    # Pricing — cached from JustTCG, refreshed by Celery tasks
    market_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    low_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    mid_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    high_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    foil_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    price_updated_at = models.DateTimeField(null=True, blank=True)

    # Extra searchable data stored as JSON (HP, types, subtypes, etc.)
    extra_data = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["tcg", "set_name", "number"]
        indexes = [
            models.Index(fields=["tcg", "set_name"]),
            models.Index(fields=["name"]),
        ]

    def __str__(self):
        return f"{self.name} [{self.set_name}] ({self.tcg})"


class CardPriceHistory(models.Model):
    """Daily price snapshot per card — powers 7-day sparklines."""
    card         = models.ForeignKey(Card, on_delete=models.CASCADE, related_name="price_history")
    date         = models.DateField(db_index=True)
    market_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    foil_price   = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)

    class Meta:
        unique_together = ("card", "date")
        ordering = ["date"]
        indexes = [models.Index(fields=["card", "date"])]

    def __str__(self):
        return f"{self.card.name} {self.date} ${self.market_price}"
