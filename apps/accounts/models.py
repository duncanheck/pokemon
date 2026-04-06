from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    """Extended user with CardVault-specific profile fields."""

    bio = models.TextField(blank=True)
    avatar = models.ImageField(upload_to="avatars/", blank=True, null=True)
    location = models.CharField(max_length=100, blank=True)
    is_public = models.BooleanField(default=True, help_text="Public profile visible to all")

    # Preferred TCGs shown on dashboard/leaderboard
    TCG_CHOICES = [
        ("pokemon", "Pokémon"),
        ("mtg", "Magic: The Gathering"),
        ("yugioh", "Yu-Gi-Oh!"),
        ("onepiece", "One Piece"),
        ("lorcana", "Lorcana"),
    ]
    preferred_tcg = models.CharField(max_length=20, choices=TCG_CHOICES, default="pokemon")

    # Aggregate stats — updated by signals/tasks, not calculated live
    total_collection_value = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    total_cards = models.PositiveIntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.username
