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
from backend.api.v1 import my_files as my_files_api
from backend.api.v1 import my_files_libraries as libraries_api
from backend.api.v1 import my_files_office as office_api
from backend.appdb.db import app_session, ensure_app_schema_initialized
from backend.appdb.models import (
    AppDepartment,
    AppDepartmentMembership,
    AppMyFile,
    AppMyFileAudit,
    AppMyFileBlob,
    AppMyFileCollaborator,
    AppMyFileFolderCollaborator,
    AppMyFileLibrary,
    AppMyFileLibraryMember,
    AppMyFileVersion,
    AppUser,
)
from backend.models.auth import User
from backend.services import onlyoffice_service as oo
from backend.services.my_files_antivirus_service import SecurityScanResult
from backend.services import my_files_collab_service as collab_module
from backend.services.my_files_collab_service import MyFilesCollabService
from backend.services import my_files_copy_service as copy_module
from backend.services.my_files_copy_service import MyFilesCopyService
from backend.services import my_files_library_service as library_module
from backend.services.my_files_library_service import MyFilesLibraryService
from backend.services.my_files_service import STORAGE_ZSTD, MyFilesNotFoundError, MyFilesService


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
        lambda user_id, *, file_id, file_name, owner_label, role="edit": sent.append((user_id, file_id, file_name)),
    )
    return sent


def _user(user_id: int) -> User:
    return User(id=user_id, username=f"user-{user_id}", role="viewer", is_active=True)


class Env:
    def __init__(self, tmp_path: Path, monkeypatch) -> None:
        monkeypatch.setenv("MY_FILES_STORAGE_V2_ENABLED", "0")
        monkeypatch.delenv("HUBIT_STORAGE_UNC", raising=False)
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
        monkeypatch.setattr(my_files_api, "my_files_service", self.service)
        monkeypatch.setattr(libraries_api, "my_files_library_service", MyFilesLibraryService(self.service))
        copy_service = MyFilesCopyService(self.service)
        self.copy_service = copy_service
        monkeypatch.setattr(office_api, "my_files_copy_service", copy_service)
        monkeypatch.setattr(my_files_api, "my_files_copy_service", copy_service)
        app = FastAPI()
        app.include_router(office_api.router, prefix="/api/v1/my-files")
        app.include_router(libraries_api.router, prefix="/api/v1/my-files")
        app.include_router(my_files_api.router, prefix="/api/v1/my-files")
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

    def upload(self, name: str, payload: bytes, folder_id: str | None = None) -> str:
        spool = self.service.new_spool_path(name)
        spool.write_bytes(payload)
        created = self.service.create_pending_upload(
            actor=_user(OWNER),
            original_file_name=name,
            mime_type="application/octet-stream",
            spool_path=spool,
            original_size_bytes=len(payload),
            retention_days=7,
            folder_id=folder_id,
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


def test_editor_rename_keeps_content_and_key_and_notifies_the_signed_command_service(env, monkeypatch):
    import httpx

    file_id = env.upload("plan.docx", b"original")
    key = env.editor_config(file_id)["document"]["key"]
    real_client = httpx.Client
    commands = []

    def command(request):
        body = __import__("json").loads(request.content)
        claims = jwt.decode(body.pop("token"), SECRET, algorithms=["HS256"])
        assert claims == body == {"c": "meta", "key": key, "meta": {"title": "New plan.docx"}}
        assert str(request.url).startswith("http://ds.internal:8080/command?")
        with app_session(env.database_url) as session:
            assert session.get(AppMyFile, file_id).original_file_name == "New plan.docx"
        commands.append(body)
        return httpx.Response(200, json={"error": 0, "key": key})

    monkeypatch.setattr(oo.httpx, "Client", lambda **kwargs: real_client(transport=httpx.MockTransport(command), **kwargs))
    response = env.client.post(f"/api/v1/my-files/{file_id}/office/rename", json={"name": "New plan"})
    assert response.status_code == 200, response.text
    assert response.json()["file"]["original_file_name"] == "New plan.docx"
    assert response.json()["editor_notified"] is True
    assert len(commands) == 1
    assert env.content(file_id) == b"original"
    assert env.editor_config(file_id)["document"]["key"] == key
    assert env.client.get(f"/api/v1/my-files/{file_id}/office/versions").json()["items"] == []
    config = env.client.get(f"/api/v1/my-files/{file_id}/office/config").json()
    assert config["can_rename"] is True and config["can_manage_access"] is True


def test_a_collaborator_cannot_rename_or_manage_access_from_the_editor(env, monkeypatch):
    file_id = env.upload("plan.docx", b"original")
    env.client.put(f"/api/v1/my-files/{file_id}/office/collaborators", json={"user_ids": [COLLAB]})
    env.as_user(COLLAB)
    config = env.client.get(f"/api/v1/my-files/{file_id}/office/config").json()
    assert config["can_rename"] is False and config["can_manage_access"] is False
    response = env.client.post(f"/api/v1/my-files/{file_id}/office/rename", json={"name": "Foreign rename"})
    assert response.status_code == 404
    assert env.editor_config(file_id)["document"]["title"] == "plan.docx"


@pytest.mark.parametrize("reply", [{"error": 6}, {"error": False}, {"key": "missing-error"}, {"error": 0, "key": "wrong-key"}])
def test_rename_reports_command_failure_without_undoing_a_committed_hub_name(env, monkeypatch, reply):
    import httpx

    file_id = env.upload("plan.docx", b"original")
    real_client = httpx.Client
    monkeypatch.setattr(oo.httpx, "Client", lambda **kwargs: real_client(
        transport=httpx.MockTransport(lambda request: httpx.Response(200, json=reply)), **kwargs,
    ))
    response = env.client.post(f"/api/v1/my-files/{file_id}/office/rename", json={"name": "Saved name"})
    assert response.status_code == 200
    assert response.json()["editor_notified"] is False
    assert env.editor_config(file_id)["document"]["title"] == "Saved name.docx"
    assert env.content(file_id) == b"original"


def test_delayed_rename_notification_converges_to_the_latest_hub_name(env, monkeypatch):
    import httpx
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    file_id = env.upload("plan.docx", b"original")
    first_started, release_first = Event(), Event()
    real_client = httpx.Client
    delivered = []

    def command(request):
        body = __import__("json").loads(request.content)
        if body["meta"]["title"] == "First.docx":
            first_started.set()
            assert release_first.wait(10)
        delivered.append(body["meta"]["title"])
        return httpx.Response(200, json={"error": 0, "key": body["key"]})

    monkeypatch.setattr(oo.httpx, "Client", lambda **kwargs: real_client(transport=httpx.MockTransport(command), **kwargs))
    with ThreadPoolExecutor(max_workers=1) as pool:
        first = pool.submit(env.client.post, f"/api/v1/my-files/{file_id}/office/rename", json={"name": "First"})
        try:
            assert first_started.wait(10)
            second = env.client.post(f"/api/v1/my-files/{file_id}/office/rename", json={"name": "Latest"})
            assert second.status_code == 200
        finally:
            release_first.set()
        result = first.result(timeout=10)
    assert result.status_code == 200
    assert result.json()["file"]["original_file_name"] == "Latest.docx"
    assert delivered[-1] == "Latest.docx"
    assert env.editor_config(file_id)["document"]["title"] == "Latest.docx"


def test_a_command_timeout_keeps_the_hub_rename_and_does_not_claim_delivery(env, monkeypatch):
    import httpx

    file_id = env.upload("plan.docx", b"original")
    real_client = httpx.Client

    def timeout(request):
        raise httpx.ConnectTimeout("fixture timeout", request=request)

    monkeypatch.setattr(oo.httpx, "Client", lambda **kwargs: real_client(transport=httpx.MockTransport(timeout), **kwargs))
    response = env.client.post(f"/api/v1/my-files/{file_id}/office/rename", json={"name": "Saved"})
    assert response.status_code == 200
    assert response.json()["editor_notified"] is False
    assert env.editor_config(file_id)["document"]["title"] == "Saved.docx"


def test_library_managers_rename_but_do_not_get_personal_file_sharing_controls(env, monkeypatch):
    library = _make_library(env, members=[_member("user", COLLAB, "manage")])
    file_id = _library_upload(env, OWNER, library, "plan.docx", b"original")
    env.as_user(COLLAB)
    config = env.client.get(f"/api/v1/my-files/{file_id}/office/config").json()
    assert config["role"] == "owner"
    assert config["can_rename"] is True and config["can_manage_access"] is False
    monkeypatch.setattr(oo, "notify_document_title", lambda *args, **kwargs: False)
    response = env.client.post(f"/api/v1/my-files/{file_id}/office/rename", json={"name": "Library plan"})
    assert response.status_code == 200
    assert response.json()["file"]["original_file_name"] == "Library plan.docx"


def test_online_rename_checks_origin_and_name_before_writing(env, monkeypatch):
    file_id = env.upload("plan.docx", b"original")
    response = env.client.post(f"/api/v1/my-files/{file_id}/office/rename", json={"name": "Bad origin"}, headers={"Origin": "https://untrusted.invalid"})
    assert response.status_code == 403
    for name in ("   ", "folder/file", "folder\\file"):
        response = env.client.post(f"/api/v1/my-files/{file_id}/office/rename", json={"name": name})
        assert response.status_code == 400
    assert env.editor_config(file_id)["document"]["title"] == "plan.docx"


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
    # Who wrote what, like the Google Docs history: the original content is the owner's, the edit is the collaborator's.
    history = env.client.get(f"/api/v1/my-files/{file_id}/office/versions").json()
    assert history["items"][0]["author"] == f"user-{OWNER}"
    assert history["current"]["author"] == f"user-{COLLAB}"

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
            column.name for column in AppMyFileCollaborator.__table__.columns if column.name != "role"
        }
        role_ns = runpy.run_path(str(MIGRATION.with_name("20261103_0158_my_file_collaborator_role.py")))
        role_ns["upgrade"].__globals__["op"] = Operations(MigrationContext.configure(connection))
        role_ns["upgrade"].__globals__["_scope"] = lambda: "app"
        role_ns["upgrade"]()
        role_ns["upgrade"]()
        assert {c["name"] for c in sa.inspect(connection).get_columns("my_file_collaborators")} == {
            column.name for column in AppMyFileCollaborator.__table__.columns
        }
        folder_ns = runpy.run_path(str(MIGRATION.with_name("20261103_0159_my_file_folder_collaborators.py")))
        folder_ns["upgrade"].__globals__["op"] = Operations(MigrationContext.configure(connection))
        folder_ns["upgrade"].__globals__["_scope"] = lambda: "app"
        folder_ns["upgrade"]()
        folder_ns["upgrade"]()
        assert {c["name"] for c in sa.inspect(connection).get_columns("my_file_folder_collaborators")} == {
            column.name for column in AppMyFileFolderCollaborator.__table__.columns
        }
        folder_ns["downgrade"]()
        assert not sa.inspect(connection).has_table("my_file_folder_collaborators")
        role_ns["downgrade"]()
        assert "role" not in {c["name"] for c in sa.inspect(connection).get_columns("my_file_collaborators")}
        namespace["downgrade"]()
        namespace["downgrade"]()
        assert not sa.inspect(connection).has_table("my_file_versions")
        assert not sa.inspect(connection).has_table("my_file_collaborators")


