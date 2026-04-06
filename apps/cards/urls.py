from django.urls import path
from . import views

urlpatterns = [
    path("",                    views.card_search,      name="card_search"),
    path("<str:tcg_id>/",       views.card_detail,      name="card_detail"),
    path("add/",                views.add_to_collection, name="add_to_collection"),
]
