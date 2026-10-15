"""Photo verification ("проверено") through the real equipment router.

Pinned behaviour: the uploader cannot verify their own photo (server-side, not only in the
UI), another writer can, verification is idempotent and withdrawn only by the verifier or an
administrator, a deleted/replaced photo loses the mark (FILE_NO is reused), and a missing
check table degrades to "unknown" instead of breaking photos.
"""
from __future__ import annotations

import sys
from functools import partial
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

ITEM_ID = 501


VERIFY_PERMS = ["database.read", "database.write", "database.photo_verify"]


def _user(user_id: int, username: str, full_name: str, role: str = "operator", perms=None):
    from backend.models.auth import User

    perms = list(perms or VERIFY_PERMS)
    return User(
        id=user_id,
        username=username,
        full_name=full_name,
        role=role,
        is_active=True,
        permissions=perms,
        use_custom_permissions=True,
        custom_permissions=perms,
    )


ALICE = _user(1, "alice", "Alice Ivanova")
BOB = _user(2, "bob", "Bob Petrov")
ADMIN = _user(3, "root", "Root Admin", role="admin")
# Writes inventory but was not granted the photo check right.
EDITOR = _user(4, "carol", "Carol Sidorova", perms=["database.read", "database.write"])
# May check photos without being able to edit inventory.
CHECKER = _user(5, "dave", "Dave Checker", perms=["database.read", "database.photo_verify"])


@pytest.fixture
def photo_env(monkeypatch, prebuilt_app_db):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.api import deps
    from backend.api.v1 import equipment as equipment_api
    from backend.appdb.db import app_session
    from backend.database import equipment_current_act_reads, equipment_photos
    from backend.services import equipment_photo_check_service as checks

    database_url = f"sqlite:///{prebuilt_app_db.as_posix()}"
    monkeypatch.setattr(checks, "app_session", lambda url=None: app_session(database_url))
    monkeypatch.setattr(checks, "is_app_database_configured", lambda: True)
    # The photo list also reads the OCR store: keep it on the same throw-away database.
    from backend.services import equipment_photo_ocr_service as ocr

    ocr.reset_table_probe()
    monkeypatch.setattr(ocr, "app_session", lambda url=None: app_session(database_url))
    monkeypatch.setattr(ocr, "is_app_database_configured", lambda: True)
    monkeypatch.setattr(ocr, "is_enabled", lambda: False)

    # In-memory stand-in for FILES: {(item_id, file_no): {created_at, created_by}}.
    files: dict[tuple[int, int], dict] = {}
    clock = {"n": 0, "next_file_no": 100}
    current = {"user": ALICE}

    def fake_insert(**kwargs):
        clock["n"] += 1
        file_no = clock["next_file_no"]
        files[(int(kwargs["item_id"]), file_no)] = {
            "created_at": f"2026-10-12 10:00:{clock['n']:02d}",
            "created_by": kwargs["created_by"],
        }
        return {"file_no": file_no, "ci_type": 1, "item_id": int(kwargs["item_id"])}

    def fake_list(item_id, db_id=None, **_):
        return [
            {
                "file_no": file_no,
                "file_name": f"p{file_no}.jpg",
                "description": "",
                "size_mb": 0.1,
                "has_thumb": True,
                "created_at": meta["created_at"],
                "created_by": meta["created_by"],
            }
            for (it, file_no), meta in sorted(files.items())
            if it == int(item_id)
        ]

    def fake_meta(item_id, file_no, db_id=None, **_):
        meta = files.get((int(item_id), int(file_no)))
        return None if meta is None else {"file_no": int(file_no), **meta}

    def fake_fingerprints(item_ids, db_id=None, **_):
        wanted = {int(v) for v in item_ids}
        return {key: meta["created_at"] for key, meta in files.items() if key[0] in wanted}

    def fake_delete(**kwargs):
        return files.pop((int(kwargs["item_id"]), int(kwargs["file_no"])), None) is not None

    monkeypatch.setattr(equipment_photos, "insert_equipment_photo", fake_insert)
    monkeypatch.setattr(equipment_photos, "list_equipment_photos", fake_list)
    monkeypatch.setattr(equipment_photos, "get_equipment_photo_meta", fake_meta)
    monkeypatch.setattr(equipment_photos, "lookup_photo_fingerprints", fake_fingerprints)
    monkeypatch.setattr(equipment_photos, "delete_equipment_photo", fake_delete)
    monkeypatch.setattr(
        equipment_photos,
        "lookup_equipment_photo_counts",
        lambda ids, db_id=None, **_: {it: sum(1 for k in files if k[0] == it) for it in ids},
    )
    monkeypatch.setattr(equipment_current_act_reads, "lookup_current_acts", lambda ids, db_id=None, **_: {})

    app = FastAPI()
    app.include_router(equipment_api.router, prefix="/equipment")
    app.dependency_overrides[deps.get_current_active_user] = lambda: current["user"]
    app.dependency_overrides[deps.get_request_scoped_database_id] = lambda: "main"
    client = TestClient(app)

    class Env:
        pass

    env = Env()
    env.client = client
    env.files = files
    env.checks = checks
    env.current = current
    env.clock = clock
    env.monkeypatch = monkeypatch

    def act_as(user):
        current["user"] = user

    def upload(user=ALICE):
        act_as(user)
        response = client.post(
            f"/equipment/{ITEM_ID}/photos", files={"file": ("a.jpg", b"x", "image/jpeg")}
        )
        assert response.status_code == 200, response.text
        return response.json()["file_no"]

    def photo(file_no, user):
        act_as(user)
        listing = client.get(f"/equipment/{ITEM_ID}/photos").json()
        return next(p for p in listing["photos"] if p["file_no"] == file_no), listing

    env.act_as = act_as
    env.upload = upload
    env.photo = photo
    env.verify = lambda file_no, user: (act_as(user), client.post(f"/equipment/{ITEM_ID}/photos/{file_no}/verify"))[1]
    env.unverify = lambda file_no, user: (act_as(user), client.delete(f"/equipment/{ITEM_ID}/photos/{file_no}/verify"))[1]
    env.verified_counts = lambda user=BOB: (
        act_as(user),
        client.post("/equipment/current-acts", json={"item_ids": [ITEM_ID]}).json()["items"][0],
    )[1]
    return env