def _journal(env, file_id: str) -> list[tuple[str, str, str]]:
    items = env.service.list_file_audit(file_id=file_id, user_id=OWNER)["items"]
    return [(i["action"], i["actor_username"], i["details"]) for i in reversed(items)]


def test_journal_says_who_changed_what(env):
    file_id = env.upload("plan.docx", b"original")
    share = f"/api/v1/my-files/{file_id}/office/collaborators"
    env.client.put(share, json={"user_ids": [COLLAB, STRANGER]})
    env.client.put(share, json={"user_ids": [COLLAB]})
    env.as_user(COLLAB)
    config = env.editor_config(file_id)
    env.callback(config, status_code=2, document=b"edit-1", users=[str(COLLAB)])
    version_id = env.client.get(f"/api/v1/my-files/{file_id}/office/versions").json()["items"][0]["id"]
    env.as_user(OWNER)
    env.client.put(share, json={"user_ids": []})
    env.callback(config, status_code=2, document=b"late edit", users=[str(COLLAB)])
    env.client.post(f"/api/v1/my-files/{file_id}/office/versions/{version_id}/restore")

    entries = [e for e in _journal(env, file_id) if e[0].startswith(("collaborators", "office"))]
    assert entries == [
        ("collaborators_changed", f"user-{OWNER}", f"Добавлены (правка): user-{COLLAB}, user-{STRANGER}."),
        ("collaborators_changed", f"user-{OWNER}", f"Убраны: user-{STRANGER}."),
        ("office_saved", f"user-{COLLAB}", "Изменения сохранены, прежнее содержимое осталось как версия №1. Размер: 8 Б → 6 Б."),
        ("collaborators_changed", f"user-{OWNER}", f"Убраны: user-{COLLAB}."),
        ("office_save_denied", f"user-{COLLAB}", "Правки не сохранены: у автора больше нет доступа к файлу."),
        ("office_restored", f"user-{OWNER}", "Возвращена версия №1 (8 Б); текущее содержимое сохранено как версия №2."),
    ]


