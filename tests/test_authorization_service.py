from __future__ import annotations

from backend.services.authorization_service import (
    PERM_DASHBOARD_READ,
    PERM_TICKETS_PERSONAL_DATA_READ,
    PERM_TICKETS_READ,
    PERM_TICKETS_WRITE,
    authorization_service,
)


def test_operator_role_does_not_get_tickets_access_by_default():
    permissions = set(authorization_service.get_permissions_for_role("operator"))

    assert PERM_DASHBOARD_READ in permissions
    assert PERM_TICKETS_READ not in permissions
    assert PERM_TICKETS_WRITE not in permissions
    assert PERM_TICKETS_PERSONAL_DATA_READ not in permissions


def test_viewer_role_does_not_get_tickets_access_by_default():
    permissions = set(authorization_service.get_permissions_for_role("viewer"))

    assert PERM_DASHBOARD_READ in permissions
    assert PERM_TICKETS_READ not in permissions
    assert PERM_TICKETS_WRITE not in permissions
    assert PERM_TICKETS_PERSONAL_DATA_READ not in permissions


def test_tickets_permissions_remain_available_for_manual_assignment():
    all_permissions = set(authorization_service.get_all_permissions())

    assert PERM_TICKETS_READ in all_permissions
    assert PERM_TICKETS_WRITE in all_permissions
    assert PERM_TICKETS_PERSONAL_DATA_READ in all_permissions
    assert authorization_service.has_permission(
        "operator",
        PERM_TICKETS_READ,
        use_custom_permissions=True,
        custom_permissions=[PERM_TICKETS_READ],
    )


def test_admin_role_keeps_tickets_access_by_default():
    permissions = set(authorization_service.get_permissions_for_role("admin"))

    assert PERM_TICKETS_READ in permissions
    assert PERM_TICKETS_WRITE in permissions
    assert PERM_TICKETS_PERSONAL_DATA_READ in permissions
