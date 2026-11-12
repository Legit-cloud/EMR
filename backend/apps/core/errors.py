"""Domain errors. The API layer turns them into the standard error format."""


class DomainError(Exception):
    """Base class for business-rule failures that callers are expected to handle."""

    code = "domain_error"
    status_code = 400

    def __init__(self, message: str = "", *, details: dict | None = None):
        super().__init__(message or self.__class__.__doc__ or self.code)
        self.message = str(self.args[0])
        self.details = details or {}


class TenantError(DomainError):
    """Tenant isolation rule broken."""

    code = "tenant_error"
    status_code = 403


class TenantContextMissing(TenantError):
    """No tenant is active, so a tenant-owned record cannot be written."""

    code = "tenant_context_missing"


class CrossTenantAccess(TenantError):
    """A record of one tenant cannot be written or linked from another tenant."""

    code = "cross_tenant_access"


class HardDeleteNotAllowed(DomainError):
    """Clinical records are never hard-deleted; mark them Entered-in-Error instead."""

    code = "hard_delete_not_allowed"
    status_code = 409


class TenantInactive(TenantError):
    """This facility's account is not active."""

    code = "tenant_inactive"
