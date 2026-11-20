from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts import selectors as accounts
from apps.core.api.mixins import TenantReadOnlyViewSet
from apps.core.policy import Action

from .. import selectors, services
from ..models import Message, Thread
from . import serializers as s


def _thread_data(thread: Thread, user_id, *, with_messages: bool = False) -> dict:
    member_ids = selectors.member_ids(thread)
    names = accounts.display_names(member_ids)
    data = {
        "id": thread.pk,
        "subject": thread.subject,
        "updated_at": thread.updated_at,
        "last_body": getattr(thread, "last_body", None),
        "unread": selectors.unread_count(thread, user_id),
        "members": [names.get(m, "") for m in member_ids],
    }
    if with_messages:
        messages = list(Message.objects.filter(thread=thread))
        for message in messages:
            message.sender_name = names.get(message.created_by_id, "")
        data["messages"] = s.MessageSerializer(messages, many=True).data
    return data


class ThreadViewSet(TenantReadOnlyViewSet):
    """The signed-in person's own conversations. Membership, not role, decides who can read a
    thread, so a thread of other people is a 404 for everyone, the tenant admin included."""

    model = Thread
    policy_resource = "messaging.thread"
    policy_actions = {"reply": Action.UPDATE, "read": Action.VIEW}
    serializer_class = s.ThreadSerializer

    def get_base_queryset(self):
        return selectors.threads_for(self.request.user.pk)

    @extend_schema(responses=s.ThreadSerializer(many=True))
    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.filter_queryset(self.get_queryset()))
        rows = [_thread_data(t, request.user.pk) for t in page]
        return self.get_paginated_response(rows)

    @extend_schema(responses=s.ThreadDetailSerializer)
    def retrieve(self, request, *args, **kwargs):
        thread = self.get_object()
        data = _thread_data(thread, request.user.pk, with_messages=True)
        services.mark_read(thread, request.user.pk)
        return Response(data)

    @extend_schema(request=s.NewThreadSerializer, responses={201: s.ThreadDetailSerializer})
    def create(self, request):
        data = s.NewThreadSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        with transaction.atomic():
            thread = services.start_thread(
                sender_id=request.user.pk,
                recipient_ids=set(data.validated_data["recipients"]),
                subject=data.validated_data["subject"],
                body=data.validated_data["body"],
            )
            self.audit_write(Action.CREATE, thread, ["subject"])
        return Response(_thread_data(thread, request.user.pk, with_messages=True), status=201)

    @extend_schema(request=s.ReplySerializer, responses={201: s.MessageSerializer})
    @action(detail=True, methods=["post"])
    def reply(self, request, pk=None):
        thread = self.get_object()
        data = s.ReplySerializer(data=request.data)
        data.is_valid(raise_exception=True)
        with transaction.atomic():
            message = services.reply(
                thread, sender_id=request.user.pk, body=data.validated_data["body"]
            )
            self.audit_write(Action.UPDATE, thread, ["messages"])
        message.sender_name = accounts.display_names([request.user.pk]).get(request.user.pk, "")
        return Response(s.MessageSerializer(message).data, status=201)
