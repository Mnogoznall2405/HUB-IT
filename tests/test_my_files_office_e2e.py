"""Co-editing of My Files documents through the real API, with a stubbed Document Server."""
from __future__ import annotations

import runpy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from fastapi import FastAPI
from fastapi.testclient import TestClient
from jose import jwt

from backend.api.deps import get_current_active_user
from backend.api.v1 import my_files_office as office_api
from backend.appdb.db import app_session, ensure_app_schema_initialized
from backend.appdb.models import AppMyFile, AppMyFileBlob, AppMyFileCollaborator, AppMyFileVersion, AppUser
from backend.models.auth import User
from backend.services import onlyoffice_service as oo
from backend.services.my_files_antivirus_service import SecurityScanResult
from backend.services import my_files_collab_service as collab_module
from backend.services.my_files_collab_service import MyFilesCollabService
from backend.services.my_files_service import STORAGE_ZSTD, MyFilesService


SECRET = "test-onlyoffice-secret"
OWNER, COLLAB, STRANGER = 42, 43, 44


@pytest.fixture(autouse=True)
def _prebuilt_app_schema(prebuilt_app_db):
    return prebuilt_app_db


@pytest.fixture(autouse=True)
def _onlyoffice_env(monkeypatch):
    monkeypatch.setenv("ONLYOFFICE_ENABLED", "1")
    monkeypatch.setenv("ONLYOFFICE_JWT_SECRET", SECRET)
    monkeypatch.setenv("ONLYOFFICE_INTERNAL_URL", "http://ds.internal:8080")
    monkeypatch.setenv("ONLYOFFICE_APP_BASE_URL", "https://hub.example")


@pytest.fixture(autouse=True)
def invites(monkeypatch):
    """Invitations go to the hub notification store; record them instead of writing there."""
    sent: list[tuple[int, str, str]] = []
    monkeypatch.setattr(
        collab_module,
        "_notify_invited",
        lambda user_id, *, file_id, file_name, owner_label: sent.append((user_id, file_id, file_name)),
    )
    return sent


def _user(user_id: int) -> User:
    return User(id=user_id, username=f"user-{user_id}", role="viewer", is_active=True)


class Env:
    def __init__(self, tmp_path: Path, monkeypatch) -> None:
        self.database_url = f"sqlite:///{(tmp_path / 'app.db').as_posix()}"
        self.service = MyFilesService(
            database_url=self.database_url,
            storage_root=tmp_path / "my-files",
            antivirus_scanner=lambda _path: SecurityScanResult(status="clean", engine="test"),
        )
        ensure_app_schema_initialized(self.database_url)
        with app_session(self.database_url) as session:
            for uid in (OWNER, COLLAB, STRANGER):
                session.add(AppUser(id=uid, username=f"user-{uid}", is_active=True))
        collab = MyFilesCollabService(self.service)
        monkeypatch.setattr(office_api, "my_files_service", self.service)
        monkeypatch.setattr(office_api, "my_files_collab_service", collab)
        self.current = _user(OWNER)
        app = FastAPI()
        app.include_router(office_api.router, prefix="/api/v1/my-files")
        app.dependency_overrides[get_current_active_user] = lambda: self.current
        self.client = TestClient(app)
        self.next_document = b""
        self.fetched_urls: list[str] = []

        def fake_fetch(settings, url, destination, *, max_bytes):
            self.fetched_urls.append(oo.rewrite_document_url(settings, url))
            destination.write_bytes(self.next_document)
            return len(self.next_document)

        monkeypatch.setattr(oo, "fetch_document", fake_fetch)

    def as_user(self, user_id: int) -> None:
        self.current = _user(user_id)

    def upload(self, name: str, payload: bytes) -> str:
        spool = self.service.new_spool_path(name)
        spool.write_bytes(payload)
        created = self.service.create_pending_upload(
            actor=_user(OWNER),
            original_file_name=name,
            mime_type="application/octet-stream",
            spool_path=spool,
            original_size_bytes=len(payload),
            retention_days=7,
        )
        self.service.process_file(created["id"])
        return created["id"]

    def content(self, file_id: str) -> bytes:
        download = self.service.get_download(file_id=file_id, user_id=OWNER)
        if download.mode == STORAGE_ZSTD:
            return b"".join(self.service.iter_zstd_download(download.path))
        return download.path.read_bytes()

    def editor_config(self, file_id: str) -> dict:
        response = self.client.get(f"/api/v1/my-files/{file_id}/office/config")
        assert response.status_code == 200, response.text
        return response.json()["config"]

    def callback(self, config: dict, *, status_code: int, document: bytes, users: list[str], secret: str = SECRET):
        self.next_document = document
        event = {
            "status": status_code,
            "key": config["document"]["key"],
            "url": "https://hub.example/onlyoffice/cache/files/data/abc/output.docx?md5=1",
            "users": users,
        }
        callback_path = config["editorConfig"]["callbackUrl"].removeprefix("https://hub.example")
        return self.client.post(callback_path, json={"token": jwt.encode(event, secret, algorithm="HS256"), **event})


