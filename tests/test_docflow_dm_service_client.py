from __future__ import annotations

import re
import sys
from pathlib import Path

import httpx
import pytest
from lxml import etree

ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.docflow_1c_client import (  # noqa: E402
    Docflow1CAuthenticationError,
    Docflow1CUnavailableError,
)
from backend.services.docflow_dm_service_client import (  # noqa: E402
    DocflowDMServiceClient,
    SOAP_ACTION,
)


def _soap_response(response_type: str, content: str = "") -> bytes:
    return f'''<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
 xmlns:tns="http://www.1c.ru/dm"
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
 <soap:Body><tns:executeResponse><tns:return xsi:type="tns:{response_type}">
 {content}
 </tns:return></tns:executeResponse></soap:Body>
</soap:Envelope>'''.encode("utf-8")


def _soap_fault(message: str) -> bytes:
    return f'''<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
 <soap:Body><soap:Fault><faultcode>soap:Client</faultcode>
 <faultstring>{message}</faultstring><detail/></soap:Fault></soap:Body>
</soap:Envelope>'''.encode("utf-8")


def _m_prefixed_response(response_type: str, content: str) -> bytes:
    payload = _soap_response(response_type, content).decode("utf-8")
    payload = payload.replace(
        "<soap:Body>",
        '<soap:Body xmlns:m="http://www.1c.ru/dm">',
    )
    return payload.replace(
        'xsi:type="tns:DMBusinessProcessApprovalTaskApproval"',
        'xsi:type="m:DMBusinessProcessApprovalTaskApproval"',
    ).encode("utf-8")


def _request_type(request: httpx.Request) -> str:
    match = re.search(rb'xsi:type="tns:([A-Za-z0-9_]+)"', request.content)
    assert match
    return match.group(1).decode("ascii")


def _task(*, executed: bool = False, accepted: bool = True) -> str:
    result = "" if not executed else '''
      <tns:approvalResult xsi:type="tns:DMApprovalResult">
       <tns:name>Согласовано</tns:name>
       <tns:ObjectID><tns:id>Согласовано</tns:id><tns:type>DMApprovalResult</tns:type></tns:ObjectID>
      </tns:approvalResult>'''
    end_date = "<tns:endDate>2026-07-30T12:00:00</tns:endDate>" if executed else ""
    return f'''
    <tns:object xsi:type="tns:DMBusinessProcessApprovalTaskApproval">
      <tns:name>HUB-IT TEST · Согласование</tns:name>
      <tns:ObjectID><tns:id>d045ebcb-8b37-11f1-8cfb-5cba2c62eea8</tns:id><tns:type>DMBusinessProcessApprovalTaskApproval</tns:type></tns:ObjectID>
      <tns:executed>{str(executed).lower()}</tns:executed>
      <tns:accepted>{str(accepted).lower()}</tns:accepted>
      <tns:beginDate>2026-07-30T10:00:00</tns:beginDate>
      {end_date}
      <tns:parentBusinessProcess xsi:type="tns:DMBusinessProcessApproval">
       <tns:name>Согласование документа</tns:name>
       <tns:ObjectID><tns:id>11111111-1111-1111-1111-111111111111</tns:id><tns:type>DMBusinessProcessApproval</tns:type></tns:ObjectID>
      </tns:parentBusinessProcess>
      {result}
    </tns:object>'''


def _acquaintance_task(*, executed: bool = False, accepted: bool = True) -> str:
    end_date = "<tns:endDate>2026-07-30T15:30:00</tns:endDate>" if executed else ""
    return f'''
    <tns:object xsi:type="tns:DMBusinessProcessTask">
      <tns:name>Ознакомиться с документом</tns:name>
      <tns:objectID><tns:id>233c3a9c-8bff-11f1-bf5b-5cba2c62ec78</tns:id><tns:type>DMBusinessProcessTask</tns:type></tns:objectID>
      <tns:executed>{str(executed).lower()}</tns:executed>
      <tns:accepted>{str(accepted).lower()}</tns:accepted>
      <tns:beginDate>2026-07-30T15:12:15</tns:beginDate>
      {end_date}
      <tns:parentBusinessProcess xsi:type="tns:DMBusinessProcessAcquaintance">
       <tns:name>Ознакомление</tns:name>
       <tns:objectID><tns:id>22222222-2222-2222-2222-222222222222</tns:id><tns:type>DMBusinessProcessAcquaintance</tns:type></tns:objectID>
      </tns:parentBusinessProcess>
    </tns:object>'''


