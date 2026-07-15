from __future__ import annotations

from collections.abc import Callable

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.api import deps
from backend.api.v1 import warehouse_1c as warehouse_1c_api
from backend.database import queries as db_queries
from backend.models.auth import User
from backend.models.warehouse_1c import ReconcileApplyPartNoRequest
from backend.services import authorization_service
from backend.services import warehouse_1c_reconcile as reconcile


def _make_user(
    *,
    role: str = "viewer",
    permissions: list[str] | None = None,
    assigned_database: str | None = "ITINVENT",
) -> User:
    permissions = permissions or []
    return User(
        id=71,
        username="reconcile-user",
        full_name="Reconcile User",
        role=role,
        permissions=permissions,
        use_custom_permissions=True,
        custom_permissions=permissions,
        is_active=True,
        assigned_database=assigned_database,
    )


def _client_for(user_factory: Callable[[], User], *, db_id: str | None = "ITINVENT") -> TestClient:
    app = FastAPI()
    app.include_router(warehouse_1c_api.router, prefix="/warehouse-1c")
    app.dependency_overrides[deps.get_current_active_user] = user_factory
    app.dependency_overrides[deps.get_current_database_id] = lambda: db_id
    return TestClient(app)


def _apply_payload(**overrides) -> dict:
    payload = {
        "inv_no": "1001",
        "nomenclature_ref": "11111111-1111-1111-1111-111111111111",
        "part_no": "PN-1001",
        "reason": "Проверено по карточке 1С",
    }
    payload.update(overrides)
    payload.setdefault("confirm", True)
    payload.setdefault("expected_part_no", "")
    payload.setdefault("expected_version", 0)
    return payload


def test_reconcile_write_permission_is_admin_only_by_default():
    assert authorization_service.PERM_WAREHOUSE_1C_RECONCILE_WRITE in (
        authorization_service.authorization_service.get_permissions_for_role("admin")
    )
    assert authorization_service.PERM_WAREHOUSE_1C_RECONCILE_WRITE not in (
        authorization_service.authorization_service.get_permissions_for_role("operator")
    )


def test_apply_request_accepts_camel_case_contract_and_requires_reason():
    request = ReconcileApplyPartNoRequest(
        invNo="1001",
        nomenclatureRef="ref-1",
        partNo="PN-1",
        reason="Подтверждено вручную",
        expectedPartNo="OLD-1",
        expectedVersion=3,
        confirm=True,
    )

    assert request.inv_no == "1001"
    assert request.nomenclature_ref == "ref-1"
    assert request.part_no == "PN-1"
    assert request.expected_part_no == "OLD-1"
    assert request.expected_version == 3
    assert request.confirm is True

    with pytest.raises(ValidationError):
        ReconcileApplyPartNoRequest(
            inv_no="1001",
            nomenclature_ref="ref-1",
            part_no="PN-1",
            reason=" ",
        )


def test_apply_requires_separate_reconcile_write_permission(monkeypatch):
    called = False
    monkeypatch.setattr(
        reconcile,
        "apply_part_no",
        lambda **kwargs: (_ for _ in ()).throw(AssertionError("must not mutate")),
    )
    client = _client_for(
        lambda: _make_user(
            permissions=[
                authorization_service.PERM_WAREHOUSE_1C_READ,
                authorization_service.PERM_DATABASE_WRITE,
            ]
        )
    )

    response = client.post("/warehouse-1c/reconcile/apply-part-no", json=_apply_payload())

    assert response.status_code == 403
    assert called is False


def test_apply_requires_database_write_permission(monkeypatch):
    monkeypatch.setattr(
        reconcile,
        "apply_part_no",
        lambda **kwargs: (_ for _ in ()).throw(AssertionError("must not mutate")),
    )
    client = _client_for(
        lambda: _make_user(
            permissions=[authorization_service.PERM_WAREHOUSE_1C_RECONCILE_WRITE]
        )
    )

    response = client.post("/warehouse-1c/reconcile/apply-part-no", json=_apply_payload())

    assert response.status_code == 403


def test_apply_requires_explicit_preview_confirmation(monkeypatch):
    monkeypatch.setattr(
        reconcile,
        "apply_part_no",
        lambda **kwargs: (_ for _ in ()).throw(AssertionError("must not mutate")),
    )
    client = _client_for(
        lambda: _make_user(
            permissions=[
                authorization_service.PERM_WAREHOUSE_1C_RECONCILE_WRITE,
                authorization_service.PERM_DATABASE_WRITE,
            ]
        )
    )

    response = client.post(
        "/warehouse-1c/reconcile/apply-part-no",
        json=_apply_payload(confirm=False),
    )

    assert response.status_code == 409


