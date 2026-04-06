from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    """Extended user with CardVault-specific profile fields."""

    bio = models.TextField(blank=True)
    avatar = models.ImageField(upload_to="avatars/", blank=True, null=True)
    location = models.CharField(max_length=100, blank=True)
    is_public = models.BooleanField(default=True)
    show_on_leaderboard = models.BooleanField(default=True, help_text="Opt in to public leaderboard")

    TCG_CHOICES = [
        ("pokemon", "Pokémon"),
        ("mtg", "Magic: The Gathering"),
        ("yugioh", "Yu-Gi-Oh!"),
        ("onepiece", "One Piece"),
        ("lorcana", "Lorcana"),
    ]
    preferred_tcg = models.CharField(max_length=20, choices=TCG_CHOICES, default="pokemon")

    # Aggregate stats — updated by Celery tasks
    total_collection_value = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    total_cards = models.PositiveIntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.username


class PortfolioSnapshot(models.Model):
    """Daily record of a user's total portfolio value — drives history charts."""
    user  = models.ForeignKey(User, on_delete=models.CASCADE, related_name="snapshots")
    date  = models.DateField(db_index=True)
    value = models.DecimalField(max_digits=12, decimal_places=2)

    class Meta:
        unique_together = ("user", "date")
        ordering = ["date"]

    def __str__(self):
        return f"{self.user.username} {self.date} ${self.value}"


class Notification(models.Model):
    """In-app notification (price surge, offer accepted, etc.)."""
    TYPE_CHOICES = [
        ("price_surge",   "Price Surge"),
        ("price_drop",    "Price Drop"),
        ("offer_received","Offer Received"),
        ("offer_accepted","Offer Accepted"),
        ("offer_declined","Offer Declined"),
        ("system",        "System"),
    ]

    user       = models.ForeignKey(User, on_delete=models.CASCADE, related_name="notifications")
    notif_type = models.CharField(max_length=20, choices=TYPE_CHOICES, default="system")
    message    = models.TextField()
    link       = models.CharField(max_length=255, blank=True)
    is_read    = models.BooleanField(default=False, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"[{self.notif_type}] {self.user.username}: {self.message[:60]}"