def _approval_checkup_task(
    *,
    executed: bool = False,
    accepted: bool = True,
    returned: bool = False,
) -> str:
    end_date = "<tns:endDate>2026-08-15T12:00:00</tns:endDate>" if executed else ""
    return f'''
    <tns:object xsi:type="tns:DMBusinessProcessApprovalTaskCheckup">
      <tns:name>Ознакомиться с результатом согласования</tns:name>
      <tns:ObjectID><tns:id>68eb5751-9798-11f1-bf5b-5cba2c62ec78</tns:id><tns:type>DMBusinessProcessApprovalTaskCheckup</tns:type></tns:ObjectID>
      <tns:executed>{str(executed).lower()}</tns:executed>
      <tns:accepted>{str(accepted).lower()}</tns:accepted>
      <tns:returned>{str(returned).lower()}</tns:returned>
      <tns:beginDate>2026-08-15T10:00:00</tns:beginDate>
      {end_date}
      <tns:parentBusinessProcess xsi:type="tns:DMBusinessProcessApproval">
       <tns:name>Согласование документа</tns:name>
       <tns:ObjectID><tns:id>33333333-3333-3333-3333-333333333333</tns:id><tns:type>DMBusinessProcessApproval</tns:type></tns:ObjectID>
      </tns:parentBusinessProcess>
      <tns:approvalResult xsi:type="tns:DMApprovalResult">
       <tns:name>Согласовано</tns:name>
       <tns:ObjectID><tns:id>Согласовано</tns:id><tns:type>DMApprovalResult</tns:type></tns:ObjectID>
      </tns:approvalResult>
    </tns:object>'''


def _invitation_task(*, executed: bool = False, accepted: bool = True) -> str:
    end_date = "<tns:endDate>2026-08-15T16:00:00</tns:endDate>" if executed else ""
    return f'''
    <tns:object xsi:type="tns:DMBusinessProcessInvitationTaskInvitation">
      <tns:name>Тест</tns:name>
      <tns:ObjectID><tns:id>03649d11-97ac-11f1-8cfb-5cba2c62eea8</tns:id><tns:type>DMBusinessProcessInvitationTaskInvitation</tns:type></tns:ObjectID>
      <tns:executed>{str(executed).lower()}</tns:executed>
      <tns:accepted>{str(accepted).lower()}</tns:accepted>
      <tns:beginDate>2026-08-15T14:00:00</tns:beginDate>
      {end_date}
      <tns:businessProcessStep>Пригласить</tns:businessProcessStep>
      <tns:parentBusinessProcess xsi:type="tns:DMBusinessProcessInvitation">
       <tns:name>Приглашение</tns:name>
       <tns:ObjectID><tns:id>44444444-4444-4444-4444-444444444444</tns:id><tns:type>DMBusinessProcessInvitation</tns:type></tns:ObjectID>
      </tns:parentBusinessProcess>
    </tns:object>'''


@pytest.mark.asyncio
async def test_list_tasks_always_uses_personal_filters_and_applies_limit(monkeypatch):
    requests: list[bytes] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request.content)
        assert request.headers["SOAPAction"] == SOAP_ACTION
        return httpx.Response(
            200,
            content=_soap_response(
                "DMGetObjectListResponse",
                f"<tns:items>{_task()}</tns:items><tns:items>{_task()}</tns:items><tns:tooManyObjects>false</tns:tooManyObjects>",
            ),
        )

    client = DocflowDMServiceClient(
        service_url="https://docflow.example/ws/DMService",
        transport=httpx.MockTransport(handler),
    )
    try:
        result = await client.list_tasks(
            login="user", password="secret", scope="inbox", search="Согласование", limit=1
        )
    finally:
        await client.aclose()

    xml = requests[0].decode("utf-8")
    assert "<tns:property>byUser</tns:property>" in xml
    assert "<tns:property>withExecuted</tns:property>" in xml
    assert "<tns:property>typed</tns:property>" in xml
    assert "<tns:property>name</tns:property>" not in xml
    assert result["returned"] == 1
    assert result["truncated"] is True


@pytest.mark.asyncio
async def test_list_tasks_filters_search_locally_without_dm_name_condition():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=_soap_response(
                "DMGetObjectListResponse",
                f"<tns:items>{_task()}</tns:items><tns:items>{_acquaintance_task()}</tns:items>"
                "<tns:tooManyObjects>false</tns:tooManyObjects>",
            ),
        )

    client = DocflowDMServiceClient(
        service_url="https://docflow.example/ws/DMService",
        transport=httpx.MockTransport(handler),
    )
    try:
        result = await client.list_tasks(
            login="user", password="secret", scope="all", search="ознакомиться", limit=10
        )
    finally:
        await client.aclose()

    assert result["returned"] == 1
    assert "Ознакомиться" in result["items"][0]["title"]


