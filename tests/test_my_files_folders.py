from __future__ import annotations

from pathlib import Path

import pytest

from backend.models.auth import User
from backend.services.my_files_service import (
    MyFilesNotFoundError,
    MyFilesService,
    MyFilesValidationError,
)
from backend.services.my_files_antivirus_service import SecurityScanResult


def _sqlite_url(path: Path) -> str:
    return f"sqlite:///{path.as_posix()}"


def _user(user_id: int = 7) -> User:
    return User(id=user_id, username=f"user-{user_id}", role="viewer", is_active=True)


def _new_service(tmp_path: Path) -> MyFilesService:
    return MyFilesService(
        database_url=_sqlite_url(tmp_path / "app.db"),
        storage_root=tmp_path / "my-files",
        antivirus_scanner=lambda _path: SecurityScanResult(status="clean", engine="test"),
    )


def _upload(service: MyFilesService, file_name: str, folder_id: str | None = None) -> dict:
    spool_path = service.new_spool_path(file_name)
    spool_path.write_bytes(b"payload")
    return service.create_pending_upload(
        actor=_user(),
        original_file_name=file_name,
        mime_type="application/octet-stream",
        spool_path=spool_path,
        original_size_bytes=spool_path.stat().st_size,
        retention_days=1,
        folder_id=folder_id,
    )


def test_create_folder_and_list_root(tmp_path):
    service = _new_service(tmp_path)

    folder = service.create_folder(actor=_user(), name="Документы")

    assert folder["name"] == "Документы"
    assert folder["parent_id"] is None

    listing = service.list_files(user_id=7)
    assert [f["name"] for f in listing["folders"]] == ["Документы"]
    assert listing["items"] == []
    assert listing["breadcrumbs"] == []
    assert listing["folder"] is None


def test_subfolder_listing_and_breadcrumbs(tmp_path):
    service = _new_service(tmp_path)
    root = service.create_folder(actor=_user(), name="Работа")
    inner = service.create_folder(actor=_user(), name="Отчёты", parent_id=root["id"])

    uploaded = _upload(service, "report.bin", folder_id=inner["id"])
    assert uploaded["folder_id"] == inner["id"]

    listing = service.list_files(user_id=7, folder_id=inner["id"])
    assert [f["id"] for f in listing["folders"]] == []
    assert [i["id"] for i in listing["items"]] == [uploaded["id"]]
    assert [b["name"] for b in listing["breadcrumbs"]] == ["Работа", "Отчёты"]

    root_listing = service.list_files(user_id=7)
    assert [i["id"] for i in root_listing["items"]] == []
    assert [f["name"] for f in root_listing["folders"]] == ["Работа"]


def test_duplicate_folder_name_rejected_case_insensitive(tmp_path):
    service = _new_service(tmp_path)
    service.create_folder(actor=_user(), name="Документы")

    with pytest.raises(MyFilesValidationError):
        service.create_folder(actor=_user(), name="  документы  ")


def test_duplicate_name_allowed_in_different_parents(tmp_path):
    service = _new_service(tmp_path)
    a = service.create_folder(actor=_user(), name="A")
    b = service.create_folder(actor=_user(), name="B")
    service.create_folder(actor=_user(), name="Общее", parent_id=a["id"])

    inner = service.create_folder(actor=_user(), name="Общее", parent_id=b["id"])
    assert inner["parent_id"] == b["id"]


def test_rename_folder(tmp_path):
    service = _new_service(tmp_path)
    folder = service.create_folder(actor=_user(), name="Старое")

    updated = service.update_folder(actor=_user(), folder_id=folder["id"], name="Новое")
    assert updated["name"] == "Новое"


def test_move_folder_and_cycle_rejected(tmp_path):
    service = _new_service(tmp_path)
    parent = service.create_folder(actor=_user(), name="Родитель")
    child = service.create_folder(actor=_user(), name="Дочерняя", parent_id=parent["id"])
    grandchild = service.create_folder(actor=_user(), name="Внучатая", parent_id=child["id"])

    moved = service.update_folder(actor=_user(), folder_id=grandchild["id"], parent_id=None)
    assert moved["parent_id"] is None

    with pytest.raises(MyFilesValidationError):
        service.update_folder(actor=_user(), folder_id=parent["id"], parent_id=child["id"])

    with pytest.raises(MyFilesValidationError):
        service.update_folder(actor=_user(), folder_id=parent["id"], parent_id=parent["id"])


