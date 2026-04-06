from django.contrib import admin
from .models import CollectionItem


@admin.register(CollectionItem)
class CollectionItemAdmin(admin.ModelAdmin):
    list_display = ("user", "card", "condition", "quantity", "is_foil", "is_hunted", "for_sale", "purchase_price")
    list_filter = ("condition", "is_foil", "is_hunted", "for_sale", "card__tcg")
    search_fields = ("user__username", "card__name", "card__set_name")
    raw_id_fields = ("user", "card")