@pytest.mark.asyncio
@pytest.mark.parametrize(("scope", "expected_completed", "expected_count"), [
    ("inbox", False, 1),
    ("completed", True, 1),
    ("all", None, 2),
])
async def test_task_scopes_keep_by_user_and_filter_executed(scope, expected_completed, expected_count):
    requests: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request.content.decode("utf-8"))
        return httpx.Response(200, content=_soap_response(
            "DMGetObjectListResponse",
            f"<tns:items>{_task(executed=False)}</tns:items>"
            f"<tns:items>{_task(executed=True)}</tns:items>"
            "<tns:tooManyObjects>false</tns:tooManyObjects>",
        ))

    client = DocflowDMServiceClient(
        service_url="https://docflow.example/ws/DMService",
        transport=httpx.MockTransport(handler),
    )
    try:
        result = await client.list_tasks(login="user", password="secret", scope=scope, limit=10)
    finally:
        await client.aclose()

    assert "<tns:property>byUser</tns:property>" in requests[0]
    assert result["returned"] == expected_count
    if expected_completed is not None:
        assert all(item["completed"] is expected_completed for item in result["items"])


def test_task_parser_hides_empty_1c_sentinel_dates():
    task_xml = _task().replace(
        "<tns:beginDate>2026-07-30T10:00:00</tns:beginDate>",
        "<tns:beginDate>2026-07-30T10:00:00</tns:beginDate>"
        "<tns:dueDate>0001-01-01T00:00:00</tns:dueDate>"
        "<tns:endDate>0001-01-01T00:00:00</tns:endDate>",
    )
    task = etree.fromstring((
        '<root xmlns:tns="http://www.1c.ru/dm" '
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
        f"{task_xml}</root>"
    ).encode("utf-8"))[0]

    parsed = DocflowDMServiceClient._parse_task(
        DocflowDMServiceClient.__new__(DocflowDMServiceClient),
        task,
    )

    assert parsed["created_at"] == "2026-07-30T10:00:00"
    assert parsed["due_at"] is None
    assert parsed["completed_at"] is None


@pytest.mark.asyncio
async def test_dmservice_rejects_dtd_and_external_entities():
    malicious = b'''<?xml version="1.0"?>
<!DOCTYPE x [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body/></soap:Envelope>'''

    client = DocflowDMServiceClient(
        service_url="https://docflow.example/ws/DMService",
        transport=httpx.MockTransport(lambda request: httpx.Response(200, content=malicious)),
    )
    try:
        with pytest.raises(Docflow1CUnavailableError, match="небезопасный XML"):
            await client.get_version(login="user", password="secret")
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_dmservice_maps_http_auth_failure_without_exposing_secret():
    client = DocflowDMServiceClient(
        service_url="https://docflow.example/ws/DMService",
        transport=httpx.MockTransport(lambda request: httpx.Response(401)),
    )
    try:
        with pytest.raises(Docflow1CAuthenticationError) as raised:
            await client.get_version(login="user", password="never-log-this")
    finally:
        await client.aclose()
    assert "never-log-this" not in str(raised.value)


