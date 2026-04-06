from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from .models import User, PortfolioSnapshot, Notification


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ("username", "email", "preferred_tcg", "total_cards", "total_collection_value", "is_public")
    list_filter = ("preferred_tcg", "is_public", "is_staff")
    fieldsets = BaseUserAdmin.fieldsets + (
        ("CardVault Profile", {
            "fields": ("bio", "avatar", "location", "is_public", "show_on_leaderboard",
                       "preferred_tcg", "total_collection_value", "total_cards")
        }),
    )


@admin.register(PortfolioSnapshot)
class PortfolioSnapshotAdmin(admin.ModelAdmin):
    list_display = ("user", "date", "value")
    list_filter  = ("date",)
    raw_id_fields = ("user",)


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display  = ("user", "notif_type", "message", "is_read", "created_at")
    list_filter   = ("notif_type", "is_read")
    raw_id_fields = ("user",)