def test_a_whole_group_can_be_picked_and_only_active_members_are_offered(env, monkeypatch):
    from backend.services.department_service import department_service

    with app_session(env.database_url) as session:
        session.get(AppUser, STRANGER).is_active = False
    monkeypatch.setattr(
        department_service, "list_departments",
        lambda **_: [{"id": "it", "name": "ИТ", "members_count": 2, "managers_count": 1}],
    )
    monkeypatch.setattr(department_service, "get_department", lambda group_id: {"id": "it"} if group_id == "it" else None)
    monkeypatch.setattr(
        department_service, "list_memberships",
        lambda **_: [{"user_id": u} for u in (OWNER, COLLAB, STRANGER)],
    )

    groups = env.client.get("/api/v1/my-files/office/groups").json()["items"]
    assert groups == [{"id": "it", "name": "ИТ", "members_count": 3}]
    members = env.client.get("/api/v1/my-files/office/groups/it/members").json()["items"]
    assert [m["user_id"] for m in members] == [OWNER, COLLAB]
    assert env.client.get("/api/v1/my-files/office/groups/missing/members").status_code == 404

    file_id = env.upload("plan.docx", b"original")
    many = [COLLAB] + list(range(1000, 1000 + 120))
    with app_session(env.database_url) as session:
        for uid in many[1:]:
            session.add(AppUser(id=uid, username=f"bulk-{uid}", is_active=True))
    saved = env.client.put(f"/api/v1/my-files/{file_id}/office/collaborators", json={"user_ids": many})
    assert saved.status_code == 200 and len(saved.json()["items"]) == len(many)


def test_audit_details_migration_is_repeatable_and_downgrades_cleanly():
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(sa.text("CREATE TABLE my_file_audit (id INTEGER PRIMARY KEY, action VARCHAR(40))"))
        namespace = runpy.run_path(str(MIGRATION.with_name("20261103_0157_my_file_audit_details.py")))
        namespace["upgrade"].__globals__["op"] = Operations(MigrationContext.configure(connection))
        namespace["upgrade"].__globals__["_scope"] = lambda: "app"
        namespace["upgrade"]()
        namespace["upgrade"]()
        assert "details" in {c["name"] for c in sa.inspect(connection).get_columns("my_file_audit")}
        namespace["downgrade"]()
        assert "details" not in {c["name"] for c in sa.inspect(connection).get_columns("my_file_audit")}


def test_file_lists_mark_co_editing_and_offer_files_shared_with_me(env):
    shared_id = env.upload("plan.docx", b"original")
    env.upload("notes.docx", b"private")
    env.client.put(f"/api/v1/my-files/{shared_id}/office/collaborators", json={"user_ids": [COLLAB, STRANGER]})

    mine = {i["id"]: i for i in env.service.list_files(user_id=OWNER)["items"]}
    assert sorted(i["collaborators_count"] for i in mine.values()) == [0, 2]
    assert mine[shared_id]["collaborators_count"] == 2 and not mine[shared_id]["shared_with_me"]

    theirs = env.service.list_files(user_id=COLLAB, view="shared")["items"]
    assert [(i["id"], i["shared_with_me"], i["owner_username"]) for i in theirs] == [(shared_id, True, f"user-{OWNER}")]
    assert env.service.list_files(user_id=COLLAB)["items"] == []
    assert env.service.list_files(user_id=OWNER, view="shared")["items"] == []

    env.client.put(
        f"/api/v1/my-files/{shared_id}/office/collaborators",
        json={"members": [{"user_id": COLLAB, "role": "comment"}]},
    )
    env.as_user(COLLAB)
    response = env.client.get("/api/v1/my-files", params={"view": "shared"})
    assert response.status_code == 200
    assert [(i["id"], i["my_role"], i["shared_with_me"]) for i in response.json()["items"]] == [(shared_id, "comment", True)]
    env.as_user(OWNER)

    env.client.put(f"/api/v1/my-files/{shared_id}/office/collaborators", json={"user_ids": []})
    assert env.service.list_files(user_id=COLLAB, view="shared")["items"] == []


def test_one_public_link_downloads_for_guests_and_edits_for_collaborators(env, monkeypatch):
    monkeypatch.setenv("MY_FILES_SHARE_TOKEN_KEY", "test-my-files-share-token-key")
    from backend.api.deps import get_current_user_optional

    file_id = env.upload("plan.docx", b"original")
    token = env.service.create_share(file_id=file_id, user_id=OWNER)["token"]
    env.client.app.dependency_overrides[get_current_user_optional] = lambda: env.current
    access = lambda: env.client.get(f"/api/v1/my-files/public/{token}/editor").json()  # noqa: E731

    # Nobody was invited yet: the link is a plain download link, signing in changes nothing.
    env.as_user(STRANGER)
    assert access() == {"signed_in": True, "editable": True, "collaborative": False, "can_open": False, "role": "", "file_id": ""}

    env.as_user(OWNER)
    env.client.put(f"/api/v1/my-files/{file_id}/office/collaborators", json={"user_ids": [COLLAB]})
    env.as_user(STRANGER)
    assert access() == {"signed_in": True, "editable": True, "collaborative": True, "can_open": False, "role": "", "file_id": ""}
    env.as_user(COLLAB)
    assert access() == {"signed_in": True, "editable": True, "collaborative": True, "can_open": True, "role": "edit", "file_id": file_id}
    env.as_user(OWNER)
    assert access()["role"] == "owner"

    # A guest is told that editing exists but must sign in; the file id stays hidden.
    env.client.app.dependency_overrides[get_current_user_optional] = lambda: None
    assert access() == {"signed_in": False, "editable": True, "collaborative": True, "can_open": False, "role": "", "file_id": ""}

    assert env.client.get("/api/v1/my-files/public/not-a-real-token-0123456789/editor").status_code == 404


def _share_with_roles(env, file_id: str, **roles: str) -> None:
    members = [{"user_id": int(uid.removeprefix("u")), "role": role} for uid, role in roles.items()]
    response = env.client.put(f"/api/v1/my-files/{file_id}/office/collaborators", json={"members": members})
    assert response.status_code == 200, response.text