def test_delete_folder_cascades_contents(tmp_path):
    service = _new_service(tmp_path)
    outer = service.create_folder(actor=_user(), name="Внешняя")
    inner = service.create_folder(actor=_user(), name="Внутренняя", parent_id=outer["id"])
    file_in_inner = _upload(service, "a.bin", folder_id=inner["id"])
    file_in_outer = _upload(service, "b.bin", folder_id=outer["id"])
    file_in_root = _upload(service, "root.bin")

    deleted = service.delete_folder(actor=_user(), folder_id=outer["id"])
    assert deleted == 2

    listing = service.list_files(user_id=7)
    assert listing["folders"] == []
    assert [i["id"] for i in listing["items"]] == [file_in_root["id"]]
    assert service.list_folders(user_id=7) == []


def test_update_file_move_and_rename(tmp_path):
    service = _new_service(tmp_path)
    folder = service.create_folder(actor=_user(), name="Архив")
    uploaded = _upload(service, "orig.bin")

    moved = service.update_file(actor=_user(), file_id=uploaded["id"], folder_id=folder["id"], name="new name.bin")
    assert moved["folder_id"] == folder["id"]
    assert moved["original_file_name"] == "new name.bin"
    assert moved["download_file_name"] == "new name.bin"

    listing = service.list_files(user_id=7)
    assert listing["items"] == []
    inner_listing = service.list_files(user_id=7, folder_id=folder["id"])
    assert [i["id"] for i in inner_listing["items"]] == [uploaded["id"]]

    back = service.update_file(actor=_user(), file_id=uploaded["id"], folder_id=None)
    assert back["folder_id"] is None


def test_folder_isolation_between_users(tmp_path):
    service = _new_service(tmp_path)
    folder = service.create_folder(actor=_user(7), name="Приватная")

    other = _user(9)
    with pytest.raises(MyFilesNotFoundError):
        service.update_folder(actor=other, folder_id=folder["id"], name="Чужая")
    with pytest.raises(MyFilesNotFoundError):
        service.delete_folder(actor=other, folder_id=folder["id"])
    assert service.list_files(user_id=9)["folders"] == []
    with pytest.raises(MyFilesNotFoundError):
        service.list_files(user_id=9, folder_id=folder["id"])


def test_upload_to_unknown_folder_rejected(tmp_path):
    service = _new_service(tmp_path)
    with pytest.raises(MyFilesNotFoundError):
        _upload(service, "x.bin", folder_id="nonexistent")


def test_trash_restore_and_purge_file(tmp_path):
    service = _new_service(tmp_path)
    uploaded = _upload(service, "keep.bin")
    service.process_file(uploaded["id"])

    service.delete_file(file_id=uploaded["id"], user_id=7)

    trash = service.list_trash(user_id=7)
    assert [item["id"] for item in trash["items"]] == [uploaded["id"]]
    assert service.list_files(user_id=7)["items"] == []

    service.restore_file(file_id=uploaded["id"], user_id=7)
    listing = service.list_files(user_id=7)
    assert [item["id"] for item in listing["items"]] == [uploaded["id"]]
    assert service.list_trash(user_id=7)["items"] == []

    service.delete_file(file_id=uploaded["id"], user_id=7)
    service.purge_file(file_id=uploaded["id"], user_id=7)
    assert service.list_trash(user_id=7)["items"] == []
    with pytest.raises(MyFilesNotFoundError):
        service.restore_file(file_id=uploaded["id"], user_id=7)


def test_restore_file_from_trashed_folder_goes_to_root(tmp_path):
    service = _new_service(tmp_path)
    folder = service.create_folder(actor=_user(), name="Архив")
    uploaded = _upload(service, "doc.bin", folder_id=folder["id"])

    service.delete_folder(actor=_user(), folder_id=folder["id"])
    trash = service.list_trash(user_id=7)
    assert [f["id"] for f in trash["folders"]] == [folder["id"]]
    assert trash["items"] == []

    service.restore_file(file_id=uploaded["id"], user_id=7)
    listing = service.list_files(user_id=7)
    assert [item["id"] for item in listing["items"]] == [uploaded["id"]]
    assert listing["items"][0]["folder_id"] is None


def test_restore_folder_brings_contents_back(tmp_path):
    service = _new_service(tmp_path)
    outer = service.create_folder(actor=_user(), name="Внешняя")
    inner = service.create_folder(actor=_user(), name="Внутренняя", parent_id=outer["id"])
    uploaded = _upload(service, "a.bin", folder_id=inner["id"])

    service.delete_folder(actor=_user(), folder_id=outer["id"])
    restored = service.restore_folder(actor=_user(), folder_id=outer["id"])
    assert restored == 1

    listing = service.list_files(user_id=7, folder_id=inner["id"])
    assert [item["id"] for item in listing["items"]] == [uploaded["id"]]
    assert service.list_trash(user_id=7)["items"] == []
    assert service.list_trash(user_id=7)["folders"] == []