def test_uploader_cannot_verify_but_another_writer_can_and_it_is_idempotent(photo_env):
    file_no = photo_env.upload(ALICE)

    own, listing = photo_env.photo(file_no, ALICE)
    assert listing["verification_available"] is True
    assert own["verified"] is False and own["can_verify"] is False
    refused = photo_env.verify(file_no, ALICE)
    assert refused.status_code == 403

    other, _ = photo_env.photo(file_no, BOB)
    assert other["can_verify"] is True

    first = photo_env.verify(file_no, BOB)
    assert first.status_code == 200
    assert first.json()["verified"] is True and first.json()["verified_by"] == "Bob Petrov"
    assert photo_env.verify(file_no, BOB).status_code == 200

    verified, _ = photo_env.photo(file_no, ALICE)
    assert verified["verified"] is True and verified["verified_by"] == "Bob Petrov"
    assert verified["can_verify"] is False
    assert photo_env.verified_counts()["photo_verified_count"] == 1


def test_check_right_is_separate_from_inventory_write(photo_env):
    file_no = photo_env.upload(ALICE)

    # Inventory write alone is not enough: no button, 403, and the flag says why.
    plain, listing = photo_env.photo(file_no, EDITOR)
    assert listing["verify_permitted"] is False
    assert plain["can_verify"] is False
    assert photo_env.verify(file_no, EDITOR).status_code == 403
    assert photo_env.photo(file_no, BOB)[0]["verified"] is False

    # The right alone is enough, without database.write.
    checker, listing = photo_env.photo(file_no, CHECKER)
    assert listing["verify_permitted"] is True and checker["can_verify"] is True
    assert photo_env.verify(file_no, CHECKER).status_code == 200

    # Withdrawal needs the right too: a plain editor cannot, the verifier and admin can.
    assert photo_env.photo(file_no, EDITOR)[0]["can_unverify"] is False
    assert photo_env.unverify(file_no, EDITOR).status_code == 403
    assert photo_env.unverify(file_no, CHECKER).status_code == 200


def test_withdraw_is_for_the_verifier_or_admin(photo_env):
    file_no = photo_env.upload(ALICE)
    assert photo_env.verify(file_no, BOB).status_code == 200

    # The UI only offers withdrawal to the verifier or an administrator.
    assert photo_env.photo(file_no, ALICE)[0]["can_unverify"] is False
    assert photo_env.photo(file_no, BOB)[0]["can_unverify"] is True
    assert photo_env.photo(file_no, ADMIN)[0]["can_unverify"] is True
    assert photo_env.unverify(file_no, ALICE).status_code == 403
    assert photo_env.photo(file_no, BOB)[0]["verified"] is True

    assert photo_env.unverify(file_no, ADMIN).status_code == 200
    assert photo_env.photo(file_no, BOB)[0]["verified"] is False
    assert photo_env.verified_counts()["photo_verified_count"] == 0


