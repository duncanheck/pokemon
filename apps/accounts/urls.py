from django.urls import path
from . import views

urlpatterns = [
    path("",                            views.home,                    name="home"),
    path("dashboard/",                  views.dashboard,               name="dashboard"),
    path("profile/<str:username>/",     views.public_profile,          name="public_profile"),
    path("leaderboard/",                views.leaderboard,             name="leaderboard"),
    path("notifications/read/",         views.mark_notifications_read, name="notifications_read"),
    path("notifications/stream/",       views.notification_stream,     name="notification_stream"),
]
