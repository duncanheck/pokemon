from django.contrib import admin
from .models import Listing, Offer


@admin.register(Listing)
class ListingAdmin(admin.ModelAdmin):
    list_display = ("seller", "collection_item", "listing_type", "asking_price", "status", "views_count", "created_at")
    list_filter = ("status", "listing_type", "accepts_offers")
    search_fields = ("seller__username", "collection_item__card__name")
    raw_id_fields = ("seller", "collection_item")


@admin.register(Offer)
class OfferAdmin(admin.ModelAdmin):
    list_display = ("buyer", "listing", "offered_price", "status", "created_at", "expires_at")
    list_filter = ("status",)
    search_fields = ("buyer__username", "listing__collection_item__card__name")
    raw_id_fields = ("buyer", "listing")
