"""IT object network map (drawio): per-section access, optimistic saves and removal.

Same harness as test_it_objects.py: only the current user, the user directory and the objects
SQL Server read are replaced; routes, permission dependencies, the service and the app database
(sqlite) are real.
"""
from __future__ import annotations

import runpy
import sys
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import Request
from fastapi.testclient import TestClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api import deps  # noqa: E402
from backend.api.v1 import it_objects as it_objects_api  # noqa: E402
from backend.main import app  # noqa: E402
from backend.models.auth import User  # noqa: E402
from backend.services.it_objects_service import ItObjectsService  # noqa: E402

BRANCHES = [{"id": 12, "name": "Объект Альфа"}, {"id": 13, "name": "Объект Бета"}]
OBJECT_REF = "OBJ-ITINVENT:12"
OTHER_REF = "OBJ-ITINVENT:13"
BASE = "/api/v1/it-objects"

ADMIN, OWNER, COLLEAGUE, VIEWER = 1, 2, 3, 4

MAP_XML = (
    '<mxfile host="app.diagrams.net" agent="test">'
    '<diagram name="Page-1"><mxGraphModel><root><mxCell id="0"/></root></mxGraphModel></diagram>'
    '</mxfile>'
)
MAP_XML_V2 = (
    '<?xml version="1.0" encoding="UTF-8"?>'
    '<mxfile host="app.diagrams.net"><diagram name="Page-2">'
    '<mxGraphModel><root><mxCell id="0"/><mxCell id="1"/></root></mxGraphModel></diagram>'
    '</mxfile>'
)


def _user(user_id: int, username: str, role: str) -> dict:
    return {
        "id": user_id,
        "username": username,
        "email": f"{username}@zsgp.ru",
        "full_name": username.title(),
        "is_active": True,
        "role": role,
        "permissions": [],
        "use_custom_permissions": False,
        "custom_permissions": [],
        "auth_source": "local",
        "is_2fa_enabled": False,
    }


USERS = {
    ADMIN: _user(ADMIN, "admin_user", "admin"),
    OWNER: _user(OWNER, "owner_user", "operator"),
    COLLEAGUE: _user(COLLEAGUE, "colleague_user", "operator"),
    VIEWER: _user(VIEWER, "viewer_user", "viewer"),
}


def _as(user_id: int) -> dict[str, str]:
    return {"X-Test-User": str(user_id)}


@pytest.fixture
def service(tmp_path):
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'it_objects.db').as_posix()}"
    return ItObjectsService(database_url=database_url, source_db_id="OBJ-ITINVENT", branch_reader=lambda db_id: list(BRANCHES))


@pytest.fixture
def client(service, monkeypatch):
    async def current_user(request: Request) -> User:
        return User(**USERS[int(request.headers["X-Test-User"])])

    app.dependency_overrides[deps.get_current_active_user] = current_user
    monkeypatch.setattr(it_objects_api, "get_it_objects_service", lambda: service)
    monkeypatch.setattr(it_objects_api.user_service, "get_by_id", lambda user_id: dict(USERS[int(user_id)]) if int(user_id) in USERS else None)
    try:
        yield TestClient(app, base_url="https://testserver", raise_server_exceptions=False)
    finally:
        app.dependency_overrides.pop(deps.get_current_active_user, None)


def _assign_owner(client, object_ref=OBJECT_REF, owner=OWNER, actor=ADMIN):
    return client.put(f"{BASE}/{object_ref}/owner", json={"user_id": owner}, headers=_as(actor))


def _grant(client, user_id, section="netmap", level="view", actor=OWNER, object_ref=OBJECT_REF):
    return client.put(
        f"{BASE}/{object_ref}/grants",
        json={"user_id": user_id, "section": section, "level": level},
        headers=_as(actor),
    )


def _put_map(client, actor, xml=MAP_XML, file_name="net.drawio", expected=None, object_ref=OBJECT_REF, preview=None):
    body = {"file_name": file_name, "xml": xml}
    if expected is not None:
        body["expected_version"] = expected
    if preview is not None:
        body["preview_png"] = preview
    return client.put(f"{BASE}/{object_ref}/netmap", json=body, headers=_as(actor))


def _get_map(client, actor, object_ref=OBJECT_REF):
    return client.get(f"{BASE}/{object_ref}/netmap", headers=_as(actor))