def test_roles_decide_who_may_edit_comment_or_only_read(env, invites):
    file_id = env.upload("plan.docx", b"original")
    _share_with_roles(env, file_id, **{f"u{COLLAB}": "comment", f"u{STRANGER}": "view"})

    def permissions(user_id: int) -> tuple[str, dict]:
        env.as_user(user_id)
        config = env.editor_config(file_id)
        return config["editorConfig"]["mode"], config["document"]["permissions"]

    assert permissions(OWNER) == ("edit", {"edit": True, "download": True, "print": True, "comment": True})
    assert permissions(COLLAB) == ("edit", {"edit": False, "download": True, "print": True, "comment": True})
    assert permissions(STRANGER) == ("view", {"edit": False, "download": True, "print": True, "comment": False})

    env.as_user(OWNER)
    config = env.editor_config(file_id)
    # A viewer's session can never write; a commenter's save (comments live inside the file) is stored.
    assert env.callback(config, status_code=2, document=b"viewer hack", users=[str(STRANGER)]).json() == {"error": 0}
    assert env.content(file_id) == b"original"
    assert env.callback(config, status_code=2, document=b"with comment", users=[str(COLLAB)]).json() == {"error": 0}
    assert env.content(file_id) == b"with comment"
    version_id = env.client.get(f"/api/v1/my-files/{file_id}/office/versions").json()["items"][0]["id"]

    # Restoring changes the content: only the owner and editors may; everybody may read history and download it.
    for user_id in (COLLAB, STRANGER):
        env.as_user(user_id)
        assert env.client.post(f"/api/v1/my-files/{file_id}/office/versions/{version_id}/restore").status_code == 400
        assert env.client.get(f"/api/v1/my-files/{file_id}/office/versions/{version_id}/download").status_code == 200
    env.as_user(OWNER)
    assert env.client.post(f"/api/v1/my-files/{file_id}/office/versions/{version_id}/restore").status_code == 204

    listed = env.client.get(f"/api/v1/my-files/{file_id}/office/collaborators").json()["items"]
    assert {i["user_id"]: i["role"] for i in listed} == {COLLAB: "comment", STRANGER: "view"}
    env.as_user(STRANGER)
    shared = env.client.get("/api/v1/my-files/office/shared-with-me").json()["items"]
    assert [(i["id"], i["role"]) for i in shared] == [(file_id, "view")]
    assert [i["my_role"] for i in env.service.list_files(user_id=STRANGER, view="shared")["items"]] == ["view"]


def test_changing_a_role_is_saved_notified_and_written_to_the_journal(env, invites):
    file_id = env.upload("plan.docx", b"original")
    _share_with_roles(env, file_id, **{f"u{COLLAB}": "view"})
    invites.clear()
    _share_with_roles(env, file_id, **{f"u{COLLAB}": "view"})
    assert invites == []  # nothing changed, nobody is bothered again

    _share_with_roles(env, file_id, **{f"u{COLLAB}": "edit"})
    assert invites == [(COLLAB, file_id, "plan.docx")]
    details = [d for a, _, d in _journal(env, file_id) if a == "collaborators_changed"]
    assert details == [
        f"Добавлены (просмотр): user-{COLLAB}.",
        f"Доступ изменён на «правка»: user-{COLLAB}.",
    ]

    env.as_user(COLLAB)
    config = env.editor_config(file_id)
    assert env.callback(config, status_code=2, document=b"edited", users=[str(COLLAB)]).json() == {"error": 0}
    assert env.content(file_id) == b"edited"


def test_presentations_open_in_the_slide_editor(env):
    file_id = env.upload("deck.pptx", b"slides")
    assert env.editor_config(file_id)["documentType"] == "slide"
    assert ".pptx" in env.client.get("/api/v1/my-files/office/status").json()["editable_extensions"]


# -- folder-level access ------------------------------------------------------------------------


def _share_folder(env, folder_id: str, **roles: str) -> None:
    members = [{"user_id": int(key[1:]), "role": role} for key, role in roles.items()]
    response = env.client.put(f"/api/v1/my-files/office/folders/{folder_id}/collaborators", json={"members": members})
    assert response.status_code == 200, response.text


def _folder(env, name: str, parent_id: str | None = None) -> str:
    return env.service.create_folder(actor=_user(OWNER), name=name, parent_id=parent_id)["id"]


def _shared_list(env, **params) -> dict:
    response = env.client.get("/api/v1/my-files", params={"view": "shared", **params})
    assert response.status_code == 200, response.text
    return response.json()


def test_folder_access_covers_files_added_later_and_subfolders(env):
    project = _folder(env, "Проект")
    nested = _folder(env, "Отчёты", project)
    other = _folder(env, "Личное")
    first = env.upload("plan.docx", b"one", folder_id=project)
    _share_folder(env, project, **{f"u{COLLAB}": "comment"})

    env.as_user(COLLAB)
    root = _shared_list(env)
    assert [(f["id"], f["my_role"], f["shared_with_me"], f["owner_username"]) for f in root["folders"]] == [
        (project, "comment", True, f"user-{OWNER}")
    ]
    assert root["items"] == []

    inside = _shared_list(env, folder_id=project)
    assert [(i["id"], i["my_role"]) for i in inside["items"]] == [(first, "comment")]
    assert [f["id"] for f in inside["folders"]] == [nested]
    assert [b["id"] for b in inside["breadcrumbs"]] == [project]

    # A file added after the grant, also deep in a subfolder, is reachable at once with the same role.
    env.as_user(OWNER)
    later = env.upload("budget.xlsx", b"two", folder_id=project)
    deep = env.upload("deep.docx", b"three", folder_id=nested)
    env.as_user(COLLAB)
    assert env.client.get(f"/api/v1/my-files/{later}/office/config").json()["role"] == "comment"
    assert env.client.get(f"/api/v1/my-files/{deep}/office/config").json()["role"] == "comment"
    assert [b["id"] for b in _shared_list(env, folder_id=nested)["breadcrumbs"]] == [project, nested]
    assert sorted(i["id"] for i in env.client.get("/api/v1/my-files/office/shared-with-me").json()["items"]) == sorted(
        [first, later, deep]
    )

    # Nothing outside the shared subtree opens, even by guessing the owner's other folder id.
    assert env.client.get("/api/v1/my-files", params={"view": "shared", "folder_id": other}).status_code == 404

    # The owner sees which folders and files are shared.
    env.as_user(OWNER)
    folders = env.service.list_files(user_id=OWNER)["folders"]
    assert {f["id"]: f["collaborators_count"] for f in folders} == {project: 1, other: 0}
    inside_owner = env.service.list_files(user_id=OWNER, folder_id=project)["items"]
    assert {i["id"]: i["collaborators_count"] for i in inside_owner} == {first: 1, later: 1}

    # A file taken out of the folder stops being shared.
    env.service.update_file(actor=_user(OWNER), file_id=first, folder_id=None)
    env.as_user(COLLAB)
    assert env.client.get(f"/api/v1/my-files/{first}/office/config").status_code == 404


def test_folder_grants_decide_who_may_save_and_the_best_role_wins(env):
    project = _folder(env, "Проект")
    file_id = env.upload("plan.docx", b"original", folder_id=project)
    _share_folder(env, project, **{f"u{COLLAB}": "edit", f"u{STRANGER}": "view"})

    env.as_user(COLLAB)
    config = env.editor_config(file_id)
    assert env.callback(config, status_code=2, document=b"by editor", users=[str(COLLAB)]).json() == {"error": 0}
    assert env.content(file_id) == b"by editor"

    env.as_user(STRANGER)
    viewer = env.client.get(f"/api/v1/my-files/{file_id}/office/config").json()
    assert viewer["role"] == "view"
    assert env.callback(viewer["config"], status_code=2, document=b"hack", users=[str(STRANGER)]).json() == {"error": 0}
    assert env.content(file_id) == b"by editor"

    # A file-level role on top of the folder's raises the stranger's rights for that file only.
    env.as_user(OWNER)
    _share_with_roles(env, file_id, **{f"u{STRANGER}": "edit"})
    env.as_user(STRANGER)
    assert env.client.get(f"/api/v1/my-files/{file_id}/office/config").json()["role"] == "edit"


