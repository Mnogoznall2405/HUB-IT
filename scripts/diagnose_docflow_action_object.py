"""Assemble a 1C agreement action and optionally perform one explicitly confirmed write."""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import uuid
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend import config as _config  # noqa: E402,F401 - loads the root .env
from backend.services.docflow_1c_client import (  # noqa: E402
    Docflow1CComClient,
    _call_any,
    _getattr_any,
    _ref_uuid,
)
from backend.services.docflow_service import docflow_service  # noqa: E402


def _select_agreement_task(items: list[dict[str, Any]], requested_ref: str) -> dict[str, Any]:
    normalized_ref = str(requested_ref or "").strip().lower()
    for item in items:
        if normalized_ref and str(item.get("ref") or "").strip().lower() != normalized_ref:
            continue
        if str(item.get("process_type") or "").strip().casefold() != "согласование":
            continue
        if bool(item.get("completed")):
            continue
        return item
    raise RuntimeError("Активное задание процесса Согласование не найдено")


async def _run(
    user_id: int,
    task_ref: str,
    *,
    write_approve: bool,
    confirmed_task_ref: str,
) -> dict[str, Any]:
    login, password = await docflow_service._load_plain_credentials(int(user_id))
    client = Docflow1CComClient()
    connection = None
    try:
        connection = client._connect(login=login, password=password)
        if str(task_ref or "").strip():
            task, _ = client._task_context(connection, task_ref=str(task_ref).strip())
            task = _select_agreement_task([task], task_ref)
        else:
            tasks = client.list_tasks(
                login=login,
                password=password,
                scope="inbox",
                search="",
                limit=50,
            )
            task = _select_agreement_task(list(tasks.get("items") or []), "")
        selected_ref = str(task.get("ref") or "")
        task_reference = client._reference_from_uuid(
            connection,
            manager_names=("Задачи", "Tasks"),
            entity_name="ЗадачаИсполнителя",
            ref=selected_ref,
            label="Задание",
        )
        task_object = _call_any(task_reference, ("ПолучитьОбъект", "GetObject"))
        process_reference = _getattr_any(task_object, "БизнесПроцесс", "BusinessProcess")
        process_object = _call_any(process_reference, ("ПолучитьОбъект", "GetObject"))
        additional_properties = _getattr_any(
            process_object,
            "ДополнительныеСвойства",
            "AdditionalProperties",
        )
        enums = _getattr_any(connection, "Перечисления", "Enums")
        agreement_results = _getattr_any(enums, "РезультатыСогласования")
        approved = _getattr_any(agreement_results, "Согласовано")

        _call_any(additional_properties, ("Вставить", "Insert"), "ТекущаяЗадача", task_reference)
        _call_any(
            additional_properties,
            ("Вставить", "Insert"),
            "РезультатСогласования",
            approved,
        )

        assembled_task = _getattr_any(additional_properties, "ТекущаяЗадача")
        assembled_result = _getattr_any(additional_properties, "РезультатСогласования")
        result = {
            "assembled": True,
            "write_called": False,
            "task_ref": selected_ref,
            "process_ref": _ref_uuid(connection, process_reference),
            "process_type": str(task.get("process_type") or ""),
            "current_task_matches": _ref_uuid(connection, assembled_task).lower() == selected_ref.lower(),
            "agreement_result": str(assembled_result),
            "pilot_title": str(task.get("title") or "").strip().upper().startswith("HUB-IT TEST"),
        }
        if not write_approve:
            return result

        normalized_confirmation = str(confirmed_task_ref or "").strip().lower()
        if normalized_confirmation != selected_ref.lower():
            raise RuntimeError("Для записи требуется точное подтверждение UUID задания")

        before, _ = client._task_context(connection, task_ref=selected_ref)
        if bool(before.get("completed")):
            return {
                **result,
                "status": "already_applied",
                "before": {
                    "completed": True,
                    "accepted": before.get("accepted"),
                    "result": str(before.get("result") or ""),
                },
            }

        transaction_started = False
        privileged_mode = False
        write_call_started = False
        command_id = uuid.uuid4().hex
        try:
            _call_any(connection, ("НачатьТранзакцию", "BeginTransaction"))
            transaction_started = True
            _call_any(
                connection,
                ("ЗаблокироватьДанныеДляРедактирования", "LockDataForEdit"),
                process_reference,
            )

            locked_state, _ = client._task_context(connection, task_ref=selected_ref)
            if bool(locked_state.get("completed")):
                _call_any(connection, ("ОтменитьТранзакцию", "RollbackTransaction"))
                transaction_started = False
                return {
                    **result,
                    "status": "already_applied",
                    "before": {
                        "completed": True,
                        "accepted": locked_state.get("accepted"),
                        "result": str(locked_state.get("result") or ""),
                    },
                }
            if str(locked_state.get("process_ref") or "").lower() != result["process_ref"].lower():
                raise RuntimeError("Процесс задания изменился перед записью")

            locked_task_reference = client._reference_from_uuid(
                connection,
                manager_names=("Задачи", "Tasks"),
                entity_name="ЗадачаИсполнителя",
                ref=selected_ref,
                label="Задание",
            )
            locked_task_object = _call_any(locked_task_reference, ("ПолучитьОбъект", "GetObject"))
            locked_process_reference = _getattr_any(
                locked_task_object,
                "БизнесПроцесс",
                "BusinessProcess",
            )
            locked_process_object = _call_any(
                locked_process_reference,
                ("ПолучитьОбъект", "GetObject"),
            )
            locked_properties = _getattr_any(
                locked_process_object,
                "ДополнительныеСвойства",
                "AdditionalProperties",
            )
            _call_any(
                locked_properties,
                ("Вставить", "Insert"),
                "ТекущаяЗадача",
                locked_task_reference,
            )
            _call_any(
                locked_properties,
                ("Вставить", "Insert"),
                "РезультатСогласования",
                approved,
            )

            _call_any(
                connection,
                ("УстановитьПривилегированныйРежим", "SetPrivilegedMode"),
                True,
            )
            privileged_mode = True
            business_processes = _getattr_any(
                connection,
                "РаботаСБизнесПроцессами",
            )
            write_call_started = True
            _call_any(
                business_processes,
                ("ЗаписатьПроцесс",),
                locked_process_object,
                "ЗаписьСОбработкойВыполненияЗадачи",
            )
            _call_any(
                connection,
                ("УстановитьПривилегированныйРежим", "SetPrivilegedMode"),
                False,
            )
            privileged_mode = False
            _call_any(connection, ("ЗафиксироватьТранзакцию", "CommitTransaction"))
            transaction_started = False
        except Exception as exc:
            if privileged_mode:
                try:
                    _call_any(
                        connection,
                        ("УстановитьПривилегированныйРежим", "SetPrivilegedMode"),
                        False,
                    )
                except Exception:
                    pass
            if transaction_started:
                try:
                    _call_any(connection, ("ОтменитьТранзакцию", "RollbackTransaction"))
                except Exception:
                    pass
            after_error, _ = client._task_context(connection, task_ref=selected_ref)
            return {
                **result,
                "status": "write_failed",
                "write_called": write_call_started,
                "command_id": command_id,
                "error": str(exc),
                "before": {
                    "completed": bool(before.get("completed")),
                    "accepted": before.get("accepted"),
                    "result": str(before.get("result") or ""),
                },
                "after": {
                    "completed": bool(after_error.get("completed")),
                    "accepted": after_error.get("accepted"),
                    "result": str(after_error.get("result") or ""),
                },
            }

        after, _ = client._task_context(connection, task_ref=selected_ref)
        return {
            **result,
            "status": "applied" if bool(after.get("completed")) else "state_unknown",
            "write_called": True,
            "command_id": command_id,
            "before": {
                "completed": bool(before.get("completed")),
                "accepted": before.get("accepted"),
                "result": str(before.get("result") or ""),
            },
            "after": {
                "completed": bool(after.get("completed")),
                "accepted": after.get("accepted"),
                "result": str(after.get("result") or ""),
            },
        }
    finally:
        password = ""
        connection = None
        client.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--user-id", type=int, required=True)
    parser.add_argument("--task-ref", default="")
    parser.add_argument("--write-approve", action="store_true")
    parser.add_argument("--confirm-task-ref", default="")
    args = parser.parse_args()
    try:
        result = asyncio.run(
            _run(
                args.user_id,
                args.task_ref,
                write_approve=bool(args.write_approve),
                confirmed_task_ref=args.confirm_task_ref,
            )
        )
    except Exception as exc:
        print(json.dumps({"assembled": False, "write_called": False, "error": str(exc)}, ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
