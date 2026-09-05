from __future__ import annotations

from backend.services.authorization_service import (
    PERM_ADDRESS_BOOK_AGE_READ,
    PERM_ADDRESS_BOOK_HIRE_DATE_READ,
    PERM_ADDRESS_BOOK_PERSONAL_EMAIL_READ,
    PERM_ADDRESS_BOOK_PERSONAL_PHONE_READ,
    PERM_ADDRESS_BOOK_READ,
    PERM_ANNOUNCEMENTS_MODERATE,
    PERM_ANNOUNCEMENTS_READ,
    PERM_CHAT_READ,
    PERM_CHAT_WRITE,
    PERM_COMPANY_STRUCTURE_READ,
    PERM_COMPUTERS_MANAGE,
    PERM_DASHBOARD_READ,
    PERM_DOCFLOW_ACT,
    PERM_DOCFLOW_CREATE,
    PERM_DOCFLOW_READ,
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
    PERM_WAREHOUSE_1C_IT_REQUESTS_READ,
    PERM_WAREHOUSE_1C_READ,
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
    assert PERM_COMPUTERS_MANAGE in permissions
    assert PERM_ADDRESS_BOOK_READ in permissions
    assert PERM_ADDRESS_BOOK_AGE_READ not in permissions
    assert PERM_ADDRESS_BOOK_HIRE_DATE_READ not in permissions
    assert PERM_ADDRESS_BOOK_PERSONAL_EMAIL_READ not in permissions
    assert PERM_ADDRESS_BOOK_PERSONAL_PHONE_READ not in permissions


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
    assert PERM_DOCFLOW_READ in permissions
    assert PERM_DOCFLOW_ACT in permissions
    assert PERM_DOCFLOW_CREATE not in permissions
    assert PERM_ADDRESS_BOOK_READ in permissions
    assert PERM_ADDRESS_BOOK_AGE_READ not in permissions
    assert PERM_ADDRESS_BOOK_HIRE_DATE_READ not in permissions
    assert PERM_ADDRESS_BOOK_PERSONAL_EMAIL_READ not in permissions
    assert PERM_ADDRESS_BOOK_PERSONAL_PHONE_READ not in permissions

    operator_permissions = set(authorization_service.get_permissions_for_role("operator"))
    assert PERM_DOCFLOW_ACT in operator_permissions
    assert PERM_DOCFLOW_CREATE in operator_permissions


def test_tickets_permissions_remain_available_for_manual_assignment():
    all_permissions = set(authorization_service.get_all_permissions())

    assert PERM_TICKETS_READ in all_permissions
    assert PERM_TICKETS_WRITE in all_permissions
    assert PERM_TICKETS_PERSONAL_DATA_READ in all_permissions
    assert PERM_PASSWORDS_READ in all_permissions
    assert PERM_PASSWORDS_WRITE in all_permissions
    assert PERM_TASKS_CREATE in all_permissions
    assert PERM_MY_FILES_AUDIT_READ in all_permissions
    assert PERM_ADDRESS_BOOK_AGE_READ in all_permissions
    assert PERM_ADDRESS_BOOK_HIRE_DATE_READ in all_permissions
    assert PERM_ADDRESS_BOOK_PERSONAL_EMAIL_READ in all_permissions
    assert PERM_ADDRESS_BOOK_PERSONAL_PHONE_READ in all_permissions
    assert PERM_COMPUTERS_MANAGE in all_permissions
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
    assert PERM_ADDRESS_BOOK_READ in permissions
    assert PERM_ADDRESS_BOOK_AGE_READ in permissions
    assert PERM_ADDRESS_BOOK_HIRE_DATE_READ in permissions
    assert PERM_ADDRESS_BOOK_PERSONAL_EMAIL_READ in permissions
    assert PERM_ADDRESS_BOOK_PERSONAL_PHONE_READ in permissions
    assert PERM_ANNOUNCEMENTS_MODERATE in permissions
    assert PERM_COMPUTERS_MANAGE in permissions
    assert PERM_WAREHOUSE_1C_READ in permissions
    assert PERM_WAREHOUSE_1C_IT_REQUESTS_READ in permissions


def test_it_requests_permission_is_separate_and_can_be_assigned_individually():
    operator_permissions = set(authorization_service.get_permissions_for_role("operator"))
    assert PERM_WAREHOUSE_1C_READ not in operator_permissions
    assert PERM_WAREHOUSE_1C_IT_REQUESTS_READ not in operator_permissions
    assert authorization_service.has_permission(
        "operator",
        PERM_WAREHOUSE_1C_IT_REQUESTS_READ,
        use_custom_permissions=True,
        custom_permissions=[PERM_WAREHOUSE_1C_IT_REQUESTS_READ],
    )
    assert not authorization_service.has_permission(
        "operator",
        PERM_WAREHOUSE_1C_IT_REQUESTS_READ,
        use_custom_permissions=True,
        custom_permissions=[PERM_WAREHOUSE_1C_READ],
    )


def test_custom_permissions_extend_the_viewer_baseline():
    viewer_permissions = set(authorization_service.get_permissions_for_role("viewer"))
    permissions = set(authorization_service.get_effective_permissions(
        "viewer",
        use_custom_permissions=True,
        custom_permissions=[PERM_TICKETS_READ],
    ))

    assert permissions == viewer_permissions | {PERM_TICKETS_READ}
