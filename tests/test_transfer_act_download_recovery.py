"""Скачивание акта после перезапуска бэкенда: реестр актов в памяти пуст, файл находится на диске по UUID."""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1] / "WEB-itinvent"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from backend.services import transfer_service  # noqa: E402

ACT_ID = "925505bd-01c8-51e5-8b6e-f6a62b490a55"


def test_recovers_pdf_by_act_id_and_rejects_non_uuid(tmp_path, monkeypatch):
    monkeypatch.setattr(transfer_service, "DEFAULT_ACTS_DIR", tmp_path)
    (tmp_path / f"transfer_act_{ACT_ID}_Иванов.docx").write_bytes(b"PK")
    pdf = tmp_path / f"transfer_act_{ACT_ID}_Иванов.pdf"
    pdf.write_bytes(b"%PDF-1.7")

    record = transfer_service.recover_act_record_from_disk(ACT_ID)

    assert record is not None
    assert record["file_path"] == str(pdf)
    assert record["file_type"] == "pdf"
    assert transfer_service.recover_act_record_from_disk("../*") is None
    assert transfer_service.recover_act_record_from_disk("*") is None
    assert transfer_service.recover_act_record_from_disk("00000000-0000-0000-0000-000000000000") is None