def test_legacy_photo_without_provenance_falls_back_to_create_user(photo_env):
    # Uploaded by the desktop client: only FILES.CREATE_USER is known.
    photo_env.files[(ITEM_ID, 7)] = {"created_at": "2026-01-01 09:00:00", "created_by": "alice"}

    assert photo_env.verify(7, ALICE).status_code == 403
    assert photo_env.verify(7, BOB).status_code == 200


def test_deleted_or_replaced_photo_loses_the_mark(photo_env):
    file_no = photo_env.upload(ALICE)
    assert photo_env.verify(file_no, BOB).status_code == 200

    photo_env.act_as(ALICE)
    assert photo_env.client.delete(f"/equipment/{ITEM_ID}/photos/{file_no}").status_code == 200
    assert photo_env.verified_counts()["photo_verified_count"] == 0

    # FILE_NO is a MAX+1 counter: the same number may come back for a different photo.
    photo_env.clock["next_file_no"] = file_no
    reused = photo_env.upload(BOB)
    assert reused == file_no
    again, _ = photo_env.photo(reused, ALICE)
    assert again["verified"] is False


def test_stale_mark_is_ignored_when_file_no_was_reused_behind_our_back(photo_env):
    file_no = photo_env.upload(ALICE)
    assert photo_env.verify(file_no, BOB).status_code == 200
    # Deleted in the desktop client and replaced: same FILE_NO, other CREATE_DATE.
    photo_env.files[(ITEM_ID, file_no)] = {"created_at": "2026-10-13 08:00:00", "created_by": "carol"}

    assert photo_env.photo(file_no, ALICE)[0]["verified"] is False
    assert photo_env.verified_counts()["photo_verified_count"] == 0


def test_missing_check_store_degrades_without_breaking_photos(photo_env):
    file_no = photo_env.upload(ALICE)
    photo_env.monkeypatch.setattr(photo_env.checks, "is_app_database_configured", lambda: False)

    photo, listing = photo_env.photo(file_no, BOB)
    assert listing["verification_available"] is False
    assert photo["can_verify"] is False and photo["verified"] is False
    assert photo_env.verify(file_no, BOB).status_code == 503
    item = photo_env.verified_counts()
    assert item["photo_count"] == 1
    assert item["photo_verified_count"] is None


def test_checker_rejects_with_a_reason_and_the_mark_replaces_verification(photo_env):
    file_no = photo_env.upload(ALICE)
    assert photo_env.verify(file_no, BOB).status_code == 200

    def reject(user, reason):
        photo_env.act_as(user)
        return photo_env.client.post(
            f"/equipment/{ITEM_ID}/photos/{file_no}/reject", json={"reason": reason}
        )

    # The uploader cannot reject, a reason is mandatory, the plain editor has no right.
    assert reject(ALICE, "плохо видно").status_code == 403
    assert reject(CHECKER, "   ").status_code == 400
    assert reject(EDITOR, "плохо видно").status_code == 403

    response = reject(CHECKER, "Нет инвентарного номера в кадре")
    assert response.status_code == 200
    body = response.json()
    assert body["rejected"] is True and body["reject_reason"] == "Нет инвентарного номера в кадре"

    photo, _ = photo_env.photo(file_no, ALICE)
    assert photo["rejected"] is True and photo["verified"] is False
    assert photo["rejected_by"] == "Dave Checker"
    assert photo["reject_reason"] == "Нет инвентарного номера в кадре"
    assert photo["can_reject"] is False  # uploader cannot judge their own photo

    counts = photo_env.verified_counts()
    assert counts["photo_verified_count"] == 0 and counts["photo_rejected_count"] == 1

    # A later acceptance replaces the rejection.
    assert photo_env.verify(file_no, BOB).status_code == 200
    again, _ = photo_env.photo(file_no, BOB)
    assert again["verified"] is True and again["rejected"] is False and again["reject_reason"] == ""
    counts = photo_env.verified_counts()
    assert counts["photo_verified_count"] == 1 and counts["photo_rejected_count"] == 0