@pytest.mark.asyncio
async def test_dmservice_parses_soap_fault_returned_with_http_500():
    client = DocflowDMServiceClient(
        service_url="https://docflow.example/ws/DMService",
        transport=httpx.MockTransport(
            lambda request: httpx.Response(
                500,
                content=_soap_fault("Отсутствует отображение для префикса m"),
            )
        ),
    )
    try:
        with pytest.raises(Docflow1CUnavailableError, match="Отсутствует отображение"):
            await client.get_version(login="user", password="secret")
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_approve_uses_accept_update_and_verifies_result_once():
    calls: list[str] = []
    update_payloads: list[bytes] = []
    accepted = False
    completed = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal accepted, completed
        request_type = _request_type(request)
        calls.append(request_type)
        if request_type == "DMGetVersionRequest":
            return httpx.Response(200, content=_soap_response("DMGetVersionResponse", "<tns:versionNumber>2.1.37.5.CORP</tns:versionNumber>"))
        if request_type == "DMGetObjectListRequest":
            return httpx.Response(200, content=_soap_response("DMGetObjectListResponse", f"<tns:items>{_task(executed=completed, accepted=accepted)}</tns:items><tns:tooManyObjects>false</tns:tooManyObjects>"))
        if request_type == "DMRetrieveRequest":
            task_xml = _task(executed=completed, accepted=accepted).replace("<tns:object", "<tns:objects", 1).replace("</tns:object>", "</tns:objects>", 1)
            return httpx.Response(200, content=_soap_response("DMRetrieveResponse", task_xml))
        if request_type == "DMAcceptTasksRequest":
            accepted = True
            return httpx.Response(200, content=_soap_response("DMAcceptTasksResponse"))
        if request_type == "DMUpdateRequest":
            update_payloads.append(request.content)
            completed = True
            return httpx.Response(200, content=_soap_response("DMUpdateResponse"))
        raise AssertionError(request_type)

    client = DocflowDMServiceClient(
        service_url="https://docflow.example/ws/DMService",
        transport=httpx.MockTransport(handler),
    )
    try:
        result = await client.apply_task_action(
            login="user",
            password="secret",
            task_ref="d045ebcb-8b37-11f1-8cfb-5cba2c62eea8",
            action="approve",
        )
    finally:
        await client.aclose()

    assert calls.count("DMAcceptTasksRequest") == 1
    assert calls.count("DMUpdateRequest") == 1
    update_xml = update_payloads[0].decode("utf-8")
    assert "<tns:executed>true</tns:executed>" in update_xml
    assert "<tns:approvalResult" in update_xml
    assert "<tns:objectID>" in update_xml
    assert "Согласовано" in update_xml
    assert result["task"]["completed"] is True
    assert result["task"]["result"] == "Согласовано"


@pytest.mark.asyncio
async def test_acknowledge_generic_acquaintance_task_completes_without_result_field():
    accepted = False
    completed = False
    update_payloads: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal accepted, completed
        request_type = _request_type(request)
        if request_type == "DMGetVersionRequest":
            return httpx.Response(
                200,
                content=_soap_response(
                    "DMGetVersionResponse",
                    "<tns:versionNumber>2.1.37.5.CORP</tns:versionNumber>",
                ),
            )
        if request_type == "DMGetObjectListRequest":
            return httpx.Response(
                200,
                content=_soap_response(
                    "DMGetObjectListResponse",
                    f"<tns:items>{_acquaintance_task(executed=completed, accepted=accepted)}</tns:items>"
                    "<tns:tooManyObjects>false</tns:tooManyObjects>",
                ),
            )
        if request_type == "DMRetrieveRequest":
            task_xml = _acquaintance_task(
                executed=completed,
                accepted=accepted,
            ).replace("<tns:object", "<tns:objects", 1).replace(
                "</tns:object>", "</tns:objects>", 1
            )
            return httpx.Response(200, content=_soap_response("DMRetrieveResponse", task_xml))
        if request_type == "DMAcceptTasksRequest":
            accepted = True
            return httpx.Response(200, content=_soap_response("DMAcceptTasksResponse"))
        if request_type == "DMUpdateRequest":
            update_payloads.append(request.content.decode("utf-8"))
            completed = True
            return httpx.Response(200, content=_soap_response("DMUpdateResponse"))
        raise AssertionError(request_type)

    client = DocflowDMServiceClient(
        service_url="https://docflow.example/ws/DMService",
        transport=httpx.MockTransport(handler),
    )
    try:
        result = await client.apply_task_action(
            login="user",
            password="secret",
            task_ref="233c3a9c-8bff-11f1-bf5b-5cba2c62ec78",
            action="acknowledge",
        )
    finally:
        await client.aclose()

    assert len(update_payloads) == 1
    assert "<tns:executed>true</tns:executed>" in update_payloads[0]
    assert "approvalResult" not in update_payloads[0]
    assert "confirmationResult" not in update_payloads[0]
    assert result["task"]["completed"] is True
    assert result["task"]["result"] is None


