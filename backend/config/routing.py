"""WebSocket routes."""

from django.urls import path

from apps.scheduling.consumers import QueueConsumer

websocket_urlpatterns = [
    path("ws/queue/<uuid:physician_id>/", QueueConsumer.as_asgi()),
]