def test_owner_saves_reads_and_updates_the_map_while_the_card_lists_the_section(client):
    assert _assign_owner(client).status_code == 200
    card = client.get(f"{BASE}/{OBJECT_REF}", headers=_as(OWNER)).json()
    assert card["my_access"]["sections"]["netmap"] == "manage"

    assert _get_map(client, OWNER).json() == {"object_ref": OBJECT_REF, "map": None, "can_manage": True, "labels": []}

    created = _put_map(client, OWNER)
    assert created.status_code == 200, created.text
    saved = created.json()["map"]
    assert saved["file_name"] == "net.drawio" and saved["xml"] == MAP_XML
    assert saved["updated_by"] == "Owner_User" and saved["updated_at"]

    fetched = _get_map(client, OWNER).json()
    assert fetched["map"]["xml"] == MAP_XML and fetched["can_manage"] is True

    updated = _put_map(client, OWNER, xml=MAP_XML_V2, file_name="net-v2.drawio", expected=saved["version"])
    assert updated.status_code == 200, updated.text
    assert _get_map(client, OWNER).json()["map"]["version"] == saved["version"] + 1
    assert _get_map(client, OWNER).json()["map"]["xml"] == MAP_XML_V2


def test_the_map_is_scoped_to_the_netmap_section(client):
    assert _assign_owner(client).status_code == 200
    assert _put_map(client, OWNER).status_code == 200

    # No grant at all: nothing.
    assert _get_map(client, COLLEAGUE).status_code == 403
    assert _put_map(client, COLLEAGUE).status_code == 403

    # A grant on another section does not open the map.
    assert _grant(client, COLLEAGUE, section="passwords", level="manage").status_code == 200
    assert _get_map(client, COLLEAGUE).status_code == 403

    # View: reads but does not write.
    assert _grant(client, COLLEAGUE, section="netmap", level="view").status_code == 200
    seen = _get_map(client, COLLEAGUE)
    assert seen.status_code == 200 and seen.json()["map"]["xml"] == MAP_XML
    assert seen.json()["can_manage"] is False
    assert _put_map(client, COLLEAGUE).status_code == 403
    assert client.delete(f"{BASE}/{OBJECT_REF}/netmap", headers=_as(COLLEAGUE)).status_code == 403

    # Manage: writes; the other object's map stays untouched.
    assert _grant(client, COLLEAGUE, section="netmap", level="manage", actor=OWNER).status_code == 200
    assert _put_map(client, COLLEAGUE, xml=MAP_XML_V2, file_name="colleague.drawio").status_code == 200
    assert _get_map(client, COLLEAGUE).json()["map"]["file_name"] == "colleague.drawio"
    assert _get_map(client, COLLEAGUE, object_ref=OTHER_REF).status_code == 403


def test_a_stale_save_is_rejected_until_it_is_confirmed(client):
    assert _assign_owner(client).status_code == 200
    assert _grant(client, COLLEAGUE, section="netmap", level="manage").status_code == 200
    assert _put_map(client, OWNER).status_code == 200
    version_one = _get_map(client, OWNER).json()["map"]["version"]

    # Someone else saved in between: our expected version is stale.
    assert _put_map(client, COLLEAGUE, xml=MAP_XML_V2).status_code == 200
    stale = _put_map(client, OWNER, xml=MAP_XML, expected=version_one)
    assert stale.status_code == 409
    assert _get_map(client, OWNER).json()["map"]["xml"] == MAP_XML_V2  # the newer save survived

    # The acknowledged overwrite goes through; saving without expectations just wins.
    forced = _put_map(client, OWNER, xml=MAP_XML, file_name="forced.drawio")
    assert forced.status_code == 200
    assert _get_map(client, OWNER).json()["map"]["xml"] == MAP_XML


def test_only_drawio_documents_are_accepted(client):
    assert _assign_owner(client).status_code == 200

    assert client.put(f"{BASE}/{OBJECT_REF}/netmap", json={"file_name": "x.drawio", "xml": "short"}, headers=_as(OWNER)).status_code == 422
    not_drawio = client.put(
        f"{BASE}/{OBJECT_REF}/netmap",
        json={"file_name": "note.txt", "xml": "this is definitely not a diagram"},
        headers=_as(OWNER),
    )
    assert not_drawio.status_code == 400
    assert _put_map(client, OWNER, xml=MAP_XML_V2).status_code == 200  # prolog is fine


def test_delete_removes_only_the_map(client):
    assert _assign_owner(client).status_code == 200
    assert _put_map(client, OWNER).status_code == 200

    assert client.delete(f"{BASE}/{OBJECT_REF}/netmap", headers=_as(OWNER)).status_code == 200
    assert _get_map(client, OWNER).json()["map"] is None
    assert client.get(f"{BASE}/{OBJECT_REF}/netmap/versions", headers=_as(OWNER)).json()["items"] == []
    card = client.get(f"{BASE}/{OBJECT_REF}", headers=_as(OWNER)).json()
    assert card["my_access"]["sections"]["netmap"] == "manage"  # the section itself stays

    # Repeated delete is a no-op, and a fresh map can be saved again.
    assert client.delete(f"{BASE}/{OBJECT_REF}/netmap", headers=_as(OWNER)).status_code == 200
    assert _put_map(client, OWNER).status_code == 200