def test_removing_a_folder_or_a_member_revokes_the_inherited_access(env):
    project = _folder(env, "Проект")
    file_id = env.upload("plan.docx", b"original", folder_id=project)
    _share_folder(env, project, **{f"u{COLLAB}": "edit"})
    env.as_user(COLLAB)
    assert env.client.get(f"/api/v1/my-files/{file_id}/office/config").status_code == 200

    env.as_user(OWNER)
    _share_folder(env, project)
    env.as_user(COLLAB)
    assert env.client.get(f"/api/v1/my-files/{file_id}/office/config").status_code == 404
    assert _shared_list(env)["folders"] == []

    env.as_user(OWNER)
    _share_folder(env, project, **{f"u{COLLAB}": "edit"})
    env.service.delete_folder(actor=_user(OWNER), folder_id=project)
    env.as_user(COLLAB)
    assert env.client.get(f"/api/v1/my-files/{file_id}/office/config").status_code == 404
    assert _shared_list(env)["folders"] == []


def test_folder_members_cannot_write_into_the_owners_folder(env):
    project = _folder(env, "Проект")
    file_id = env.upload("plan.docx", b"original", folder_id=project)
    _share_folder(env, project, **{f"u{COLLAB}": "edit"})
    env.as_user(COLLAB)

    spool = env.service.new_spool_path("evil.docx")
    spool.write_bytes(b"x")
    with pytest.raises(MyFilesNotFoundError):
        env.service.create_pending_upload(
            actor=_user(COLLAB),
            original_file_name="evil.docx",
            mime_type="application/octet-stream",
            spool_path=spool,
            original_size_bytes=1,
            retention_days=7,
            folder_id=project,
        )
    assert env.client.patch(f"/api/v1/my-files/{file_id}", json={"name": "renamed.docx"}).status_code == 404
    assert env.client.patch(f"/api/v1/my-files/folders/{project}", json={"name": "renamed"}).status_code == 404
    assert env.client.put(
        f"/api/v1/my-files/office/folders/{project}/collaborators", json={"members": []}
    ).status_code == 404


def test_folder_members_download_files_and_the_journal_records_it(env):
    project = _folder(env, "Проект")
    file_id = env.upload("report.pdf", b"%PDF-body", folder_id=project)
    _share_folder(env, project, **{f"u{COLLAB}": "view"})

    env.as_user(STRANGER)
    assert env.client.post(f"/api/v1/my-files/{file_id}/download-grant").status_code == 404

    env.as_user(COLLAB)
    grant = env.client.post(f"/api/v1/my-files/{file_id}/download-grant")
    assert grant.status_code == 200, grant.text
    downloaded = env.client.get("/api/v1" + grant.json()["download_path"])
    assert downloaded.status_code == 200 and downloaded.content == b"%PDF-body"
    env.as_user(OWNER)
    assert ("shared_download_started", f"user-{COLLAB}") in [(a, u) for a, u, _ in _journal(env, file_id)]


def test_folder_access_is_written_to_the_journal_and_notifies(env, monkeypatch):
    sent = []
    monkeypatch.setattr(
        collab_module,
        "_notify_folder_invited",
        lambda user_id, *, folder_id, folder_name, owner_label, role="edit": sent.append((user_id, folder_name, role)),
    )
    project = _folder(env, "Проект")
    _share_folder(env, project, **{f"u{COLLAB}": "comment", f"u{STRANGER}": "view"})
    assert sorted(sent) == sorted([(COLLAB, "Проект", "comment"), (STRANGER, "Проект", "view")])
    entry = next(item for item in env.service.list_audit() if item["action"] == "folder_access_changed")
    assert entry["actor_username"] == f"user-{OWNER}"
    assert entry["details"] == (
        f"Папка «Проект». Добавлены (комментарии): user-{COLLAB}. Добавлены (просмотр): user-{STRANGER}."
    )


# -- shared libraries ("Общие папки") ----------------------------------------------------------


def _admin(user_id: int) -> User:
    return User(id=user_id, username=f"user-{user_id}", role="admin", is_active=True)


def _member(kind: str, principal_id, role: str) -> dict:
    return {"principal_type": kind, "principal_id": str(principal_id), "role": role}


def _make_library(env, name: str = "Бухгалтерия", quota: int = 0, members: list[dict] | None = None) -> str:
    env.current = _admin(OWNER)
    created = env.client.post("/api/v1/my-files/libraries", json={"name": name, "quota_bytes": quota})
    assert created.status_code == 201, created.text
    library_id = created.json()["id"]
    if members is not None:
        saved = env.client.put(
            f"/api/v1/my-files/libraries/{library_id}/members",
            json={"members": [_member("user", OWNER, "manage"), *members]},
        )
        assert saved.status_code == 200, saved.text
    env.as_user(OWNER)
    return library_id


def _library_upload(env, user_id: int, library_id: str, name: str, payload: bytes, folder_id: str | None = None) -> str:
    spool = env.service.new_spool_path(name)
    spool.write_bytes(payload)
    created = env.service.create_pending_upload(
        actor=_user(user_id),
        original_file_name=name,
        mime_type="application/octet-stream",
        spool_path=spool,
        original_size_bytes=len(payload),
        retention_days=1,
        folder_id=folder_id,
        library_id=None if folder_id else library_id,
    )
    env.service.process_file(created["id"])
    return created["id"]


def _library_list(env, library_id: str, **params):
    return env.client.get("/api/v1/my-files", params={"view": "library", "library_id": library_id, **params})


def test_library_files_live_outside_personal_quota_and_never_expire(env):
    library = _make_library(env, members=[_member("user", COLLAB, "edit")])
    file_id = _library_upload(env, COLLAB, library, "report.docx", b"data")

    for user_id in (OWNER, COLLAB):
        env.as_user(user_id)
        listing = _library_list(env, library)
        assert listing.status_code == 200, listing.text
        assert [item["original_file_name"] for item in listing.json()["items"]] == ["report.docx"]
        assert listing.json()["library"]["id"] == library
        assert env.client.get("/api/v1/my-files").json()["items"] == []
    assert env.service.quota(user_id=COLLAB)["used_bytes"] == 0
    assert env.service.quota(user_id=OWNER)["used_bytes"] == 0

    env.as_user(COLLAB)
    libraries = env.client.get("/api/v1/my-files/libraries").json()
    assert libraries["can_manage"] is False
    assert [(i["name"], i["my_role"], i["files_count"], i["used_bytes"]) for i in libraries["items"]] == [
        ("Бухгалтерия", "edit", 1, 4)
    ]

    env.as_user(STRANGER)
    assert env.client.get("/api/v1/my-files/libraries").json()["items"] == []
    assert _library_list(env, library).status_code == 404
    assert env.client.post(f"/api/v1/my-files/{file_id}/download-grant").status_code == 404

    env.service.cleanup_expired(limit=1000)
    with app_session(env.database_url) as session:
        row = session.get(AppMyFile, file_id)
        assert row.deleted_at is None and row.status == "ready"
        assert row.uploaded_by_user_id == COLLAB and row.owner_user_id < 0
        assert row.expires_at.replace(tzinfo=timezone.utc) > datetime.now(timezone.utc) + timedelta(days=3650)


