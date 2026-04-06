from django.urls import path
from . import views

urlpatterns = [
    path("",                            views.marketplace_browse, name="marketplace_browse"),
    path("create/",                     views.listing_create,     name="listing_create"),
    path("my/",                         views.my_listings,        name="my_listings"),
    path("my/offers/",                  views.my_offers,          name="my_offers"),
    path("<int:pk>/",                   views.listing_detail,     name="listing_detail"),
    path("<int:pk>/edit/",              views.listing_edit,       name="listing_edit"),
    path("<int:pk>/cancel/",            views.listing_cancel,     name="listing_cancel"),
    path("<int:pk>/offer/",             views.make_offer,         name="make_offer"),
    path("offer/<int:offer_pk>/respond/",  views.respond_offer,  name="respond_offer"),
    path("offer/<int:offer_pk>/withdraw/", views.withdraw_offer, name="withdraw_offer"),
    path("offer/<int:offer_pk>/accept-counter/", views.accept_counter, name="accept_counter"),
]