def test_hiding_the_object_closes_the_map_too(client):
    assert _assign_owner(client).status_code == 200
    assert _put_map(client, OWNER).status_code == 200

    assert client.delete(f"{BASE}/{OBJECT_REF}", headers=_as(ADMIN)).status_code == 200
    assert _get_map(client, OWNER).status_code == 403

    assert client.post(f"{BASE}/{OBJECT_REF}/restore", headers=_as(ADMIN)).status_code == 200
    assert _get_map(client, OWNER).json()["map"]["xml"] == MAP_XML  # the map survived the hide/restore


def test_every_save_keeps_a_restorable_version(client):
    assert _assign_owner(client).status_code == 200
    assert _grant(client, COLLEAGUE, section="netmap", level="view").status_code == 200

    assert _put_map(client, OWNER, xml=MAP_XML, file_name="v1.drawio").status_code == 200
    second = _put_map(client, OWNER, xml=MAP_XML_V2, file_name="v2.drawio", expected=1)
    assert second.status_code == 200, second.text

    # View level is enough to browse the history.
    listing = client.get(f"{BASE}/{OBJECT_REF}/netmap/versions", headers=_as(COLLEAGUE))
    assert listing.status_code == 200, listing.text
    items = listing.json()["items"]
    assert [item["version"] for item in items] == [2, 1]
    assert items[0]["file_name"] == "v2.drawio" and items[0]["saved_by"] == "Owner_User"

    one = client.get(f"{BASE}/{OBJECT_REF}/netmap/versions/1", headers=_as(COLLEAGUE))
    assert one.status_code == 200 and one.json()["map"]["xml"] == MAP_XML
    assert client.get(f"{BASE}/{OBJECT_REF}/netmap/versions/9", headers=_as(COLLEAGUE)).status_code == 404
    assert client.get(f"{BASE}/{OBJECT_REF}/netmap/versions", headers=_as(VIEWER)).status_code == 403

    # Restoring = a normal save of the old xml on top: it becomes the latest version.
    restored = _put_map(client, OWNER, xml=MAP_XML, file_name="v1.drawio", expected=2)
    assert restored.status_code == 200
    assert _get_map(client, OWNER).json()["map"]["version"] == 3
    assert [item["version"] for item in client.get(f"{BASE}/{OBJECT_REF}/netmap/versions", headers=_as(OWNER)).json()["items"]] == [3, 2, 1]


def test_the_editor_png_is_stored_and_served_separately(client):
    import base64

    png = b"\x89PNG\r\n\x1a\n" + b"fakepng"
    assert _assign_owner(client).status_code == 200
    assert _grant(client, COLLEAGUE, section="netmap", level="view").status_code == 200

    # No map yet: neither a stored preview nor a preview write.
    assert client.get(f"{BASE}/{OBJECT_REF}/netmap/preview", headers=_as(OWNER)).status_code == 404
    assert client.put(
        f"{BASE}/{OBJECT_REF}/netmap/preview",
        json={"png": base64.b64encode(png).decode()},
        headers=_as(OWNER),
    ).status_code == 404

    assert _put_map(client, OWNER).status_code == 200
    assert _get_map(client, OWNER).json()["map"]["has_preview"] is False

    assert client.put(
        f"{BASE}/{OBJECT_REF}/netmap/preview",
        json={"png": "data:image/png;base64," + base64.b64encode(png).decode()},
        headers=_as(OWNER),
    ).status_code == 200
    fetched = client.get(f"{BASE}/{OBJECT_REF}/netmap/preview", headers=_as(COLLEAGUE))
    assert fetched.status_code == 200 and fetched.content == png and fetched.headers["content-type"].startswith("image/png")
    assert _get_map(client, OWNER).json()["map"]["has_preview"] is True

    # View may read the preview but not replace it; garbage is rejected.
    assert client.put(
        f"{BASE}/{OBJECT_REF}/netmap/preview",
        json={"png": base64.b64encode(png).decode()},
        headers=_as(COLLEAGUE),
    ).status_code == 403
    assert client.put(
        f"{BASE}/{OBJECT_REF}/netmap/preview",
        json={"png": base64.b64encode(b"not-a-png").decode()},
        headers=_as(OWNER),
    ).status_code == 400

    # The save payload itself may carry the thumbnail; it does not bump the version.
    before = _get_map(client, OWNER).json()["map"]["version"]
    saved = _put_map(client, OWNER, xml=MAP_XML_V2, expected=before, preview=base64.b64encode(png).decode())
    assert saved.status_code == 200
    assert client.get(f"{BASE}/{OBJECT_REF}/netmap/preview", headers=_as(OWNER)).content == png