def test_library_roles_decide_who_adds_deletes_and_empties_the_trash(env):
    library = _make_library(
        env, members=[_member("user", COLLAB, "edit"), _member("user", STRANGER, "view")]
    )
    file_id = _library_upload(env, OWNER, library, "plan.docx", b"original")

    # A viewer reads and downloads, nothing more.
    env.as_user(STRANGER)
    assert env.client.post(f"/api/v1/my-files/{file_id}/download-grant").status_code == 200
    assert env.client.post("/api/v1/my-files/folders", json={"name": "Новая", "library_id": library}).status_code == 404
    assert env.client.patch(f"/api/v1/my-files/{file_id}", json={"name": "x.docx"}).status_code == 404
    assert env.client.delete(f"/api/v1/my-files/{file_id}").status_code == 404
    with pytest.raises(MyFilesNotFoundError):
        _library_upload(env, STRANGER, library, "evil.docx", b"x")

    # An editor adds folders and files, renames and deletes to the trash, but the trash itself is the managers'.
    env.as_user(COLLAB)
    folder = env.client.post("/api/v1/my-files/folders", json={"name": "Отчёты", "library_id": library})
    assert folder.status_code == 201, folder.text
    nested = _library_upload(env, COLLAB, library, "q1.docx", b"q1", folder_id=folder.json()["id"])
    assert env.client.patch(f"/api/v1/my-files/{nested}", json={"name": "q1-final.docx"}).status_code == 200
    assert env.client.delete(f"/api/v1/my-files/{file_id}").status_code == 204
    assert env.client.get("/api/v1/my-files/trash", params={"library_id": library}).status_code == 404
    assert env.client.post(f"/api/v1/my-files/trash/files/{file_id}/restore").status_code == 404
    assert env.client.delete(f"/api/v1/my-files/trash/files/{file_id}").status_code == 404
    assert env.client.post("/api/v1/my-files/folders", json={"name": "Отчёты", "library_id": library}).status_code == 400

    # A manager sees the trash, restores and purges.
    env.as_user(OWNER)
    trash = env.client.get("/api/v1/my-files/trash", params={"library_id": library}).json()
    assert [item["id"] for item in trash["items"]] == [file_id]
    assert env.client.post(f"/api/v1/my-files/trash/files/{file_id}/restore").status_code == 204
    names = sorted(i["original_file_name"] for i in _library_list(env, library).json()["items"])
    assert names == ["plan.docx"]
    assert env.client.delete(f"/api/v1/my-files/{file_id}").status_code == 204
    assert env.client.post("/api/v1/my-files/trash/empty", params={"library_id": library}).status_code == 204
    assert env.client.get("/api/v1/my-files/trash", params={"library_id": library}).json()["items"] == []


def test_a_department_in_a_library_follows_its_current_members(env):
    with app_session(env.database_url) as session:
        session.add(AppDepartment(id="it", name="ИТ-отдел", is_active=True))
        session.add(AppDepartmentMembership(department_id="it", user_id=STRANGER, is_active=True))
    library = _make_library(env, members=[_member("department", "it", "view")])
    _library_upload(env, OWNER, library, "plan.docx", b"original")

    env.as_user(STRANGER)
    assert [i["my_role"] for i in env.client.get("/api/v1/my-files/libraries").json()["items"]] == ["view"]
    assert _library_list(env, library).status_code == 200

    env.as_user(COLLAB)
    assert _library_list(env, library).status_code == 404
    with app_session(env.database_url) as session:
        session.add(AppDepartmentMembership(department_id="it", user_id=COLLAB, is_active=True))
    assert _library_list(env, library).status_code == 200

    with app_session(env.database_url) as session:
        for membership in session.query(AppDepartmentMembership).filter_by(user_id=STRANGER):
            membership.is_active = False
    env.as_user(STRANGER)
    assert _library_list(env, library).status_code == 404
    assert env.client.get("/api/v1/my-files/libraries").json()["items"] == []

    env.current = _admin(OWNER)
    members = env.client.get(f"/api/v1/my-files/libraries/{library}/members").json()["items"]
    assert [(m["principal_type"], m["name"], m["role"], m["members_count"]) for m in members] == [
        ("department", "ИТ-отдел", "view", 1),
        ("user", "user-42", "manage", 0),
    ]


def test_files_cannot_be_moved_between_a_person_and_a_library(env):
    library = _make_library(env, members=[_member("user", COLLAB, "edit")])
    env.as_user(COLLAB)
    library_folder = env.client.post("/api/v1/my-files/folders", json={"name": "Общая", "library_id": library}).json()["id"]
    personal_folder = env.service.create_folder(actor=_user(COLLAB), name="Личная")["id"]
    library_file = _library_upload(env, COLLAB, library, "shared.docx", b"s")
    spool = env.service.new_spool_path("mine.docx")
    spool.write_bytes(b"m")
    personal_file = env.service.create_pending_upload(
        actor=_user(COLLAB), original_file_name="mine.docx", mime_type="application/octet-stream",
        spool_path=spool, original_size_bytes=1, retention_days=7,
    )["id"]

    assert env.client.patch(f"/api/v1/my-files/{library_file}", json={"folder_id": personal_folder}).status_code == 404
    assert env.client.patch(f"/api/v1/my-files/{personal_file}", json={"folder_id": library_folder}).status_code == 404
    assert env.client.patch(f"/api/v1/my-files/folders/{library_folder}", json={"parent_id": personal_folder}).status_code == 404
    assert env.client.patch(f"/api/v1/my-files/{library_file}", json={"folder_id": library_folder}).status_code == 200


