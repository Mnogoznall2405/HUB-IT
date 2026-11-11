from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

template_model = importlib.import_module("backend.services.mail_template_model")
mail_module = importlib.import_module("backend.services.mail_service")


def test_template_model_normalizes_fields_options_and_order():
    fields = template_model.normalize_template_fields(
        [
            {
                "key": "Department!",
                "label": "Department",
                "type": "select",
                "required": True,
                "options": "IT;IT\nHR",
                "default_value": "HR",
                "order": 2,
            },
            {
                "key": "Approvers",
                "type": "multiselect",
                "options": [{"label": "Ivan"}, {"value": "Olga"}, {"value": "Ivan"}],
                "default_value": ["Ivan", "Unknown"],
                "order": 1,
            },
        ]
    )

    assert [field["key"] for field in fields] == ["approvers", "department"]
    assert fields[0]["options"] == ["Ivan", "Olga"]
    assert fields[0]["default_value"] == ["Ivan"]
    assert fields[1]["options"] == ["IT", "HR"]


def test_template_model_validates_required_and_coerces_values():
    fields = template_model.normalize_template_fields(
        [
            {"key": "accepted", "type": "checkbox", "required": True},
            {"key": "roles", "type": "multiselect", "required": True, "options": ["VPN", "ERP"]},
            {"key": "email", "type": "email", "required": True},
            {"key": "phone", "type": "tel", "required": False},
            {"key": "due", "type": "date", "required": False},
        ]
    )

    values = template_model.validate_template_values(
        fields,
        {
            "accepted": "yes",
            "roles": "VPN;ERP;Unknown",
            "email": "user@example.com",
            "phone": "+7 (343) 123-45-67",
            "due": "2026-05-03",
        },
    )

    assert values == {
        "accepted": True,
        "roles": ["VPN", "ERP"],
        "email": "user@example.com",
        "phone": "+7 (343) 123-45-67",
        "due": "2026-05-03",
    }


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ({"key": "email", "type": "email"}, "bad-email", "valid email"),
        ({"key": "phone", "type": "tel"}, "12", "valid phone"),
        ({"key": "due", "type": "date"}, "03.05.2026", "YYYY-MM-DD"),
        ({"key": "kind", "type": "select", "options": ["A"]}, "B", "unsupported value"),
    ],
)
def test_template_model_rejects_invalid_field_values(field, value, message):
    normalized = template_model.normalize_template_fields([field])

    with pytest.raises(template_model.TemplateValidationError, match=message):
        template_model.validate_template_values(normalized, {field["key"]: value})


def test_template_model_reports_missing_required_fields():
    fields = template_model.normalize_template_fields(
        [
            {"key": "title", "type": "text", "required": True},
            {"key": "approved", "type": "checkbox", "required": True},
        ]
    )

    with pytest.raises(template_model.TemplateValidationError, match="title, approved"):
        template_model.validate_template_values(fields, {"title": "", "approved": False})


def test_template_model_renders_bool_list_and_missing_values():
    result = template_model.render_template(
        "User {{ username }} roles={{roles}} accepted={{accepted}} missing={{missing}}",
        {
            "username": "ivan",
            "roles": ["VPN", "ERP"],
            "accepted": True,
        },
    )

    assert result == "User ivan roles=VPN, ERP accepted=Да missing="


def test_template_model_enforces_attachment_limits():
    limits = template_model.AttachmentLimits(max_files=2, max_file_size=5, max_total_size=8)

    template_model.validate_attachments_limits([("a.txt", b"123"), ("b.txt", b"12345")], limits)

    with pytest.raises(template_model.AttachmentLimitError, match="Maximum is 2"):
        template_model.validate_attachments_limits([("a", b""), ("b", b""), ("c", b"")], limits)

    with pytest.raises(template_model.AttachmentLimitError, match="exceeds 0MB limit"):
        template_model.validate_attachments_limits([("big.bin", b"123456")], limits)

    with pytest.raises(template_model.AttachmentLimitError, match="Total attachment size"):
        template_model.validate_attachments_limits([("a.bin", b"12345"), ("b.bin", b"1234")], limits)


def test_mail_service_template_wrappers_keep_mail_service_errors():
    with pytest.raises(mail_module.MailServiceError, match="Template fields must be an array"):
        mail_module.MailService._normalize_template_fields({"bad": "payload"})

    with pytest.raises(mail_module.MailPayloadTooLargeError, match="Maximum is 1"):
        mail_module.MailService._validate_attachments_limits(
            [("a", b""), ("b", b"")],
            max_files=1,
            max_file_size=1024,
            max_total_size=1024,
        )