def test_map_labels_come_from_diagram_vertices(client):
    assert _assign_owner(client).status_code == 200
    xml = (
        '<mxfile host="app.diagrams.net"><diagram name="Page-1"><mxGraphModel><root>'
        '<mxCell id="0"/><mxCell id="1" parent="0"/>'
        '<object id="sw" label="SW-CORE-01" placeHolder="1"><mxCell parent="1" vertex="1" style="x"/></object>'
        '<mxCell id="pc" value="&lt;b&gt;PC-ALPHA-1&lt;/b&gt;" parent="1" vertex="1" style="x"/>'
        '<mxCell id="edge" value="uplink" parent="1" edge="1" source="sw" target="pc" style="x"/>'
        '</root></mxGraphModel></diagram></mxfile>'
    )
    assert _put_map(client, OWNER, xml=xml).status_code == 200
    labels = _get_map(client, OWNER).json()["labels"]
    assert "SW-CORE-01" in labels and "PC-ALPHA-1" in labels
    assert "uplink" not in labels  # edges and free text are not device labels


def test_map_labels_are_read_from_compressed_diagram_bodies(client):
    """Real .drawio files keep <diagram> content as base64 + raw-deflate(URI-encoded XML)."""
    import base64
    import zlib
    from urllib.parse import quote

    def pack(inner_xml: str) -> str:
        compressor = zlib.compressobj(zlib.Z_DEFAULT_COMPRESSION, zlib.DEFLATED, -15)
        blob = compressor.compress(quote(inner_xml).encode()) + compressor.flush()
        return base64.b64encode(blob).decode()

    assert _assign_owner(client).status_code == 200
    inner = (
        '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>'
        '<mxCell id="sw" value="SW-EDGE-01" parent="1" vertex="1" style="x"/></root></mxGraphModel>'
    )
    xml = f'<mxfile host="app.diagrams.net"><diagram name="Page-1">{pack(inner)}</diagram></mxfile>'
    assert _put_map(client, OWNER, xml=xml).status_code == 200
    labels = _get_map(client, OWNER).json()["labels"]
    assert labels == ["SW-EDGE-01"]


def test_netmap_migration_up_and_down():
    revision = PROJECT_ROOT / "WEB-itinvent" / "backend" / "alembic" / "versions" / "20261111_0166_it_object_netmap.py"
    engine = sa.create_engine("sqlite+pysqlite:///:memory:", future=True)
    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))

        def run(name: str) -> None:
            operation = runpy.run_path(str(revision))[name]
            operation.__globals__["op"] = operations
            operation.__globals__["_scope"] = lambda: "app"
            operation()

        run("upgrade")
        run("upgrade")  # created "if missing": a second run must be a no-op
        inspector = sa.inspect(connection)
        assert inspector.has_table("it_object_netmaps")
        assert {column["name"] for column in inspector.get_columns("it_object_netmaps")} >= {
            "id", "object_id", "file_name", "xml", "version", "updated_at", "updated_by_user_id",
        }
        uniques = [item for item in inspector.get_unique_constraints("it_object_netmaps") if item["column_names"] == ["object_id"]]
        assert len(uniques) == 1

        run("downgrade")
        assert not sa.inspect(connection).has_table("it_object_netmaps")


def test_netmap_versions_migration_up_and_down():
    """0168 adds preview_png to the 0166 table and creates the history table."""
    versions_dir = PROJECT_ROOT / "WEB-itinvent" / "backend" / "alembic" / "versions"
    engine = sa.create_engine("sqlite+pysqlite:///:memory:", future=True)
    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))

        def run(revision_file: str, name: str) -> None:
            operation = runpy.run_path(str(versions_dir / revision_file))[name]
            operation.__globals__["op"] = operations
            operation.__globals__["_scope"] = lambda: "app"
            operation()

        run("20261111_0166_it_object_netmap.py", "upgrade")
        run("20261111_0168_it_object_netmap_versions.py", "upgrade")
        run("20261111_0168_it_object_netmap_versions.py", "upgrade")  # create-if-missing: a second run is a no-op
        inspector = sa.inspect(connection)
        assert "preview_png" in {column["name"] for column in inspector.get_columns("it_object_netmaps")}
        assert inspector.has_table("it_object_netmap_versions")
        assert {column["name"] for column in inspector.get_columns("it_object_netmap_versions")} >= {
            "id", "object_id", "version", "file_name", "xml", "saved_by_user_id", "saved_by_name", "created_at",
        }
        uniques = [
            item for item in inspector.get_unique_constraints("it_object_netmap_versions")
            if set(item["column_names"]) == {"object_id", "version"}
        ]
        assert len(uniques) == 1

        run("20261111_0168_it_object_netmap_versions.py", "downgrade")
        assert not sa.inspect(connection).has_table("it_object_netmap_versions")
        assert "preview_png" not in {column["name"] for column in sa.inspect(connection).get_columns("it_object_netmaps")}