def test_expired_trashed_file_is_purged(tmp_path):
    from datetime import datetime, timedelta, timezone

    from backend.appdb.db import app_session
    from backend.appdb.models import AppMyFile

    service = _new_service(tmp_path)
    uploaded = _upload(service, "old.bin")
    service.process_file(uploaded["id"])
    service.delete_file(file_id=uploaded["id"], user_id=7)

    database_url = _sqlite_url(tmp_path / "app.db")
    with app_session(database_url) as session:
        row = session.get(AppMyFile, uploaded["id"])
        row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)

    assert service.cleanup_expired() == 1
    assert service.list_trash(user_id=7)["items"] == []


def test_folder_share_lists_subtree_files_and_grants_download(tmp_path):
    service = _new_service(tmp_path)
    outer = service.create_folder(actor=_user(), name="Внешняя")
    inner = service.create_folder(actor=_user(), name="Внутренняя", parent_id=outer["id"])
    nested = _upload(service, "nested.bin", folder_id=inner["id"])
    top = _upload(service, "top.bin", folder_id=outer["id"])
    other = _upload(service, "other.bin")
    for item in (nested, top, other):
        service.process_file(item["id"])

    share = service.create_folder_share(actor=_user(), folder_id=outer["id"])
    assert share["public_path"].startswith("/shared-folders/")

    public = service.get_public_folder(token=share["token"])
    assert public["folder_name"] == "Внешняя"
    by_name = {item["file_name"]: item for item in public["items"]}
    assert set(by_name) == {"nested.bin", "top.bin"}
    assert by_name["nested.bin"]["relative_path"] == "Внутренняя"
    assert by_name["top.bin"]["relative_path"] == ""

    grant = service.create_public_folder_download_grant(token=share["token"], file_id=nested["id"])
    download = service.consume_download_grant(token=grant["token"])
    assert download.file_name == "nested.bin"

    # файл вне папки недоступен
    with pytest.raises(MyFilesNotFoundError):
        service.create_public_folder_download_grant(token=share["token"], file_id=other["id"])

    service.revoke_folder_share(actor=_user(), folder_id=outer["id"])
    with pytest.raises(MyFilesNotFoundError):
        service.get_public_folder(token=share["token"])


def test_favorites_and_recent_views(tmp_path):
    service = _new_service(tmp_path)
    folder = service.create_folder(actor=_user(), name="Избранная")
    plain = service.create_folder(actor=_user(), name="Обычная")
    fav_file = _upload(service, "fav.bin", folder_id=folder["id"])
    other = _upload(service, "other.bin")

    service.update_file(actor=_user(), file_id=fav_file["id"], is_favorite=True)
    service.update_folder(actor=_user(), folder_id=folder["id"], is_favorite=True)

    favorites = service.list_files(user_id=7, view="favorites")
    assert [item["id"] for item in favorites["items"]] == [fav_file["id"]]
    assert favorites["items"][0]["is_favorite"] is True
    assert favorites["items"][0]["folder_name"] == "Избранная"
    assert [f["id"] for f in favorites["folders"]] == [folder["id"]]
    assert favorites["breadcrumbs"] == []

    recent = service.list_files(user_id=7, view="recent")
    assert {item["id"] for item in recent["items"]} == {fav_file["id"], other["id"]}
    assert recent["folders"] == []

    service.update_file(actor=_user(), file_id=fav_file["id"], is_favorite=False)
    assert service.list_files(user_id=7, view="favorites")["items"] == []


def test_folder_archive_grant_builds_zip(tmp_path):
    import zipfile

    service = _new_service(tmp_path)
    outer = service.create_folder(actor=_user(), name="Внешняя")
    inner = service.create_folder(actor=_user(), name="Внутренняя", parent_id=outer["id"])
    nested = _upload(service, "nested.bin", folder_id=inner["id"])
    top = _upload(service, "top.bin", folder_id=outer["id"])
    for item in (nested, top):
        service.process_file(item["id"])

    grant = service.create_folder_archive_grant(folder_id=outer["id"], user_id=7, actor=_user())
    payload = service.consume_download_grant(token=grant["token"])
    assert payload.file_name == "Внешняя.zip"
    assert payload.cleanup_after is True
    with zipfile.ZipFile(payload.path) as archive:
        assert sorted(archive.namelist()) == ["top.bin", "Внутренняя/nested.bin"]
    payload.path.unlink(missing_ok=True)

    retry = service.consume_download_grant(token=grant["token"])
    assert retry.file_name == "Внешняя.zip"
    retry.path.unlink(missing_ok=True)