def test_rejection_is_withdrawn_by_the_rejecter_or_admin_and_dies_with_the_photo(photo_env):
    file_no = photo_env.upload(ALICE)
    photo_env.act_as(CHECKER)
    assert photo_env.client.post(
        f"/equipment/{ITEM_ID}/photos/{file_no}/reject", json={"reason": "размыто"}
    ).status_code == 200

    assert photo_env.photo(file_no, BOB)[0]["can_unverify"] is False
    assert photo_env.unverify(file_no, BOB).status_code == 403
    assert photo_env.photo(file_no, CHECKER)[0]["can_unverify"] is True
    assert photo_env.unverify(file_no, CHECKER).status_code == 200
    assert photo_env.photo(file_no, BOB)[0]["rejected"] is False

    photo_env.act_as(CHECKER)
    assert photo_env.client.post(
        f"/equipment/{ITEM_ID}/photos/{file_no}/reject", json={"reason": "размыто"}
    ).status_code == 200
    assert photo_env.unverify(file_no, ADMIN).status_code == 200

    # A replaced photo (same FILE_NO) does not inherit the rejection.
    photo_env.act_as(CHECKER)
    photo_env.client.post(f"/equipment/{ITEM_ID}/photos/{file_no}/reject", json={"reason": "размыто"})
    photo_env.files[(ITEM_ID, file_no)] = {"created_at": "2026-10-20 08:00:00", "created_by": "carol"}
    assert photo_env.photo(file_no, BOB)[0]["rejected"] is False
    assert photo_env.verified_counts()["photo_rejected_count"] == 0


def test_rejection_reason_is_edited_by_the_rejecter_or_admin_only(photo_env):
    file_no = photo_env.upload(ALICE)
    url = f"/equipment/{ITEM_ID}/photos/{file_no}/reject"

    def edit(user, reason):
        photo_env.act_as(user)
        return photo_env.client.patch(url, json={"reason": reason})

    # Nothing to edit until the photo is rejected.
    assert edit(CHECKER, "размыто").status_code == 404
    photo_env.act_as(CHECKER)
    assert photo_env.client.post(url, json={"reason": "размыто"}).status_code == 200

    assert edit(BOB, "другое").status_code == 403
    assert edit(CHECKER, "   ").status_code == 400
    response = edit(CHECKER, "  Не видно  номер ")
    assert response.status_code == 200 and response.json()["reject_reason"] == "Не видно номер"

    photo, _ = photo_env.photo(file_no, ALICE)
    assert photo["rejected"] is True and photo["reject_reason"] == "Не видно номер"
    assert photo["rejected_by"] == "Dave Checker"
    assert edit(ADMIN, "Админ уточнил").status_code == 200
    # The mark itself stays the checker's, only the text changed.
    assert photo_env.photo(file_no, ALICE)[0]["rejected_by"] == "Dave Checker"


def test_rotation_is_for_writers_and_checkers_and_keeps_the_marks(photo_env):
    from backend.database import equipment_photos

    rotated = []

    def fake_rotate(**kwargs):
        rotated.append(kwargs["degrees"])
        return {"file_no": kwargs["file_no"], "file_name": "p.jpg", "size_mb": 0.1, "has_thumb": True}

    photo_env.monkeypatch.setattr(equipment_photos, "rotate_equipment_photo", fake_rotate)
    file_no = photo_env.upload(ALICE)
    assert photo_env.verify(file_no, BOB).status_code == 200
    url = f"/equipment/{ITEM_ID}/photos/{file_no}/rotate"
    viewer = _user(6, "erin", "Erin Viewer", perms=["database.read"])

    def rotate(user, degrees=90):
        photo_env.act_as(user)
        return photo_env.client.post(url, json={"degrees": degrees})

    assert rotate(viewer).status_code == 403
    assert rotate(EDITOR).status_code == 200
    assert rotate(CHECKER, 270).status_code == 200
    assert rotated == [90, 270]

    # The same photo row: the verification mark survives the rotation.
    assert photo_env.photo(file_no, ALICE)[0]["verified"] is True


def test_reject_waits_for_the_migration_without_breaking_verification(photo_env):
    file_no = photo_env.upload(ALICE)
    photo_env.monkeypatch.setattr(photo_env.checks, "reject_columns_available", lambda session: False)

    photo, listing = photo_env.photo(file_no, CHECKER)
    assert listing["verification_available"] is True
    assert photo["can_verify"] is True and photo["can_reject"] is False

    photo_env.act_as(CHECKER)
    refused = photo_env.client.post(
        f"/equipment/{ITEM_ID}/photos/{file_no}/reject", json={"reason": "размыто"}
    )
    assert refused.status_code == 503
    assert photo_env.verify(file_no, CHECKER).status_code == 200
    assert photo_env.verified_counts()["photo_verified_count"] == 1