@pytest.mark.asyncio
async def test_acknowledge_approval_checkup_preserves_process_result_and_return_flag():
    accepted = False
    completed = False
    update_payloads: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal accepted, completed
        request_type = _request_type(request)
        if request_type == "DMGetVersionRequest":
            return httpx.Response(
                200,
                content=_soap_response(
                    "DMGetVersionResponse",
                    "<tns:versionNumber>2.1.37.5.CORP</tns:versionNumber>",
                ),
            )
        if request_type == "DMGetObjectListRequest":
            return httpx.Response(
                200,
                content=_soap_response(
                    "DMGetObjectListResponse",
                    f"<tns:items>{_approval_checkup_task(executed=completed, accepted=accepted, returned=True)}</tns:items>"
                    "<tns:tooManyObjects>false</tns:tooManyObjects>",
                ),
            )
        if request_type == "DMRetrieveRequest":
            task_xml = _approval_checkup_task(
                executed=completed,
                accepted=accepted,
                returned=True,
            ).replace("<tns:object", "<tns:objects", 1).replace(
                "</tns:object>", "</tns:objects>", 1
            )
            return httpx.Response(200, content=_soap_response("DMRetrieveResponse", task_xml))
        if request_type == "DMAcceptTasksRequest":
            accepted = True
            return httpx.Response(200, content=_soap_response("DMAcceptTasksResponse"))
        if request_type == "DMUpdateRequest":
            update_payloads.append(request.content.decode("utf-8"))
            completed = True
            return httpx.Response(200, content=_soap_response("DMUpdateResponse"))
        raise AssertionError(request_type)

    client = DocflowDMServiceClient(
        service_url="https://docflow.example/ws/DMService",
        transport=httpx.MockTransport(handler),
    )
    try:
        result = await client.apply_task_action(
            login="user",
            password="secret",
            task_ref="68eb5751-9798-11f1-bf5b-5cba2c62ec78",
            action="acknowledge",
        )
    finally:
        await client.aclose()

    assert len(update_payloads) == 1
    assert "<tns:executed>true</tns:executed>" in update_payloads[0]
    assert "<tns:returned>false</tns:returned>" in update_payloads[0]
    assert "<tns:approvalResult" in update_payloads[0]
    assert result["task"]["completed"] is True
    assert result["task"]["result"] == "Согласовано"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("action", "result_id", "result_name"),
    (
        ("accept_invitation", "Принято", "Принято"),
        ("decline_invitation", "НеПринято", "Не принято"),
    ),
)
async def test_invitation_actions_write_allowlisted_invitation_result(action, result_id, result_name):
    accepted = False
    completed = False
    update_payloads: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal accepted, completed
        request_type = _request_type(request)
        if request_type == "DMGetVersionRequest":
            return httpx.Response(
                200,
                content=_soap_response(
                    "DMGetVersionResponse",
                    "<tns:versionNumber>2.1.37.5.CORP</tns:versionNumber>",
                ),
            )
        if request_type == "DMGetObjectListRequest":
            return httpx.Response(
                200,
                content=_soap_response(
                    "DMGetObjectListResponse",
                    f"<tns:items>{_invitation_task(executed=completed, accepted=accepted)}</tns:items>"
                    "<tns:tooManyObjects>false</tns:tooManyObjects>",
                ),
            )
        if request_type == "DMRetrieveRequest":
            task_xml = _invitation_task(
                executed=completed,
                accepted=accepted,
            ).replace("<tns:object", "<tns:objects", 1).replace(
                "</tns:object>", "</tns:objects>", 1
            )
            return httpx.Response(200, content=_soap_response("DMRetrieveResponse", task_xml))
        if request_type == "DMAcceptTasksRequest":
            accepted = True
            return httpx.Response(200, content=_soap_response("DMAcceptTasksResponse"))
        if request_type == "DMUpdateRequest":
            update_payloads.append(request.content.decode("utf-8"))
            completed = True
            return httpx.Response(200, content=_soap_response("DMUpdateResponse"))
        raise AssertionError(request_type)

    client = DocflowDMServiceClient(
        service_url="https://docflow.example/ws/DMService",
        transport=httpx.MockTransport(handler),
    )
    try:
        result = await client.apply_task_action(
            login="user",
            password="secret",
            task_ref="03649d11-97ac-11f1-8cfb-5cba2c62eea8",
            action=action,
        )
    finally:
        await client.aclose()

    assert len(update_payloads) == 1
    assert "<tns:executed>true</tns:executed>" in update_payloads[0]
    assert '<tns:invitationResult xsi:type="tns:DMInvitationResult">' in update_payloads[0]
    assert f"<tns:name>{result_name}</tns:name>" in update_payloads[0]
    assert f"<tns:id>{result_id}</tns:id>" in update_payloads[0]
    assert "<tns:type>DMInvitationResult</tns:type>" in update_payloads[0]
    assert result["task"]["completed"] is True
    assert result["task"]["process_type"] == "Приглашение"