@pytest.fixture
def env(tmp_path, monkeypatch):
    return Env(tmp_path, monkeypatch)


def test_collaborator_edits_are_saved_as_versions_and_can_be_restored(env):
    file_id = env.upload("plan.docx", b"original")
    shared = env.client.put(f"/api/v1/my-files/{file_id}/office/collaborators", json={"user_ids": [COLLAB]})
    assert shared.status_code == 200
    assert [item["username"] for item in shared.json()["items"]] == [f"user-{COLLAB}"]

    env.as_user(COLLAB)
    config = env.editor_config(file_id)
    assert config["documentType"] == "word"
    source_path = urlsplit(config["document"]["url"])
    source = env.client.get(f"{source_path.path}?{source_path.query}")
    assert source.status_code == 200 and source.content == b"original"
    assert jwt.decode(config["token"], SECRET, algorithms=["HS256"])["document"]["key"] == config["document"]["key"]

    assert env.callback(config, status_code=6, document=b"edit-1", users=[str(COLLAB)]).json() == {"error": 0}
    assert env.content(file_id) == b"edit-1"
    versions = env.client.get(f"/api/v1/my-files/{file_id}/office/versions").json()["items"]
    assert [(v["version_no"], v["replaced_by"]) for v in versions] == [(1, f"user-{COLLAB}")]

    # Autosave and the closing save of the same session replace the content without piling up versions.
    assert env.callback(config, status_code=2, document=b"edit-2", users=[str(COLLAB)]).json() == {"error": 0}
    assert env.content(file_id) == b"edit-2"
    assert len(env.client.get(f"/api/v1/my-files/{file_id}/office/versions").json()["items"]) == 1
    assert env.fetched_urls[0] == "http://ds.internal:8080/cache/files/data/abc/output.docx?md5=1"

    # A new editing session gets a new key; a callback of an unknown session never overwrites the file.
    assert env.editor_config(file_id)["document"]["key"] != config["document"]["key"]
    foreign = dict(config, document=dict(config["document"], key="f" * 40))
    assert env.callback(foreign, status_code=2, document=b"foreign", users=[str(COLLAB)]).json() == {"error": 0}
    assert env.content(file_id) == b"edit-2"

    env.as_user(OWNER)
    restored = env.client.post(f"/api/v1/my-files/{file_id}/office/versions/{versions[0]['id']}/restore")
    assert restored.status_code == 204
    assert env.content(file_id) == b"original"
    assert len(env.client.get(f"/api/v1/my-files/{file_id}/office/versions").json()["items"]) == 1


def test_a_collaborator_is_notified_only_when_newly_added(env, invites):
    file_id = env.upload("plan.docx", b"original")
    share = f"/api/v1/my-files/{file_id}/office/collaborators"

    env.client.put(share, json={"user_ids": [COLLAB]})
    env.client.put(share, json={"user_ids": [COLLAB]})
    env.client.put(share, json={"user_ids": [COLLAB, STRANGER]})

    assert invites == [(COLLAB, file_id, "plan.docx"), (STRANGER, file_id, "plan.docx")]


def test_edits_of_a_removed_collaborator_are_rejected(env):
    file_id = env.upload("plan.docx", b"original")
    share = f"/api/v1/my-files/{file_id}/office/collaborators"
    env.client.put(share, json={"user_ids": [COLLAB]})
    env.as_user(COLLAB)
    config = env.editor_config(file_id)

    env.as_user(OWNER)
    env.client.put(share, json={"user_ids": []})
    assert env.callback(config, status_code=2, document=b"late edit", users=[str(COLLAB)]).json() == {"error": 0}

    assert env.content(file_id) == b"original"
    assert env.client.get(f"/api/v1/my-files/{file_id}/office/versions").json()["items"] == []
    # A session whose last editor may still edit is saved as usual.
    assert env.callback(config, status_code=2, document=b"owner edit", users=[str(OWNER)]).json() == {"error": 0}
    assert env.content(file_id) == b"owner edit"