def test_apply_requires_expected_part_no_for_optimistic_lock(monkeypatch):
    monkeypatch.setattr(
        reconcile,
        "apply_part_no",
        lambda **kwargs: (_ for _ in ()).throw(AssertionError("must not mutate")),
    )
    client = _client_for(
        lambda: _make_user(
            permissions=[
                authorization_service.PERM_WAREHOUSE_1C_RECONCILE_WRITE,
                authorization_service.PERM_DATABASE_WRITE,
            ]
        )
    )

    response = client.post(
        "/warehouse-1c/reconcile/apply-part-no",
        json=_apply_payload(expected_part_no=None),
    )

    assert response.status_code == 422


def test_apply_requires_expected_registry_version(monkeypatch):
    client = _client_for(
        lambda: _make_user(
            permissions=[
                authorization_service.PERM_WAREHOUSE_1C_RECONCILE_WRITE,
                authorization_service.PERM_DATABASE_WRITE,
            ]
        )
    )

    response = client.post(
        "/warehouse-1c/reconcile/apply-part-no",
        json=_apply_payload(expected_version=None),
    )

    assert response.status_code == 422


def test_write_body_rejects_database_override_and_uses_server_database(monkeypatch):
    captured = {}
    monkeypatch.setattr(db_queries, "get_equipment_by_inv", lambda *args, **kwargs: {"part_no": ""})
    monkeypatch.setattr(
        reconcile,
        "apply_part_no",
        lambda **kwargs: captured.update(kwargs) or {"ok": True, "part_no": kwargs["part_no"]},
    )
    client = _client_for(
        lambda: _make_user(
            permissions=[
                authorization_service.PERM_WAREHOUSE_1C_RECONCILE_WRITE,
                authorization_service.PERM_DATABASE_WRITE,
            ]
        ),
        db_id="ITINVENT",
    )

    response = client.post(
        "/warehouse-1c/reconcile/apply-part-no",
        json=_apply_payload(hub_db_id="other-db"),
    )

    assert response.status_code == 422
    assert captured == {}


def test_non_admin_without_server_owned_database_cannot_fall_back_to_all(monkeypatch):
    user = _make_user(
        permissions=[authorization_service.PERM_WAREHOUSE_1C_READ],
        assigned_database=None,
    )
    from backend.api.v1 import database as database_api

    monkeypatch.setattr(database_api, "get_user_database", lambda *args, **kwargs: None)
    monkeypatch.setattr(database_api.settings_service, "get_user_settings", lambda *args, **kwargs: {})
    with pytest.raises(HTTPException) as exc_info:
        warehouse_1c_api._resolve_scoped_hub_db(
            current_user=user,
            selected_db_id="other-db",
        )

    assert exc_info.value.status_code == 409


def test_all_scope_is_explicit_admin_only_and_allowlisted(monkeypatch):
    viewer = _make_user(permissions=[authorization_service.PERM_WAREHOUSE_1C_READ])
    with pytest.raises(HTTPException) as exc_info:
        warehouse_1c_api._resolve_scoped_hub_db(
            current_user=viewer,
            selected_db_id="assigned-db",
            requested_scope="all",
        )
    assert exc_info.value.status_code == 403

    from backend.api.v1 import database as database_api

    monkeypatch.setenv("WAREHOUSE_1C_RECONCILE_ALLOWED_DB_IDS", "ITINVENT")
    monkeypatch.setattr(database_api, "get_all_db_configs", lambda: [{"id": "ITINVENT", "name": "IT"}])
    admin = _make_user(role="admin", assigned_database=None)
    target_db, scope = warehouse_1c_api._resolve_scoped_hub_db(
        current_user=admin,
        selected_db_id="selected-db",
        requested_scope="all",
    )
    assert target_db is None
    assert scope == "all"


def test_all_scope_fails_closed_without_a_reconcile_allowlist(monkeypatch):
    monkeypatch.delenv("WAREHOUSE_1C_RECONCILE_ALLOWED_DB_IDS", raising=False)
    admin = _make_user(role="admin", assigned_database=None)

    with pytest.raises(HTTPException) as exc_info:
        warehouse_1c_api._resolve_scoped_hub_db(
            current_user=admin,
            selected_db_id="selected-db",
            requested_scope="all",
        )

    assert exc_info.value.status_code == 409


