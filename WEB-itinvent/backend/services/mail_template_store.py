from __future__ import annotations

import json
from dataclasses import dataclass
from threading import RLock
from typing import Any, Callable, Optional

from backend.services.mail_template_model import TemplateValidationError, normalize_template_fields


class TemplateStoreError(ValueError):
    """Raised when IT request template storage cannot complete an operation."""


def normalize_text(value: Any, default: str = "") -> str:
    text = str(value or "").strip()
    return text or default


def parse_template_fields_json(raw_json: str) -> list[dict[str, Any]]:
    try:
        loaded = json.loads(raw_json or "[]")
    except Exception as exc:
        raise TemplateStoreError("Template fields JSON is invalid") from exc
    return normalize_template_fields(loaded)


@dataclass(frozen=True)
class MailTemplateStore:
    lock: RLock
    connect: Callable[[], Any]
    table: str
    id_generator: Callable[[], str]
    now_iso: Callable[[], str]

    def _serialize_row(self, row: Any) -> dict[str, Any]:
        item = dict(row)
        try:
            item["fields"] = parse_template_fields_json(item.get("required_fields_json") or "[]")
        except (TemplateStoreError, TemplateValidationError):
            item["fields"] = []
        return item

    def migrate_legacy_template_fields(self, *, logger: Any) -> None:
        migrated_count = 0
        deactivated_count = 0
        with self.lock, self.connect() as conn:
            rows = conn.execute(
                f"SELECT id, required_fields_json, is_active FROM {self.table}"
            ).fetchall()
            for row in rows:
                template_id = normalize_text(row["id"])
                raw = normalize_text(row["required_fields_json"], "[]")
                try:
                    loaded = json.loads(raw or "[]")
                except Exception:
                    conn.execute(
                        f"UPDATE {self.table} SET is_active = 0, updated_at = ? WHERE id = ?",
                        (self.now_iso(), template_id),
                    )
                    deactivated_count += 1
                    logger.warning("Template %s disabled during migration: invalid fields JSON", template_id)
                    continue

                if not isinstance(loaded, list):
                    conn.execute(
                        f"UPDATE {self.table} SET is_active = 0, updated_at = ? WHERE id = ?",
                        (self.now_iso(), template_id),
                    )
                    deactivated_count += 1
                    logger.warning("Template %s disabled during migration: fields payload is not an array", template_id)
                    continue

                is_new_schema = all(isinstance(item, dict) and normalize_text(item.get("type")) for item in loaded)
                try:
                    if is_new_schema:
                        normalized = normalize_template_fields(loaded)
                    else:
                        converted = []
                        for index, item in enumerate(loaded):
                            if not isinstance(item, dict):
                                raise TemplateStoreError("Legacy field entry must be an object")
                            converted.append(
                                {
                                    "key": normalize_text(item.get("key")).lower(),
                                    "label": normalize_text(item.get("label")),
                                    "type": "text",
                                    "required": bool(item.get("required", True)),
                                    "placeholder": normalize_text(item.get("placeholder")),
                                    "help_text": "",
                                    "default_value": "",
                                    "options": [],
                                    "order": index,
                                }
                            )
                        normalized = normalize_template_fields(converted)
                    serialized = json.dumps(normalized, ensure_ascii=False)
                    if serialized != raw:
                        conn.execute(
                            f"UPDATE {self.table} SET required_fields_json = ?, updated_at = ? WHERE id = ?",
                            (serialized, self.now_iso(), template_id),
                        )
                        migrated_count += 1
                except Exception as exc:
                    conn.execute(
                        f"UPDATE {self.table} SET is_active = 0, updated_at = ? WHERE id = ?",
                        (self.now_iso(), template_id),
                    )
                    deactivated_count += 1
                    logger.warning("Template %s disabled during migration: %s", template_id, exc)
            conn.commit()

        if migrated_count or deactivated_count:
            logger.info(
                "IT template migration completed: migrated=%s deactivated=%s",
                migrated_count,
                deactivated_count,
            )

    def list_templates(self, *, active_only: bool = True) -> list[dict[str, Any]]:
        where_sql = "WHERE is_active = 1" if active_only else ""
        with self.lock, self.connect() as conn:
            rows = conn.execute(
                f"""
                SELECT *
                FROM {self.table}
                {where_sql}
                ORDER BY updated_at DESC, LOWER(title) ASC
                """
            ).fetchall()
        return [self._serialize_row(row) for row in rows]

    def get_template(self, template_id: str, *, active_only: bool = False) -> Optional[dict[str, Any]]:
        normalized_id = normalize_text(template_id)
        if not normalized_id:
            return None
        sql = f"SELECT * FROM {self.table} WHERE id = ?"
        params: list[Any] = [normalized_id]
        if active_only:
            sql += " AND is_active = 1"
        with self.lock, self.connect() as conn:
            row = conn.execute(sql, tuple(params)).fetchone()
        if row is None:
            return None
        return self._serialize_row(row)

    def create_template(self, *, payload: dict[str, Any], actor: dict[str, Any]) -> dict[str, Any]:
        if "required_fields" in payload:
            raise TemplateStoreError("required_fields is no longer supported. Use fields")
        template_id = normalize_text(payload.get("id")) or self.id_generator()
        code = normalize_text(payload.get("code")).lower()
        title = normalize_text(payload.get("title"))
        subject_template = normalize_text(payload.get("subject_template"))
        body_template_md = normalize_text(payload.get("body_template_md"))
        category = normalize_text(payload.get("category"))
        template_fields = normalize_template_fields(payload.get("fields") or [])
        if not code:
            raise TemplateStoreError("Template code is required")
        if not title:
            raise TemplateStoreError("Template title is required")
        if not subject_template:
            raise TemplateStoreError("Template subject is required")
        now = self.now_iso()

        with self.lock, self.connect() as conn:
            exists = conn.execute(
                f"SELECT id FROM {self.table} WHERE code = ?",
                (code,),
            ).fetchone()
            if exists is not None:
                raise TemplateStoreError(f"Template code already exists: {code}")
            conn.execute(
                f"""
                INSERT INTO {self.table}
                (id, code, title, category, subject_template, body_template_md, required_fields_json, is_active,
                 created_by_user_id, created_by_username, updated_by_user_id, updated_by_username, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
                """,
                (
                    template_id,
                    code,
                    title,
                    category,
                    subject_template,
                    body_template_md,
                    json.dumps(template_fields, ensure_ascii=False),
                    int(actor.get("id") or 0),
                    normalize_text(actor.get("username")),
                    int(actor.get("id") or 0),
                    normalize_text(actor.get("username")),
                    now,
                    now,
                ),
            )
            conn.commit()
        created = self.get_template(template_id)
        if not created:
            raise TemplateStoreError("Template was not created")
        return created

    def update_template(self, *, template_id: str, payload: dict[str, Any], actor: dict[str, Any]) -> dict[str, Any]:
        current = self.get_template(template_id, active_only=False)
        if current is None:
            raise TemplateStoreError("Template not found")
        if "required_fields" in payload:
            raise TemplateStoreError("required_fields is no longer supported. Use fields")
        fields: list[str] = []
        params: list[Any] = []

        if "code" in payload:
            code = normalize_text(payload.get("code")).lower()
            if not code:
                raise TemplateStoreError("Template code cannot be empty")
            fields.append("code = ?")
            params.append(code)
        if "title" in payload:
            title = normalize_text(payload.get("title"))
            if not title:
                raise TemplateStoreError("Template title cannot be empty")
            fields.append("title = ?")
            params.append(title)
        if "category" in payload:
            fields.append("category = ?")
            params.append(normalize_text(payload.get("category")))
        if "subject_template" in payload:
            subject_template = normalize_text(payload.get("subject_template"))
            if not subject_template:
                raise TemplateStoreError("Template subject cannot be empty")
            fields.append("subject_template = ?")
            params.append(subject_template)
        if "body_template_md" in payload:
            fields.append("body_template_md = ?")
            params.append(normalize_text(payload.get("body_template_md")))
        if "fields" in payload:
            template_fields = normalize_template_fields(payload.get("fields") or [])
            fields.append("required_fields_json = ?")
            params.append(json.dumps(template_fields, ensure_ascii=False))
        if "is_active" in payload:
            fields.append("is_active = ?")
            params.append(1 if bool(payload.get("is_active")) else 0)

        if not fields:
            return current
        fields.extend(["updated_by_user_id = ?", "updated_by_username = ?", "updated_at = ?"])
        params.extend([int(actor.get("id") or 0), normalize_text(actor.get("username")), self.now_iso()])
        params.append(normalize_text(template_id))

        with self.lock, self.connect() as conn:
            conn.execute(
                f"UPDATE {self.table} SET {', '.join(fields)} WHERE id = ?",
                tuple(params),
            )
            conn.commit()
        updated = self.get_template(template_id, active_only=False)
        if updated is None:
            raise TemplateStoreError("Template not found after update")
        return updated

    def delete_template(self, *, template_id: str, actor: dict[str, Any]) -> bool:
        normalized_id = normalize_text(template_id)
        with self.lock, self.connect() as conn:
            row = conn.execute(f"SELECT id FROM {self.table} WHERE id = ?", (normalized_id,)).fetchone()
            if row is None:
                return False
            conn.execute(
                f"""
                UPDATE {self.table}
                SET is_active = 0, updated_by_user_id = ?, updated_by_username = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    int(actor.get("id") or 0),
                    normalize_text(actor.get("username")),
                    self.now_iso(),
                    normalized_id,
                ),
            )
            conn.commit()
        return True