@pytest.fixture
def notify_env(photo_env):
    """Photo env with the hub, the user directory and the ITEMS lookup replaced by recorders."""
    from backend.database import queries
    from backend.services import hub_service as hub_module
    from backend.services import user_service as user_module

    sent: list[dict] = []
    directory = {
        1: {"id": 1, "username": "alice", "full_name": "Alice Ivanova", "is_active": True},
        2: {"id": 2, "username": "bob", "full_name": "Bob Petrov", "is_active": True},
        6: {"id": 6, "username": "zoe", "full_name": "Zoe Twin", "is_active": True},
        7: {"id": 7, "username": "zoe2", "full_name": "Zoe  Twin", "is_active": True},
    }

    def fake_notification(**kwargs):
        sent.append(kwargs)
        return "n-1"

    def fake_search(*, query="", status="all", limit=50, **_):
        needle = " ".join(query.lower().split())
        items = [u for u in directory.values() if needle in " ".join(u["full_name"].lower().split())]
        return {"items": items, "total": len(items)}

    mp = photo_env.monkeypatch
    mp.setattr(hub_module.hub_service, "create_user_notification", fake_notification)
    mp.setattr(user_module.user_service, "get_by_id", lambda user_id: directory.get(int(user_id)))
    mp.setattr(
        user_module.user_service,
        "get_by_username",
        lambda name: next((u for u in directory.values() if u["username"] == name.lower()), None),
    )
    mp.setattr(user_module.user_service, "search_users", fake_search)
    mp.setattr(
        queries,
        "get_equipment_items_by_ids",
        lambda ids, db_id=None: [{"item_id": ITEM_ID, "inv_no": "INV-501", "model_name": "HP LaserJet"}],
    )
    photo_env.sent = sent
    photo_env.directory = directory
    return photo_env


def _reject(env, file_no, user=CHECKER, reason="Размытое фото"):
    env.act_as(user)
    return env.client.post(f"/equipment/{ITEM_ID}/photos/{file_no}/reject", json={"reason": reason})


def test_rejection_notifies_only_the_uploader_with_a_link_to_the_photo(notify_env):
    file_no = notify_env.upload(ALICE)

    assert _reject(notify_env, file_no).status_code == 200

    assert len(notify_env.sent) == 1
    note = notify_env.sent[0]
    assert note["recipient_user_id"] == 1
    assert note["title"] == "Фото отклонено: INV-501"
    assert "HP LaserJet" in note["body"] and "Размытое фото" in note["body"]
    assert note["entity_type"] == "equipment_photo"
    assert note["entity_id"] == f"main:INV-501:{file_no}"

    # Editing the reason of an existing rejection does not ping the uploader again.
    notify_env.act_as(CHECKER)
    patched = notify_env.client.patch(
        f"/equipment/{ITEM_ID}/photos/{file_no}/reject", json={"reason": "Не виден номер"}
    )
    assert patched.status_code == 200
    assert len(notify_env.sent) == 1


def test_rejection_finds_the_uploader_of_a_legacy_photo_by_name_but_never_guesses(notify_env):
    notify_env.files[(ITEM_ID, 7)] = {"created_at": "2026-01-01 09:00:00", "created_by": "Alice  Ivanova"}
    notify_env.files[(ITEM_ID, 8)] = {"created_at": "2026-01-01 09:01:00", "created_by": "Zoe Twin"}
    notify_env.files[(ITEM_ID, 9)] = {"created_at": "2026-01-01 09:02:00", "created_by": "Кто-то из старого клиента"}

    for file_no in (7, 8, 9):
        assert _reject(notify_env, file_no).status_code == 200

    # Exact full name of one active user -> notified; two namesakes or an unknown name -> nobody.
    assert [n["recipient_user_id"] for n in notify_env.sent] == [1]


def test_failed_notification_does_not_fail_the_rejection(notify_env):
    from backend.services import hub_service as hub_module

    def boom(**_):
        raise RuntimeError("hub is down")

    notify_env.monkeypatch.setattr(hub_module.hub_service, "create_user_notification", boom)
    file_no = notify_env.upload(ALICE)

    response = _reject(notify_env, file_no)

    assert response.status_code == 200 and response.json()["rejected"] is True