def test_only_people_with_the_permission_create_and_manage_libraries(env):
    library = _make_library(env, members=[_member("user", COLLAB, "manage")])

    # A library manager works inside the library but does not administer libraries.
    env.as_user(COLLAB)
    assert env.client.post("/api/v1/my-files/libraries", json={"name": "Своя"}).status_code == 403
    assert env.client.patch(f"/api/v1/my-files/libraries/{library}", json={"name": "Другая"}).status_code == 403
    assert env.client.put(f"/api/v1/my-files/libraries/{library}/members", json={"members": []}).status_code == 403
    assert env.client.delete(f"/api/v1/my-files/libraries/{library}").status_code == 403
    assert env.client.get(f"/api/v1/my-files/libraries/{library}/members").status_code == 403

    env.current = _admin(OWNER)
    listed = env.client.get("/api/v1/my-files/libraries").json()
    assert listed["can_manage"] is True and [i["id"] for i in listed["items"]] == [library]
    # Somebody must always be able to manage the library.
    assert env.client.put(
        f"/api/v1/my-files/libraries/{library}/members", json={"members": [_member("user", COLLAB, "edit")]}
    ).status_code == 400
    assert env.client.put(f"/api/v1/my-files/libraries/{library}/members", json={"members": []}).status_code == 400
    assert env.client.put(
        f"/api/v1/my-files/libraries/{library}/members",
        json={"members": [_member("user", 99999, "manage")]},
    ).status_code == 400


def test_library_quota_names_and_deletion(env):
    library = _make_library(env, quota=10, members=[])
    _library_upload(env, OWNER, library, "a.bin", b"12345678")
    with pytest.raises(Exception, match="quota"):
        _library_upload(env, OWNER, library, "b.bin", b"12345678")
    assert env.service.quota(user_id=OWNER)["used_bytes"] == 0

    env.current = _admin(OWNER)
    assert env.client.post("/api/v1/my-files/libraries", json={"name": "бухгалтерия"}).status_code == 400
    assert env.client.patch(f"/api/v1/my-files/libraries/{library}", json={"quota_bytes": 5}).status_code == 400
    assert env.client.patch(f"/api/v1/my-files/libraries/{library}", json={"quota_bytes": 0, "name": "Финансы"}).status_code == 200
    assert env.client.delete(f"/api/v1/my-files/libraries/{library}").status_code == 400

    file_id = _library_list(env, library).json()["items"][0]["id"]
    assert env.client.delete(f"/api/v1/my-files/{file_id}").status_code == 204
    assert env.client.delete(f"/api/v1/my-files/libraries/{library}").status_code == 400
    assert env.client.delete(f"/api/v1/my-files/trash/files/{file_id}").status_code == 204
    assert env.client.delete(f"/api/v1/my-files/libraries/{library}").status_code == 204
    assert env.client.get("/api/v1/my-files/libraries").json()["items"] == []
    assert _library_list(env, library).status_code == 404
    # The number of a deleted library stays taken, so a new one never reuses its storage.
    again = env.client.post("/api/v1/my-files/libraries", json={"name": "Финансы"})
    assert again.status_code == 201
    with app_session(env.database_url) as session:
        owners = [row.owner_user_id for row in session.query(AppMyFileLibrary).all()]
    assert sorted(owners) == [-2, -1]


def test_library_documents_are_edited_by_role_and_stay_in_the_library_quota(env):
    library = _make_library(env, members=[_member("user", COLLAB, "edit"), _member("user", STRANGER, "view")])
    file_id = _library_upload(env, OWNER, library, "plan.docx", b"original")

    def permissions(user_id: int) -> tuple[str, dict]:
        env.as_user(user_id)
        config = env.editor_config(file_id)
        return config["editorConfig"]["mode"], config["document"]["permissions"]

    assert permissions(COLLAB)[1]["edit"] is True
    assert permissions(STRANGER) == ("view", {"edit": False, "download": True, "print": True, "comment": False})
    env.as_user(OWNER)
    config = env.editor_config(file_id)
    assert env.callback(config, status_code=2, document=b"viewer hack", users=[str(STRANGER)]).json() == {"error": 0}
    assert env.content(file_id) == b"original"
    assert env.callback(config, status_code=2, document=b"edited by colleague", users=[str(COLLAB)]).json() == {"error": 0}
    assert env.content(file_id) == b"edited by colleague"
    assert env.client.get(f"/api/v1/my-files/{file_id}/office/versions").json()["items"]
    assert env.service.quota(user_id=COLLAB)["used_bytes"] == 0


def test_library_changes_are_journaled_and_members_are_notified(env, monkeypatch):
    sent = []
    monkeypatch.setattr(
        library_module,
        "_notify_invited",
        lambda user_id, *, library_id, library_name, owner_label, role: sent.append((user_id, library_name, role)),
    )
    with app_session(env.database_url) as session:
        session.add(AppDepartment(id="it", name="ИТ-отдел", is_active=True))
        session.add(AppDepartmentMembership(department_id="it", user_id=STRANGER, is_active=True))
    library = _make_library(env, members=[_member("user", COLLAB, "edit"), _member("department", "it", "view")])
    assert sorted(sent) == [(COLLAB, "Бухгалтерия", "edit"), (STRANGER, "Бухгалтерия", "view")]

    env.current = _admin(OWNER)
    sent.clear()
    saved = env.client.put(
        f"/api/v1/my-files/libraries/{library}/members",
        json={"members": [_member("user", OWNER, "manage"), _member("user", COLLAB, "comment")]},
    )
    assert saved.status_code == 200, saved.text
    assert sent == [(COLLAB, "Бухгалтерия", "comment")]
    with app_session(env.database_url) as session:
        rows = session.query(AppMyFileAudit).filter(AppMyFileAudit.action.like("library_%")).order_by(AppMyFileAudit.id).all()
    assert [row.action for row in rows] == ["library_created", "library_members_changed", "library_members_changed"]
    assert "Убраны: ИТ-отдел" in rows[-1].details and "Доступ изменён на «комментарии»" in rows[-1].details


def _processed(env, file_id: str) -> dict:
    env.service.process_file(file_id)
    with app_session(env.database_url) as session:
        row = session.get(AppMyFile, file_id)
        return {"status": row.status, "retention_days": row.retention_days, "owner": row.owner_user_id, "name": row.original_file_name}


def test_blank_documents_are_created_forever_with_free_names_and_open_in_the_editor(env):
    created = env.client.post("/api/v1/my-files/office/new", json={"kind": "docx"})
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["original_file_name"] == "Новый документ.docx"
    assert body["retention_days"] == 0
    assert _processed(env, body["id"])["status"] == "ready"
    assert env.content(body["id"]).startswith(b"PK")
    assert env.editor_config(body["id"])["documentType"] == "word"

    again = env.client.post("/api/v1/my-files/office/new", json={"kind": "docx"}).json()
    assert again["original_file_name"] == "Новый документ (2).docx"
    named = env.client.post("/api/v1/my-files/office/new", json={"kind": "xlsx", "name": "Бюджет"}).json()
    assert named["original_file_name"] == "Бюджет.xlsx"
    slides = env.client.post("/api/v1/my-files/office/new", json={"kind": "pptx"}).json()
    assert slides["original_file_name"] == "Новая презентация.pptx"
    assert env.client.post("/api/v1/my-files/office/new", json={"kind": "exe"}).status_code == 400

    folder = _folder(env, "Отчёты")
    inside = env.client.post("/api/v1/my-files/office/new", json={"kind": "docx", "folder_id": folder}).json()
    assert inside["original_file_name"] == "Новый документ.docx" and inside["folder_id"] == folder