def test_retired_versions_can_be_downloaded_by_participants_only(env):
    file_id = env.upload("plan.docx", b"original")
    env.client.put(f"/api/v1/my-files/{file_id}/office/collaborators", json={"user_ids": [COLLAB]})
    config = env.editor_config(file_id)
    env.callback(config, status_code=2, document=b"edited", users=[str(OWNER)])
    version = env.client.get(f"/api/v1/my-files/{file_id}/office/versions").json()["items"][0]
    path = f"/api/v1/my-files/{file_id}/office/versions/{version['id']}/download"

    env.as_user(COLLAB)
    downloaded = env.client.get(path)
    assert downloaded.status_code == 200 and downloaded.content == b"original"
    assert "plan" in downloaded.headers["content-disposition"] and "docx" in downloaded.headers["content-disposition"]

    env.as_user(STRANGER)
    assert env.client.get(path).status_code == 404
    env.as_user(OWNER)
    assert env.client.get(f"/api/v1/my-files/{file_id}/office/versions/{'0' * 32}/download").status_code == 404


def test_callbacks_must_be_signed_and_addressed_to_the_file(env):
    file_id = env.upload("book.xlsx", b"sheet")
    config = env.editor_config(file_id)
    assert config["documentType"] == "cell"

    forged = env.callback(config, status_code=2, document=b"hacked", users=[str(OWNER)], secret="wrong-secret")
    assert forged.status_code == 403
    callback_path = config["editorConfig"]["callbackUrl"].removeprefix("https://hub.example")
    unsigned = env.client.post(callback_path, json={"status": 2, "key": config["document"]["key"], "url": "x"})
    assert unsigned.status_code == 403
    source_token = urlsplit(config["document"]["url"]).query.removeprefix("t=")
    wrong_kind = env.client.post(
        f"/api/v1/my-files/office/callback?t={source_token}", json={"status": 2}
    )
    assert wrong_kind.status_code == 403
    assert env.content(file_id) == b"sheet"


def test_only_owner_and_collaborators_can_open_a_document(env):
    file_id = env.upload("secret.docx", b"private")
    env.as_user(STRANGER)
    assert env.client.get(f"/api/v1/my-files/{file_id}/office/config").status_code == 404
    assert env.client.get(f"/api/v1/my-files/{file_id}/office/versions").status_code == 404
    assert env.client.put(
        f"/api/v1/my-files/{file_id}/office/collaborators", json={"user_ids": [STRANGER]}
    ).status_code == 404
    assert env.client.get("/api/v1/my-files/office/shared-with-me").json()["items"] == []

    env.as_user(OWNER)
    env.client.put(f"/api/v1/my-files/{file_id}/office/collaborators", json={"user_ids": [COLLAB]})
    env.as_user(COLLAB)
    assert [item["id"] for item in env.client.get("/api/v1/my-files/office/shared-with-me").json()["items"]] == [file_id]
    env.as_user(OWNER)
    env.client.put(f"/api/v1/my-files/{file_id}/office/collaborators", json={"user_ids": []})
    env.as_user(COLLAB)
    assert env.client.get(f"/api/v1/my-files/{file_id}/office/config").status_code == 404


def test_everyone_opening_a_document_during_a_session_joins_the_same_session(env):
    file_id = env.upload("team.docx", b"base")
    env.client.put(f"/api/v1/my-files/{file_id}/office/collaborators", json={"user_ids": [COLLAB]})

    first = env.editor_config(file_id)
    env.as_user(COLLAB)
    joined = env.editor_config(file_id)
    env.as_user(OWNER)
    refreshed = env.editor_config(file_id)

    assert first["document"]["key"] == joined["document"]["key"] == refreshed["document"]["key"]
    assert first["editorConfig"]["customization"]["forcesave"] is False
    env.callback(first, status_code=2, document=b"done", users=[str(OWNER), str(COLLAB)])
    assert env.editor_config(file_id)["document"]["key"] != first["document"]["key"]


