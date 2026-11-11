from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.deps import get_current_active_user
from backend.api.v1 import company_structure as company_structure_api
from backend.models.auth import User
from backend.services.authorization_service import PERM_COMPANY_STRUCTURE_READ


def _user(permissions: list[str]) -> User:
    return User(
        id=42,
        username="company-user",
        role="viewer",
        is_active=True,
        permissions=permissions,
        use_custom_permissions=True,
        custom_permissions=permissions,
    )


def _client(user: User) -> TestClient:
    app = FastAPI()
    app.include_router(company_structure_api.router, prefix="/company-structure")
    app.dependency_overrides[get_current_active_user] = lambda: user
    return TestClient(app)


def test_company_node_photo_requires_authentication():
    app = FastAPI()
    app.include_router(company_structure_api.router, prefix="/company-structure")
    response = TestClient(app).get("/company-structure/nodes/node-1/photo")

    assert response.status_code == 401


def test_company_node_photo_is_private_for_authorized_user(monkeypatch, tmp_path: Path):
    photo = tmp_path / "node-1.jpg"
    photo.write_bytes(b"jpeg")

    class FakeService:
        def get_node_photo_path(self, node_id: str) -> Path:
            assert node_id == "node-1"
            return photo

    monkeypatch.setattr(company_structure_api, "get_company_structure_service", lambda: FakeService())
    response = _client(_user([PERM_COMPANY_STRUCTURE_READ])).get(
        "/company-structure/nodes/node-1/photo",
    )

    assert response.status_code == 200
    assert response.headers["cache-control"] == "private, max-age=0, must-revalidate"