@pytest.mark.asyncio
async def test_task_state_bypasses_stale_task_xml_cache():
    task_ref = "03649d11-97ac-11f1-8cfb-5cba2c62eea8"
    requests = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal requests
        request_type = _request_type(request)
        if request_type == "DMGetVersionRequest":
            return httpx.Response(
                200,
                content=_soap_response(
                    "DMGetVersionResponse",
                    "<tns:version>1.1.2.1</tns:version>",
                ),
            )
        assert request_type == "DMRetrieveRequest"
        requests += 1
        task_xml = _invitation_task(executed=True, accepted=True).replace(
            "<tns:object", "<tns:objects", 1
        ).replace("</tns:object>", "</tns:objects>", 1)
        return httpx.Response(200, content=_soap_response("DMRetrieveResponse", task_xml))

    client = DocflowDMServiceClient(
        service_url="https://docflow.example/ws/DMService",
        transport=httpx.MockTransport(handler),
    )
    stale_xml = _invitation_task(executed=False, accepted=True).replace(
        "<tns:object ",
        '<tns:object xmlns:tns="http://www.1c.ru/dm" '
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ',
        1,
    )
    stale = etree.fromstring(stale_xml.encode("utf-8"))
    client._merge_visible_type_cache(
        "user",
        {task_ref: "DMBusinessProcessInvitationTaskInvitation"},
        False,
    )
    client._set_task_xml_cache("user", task_ref, etree.tostring(stale, encoding="utf-8"))
    try:
        state = await client.get_task_state(
            login="user",
            password="secret",
            task_ref=task_ref,
        )
    finally:
        await client.aclose()

    assert requests == 1
    assert state["completed"] is True
    assert state["completed_at"] == "2026-08-15T16:00:00"


@pytest.mark.asyncio
async def test_approve_normalizes_inherited_xsi_type_prefix_before_write():
    accepted = False
    completed = False
    write_payloads: list[str] = []

    def typed_task(*, for_retrieve: bool) -> bytes:
        task_xml = _task(executed=completed, accepted=accepted)
        if for_retrieve:
            task_xml = task_xml.replace("<tns:object", "<tns:objects", 1).replace(
                "</tns:object>", "</tns:objects>", 1
            )
            response_type = "DMRetrieveResponse"
        else:
            response_type = "DMGetObjectListResponse"
            task_xml = f"<tns:items>{task_xml}</tns:items><tns:tooManyObjects>false</tns:tooManyObjects>"
        return _m_prefixed_response(response_type, task_xml)

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal accepted, completed
        request_type = _request_type(request)
        if request_type == "DMGetVersionRequest":
            return httpx.Response(
                200,
                content=_soap_response(
                    "DMGetVersionResponse",
                    "<tns:versionNumber>2.1.37.5.CORP</tns:versionNumber>",
                ),
            )
        if request_type == "DMGetObjectListRequest":
            return httpx.Response(200, content=typed_task(for_retrieve=False))
        if request_type == "DMRetrieveRequest":
            return httpx.Response(200, content=typed_task(for_retrieve=True))
        if request_type in {"DMAcceptTasksRequest", "DMUpdateRequest"}:
            xml = request.content.decode("utf-8")
            write_payloads.append(xml)
            if 'xsi:type="m:' in xml:
                return httpx.Response(
                    500,
                    content=_soap_fault("Отсутствует отображение для префикса m"),
                )
            if request_type == "DMAcceptTasksRequest":
                accepted = True
                return httpx.Response(200, content=_soap_response("DMAcceptTasksResponse"))
            completed = True
            return httpx.Response(200, content=_soap_response("DMUpdateResponse"))
        raise AssertionError(request_type)

    client = DocflowDMServiceClient(
        service_url="https://docflow.example/ws/DMService",
        transport=httpx.MockTransport(handler),
    )
    try:
        result = await client.apply_task_action(
            login="user",
            password="secret",
            task_ref="d045ebcb-8b37-11f1-8cfb-5cba2c62eea8",
            action="approve",
        )
    finally:
        await client.aclose()

    assert len(write_payloads) == 2
    assert all('xsi:type="m:' not in payload for payload in write_payloads)
    assert result["task"]["completed"] is True


