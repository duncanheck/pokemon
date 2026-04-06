from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from .models import User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ("username", "email", "preferred_tcg", "total_cards", "total_collection_value", "is_public")
    list_filter = ("preferred_tcg", "is_public", "is_staff")
    fieldsets = BaseUserAdmin.fieldsets + (
        ("CardVault Profile", {
            "fields": ("bio", "avatar", "location", "is_public", "preferred_tcg",
                       "total_collection_value", "total_cards")
        }),
    )