def test_expected_part_no_conflict_blocks_apply(monkeypatch):
    called = False

    def fake_apply(**kwargs):
        nonlocal called
        called = True
        return {"ok": True}

    monkeypatch.setattr(
        db_queries,
        "get_equipment_by_inv",
        lambda *args, **kwargs: {"part_no": "CURRENT-PART"},
    )
    monkeypatch.setattr(reconcile, "apply_part_no", fake_apply)
    client = _client_for(
        lambda: _make_user(
            permissions=[
                authorization_service.PERM_WAREHOUSE_1C_RECONCILE_WRITE,
                authorization_service.PERM_DATABASE_WRITE,
            ]
        )
    )

    response = client.post(
        "/warehouse-1c/reconcile/apply-part-no",
        json=_apply_payload(expected_part_no="STALE-PART"),
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "reconcile_part_no_conflict"
    assert called is False


def test_apply_stays_audit_only_until_registry_write_flag_is_enabled(monkeypatch):
    monkeypatch.setenv("WAREHOUSE_1C_RECONCILE_REGISTRY_WRITE_ENABLED", "0")
    monkeypatch.setattr(db_queries, "get_equipment_by_inv", lambda *args, **kwargs: {"part_no": ""})
    monkeypatch.setattr(
        reconcile,
        "apply_part_no",
        lambda **kwargs: (_ for _ in ()).throw(AssertionError("must not mutate while flag is off")),
    )
    client = _client_for(
        lambda: _make_user(
            permissions=[
                authorization_service.PERM_WAREHOUSE_1C_RECONCILE_WRITE,
                authorization_service.PERM_DATABASE_WRITE,
            ]
        )
    )

    response = client.post("/warehouse-1c/reconcile/apply-part-no", json=_apply_payload())

    assert response.status_code == 409
    assert "audit-only" in response.json()["detail"]


def test_reconcile_write_is_enabled_by_default_after_registry_rollout(monkeypatch):
    monkeypatch.delenv("WAREHOUSE_1C_RECONCILE_REGISTRY_WRITE_ENABLED", raising=False)

    assert warehouse_1c_api._reconcile_write_enabled() is True


def test_auto_link_is_preview_by_default(monkeypatch):
    captured = {}

    async def fake_auto_link_pending(**kwargs):
        captured.update(kwargs)
        return {"dry_run": kwargs["dry_run"], "linked": []}

    monkeypatch.setattr(reconcile, "auto_link_pending", fake_auto_link_pending)
    client = _client_for(
        lambda: _make_user(permissions=[authorization_service.PERM_WAREHOUSE_1C_READ])
    )

    response = client.post("/warehouse-1c/reconcile/auto-link", json={"limit": 5})

    assert response.status_code == 200
    assert captured["dry_run"] is True
    assert captured["db_id"] == "ITINVENT"


def test_auto_link_rejects_batch_commit_even_with_write_permissions(monkeypatch):
    monkeypatch.setattr(
        reconcile,
        "auto_link_pending",
        lambda **kwargs: (_ for _ in ()).throw(AssertionError("must not auto-link")),
    )
    client = _client_for(
        lambda: _make_user(
            permissions=[
                authorization_service.PERM_WAREHOUSE_1C_READ,
                authorization_service.PERM_WAREHOUSE_1C_RECONCILE_WRITE,
                authorization_service.PERM_DATABASE_WRITE,
            ]
        )
    )

    response = client.post(
        "/warehouse-1c/reconcile/auto-link",
        json={"limit": 5, "dry_run": False, "confirm": True, "reason": "Проверено"},
    )

    assert response.status_code == 422


def test_admin_can_confirm_explicit_warehouse_owner_link(monkeypatch):
    captured = {}
    from backend.services.one_c_reconcile_registry_service import one_c_reconcile_registry_service

    monkeypatch.setattr(db_queries, "get_owner_by_no", lambda *args, **kwargs: {"OWNER_NO": 7})
    monkeypatch.setenv("WAREHOUSE_1C_RECONCILE_REGISTRY_WRITE_ENABLED", "1")
    monkeypatch.setattr(
        one_c_reconcile_registry_service,
        "upsert_warehouse_owner_link",
        lambda **kwargs: captured.update(kwargs) or {"status": kwargs["status"], "owner_no": kwargs["owner_no"]},
    )
    client = _client_for(
        lambda: _make_user(
            role="admin",
            permissions=[
                authorization_service.PERM_WAREHOUSE_1C_RECONCILE_WRITE,
                authorization_service.PERM_DATABASE_WRITE,
            ],
        )
    )

    response = client.post(
        "/warehouse-1c/reconcile/warehouse-owner-links",
        json={
            "warehouse_ref": "warehouse-ref-1",
            "owner_no": 7,
            "status": "active",
            "reason": "verified against warehouse record",
            "expected_version": 0,
            "confirm": True,
        },
    )

    assert response.status_code == 200
    assert captured["hub_db_id"] == "ITINVENT"
    assert captured["status"] == "active"
    assert captured["expected_version"] == 0


def test_runtime_status_hides_operational_errors_from_non_admin(monkeypatch):
    monkeypatch.setenv("WAREHOUSE_1C_RECONCILE_REGISTRY_WRITE_ENABLED", "0")
    monkeypatch.setattr(
        warehouse_1c_api.warehouse_1c_service,
        "get_runtime_status",
        lambda: {
            "catalog": {"status": "stale", "last_error": "catalog secret"},
            "bridge": {"circuit_breaker": "open", "last_error": "com secret"},
        },
    )
    client = _client_for(
        lambda: _make_user(permissions=[authorization_service.PERM_WAREHOUSE_1C_READ])
    )

    response = client.get("/warehouse-1c/status")

    assert response.status_code == 200
    assert "last_error" not in response.json()["catalog"]
    assert "last_error" not in response.json()["bridge"]
    assert response.json()["bridge"]["circuit_breaker"] == "open"
    assert response.json()["reconcile"] == {"write_enabled": False, "mode": "audit_only"}