@pytest.mark.asyncio
async def test_write_timeout_is_not_retried():
    updates = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal updates
        request_type = _request_type(request)
        if request_type == "DMGetVersionRequest":
            return httpx.Response(200, content=_soap_response("DMGetVersionResponse", "<tns:versionNumber>2.1.37.5.CORP</tns:versionNumber>"))
        if request_type == "DMGetObjectListRequest":
            return httpx.Response(200, content=_soap_response("DMGetObjectListResponse", f"<tns:items>{_task()}</tns:items><tns:tooManyObjects>false</tns:tooManyObjects>"))
        if request_type == "DMRetrieveRequest":
            task_xml = _task().replace("<tns:object", "<tns:objects", 1).replace("</tns:object>", "</tns:objects>", 1)
            return httpx.Response(200, content=_soap_response("DMRetrieveResponse", task_xml))
        if request_type == "DMUpdateRequest":
            updates += 1
            raise httpx.ReadTimeout("timeout", request=request)
        raise AssertionError(request_type)

    client = DocflowDMServiceClient(
        service_url="https://docflow.example/ws/DMService",
        transport=httpx.MockTransport(handler),
    )
    try:
        from backend.services.docflow_1c_client import Docflow1COutcomeUnknownError

        with pytest.raises(Docflow1COutcomeUnknownError):
            await client.apply_task_action(
                login="user",
                password="secret",
                task_ref="d045ebcb-8b37-11f1-8cfb-5cba2c62eea8",
                action="approve",
            )
    finally:
        await client.aclose()
    assert updates == 1


@pytest.mark.asyncio
async def test_file_export_accepts_wrapped_base64_and_removes_no_security_checks(monkeypatch):
    file_ref = "33333333-3333-3333-3333-333333333333"

    def handler(request: httpx.Request) -> httpx.Response:
        assert _request_type(request) == "DMRetrieveRequest"
        return httpx.Response(200, content=_soap_response("DMRetrieveResponse", f'''
          <tns:objects xsi:type="tns:DMFile">
            <tns:name>example.txt</tns:name>
            <tns:ObjectID><tns:id>{file_ref}</tns:id><tns:type>DMFile</tns:type></tns:ObjectID>
            <tns:extension>txt</tns:extension><tns:size>5</tns:size>
            <tns:binaryData>aGVs\n bG8=</tns:binaryData>
          </tns:objects>'''))

    client = DocflowDMServiceClient(
        service_url="https://docflow.example/ws/DMService",
        transport=httpx.MockTransport(handler),
    )

    async def document_context(**kwargs):
        return {
            "ref": kwargs["task_ref"],
            "files": [{
                "ref": file_ref,
                "name": "example.txt",
                "extension": "txt",
                "size": 5,
                "xdto_type": "DMFile",
            }],
        }, []

    monkeypatch.setattr(client, "_document_context", document_context)
    exported = None
    try:
        exported = await client.export_file(
            login="user",
            password="secret",
            task_ref="22222222-2222-2222-2222-222222222222",
            file_ref=file_ref,
        )
        exported_path = Path(exported["temporary_path"])
        assert exported_path.read_bytes() == b"hello"
        assert exported["size"] == 5
    finally:
        if exported:
            Path(exported["temporary_path"]).unlink(missing_ok=True)
        await client.aclose()


def test_file_summaries_do_not_expose_internal_file_versions_as_attachments():
    owner = etree.fromstring(b'''
      <tns:object xmlns:tns="http://www.1c.ru/dm"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
        <tns:files>
          <tns:file xsi:type="tns:DMFile">
            <tns:name>document.pdf</tns:name>
            <tns:objectID><tns:id>11111111-1111-1111-1111-111111111111</tns:id><tns:type>DMFile</tns:type></tns:objectID>
            <tns:extension>pdf</tns:extension><tns:size>1200</tns:size>
            <tns:activeVersion xsi:type="tns:DMFileVersion">
              <tns:name>GL-0000000000001</tns:name>
              <tns:objectID><tns:id>22222222-2222-2222-2222-222222222222</tns:id><tns:type>DMFileVersion</tns:type></tns:objectID>
              <tns:size>0</tns:size>
            </tns:activeVersion>
          </tns:file>
        </tns:files>
      </tns:object>
    ''')

    files = DocflowDMServiceClient._file_summaries([owner])

    assert [(item["name"], item["xdto_type"]) for item in files] == [
        ("document.pdf", "DMFile"),
    ]


def test_like_pattern_wraps_plain_query():
    assert DocflowDMServiceClient._like_pattern("акт") == "%акт%"
    assert DocflowDMServiceClient._like_pattern("%акт%") == "%акт%"
    assert DocflowDMServiceClient._like_pattern("") == ""