def test_blank_documents_in_a_library_need_the_edit_role_and_use_its_quota(env):
    library = _make_library(env, members=[_member("user", COLLAB, "edit"), _member("user", STRANGER, "view")])
    env.as_user(COLLAB)
    created = env.client.post("/api/v1/my-files/office/new", json={"kind": "docx", "library_id": library})
    assert created.status_code == 201, created.text
    assert _processed(env, created.json()["id"])["owner"] < 0
    assert env.service.quota(user_id=COLLAB)["used_bytes"] == 0

    env.as_user(STRANGER)
    assert env.client.post("/api/v1/my-files/office/new", json={"kind": "docx", "library_id": library}).status_code == 404
    env.as_user(OWNER)
    assert env.client.post("/api/v1/my-files/office/new", json={"kind": "docx", "library_id": "missing"}).status_code == 404


def test_a_copy_crosses_between_the_disk_and_a_library_by_roles(env):
    library = _make_library(env, members=[_member("user", COLLAB, "edit"), _member("user", STRANGER, "view")])
    source = env.upload("plan.docx", b"original")

    into_library = env.client.post(f"/api/v1/my-files/{source}/copy", json={"library_id": library})
    assert into_library.status_code == 201, into_library.text
    copied = into_library.json()
    assert copied["original_file_name"] == "plan.docx" and copied["retention_days"] == 0
    assert _processed(env, copied["id"])["owner"] < 0
    env.as_user(COLLAB)
    assert env.service.get_download(file_id=copied["id"], user_id=COLLAB).path.exists()
    env.as_user(OWNER)
    assert env.content(source) == b"original"
    assert [i["id"] for i in _library_list(env, library).json()["items"]] == [copied["id"]]

    next_to_it = env.client.post(f"/api/v1/my-files/{source}/copy", json={}).json()
    assert next_to_it["original_file_name"] == "Копия plan.docx"
    _processed(env, next_to_it["id"])

    # A library file can be taken to a person's own disk by anyone who may read it, and it then counts there.
    env.as_user(STRANGER)
    mine = env.client.post(f"/api/v1/my-files/{copied['id']}/copy", json={})
    assert mine.status_code == 201, mine.text
    assert _processed(env, mine.json()["id"])["owner"] == STRANGER
    assert env.service.quota(user_id=STRANGER)["used_bytes"] == len(b"original")
    # ...but a reader cannot put anything into the library, and an outsider cannot copy its files at all.
    assert env.client.post(f"/api/v1/my-files/{source}/copy", json={"library_id": library}).status_code == 404
    env.as_user(COLLAB)
    assert env.client.post(f"/api/v1/my-files/{source}/copy", json={}).status_code == 404

    env.as_user(OWNER)
    actions = [action for action, _actor, _details in _journal(env, source)]
    assert actions.count("file_copied") == 2
    assert "file_copy_created" in [action for action, _actor, _details in _journal(env, copied["id"])]


def test_copies_respect_the_target_quota_and_the_size_cap(env, monkeypatch):
    library = _make_library(env, quota=5)
    source = env.upload("big.bin", b"0123456789")
    over_quota = env.client.post(f"/api/v1/my-files/{source}/copy", json={"library_id": library})
    assert over_quota.status_code == 400 and "quota" in over_quota.text.lower()
    assert _library_list(env, library).json()["items"] == []

    monkeypatch.setattr(copy_module, "COPY_MAX_BYTES", 4)
    too_big = env.client.post(f"/api/v1/my-files/{source}/copy", json={})
    assert too_big.status_code == 400 and "too large" in too_big.text.lower()
    assert [i["original_file_name"] for i in env.client.get("/api/v1/my-files").json()["items"]] == ["big.bin"]


def test_recent_files_and_search_include_libraries_only_for_their_members(env):
    library = _make_library(env, members=[_member("user", COLLAB, "edit")])
    _library_upload(env, OWNER, library, "budget.xlsx", b"numbers")
    env.upload("plan.docx", b"mine")
    folder = env.client.post("/api/v1/my-files/folders", json={"name": "Budget 2027", "library_id": library})
    assert folder.status_code == 201, folder.text

    env.as_user(COLLAB)
    recent = env.client.get("/api/v1/my-files", params={"view": "recent"}).json()
    assert [(i["original_file_name"], i["library_name"], i["my_role"]) for i in recent["items"]] == [
        ("budget.xlsx", "Бухгалтерия", "edit")
    ]
    assert recent["items"][0]["library_id"] == library
    found = env.client.get("/api/v1/my-files", params={"q": "budget 20"}).json()
    assert [i["library_id"] for i in found["folders"]] == [library]
    assert env.client.get("/api/v1/my-files", params={"q": "budget"}).json()["items"][0]["library_name"] == "Бухгалтерия"

    env.as_user(OWNER)
    names = sorted(i["original_file_name"] for i in env.client.get("/api/v1/my-files", params={"view": "recent"}).json()["items"])
    assert names == ["budget.xlsx", "plan.docx"]
    personal = next(i for i in env.client.get("/api/v1/my-files").json()["items"] if i["original_file_name"] == "plan.docx")
    assert personal["library_id"] is None and personal["my_role"] == ""

    env.as_user(STRANGER)
    assert env.client.get("/api/v1/my-files", params={"view": "recent"}).json()["items"] == []
    assert env.client.get("/api/v1/my-files", params={"q": "budget"}).json()["items"] == []
    assert env.client.get("/api/v1/my-files", params={"view": "favorites"}).json()["items"] == []


def test_library_migration_is_repeatable_matches_the_model_and_downgrades_cleanly():
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(sa.text("CREATE TABLE my_files (id VARCHAR(64) PRIMARY KEY, owner_user_id INTEGER)"))
        namespace = runpy.run_path(str(MIGRATION.with_name("20261103_0160_my_file_libraries.py")))
        namespace["upgrade"].__globals__["op"] = Operations(MigrationContext.configure(connection))
        namespace["upgrade"].__globals__["_scope"] = lambda: "app"
        namespace["upgrade"]()
        namespace["upgrade"]()
        inspector = sa.inspect(connection)
        assert {c["name"] for c in inspector.get_columns("my_file_libraries")} == {
            column.name for column in AppMyFileLibrary.__table__.columns
        }
        assert {c["name"] for c in inspector.get_columns("my_file_library_members")} == {
            column.name for column in AppMyFileLibraryMember.__table__.columns
        }
        assert "uploaded_by_user_id" in {c["name"] for c in inspector.get_columns("my_files")}
        namespace["downgrade"]()
        namespace["downgrade"]()
        inspector = sa.inspect(connection)
        assert not inspector.has_table("my_file_libraries") and not inspector.has_table("my_file_library_members")
        assert "uploaded_by_user_id" not in {c["name"] for c in inspector.get_columns("my_files")}
