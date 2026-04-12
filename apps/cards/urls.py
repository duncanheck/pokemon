from django.urls import path
from . import views

urlpatterns = [
    # Exact-match paths MUST come before <str:tcg_id> to avoid shadowing
    path("",                             views.card_search,        name="card_search"),
    path("sets/",                        views.set_browser,        name="set_browser"),
    path("compare/",                     views.card_compare,       name="card_compare"),
    path("add/",                         views.add_to_collection,  name="add_to_collection"),
    # Dynamic card routes
    path("<str:tcg_id>/",                views.card_detail,        name="card_detail"),
    path("<str:tcg_id>/price.json",      views.card_price_json,    name="card_price_json"),
    path("<str:tcg_id>/sparkline.json",  views.card_sparkline_json, name="card_sparkline_json"),
]
