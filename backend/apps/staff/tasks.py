"""Celery tasks."""

import logging

from celery import shared_task

from apps.core.tenancy import tenant_context
from apps.tenants.selectors import active_tenant_ids

from . import services

logger = logging.getLogger(__name__)


@shared_task
def run_licence_watcher():
    """Daily (Celery beat): flag expiring and expired licences in every tenant."""
    flagged = 0
    for tenant_id in active_tenant_ids():
        with tenant_context(tenant_id):
            flagged += len(services.watch_licences())
    logger.info("Licence watcher flagged %d licence(s)", flagged)
    return flagged
