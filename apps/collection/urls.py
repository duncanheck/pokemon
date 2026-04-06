from django.urls import path
from . import views

urlpatterns = [
    path("",                    views.collection_list,   name="collection_list"),
    path("<int:pk>/update/",    views.collection_update, name="collection_update"),
    path("<int:pk>/delete/",    views.collection_delete, name="collection_delete"),
    path("<int:pk>/toggle/",    views.collection_toggle, name="collection_toggle"),
]