@pytest.fixture
def review_env(photo_env):
    """Photo review queue on top of the photo_env stand-ins for FILES / ITEMS."""
    from backend.database import queries
    from backend.services import equipment_photo_review_service as review

    review.reset_cache()

    def fake_recent(db_id, since_days, get_db_fn):
        return [
            {"item_id": item, "file_no": number, "created_at": meta["created_at"], "created_by": meta["created_by"]}
            for (item, number), meta in photo_env.files.items()
        ]

    photo_env.monkeypatch.setattr(review, "_recent_photos", fake_recent)
    photo_env.monkeypatch.setattr(
        queries,
        "get_equipment_items_by_ids",
        lambda ids, db_id=None: [
            {
                "item_id": item, "inv_no": f"INV-{item}", "model_name": "Монитор Dell",
                "serial_no": "SN-1", "employee_name": "Иванов И.И.", "branch_name": "", "location_name": "",
            }
            for item in ids
        ],
    )
    photo_env.review = review

    def queue(user, status, **params):
        photo_env.act_as(user)
        return photo_env.client.get("/equipment/photos/review", params={"status": status, **params})

    def summary(user, **params):
        photo_env.act_as(user)
        return photo_env.client.get("/equipment/photos/review/summary", params=params)

    photo_env.queue = queue
    photo_env.summary = summary
    return photo_env


def test_review_queue_lists_rejected_and_unchecked_photos_without_the_own_ones(review_env):
    env = review_env
    rejected_no = env.upload(ALICE)
    env.clock["next_file_no"] += 1
    own_unchecked_no = env.upload(ALICE)
    env.clock["next_file_no"] += 1
    other_unchecked_no = env.upload(BOB)
    env.act_as(CHECKER)
    reason = "Нет инвентарного номера в кадре"
    assert env.client.post(
        f"/equipment/{ITEM_ID}/photos/{rejected_no}/reject", json={"reason": reason}
    ).status_code == 200

    rejected = env.queue(CHECKER, "rejected").json()
    assert [row["file_no"] for row in rejected["items"]] == [rejected_no]
    row = rejected["items"][0]
    assert row["reject_reason"] == reason and row["rejected_by"] == "Dave Checker"
    assert row["inv_no"] == f"INV-{ITEM_ID}" and row["employee_name"] == "Иванов И.И."

    # The checker sees every photo nobody has judged yet; the uploader never their own.
    checker_view = env.queue(CHECKER, "unchecked").json()
    assert {item["file_no"] for item in checker_view["items"]} == {own_unchecked_no, other_unchecked_no}
    alice_view = env.queue(ALICE, "unchecked").json()
    assert [item["file_no"] for item in alice_view["items"]] == [other_unchecked_no]

    # The uploader finds their rejected photo marked as theirs.
    alice_rejected = env.queue(ALICE, "rejected").json()["items"][0]
    assert alice_rejected["uploaded_by_me"] is True

    counters = env.summary(ALICE).json()
    assert counters["rejected"] == 1 and counters["unchecked"] == 1 and counters["mine_rejected"] == 1


def test_review_queue_follows_checks_and_drops_stale_marks(review_env):
    env = review_env
    file_no = env.upload(BOB)
    assert env.summary(ALICE).json()["unchecked"] == 1

    assert env.verify(file_no, ALICE).status_code == 200
    # Cached for a minute: the client passes refresh=1 after its own action.
    assert env.summary(ALICE, refresh=1).json()["unchecked"] == 0
    assert env.queue(ALICE, "unchecked").json()["items"] == []

    env.clock["next_file_no"] += 1
    other_no = env.upload(BOB)
    env.act_as(CHECKER)
    assert env.client.post(
        f"/equipment/{ITEM_ID}/photos/{other_no}/reject", json={"reason": "размыто"}
    ).status_code == 200
    assert len(env.queue(CHECKER, "rejected").json()["items"]) == 1

    # A deleted photo (FILE_NO may be reused) takes its rejection out of the queue.
    env.files.pop((ITEM_ID, other_no))
    assert env.queue(CHECKER, "rejected").json()["items"] == []


def test_review_queue_needs_the_photo_check_right(review_env):
    env = review_env
    env.upload(ALICE)
    assert env.queue(EDITOR, "rejected").status_code == 403
    assert env.summary(EDITOR).status_code == 403
    assert env.queue(CHECKER, "rejected").status_code == 200
