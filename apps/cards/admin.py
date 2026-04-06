from django.contrib import admin
from .models import Card


@admin.register(Card)
class CardAdmin(admin.ModelAdmin):
    list_display = ("name", "tcg", "set_name", "number", "rarity", "market_price", "price_updated_at")
    list_filter = ("tcg", "rarity", "set_name")
    search_fields = ("name", "tcg_id", "set_name", "set_code")
    readonly_fields = ("tcg_id", "created_at", "updated_at", "price_updated_at")