def test_document_server_requests_pass_the_real_app_without_a_session(monkeypatch):
    from backend.main import app

    monkeypatch.setenv("ONLYOFFICE_ENABLED", "1")
    client = TestClient(app, base_url="https://testserver", raise_server_exceptions=False)

    source = client.get("/api/v1/my-files/office/source", params={"t": "not-a-signed-token"})
    assert (source.status_code, source.json()["detail"]) == (403, "Invalid token")
    callback = client.post("/api/v1/my-files/office/callback", params={"t": "not-a-signed-token"}, json={"status": 2})
    assert (callback.status_code, callback.json()["detail"]) == (403, "Invalid callback")

    settings = oo.load_settings()
    token = oo.make_callback_token(settings, file_id="any-file")
    event = {"status": 4, "key": "k", "users": []}
    closed = client.post(
        "/api/v1/my-files/office/callback",
        params={"t": token},
        json={"token": jwt.encode(event, SECRET, algorithm="HS256"), **event},
    )
    assert (closed.status_code, closed.json()) == (200, {"error": 0})


def test_without_the_migration_quota_purge_and_expiry_keep_working(env):
    with app_session(env.database_url) as session:
        for table in (AppMyFileVersion.__table__, AppMyFileCollaborator.__table__):
            table.drop(session.get_bind())

    file_id = env.upload("legacy.docx", b"legacy")
    assert env.service.quota(user_id=OWNER)["used_bytes"] == len(b"legacy")
    env.service.delete_file(file_id=file_id, user_id=OWNER)
    env.service.purge_file(file_id=file_id, user_id=OWNER)

    expiring = env.upload("old.docx", b"old")
    with app_session(env.database_url) as session:
        row = session.get(AppMyFile, expiring)
        row.expires_at = datetime.now(timezone.utc) - timedelta(days=1)
    assert env.service.cleanup_expired() == 1
    with app_session(env.database_url) as session:
        assert session.scalars(sa.select(AppMyFileBlob)).all() == []


def test_other_file_types_are_not_editable(env):
    file_id = env.upload("notes.txt", b"text")
    assert env.client.get(f"/api/v1/my-files/{file_id}/office/config").status_code == 400


def test_purging_a_file_releases_its_history(env):
    file_id = env.upload("report.docx", b"v0")
    env.client.put(f"/api/v1/my-files/{file_id}/office/collaborators", json={"user_ids": [COLLAB]})
    config = env.editor_config(file_id)
    env.callback(config, status_code=2, document=b"v1", users=[str(OWNER)])

    env.service.delete_file(file_id=file_id, user_id=OWNER)
    env.service.purge_file(file_id=file_id, user_id=OWNER)

    with app_session(env.database_url) as session:
        assert session.scalars(sa.select(AppMyFileVersion)).all() == []
        assert session.scalars(sa.select(AppMyFileCollaborator)).all() == []
        assert session.scalars(sa.select(AppMyFileBlob)).all() == []


def test_history_counts_toward_the_owner_quota(env):
    file_id = env.upload("big.docx", b"a" * 1000)
    before = env.service.quota(user_id=OWNER)["used_bytes"]
    config = env.editor_config(file_id)
    env.callback(config, status_code=2, document=b"b" * 1000, users=[str(OWNER)])
    assert env.service.quota(user_id=OWNER)["used_bytes"] == before + 1000


def test_office_status_reports_disabled_when_not_configured(env, monkeypatch):
    monkeypatch.setenv("ONLYOFFICE_ENABLED", "0")
    assert env.client.get("/api/v1/my-files/office/status").json() == {
        "enabled": False,
        "public_path": "",
        "editable_extensions": [],
    }
    file_id = env.upload("off.docx", b"x")
    assert env.client.get(f"/api/v1/my-files/{file_id}/office/config").status_code == 503


MIGRATION = (
    Path(__file__).resolve().parents[1] / "WEB-itinvent/backend/alembic/versions/20261102_0156_my_file_collab.py"
)


def test_collaboration_migration_is_repeatable_matches_the_model_and_downgrades_cleanly():
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        namespace = runpy.run_path(str(MIGRATION))
        namespace["upgrade"].__globals__["op"] = Operations(MigrationContext.configure(connection))
        namespace["upgrade"].__globals__["_scope"] = lambda: "app"
        namespace["upgrade"]()
        namespace["upgrade"]()
        inspector = sa.inspect(connection)
        assert {c["name"] for c in inspector.get_columns("my_file_versions")} == {
            column.name for column in AppMyFileVersion.__table__.columns
        }
        assert {c["name"] for c in inspector.get_columns("my_file_collaborators")} == {
            column.name for column in AppMyFileCollaborator.__table__.columns
        }
        namespace["downgrade"]()
        namespace["downgrade"]()
        assert not sa.inspect(connection).has_table("my_file_versions")
        assert not sa.inspect(connection).has_table("my_file_collaborators")
