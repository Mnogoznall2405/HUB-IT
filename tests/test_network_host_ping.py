"""Unit tests for NetworkHostPingTool — registration, input validation, and output parsing."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from backend.ai_chat.tools.network import (
    NetworkHostPingArgs,
    NetworkHostPingTool,
    parse_ping_output,
)
from backend.ai_chat.tools.registry import ai_tool_registry


# ---------------------------------------------------------------------------
# Registration & attributes
# ---------------------------------------------------------------------------


def test_ping_tool_registered():
    """network.host.ping is registered in the global tool registry."""
    tool = ai_tool_registry.get("network.host.ping")
    assert tool is not None
    assert tool.tool_id == "network.host.ping"


def test_ping_tool_not_admin_only():
    """Ping tool does not require admin access."""
    tool = NetworkHostPingTool()
    assert tool.admin_only is False


def test_ping_tool_stage():
    """Ping tool uses the checking_network stage."""
    tool = NetworkHostPingTool()
    assert tool.stage == "checking_network"


# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------


def test_ping_args_defaults():
    """Default count is 4."""
    args = NetworkHostPingArgs(host="192.168.1.1")
    assert args.count == 4
    assert args.host == "192.168.1.1"


def test_ping_args_count_range_valid():
    """Count within 1–10 is accepted."""
    args = NetworkHostPingArgs(host="example.com", count=1)
    assert args.count == 1
    args = NetworkHostPingArgs(host="example.com", count=10)
    assert args.count == 10


def test_ping_args_count_too_low():
    """Count below 1 is rejected."""
    with pytest.raises(ValidationError):
        NetworkHostPingArgs(host="example.com", count=0)


def test_ping_args_count_too_high():
    """Count above 10 is rejected."""
    with pytest.raises(ValidationError):
        NetworkHostPingArgs(host="example.com", count=11)


def test_ping_args_host_empty():
    """Empty host is rejected."""
    with pytest.raises(ValidationError):
        NetworkHostPingArgs(host="")


def test_ping_args_host_too_long():
    """Host longer than 253 chars is rejected."""
    with pytest.raises(ValidationError):
        NetworkHostPingArgs(host="a" * 254)


def test_ping_args_host_max_length():
    """Host exactly 253 chars is accepted."""
    args = NetworkHostPingArgs(host="a" * 253)
    assert len(args.host) == 253


# ---------------------------------------------------------------------------
# Output parsing — English Windows ping
# ---------------------------------------------------------------------------


PING_SUCCESS_EN = """\
Pinging example.com [93.184.216.34] with 32 bytes of data:
Reply from 93.184.216.34: bytes=32 time=5ms TTL=56
Reply from 93.184.216.34: bytes=32 time=6ms TTL=56
Reply from 93.184.216.34: bytes=32 time=5ms TTL=56
Reply from 93.184.216.34: bytes=32 time=5ms TTL=56

Ping statistics for 93.184.216.34:
    Packets: Sent = 4, Received = 4, Lost = 0 (0% loss),
Approximate round trip times in milli-seconds:
    Minimum = 5ms, Maximum = 6ms, Average = 5ms
"""


def test_parse_ping_success_en():
    result = parse_ping_output(PING_SUCCESS_EN)
    assert result["reachable"] is True
    assert result["packet_loss_percent"] == 0
    assert result["response_time_ms"] == 5
    assert result["resolved_ip"] == "93.184.216.34"


PING_PARTIAL_LOSS_EN = """\
Pinging 10.0.0.1 with 32 bytes of data:
Reply from 10.0.0.1: bytes=32 time=2ms TTL=128
Request timed out.
Reply from 10.0.0.1: bytes=32 time=3ms TTL=128
Request timed out.

Ping statistics for 10.0.0.1:
    Packets: Sent = 4, Received = 2, Lost = 2 (50% loss),
Approximate round trip times in milli-seconds:
    Minimum = 2ms, Maximum = 3ms, Average = 2ms
"""


def test_parse_ping_partial_loss_en():
    result = parse_ping_output(PING_PARTIAL_LOSS_EN)
    assert result["reachable"] is True
    assert result["packet_loss_percent"] == 50
    assert result["response_time_ms"] == 2
    assert result["resolved_ip"] == "10.0.0.1"


PING_TOTAL_LOSS_EN = """\
Pinging 10.0.0.99 with 32 bytes of data:
Request timed out.
Request timed out.
Request timed out.
Request timed out.

Ping statistics for 10.0.0.99:
    Packets: Sent = 4, Received = 0, Lost = 4 (100% loss),
"""


def test_parse_ping_total_loss_en():
    result = parse_ping_output(PING_TOTAL_LOSS_EN)
    assert result["reachable"] is False
    assert result["packet_loss_percent"] == 100
    assert result["response_time_ms"] is None
    assert result["resolved_ip"] == "10.0.0.99"


# ---------------------------------------------------------------------------
# Output parsing — Russian Windows ping
# ---------------------------------------------------------------------------


PING_SUCCESS_RU = """\
Обмен пакетами с server.corp [192.168.1.10] по 32 байт:
Ответ от 192.168.1.10: число байт=32 время=1мс TTL=128
Ответ от 192.168.1.10: число байт=32 время=1мс TTL=128
Ответ от 192.168.1.10: число байт=32 время<1мс TTL=128
Ответ от 192.168.1.10: число байт=32 время=1мс TTL=128

Статистика Ping для 192.168.1.10:
    Пакетов: отправлено = 4, получено = 4, потеряно = 0 (0% потерь)
Приблизительное время приёма-передачи:
    Минимальное = 0мсек, Максимальное = 1мсек, Среднее = 0мсек
"""


def test_parse_ping_success_ru():
    result = parse_ping_output(PING_SUCCESS_RU)
    assert result["reachable"] is True
    assert result["packet_loss_percent"] == 0
    assert result["response_time_ms"] == 0


PING_TOTAL_LOSS_RU = """\
Обмен пакетами с unknown.host [10.0.0.99] по 32 байт:
Превышен интервал ожидания для запроса.
Превышен интервал ожидания для запроса.
Превышен интервал ожидания для запроса.
Превышен интервал ожидания для запроса.

Статистика Ping для 10.0.0.99:
    Пакетов: отправлено = 4, получено = 0, потеряно = 4 (100% потерь)
"""


def test_parse_ping_total_loss_ru():
    result = parse_ping_output(PING_TOTAL_LOSS_RU)
    assert result["reachable"] is False
    assert result["packet_loss_percent"] == 100
    assert result["response_time_ms"] is None


# ---------------------------------------------------------------------------
# Output parsing — edge cases
# ---------------------------------------------------------------------------


def test_parse_ping_empty_output():
    """Empty output should return unreachable defaults."""
    result = parse_ping_output("")
    assert result["reachable"] is False
    assert result["packet_loss_percent"] == 100
    assert result["response_time_ms"] is None
    assert result["resolved_ip"] is None


def test_parse_ping_ip_direct():
    """Direct IP ping (no bracket notation) extracts resolved_ip."""
    output = "Pinging 8.8.8.8 with 32 bytes of data:\nReply from 8.8.8.8: bytes=32 time=10ms TTL=118\n\nPing statistics for 8.8.8.8:\n    Packets: Sent = 1, Received = 1, Lost = 0 (0% loss),\nApproximate round trip times in milli-seconds:\n    Minimum = 10ms, Maximum = 10ms, Average = 10ms\n"
    result = parse_ping_output(output)
    assert result["resolved_ip"] == "8.8.8.8"
    assert result["reachable"] is True
    assert result["response_time_ms"] == 10
