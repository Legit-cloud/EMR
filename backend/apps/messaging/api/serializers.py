from rest_framework import serializers


class MessageSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    sender = serializers.UUIDField(source="created_by_id")
    sender_name = serializers.CharField()
    body = serializers.CharField()
    created_at = serializers.DateTimeField()


class ThreadSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    subject = serializers.CharField()
    updated_at = serializers.DateTimeField()
    last_body = serializers.CharField(allow_null=True)
    unread = serializers.IntegerField()
    members = serializers.ListField(child=serializers.CharField())


class ThreadDetailSerializer(ThreadSerializer):
    messages = MessageSerializer(many=True)


class NewThreadSerializer(serializers.Serializer):
    recipients = serializers.ListField(child=serializers.UUIDField(), min_length=1, max_length=50)
    subject = serializers.CharField(max_length=150)
    body = serializers.CharField(max_length=4000)


class ReplySerializer(serializers.Serializer):
    body = serializers.CharField(max_length=4000)