@pytest.mark.asyncio
async def test_search_assignment_documents_empty_query_skips_soap():
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        raise AssertionError("empty document search must not call DMService")

    client = DocflowDMServiceClient(
        service_url="https://docflow.example/ws/DMService",
        transport=httpx.MockTransport(handler),
    )
    try:
        result = await client.search_assignment_documents(login="user", password="secret", search="ab")
        assert result["items"] == []
        assert result["truncated"] is False
        assert "3" in (result.get("reason") or "")
        assert calls == 0
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_search_assignment_documents_sends_like_percent_and_parallel_types():
    seen_types: list[str] = []
    seen_values: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        assert _request_type(request) == "DMGetObjectListRequest"
        payload = request.content.decode("utf-8")
        type_match = re.search(r"<tns:type>(DM\w+Document)</tns:type>", payload)
        assert type_match
        seen_types.append(type_match.group(1))
        value_match = re.search(r"<tns:value[^>]*>([^<]+)</tns:value>", payload)
        assert value_match
        seen_values.append(value_match.group(1))
        assert "comparisonOperator" in payload and "LIKE" in payload
        doc_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        return httpx.Response(
            200,
            content=_soap_response(
                "DMGetObjectListResponse",
                f"""
                <tns:items>
                  <tns:object xsi:type="tns:{type_match.group(1)}">
                    <tns:name>Акт {type_match.group(1)}</tns:name>
                    <tns:ObjectID><tns:id>{doc_id}</tns:id><tns:type>{type_match.group(1)}</tns:type></tns:ObjectID>
                    <tns:number>A-1</tns:number>
                  </tns:object>
                </tns:items>
                <tns:tooManyObjects>false</tns:tooManyObjects>
                """,
            ),
        )

    client = DocflowDMServiceClient(
        service_url="https://docflow.example/ws/DMService",
        transport=httpx.MockTransport(handler),
    )
    try:
        result = await client.search_assignment_documents(
            login="user", password="secret", search="акт", limit=20
        )
        assert set(seen_types) == {
            "DMInternalDocument",
            "DMIncomingDocument",
            "DMOutgoingDocument",
        }
        assert all(value == "%акт%" for value in seen_values)
        assert result["returned"] == 3
        assert result["truncated"] is False
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_search_assignment_documents_partial_type_failure_keeps_results():
    def handler(request: httpx.Request) -> httpx.Response:
        payload = request.content.decode("utf-8")
        if "DMIncomingDocument" in payload:
            raise httpx.ReadTimeout("timeout", request=request)
        return httpx.Response(
            200,
            content=_soap_response(
                "DMGetObjectListResponse",
                """
                <tns:items>
                  <tns:object xsi:type="tns:DMInternalDocument">
                    <tns:name>Внутренний акт</tns:name>
                    <tns:ObjectID><tns:id>bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb</tns:id><tns:type>DMInternalDocument</tns:type></tns:ObjectID>
                  </tns:object>
                </tns:items>
                <tns:tooManyObjects>false</tns:tooManyObjects>
                """,
            ),
        )

    client = DocflowDMServiceClient(
        service_url="https://docflow.example/ws/DMService",
        transport=httpx.MockTransport(handler),
    )
    try:
        result = await client.search_assignment_documents(
            login="user", password="secret", search="акт"
        )
        assert result["returned"] >= 1
        assert any(item["document_type"] == "internal" for item in result["items"])
        assert result.get("reason")
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_search_assignment_assignees_sends_like_percent():
    def handler(request: httpx.Request) -> httpx.Response:
        payload = request.content.decode("utf-8")
        assert "%Иванов%" in payload
        assert "LIKE" in payload
        return httpx.Response(
            200,
            content=_soap_response(
                "DMGetObjectListResponse",
                """
                <tns:items>
                  <tns:object xsi:type="tns:DMUser">
                    <tns:name>Иванов И.И.</tns:name>
                    <tns:ObjectID><tns:id>cccccccc-cccc-cccc-cccc-cccccccccccc</tns:id><tns:type>DMUser</tns:type></tns:ObjectID>
                  </tns:object>
                </tns:items>
                <tns:tooManyObjects>false</tns:tooManyObjects>
                """,
            ),
        )

    client = DocflowDMServiceClient(
        service_url="https://docflow.example/ws/DMService",
        transport=httpx.MockTransport(handler),
    )
    try:
        result = await client.search_assignment_assignees(
            login="user", password="secret", search="Иванов"
        )
        assert result["returned"] == 1
        assert result["items"][0]["name"] == "Иванов И.И."
    finally:
        await client.aclose()
