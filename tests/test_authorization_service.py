from __future__ import annotations

from backend.services.authorization_service import (
    PERM_DASHBOARD_READ,
    PERM_MY_FILES_AUDIT_READ,
    PERM_MY_FILES_READ,
    PERM_MY_FILES_SHARE,
    PERM_MY_FILES_WRITE,
    PERM_PASSWORDS_READ,
    PERM_PASSWORDS_WRITE,
    PERM_TASKS_CREATE,
    PERM_TASKS_WRITE,
    PERM_TICKETS_PERSONAL_DATA_READ,
    PERM_TICKETS_READ,
    PERM_TICKETS_WRITE,
    authorization_service,
)


def test_operator_role_does_not_get_tickets_access_by_default():
    permissions = set(authorization_service.get_permissions_for_role("operator"))

    assert PERM_DASHBOARD_READ in permissions
    assert PERM_TASKS_CREATE in permissions
    assert PERM_TICKETS_READ not in permissions
    assert PERM_TICKETS_WRITE not in permissions
    assert PERM_TICKETS_PERSONAL_DATA_READ not in permissions
    assert PERM_PASSWORDS_READ not in permissions
    assert PERM_PASSWORDS_WRITE not in permissions


def test_viewer_role_does_not_get_tickets_access_by_default():
    permissions = set(authorization_service.get_permissions_for_role("viewer"))

    assert PERM_DASHBOARD_READ in permissions
    assert PERM_TICKETS_READ not in permissions
    assert PERM_TICKETS_WRITE not in permissions
    assert PERM_TICKETS_PERSONAL_DATA_READ not in permissions
    assert PERM_PASSWORDS_READ not in permissions
    assert PERM_PASSWORDS_WRITE not in permissions
    assert PERM_TASKS_CREATE in permissions
    assert PERM_TASKS_WRITE not in permissions
    assert PERM_MY_FILES_READ in permissions
    assert PERM_MY_FILES_WRITE in permissions
    assert PERM_MY_FILES_SHARE in permissions
    assert PERM_MY_FILES_AUDIT_READ not in permissions


def test_tickets_permissions_remain_available_for_manual_assignment():
    all_permissions = set(authorization_service.get_all_permissions())

    assert PERM_TICKETS_READ in all_permissions
    assert PERM_TICKETS_WRITE in all_permissions
    assert PERM_TICKETS_PERSONAL_DATA_READ in all_permissions
    assert PERM_PASSWORDS_READ in all_permissions
    assert PERM_PASSWORDS_WRITE in all_permissions
    assert PERM_TASKS_CREATE in all_permissions
    assert PERM_MY_FILES_AUDIT_READ in all_permissions
    assert authorization_service.has_permission(
        "operator",
        PERM_TICKETS_READ,
        use_custom_permissions=True,
        custom_permissions=[PERM_TICKETS_READ],
    )
    assert authorization_service.has_permission(
        "operator",
        PERM_PASSWORDS_READ,
        use_custom_permissions=True,
        custom_permissions=[PERM_PASSWORDS_READ],
    )


def test_admin_role_keeps_tickets_access_by_default():
    permissions = set(authorization_service.get_permissions_for_role("admin"))

    assert PERM_TICKETS_READ in permissions
    assert PERM_TICKETS_WRITE in permissions
    assert PERM_TICKETS_PERSONAL_DATA_READ in permissions
    assert PERM_PASSWORDS_READ in permissions
    assert PERM_PASSWORDS_WRITE in permissions
    assert PERM_MY_FILES_AUDIT_READ in permissions
