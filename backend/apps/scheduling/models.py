from django.conf import settings
from django.contrib.postgres.constraints import ExclusionConstraint
from django.contrib.postgres.fields import DateTimeRangeField, RangeBoundary, RangeOperators
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import F, Func, Q

from apps.core.models import TenantModel


class TsTzRange(Func):
    function = "TSTZRANGE"
    output_field = DateTimeRangeField()


class AppointmentType(models.TextChoices):
    NEW = "new", "New visit"
    FOLLOW_UP = "follow_up", "Follow-up"
    PROCEDURE = "procedure", "Procedure"
    EMERGENCY = "emergency", "Emergency"


class AppointmentStatus(models.TextChoices):
    BOOKED = "booked", "Booked"
    CONFIRMED = "confirmed", "Confirmed"
    CHECKED_IN = "checked_in", "Checked in"
    IN_CONSULTATION = "in_consultation", "In consultation"
    COMPLETED = "completed", "Completed"
    NO_SHOW = "no_show", "No-show"
    CANCELLED = "cancelled", "Cancelled"


S = AppointmentStatus
TRANSITIONS = {
    S.BOOKED: {S.CONFIRMED, S.CHECKED_IN, S.CANCELLED, S.NO_SHOW},
    S.CONFIRMED: {S.CHECKED_IN, S.CANCELLED, S.NO_SHOW},
    S.CHECKED_IN: {S.IN_CONSULTATION, S.CANCELLED},
    S.IN_CONSULTATION: {S.COMPLETED},
    S.COMPLETED: set(),
    S.NO_SHOW: set(),
    S.CANCELLED: set(),
}
# Statuses that hold the physician's time.
HOLDING_STATUSES = [S.BOOKED, S.CONFIRMED, S.CHECKED_IN, S.IN_CONSULTATION]


class AvailabilityWindow(TenantModel):
    """A period in which a physician takes bookings."""

    physician = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+"
    )
    facility = models.ForeignKey("tenants.Facility", on_delete=models.PROTECT, related_name="+")
    department = models.ForeignKey(
        "tenants.Department", on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    start_at = models.DateTimeField()
    end_at = models.DateTimeField()

    class Meta(TenantModel.Meta):
        ordering = ["start_at"]
        constraints = [
            models.CheckConstraint(condition=Q(end_at__gt=F("start_at")), name="window_has_length"),
            ExclusionConstraint(
                name="windows_do_not_overlap",
                expressions=[
                    (TsTzRange("start_at", "end_at", RangeBoundary()), RangeOperators.OVERLAPS),
                    ("physician", RangeOperators.EQUAL),
                ],
            ),
        ]

    def __str__(self) -> str:
        return f"{self.physician_id} {self.start_at:%Y-%m-%d %H:%M}-{self.end_at:%H:%M}"


class Appointment(TenantModel):
    """The single appointment entity (CLAUDE.md Section 5): seven states, no double-booking.

    The exclusion constraint makes double-booking impossible in the database, even for
    simultaneous requests: two appointments of one physician that hold time cannot
    overlap. Emergency appointments are outside the constraint, so they may overbook.
    """

    patient = models.ForeignKey("patients.Patient", on_delete=models.PROTECT, related_name="+")
    physician = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+"
    )
    facility = models.ForeignKey("tenants.Facility", on_delete=models.PROTECT, related_name="+")
    department = models.ForeignKey(
        "tenants.Department", on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    appointment_type = models.CharField(max_length=12, choices=AppointmentType.choices)
    start_at = models.DateTimeField()
    end_at = models.DateTimeField()
    status = models.CharField(
        max_length=16, choices=AppointmentStatus.choices, default=AppointmentStatus.BOOKED
    )
    reason = models.CharField(max_length=500, blank=True)
    cancellation_reason = models.CharField(max_length=500, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    # 1 is the most urgent. Set at check-in.
    triage_priority = models.PositiveSmallIntegerField(null=True, blank=True)
    checked_in_at = models.DateTimeField(null=True, blank=True)
    checked_in_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    consultation_started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    encounter_id = models.UUIDField(null=True, blank=True)
    # Shared by the appointments of one recurring booking.
    series_id = models.UUIDField(null=True, blank=True, db_index=True)

    class Meta(TenantModel.Meta):
        ordering = ["start_at"]
        indexes = [models.Index(fields=["physician", "start_at"], name="appointment_physician_day")]
        constraints = [
            models.CheckConstraint(
                condition=Q(end_at__gt=F("start_at")), name="appointment_has_length"
            ),
            models.CheckConstraint(
                condition=~Q(status="cancelled") | ~Q(cancellation_reason=""),
                name="cancellation_needs_reason",
            ),
            models.CheckConstraint(
                condition=Q(triage_priority__isnull=True)
                | Q(triage_priority__gte=1, triage_priority__lte=5),
                name="triage_priority_1_to_5",
            ),
            ExclusionConstraint(
                name="no_double_booking",
                expressions=[
                    (TsTzRange("start_at", "end_at", RangeBoundary()), RangeOperators.OVERLAPS),
                    ("physician", RangeOperators.EQUAL),
                ],
                condition=Q(status__in=HOLDING_STATUSES) & ~Q(appointment_type="emergency"),
                violation_error_message="The physician already has an appointment at this time.",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.start_at:%Y-%m-%d %H:%M} ({self.get_status_display()})"

    @classmethod
    def care_team_q(cls, user_id) -> Q:
        """A physician's own appointments."""
        return Q(physician_id=user_id)

    def clean(self):
        super().clean()
        if self.department_id and self.department.facility_id != self.facility_id:
            raise ValidationError({"department": "The department is in a different facility."})


class AppointmentReminder(TenantModel):
    """Records that the reminder for one offset was sent, so it is never sent twice."""

    appointment = models.ForeignKey(Appointment, on_delete=models.CASCADE, related_name="reminders")
    offset_hours = models.PositiveSmallIntegerField()
    sent_at = models.DateTimeField()

    class Meta(TenantModel.Meta):
        constraints = [
            models.UniqueConstraint(
                fields=["appointment", "offset_hours"], name="one_reminder_per_offset"
            )
        ]

    def __str__(self) -> str:
        return f"{self.offset_hours}h reminder for {self.appointment_id}"
