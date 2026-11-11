from __future__ import annotations

import argparse
import json
import secrets
import sys
from datetime import datetime, timezone
from pathlib import Path


ACCOUNT_PREFIX = "marketing_demo_"
DEFAULT_STATE_DIR = ".codex_tmp/about-capture"
DEMO_PEOPLE = (
    {
        "suffix": "anton",
        "full_name": "Антон Лебедев",
        "department": "Проектный офис",
        "job_title": "Координатор проектов",
    },
    {
        "suffix": "marina",
        "full_name": "Марина Орлова",
        "department": "Финансовая служба",
        "job_title": "Ведущий специалист",
    },
    {
        "suffix": "kirill",
        "full_name": "Кирилл Волков",
        "department": "IT-поддержка",
        "job_title": "Инженер поддержки",
    },
    {
        "suffix": "elena",
        "full_name": "Елена Соколова",
        "department": "Отдел снабжения",
        "job_title": "Специалист по снабжению",
    },
)


def _project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _configure_imports(project_root: Path) -> None:
    web_root = project_root / "WEB-itinvent"
    for path in (web_root, project_root):
        value = str(path)
        if value not in sys.path:
            sys.path.insert(0, value)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _write_private_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _load_json(path: Path) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise SystemExit(f"Некорректный JSON: {path}")
    return payload


def _require_confirmation(args: argparse.Namespace) -> None:
    if not args.confirm_current_hub:
        raise SystemExit(
            "Операция изменяет данные текущего HUB. Повторите команду с --confirm-current-hub."
        )


def _load_user_service(project_root: Path):
    _configure_imports(project_root)
    from backend.services.user_service import user_service

    return user_service


def prepare(args: argparse.Namespace) -> int:
    _require_confirmation(args)
    project_root = _project_root()
    state_root = (project_root / args.state_dir).resolve()
    batch = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    batch_dir = state_root / batch
    manifest_path = batch_dir / "manifest.json"
    credentials_path = batch_dir / "credentials.json"
    user_service = _load_user_service(project_root)

    existing = [
        item
        for item in user_service.list_users()
        if str(item.get("username") or "").startswith(ACCOUNT_PREFIX)
    ]
    if existing:
        raise SystemExit(
            "Уже существуют временные marketing_demo_* учётки. Сначала выполните их очистку."
        )

    password = secrets.token_urlsafe(24)
    created_users: list[dict] = []
    try:
        for person in DEMO_PEOPLE:
            username = f"{ACCOUNT_PREFIX}{batch}_{person['suffix']}"
            created = user_service.create_user(
                username=username,
                password=password,
                role="viewer",
                auth_source="local",
                email=None,
                full_name=person["full_name"],
                department=person["department"],
                job_title=person["job_title"],
                is_active=True,
                use_custom_permissions=False,
                custom_permissions=[],
            )
            created_users.append(
                {
                    "id": int(created["id"]),
                    "username": str(created["username"]),
                    "full_name": str(created.get("full_name") or ""),
                }
            )
    except Exception:
        for created in reversed(created_users):
            current = user_service.get_by_id(int(created["id"]))
            if current and str(current.get("username") or "") == created["username"]:
                user_service.delete_user(int(created["id"]))
        raise

    _write_private_json(
        manifest_path,
        {
            "schema_version": 1,
            "kind": "hub-about-capture",
            "batch": batch,
            "created_at": _utc_now(),
            "users": created_users,
            "resources": {"conversation_ids": [], "task_ids": [], "file_ids": []},
            "cleanup_completed_at": None,
        },
    )
    _write_private_json(
        credentials_path,
        {
            "batch": batch,
            "password": password,
            "users": [
                {"id": item["id"], "username": item["username"]}
                for item in created_users
            ],
        },
    )
    print(f"Создан тестовый контур: {batch}")
    print(f"Manifest: {manifest_path}")
    print("Создано учёток: 4 (viewer, use_custom_permissions=false)")
    return 0


def cleanup_users(args: argparse.Namespace) -> int:
    _require_confirmation(args)
    project_root = _project_root()
    manifest_path = Path(args.manifest).resolve()
    state_root = (project_root / args.state_dir).resolve()
    if state_root not in manifest_path.parents:
        raise SystemExit(f"Manifest должен находиться внутри {state_root}")

    manifest = _load_json(manifest_path)
    if manifest.get("kind") != "hub-about-capture" or manifest.get("schema_version") != 1:
        raise SystemExit("Это не manifest тестового контура HUB About")

    user_service = _load_user_service(project_root)
    deleted = 0
    for recorded in reversed(list(manifest.get("users") or [])):
        user_id = int(recorded.get("id") or 0)
        username = str(recorded.get("username") or "")
        if user_id <= 1 or not username.startswith(ACCOUNT_PREFIX):
            raise SystemExit(f"Небезопасная запись пользователя в manifest: {recorded!r}")
        current = user_service.get_by_id(user_id)
        if current is None:
            continue
        current_username = str(current.get("username") or "")
        if current_username != username:
            raise SystemExit(
                f"ID {user_id} теперь принадлежит другой учётке; удаление остановлено."
            )
        if not current_username.startswith(ACCOUNT_PREFIX):
            raise SystemExit(f"Отказ удаления учётки без префикса {ACCOUNT_PREFIX}")
        if user_service.delete_user(user_id):
            deleted += 1

    manifest["cleanup_completed_at"] = _utc_now()
    _write_private_json(manifest_path, manifest)
    print(f"Удалено временных учёток: {deleted}")
    print("Перед удалением учёток ресурсы из manifest должны быть удалены через HUB API.")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Создание и безопасная очистка временных viewer-учёток для скриншотов /about."
    )
    parser.add_argument("--state-dir", default=DEFAULT_STATE_DIR)
    parser.add_argument("--confirm-current-hub", action="store_true")
    subparsers = parser.add_subparsers(dest="command", required=True)

    prepare_parser = subparsers.add_parser("prepare")
    prepare_parser.set_defaults(handler=prepare)

    cleanup_parser = subparsers.add_parser("cleanup-users")
    cleanup_parser.add_argument("--manifest", required=True)
    cleanup_parser.set_defaults(handler=cleanup_users)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    return int(args.handler(args))


if __name__ == "__main__":
    raise SystemExit(main())
