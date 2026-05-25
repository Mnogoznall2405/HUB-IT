"""
Property-based tests for ping output parsing.

Feature: ai-agent-universal-tools
Property 6: Ping output parsing extracts correct fields

**Validates: Requirements 5.2**

For any Windows ping command output string (success with N packets, partial loss,
or total failure), the parser SHALL extract `reachable` (bool),
`packet_loss_percent` (0–100), and `response_time_ms` (positive int or null).
`reachable` SHALL be True if and only if `packet_loss_percent < 100`.
"""

import sys
from pathlib import Path

# Ensure WEB-itinvent is on the path (backend lives there)
PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from hypothesis import given, settings, assume
from hypothesis.strategies import (
    integers,
    composite,
    sampled_from,
    just,
    one_of,
)

from backend.ai_chat.tools.network import parse_ping_output


# --- Strategies: Generate realistic Windows ping output strings ---


@composite
def success_ping_output(draw):
    """Generate a Windows ping output with 0% packet loss (full success)."""
    sent = draw(integers(min_value=1, max_value=10))
    received = sent
    loss_percent = 0
    avg_time = draw(integers(min_value=1, max_value=5000))
    min_time = max(1, avg_time - draw(integers(min_value=0, max_value=50)))
    max_time = avg_time + draw(integers(min_value=0, max_value=50))
    ip = f"192.168.{draw(integers(min_value=0, max_value=255))}.{draw(integers(min_value=1, max_value=254))}"

    # Build reply lines
    replies = "\n".join(
        f"Reply from {ip}: bytes=32 time={draw(integers(min_value=1, max_value=5000))}ms TTL=128"
        for _ in range(received)
    )

    output = (
        f"Pinging {ip} with 32 bytes of data:\n"
        f"{replies}\n\n"
        f"Ping statistics for {ip}:\n"
        f"    Packets: Sent = {sent}, Received = {received}, Lost = 0 ({loss_percent}% loss),\n"
        f"Approximate round trip times in milli-seconds:\n"
        f"    Minimum = {min_time}ms, Maximum = {max_time}ms, Average = {avg_time}ms\n"
    )
    return output, loss_percent, avg_time, ip


@composite
def partial_loss_ping_output(draw):
    """Generate a Windows ping output with partial packet loss (1-99%)."""
    sent = draw(integers(min_value=2, max_value=10))
    # Ensure at least 1 received and at least 1 lost
    received = draw(integers(min_value=1, max_value=sent - 1))
    lost = sent - received
    loss_percent = int(round(lost / sent * 100))
    # Ensure loss_percent is between 1 and 99 (partial)
    assume(1 <= loss_percent <= 99)

    avg_time = draw(integers(min_value=1, max_value=5000))
    min_time = max(1, avg_time - draw(integers(min_value=0, max_value=50)))
    max_time = avg_time + draw(integers(min_value=0, max_value=50))
    ip = f"10.{draw(integers(min_value=0, max_value=255))}.{draw(integers(min_value=0, max_value=255))}.{draw(integers(min_value=1, max_value=254))}"

    # Build reply lines (only for received packets)
    replies = "\n".join(
        f"Reply from {ip}: bytes=32 time={draw(integers(min_value=1, max_value=5000))}ms TTL=64"
        for _ in range(received)
    )
    # Add timeout lines for lost packets
    timeouts = "\n".join("Request timed out." for _ in range(lost))

    output = (
        f"Pinging {ip} with 32 bytes of data:\n"
        f"{replies}\n{timeouts}\n\n"
        f"Ping statistics for {ip}:\n"
        f"    Packets: Sent = {sent}, Received = {received}, Lost = {lost} ({loss_percent}% loss),\n"
        f"Approximate round trip times in milli-seconds:\n"
        f"    Minimum = {min_time}ms, Maximum = {max_time}ms, Average = {avg_time}ms\n"
    )
    return output, loss_percent, avg_time, ip


@composite
def total_failure_ping_output(draw):
    """Generate a Windows ping output with 100% packet loss (total failure)."""
    sent = draw(integers(min_value=1, max_value=10))
    ip = f"172.{draw(integers(min_value=16, max_value=31))}.{draw(integers(min_value=0, max_value=255))}.{draw(integers(min_value=1, max_value=254))}"

    # All packets lost - no reply lines, only timeouts
    timeouts = "\n".join("Request timed out." for _ in range(sent))

    output = (
        f"Pinging {ip} with 32 bytes of data:\n"
        f"{timeouts}\n\n"
        f"Ping statistics for {ip}:\n"
        f"    Packets: Sent = {sent}, Received = 0, Lost = {sent} (100% loss),\n"
    )
    return output, 100, None, ip


@composite
def hostname_ping_output(draw):
    """Generate a Windows ping output with hostname resolution (bracket IP)."""
    sent = draw(integers(min_value=1, max_value=10))
    received = sent
    loss_percent = 0
    avg_time = draw(integers(min_value=1, max_value=5000))
    min_time = max(1, avg_time - draw(integers(min_value=0, max_value=50)))
    max_time = avg_time + draw(integers(min_value=0, max_value=50))
    ip = f"192.168.{draw(integers(min_value=0, max_value=255))}.{draw(integers(min_value=1, max_value=254))}"
    hostname = draw(sampled_from(["server01", "dc-main", "web.local", "mail.corp.local"]))

    replies = "\n".join(
        f"Reply from {ip}: bytes=32 time={draw(integers(min_value=1, max_value=5000))}ms TTL=128"
        for _ in range(received)
    )

    output = (
        f"Pinging {hostname} [{ip}] with 32 bytes of data:\n"
        f"{replies}\n\n"
        f"Ping statistics for {ip}:\n"
        f"    Packets: Sent = {sent}, Received = {received}, Lost = 0 ({loss_percent}% loss),\n"
        f"Approximate round trip times in milli-seconds:\n"
        f"    Minimum = {min_time}ms, Maximum = {max_time}ms, Average = {avg_time}ms\n"
    )
    return output, loss_percent, avg_time, ip


# Combined strategy for any valid ping output
any_ping_output = one_of(
    success_ping_output(),
    partial_loss_ping_output(),
    total_failure_ping_output(),
    hostname_ping_output(),
)


# --- Property Tests ---


@settings(max_examples=100)
@given(data=any_ping_output)
def test_ping_parser_returns_required_fields(data):
    """Property 6a: parse_ping_output always returns all required fields.

    **Validates: Requirements 5.2**
    """
    output, _, _, _ = data
    result = parse_ping_output(output)

    assert "reachable" in result, "Missing 'reachable' field"
    assert "packet_loss_percent" in result, "Missing 'packet_loss_percent' field"
    assert "response_time_ms" in result, "Missing 'response_time_ms' field"


@settings(max_examples=100)
@given(data=any_ping_output)
def test_ping_parser_field_types(data):
    """Property 6b: Extracted fields have correct types.

    reachable: bool, packet_loss_percent: int in 0-100, response_time_ms: positive int or None.

    **Validates: Requirements 5.2**
    """
    output, _, _, _ = data
    result = parse_ping_output(output)

    assert isinstance(result["reachable"], bool), (
        f"reachable should be bool, got {type(result['reachable'])}"
    )
    assert isinstance(result["packet_loss_percent"], int), (
        f"packet_loss_percent should be int, got {type(result['packet_loss_percent'])}"
    )
    assert 0 <= result["packet_loss_percent"] <= 100, (
        f"packet_loss_percent should be 0-100, got {result['packet_loss_percent']}"
    )
    if result["response_time_ms"] is not None:
        assert isinstance(result["response_time_ms"], int), (
            f"response_time_ms should be int or None, got {type(result['response_time_ms'])}"
        )
        assert result["response_time_ms"] > 0, (
            f"response_time_ms should be positive, got {result['response_time_ms']}"
        )


@settings(max_examples=100)
@given(data=any_ping_output)
def test_ping_parser_reachable_iff_loss_below_100(data):
    """Property 6c: reachable is True if and only if packet_loss_percent < 100.

    **Validates: Requirements 5.2**
    """
    output, _, _, _ = data
    result = parse_ping_output(output)

    if result["packet_loss_percent"] < 100:
        assert result["reachable"] is True, (
            f"reachable should be True when loss={result['packet_loss_percent']}%"
        )
    else:
        assert result["reachable"] is False, (
            f"reachable should be False when loss={result['packet_loss_percent']}%"
        )


@settings(max_examples=100)
@given(data=success_ping_output())
def test_ping_parser_success_extracts_response_time(data):
    """Property 6d: For successful pings (0% loss), response_time_ms is a positive integer.

    **Validates: Requirements 5.2**
    """
    output, loss_percent, expected_avg, _ = data
    result = parse_ping_output(output)

    assert result["reachable"] is True, "Should be reachable with 0% loss"
    assert result["packet_loss_percent"] == 0, (
        f"Expected 0% loss, got {result['packet_loss_percent']}%"
    )
    assert result["response_time_ms"] is not None, (
        "response_time_ms should not be None for successful ping"
    )
    assert result["response_time_ms"] == expected_avg, (
        f"Expected avg time {expected_avg}ms, got {result['response_time_ms']}ms"
    )


@settings(max_examples=100)
@given(data=total_failure_ping_output())
def test_ping_parser_total_failure_no_response_time(data):
    """Property 6e: For total failure (100% loss), response_time_ms is None.

    **Validates: Requirements 5.2**
    """
    output, loss_percent, _, _ = data
    result = parse_ping_output(output)

    assert result["reachable"] is False, "Should not be reachable with 100% loss"
    assert result["packet_loss_percent"] == 100, (
        f"Expected 100% loss, got {result['packet_loss_percent']}%"
    )
    assert result["response_time_ms"] is None, (
        f"response_time_ms should be None for total failure, got {result['response_time_ms']}"
    )


@settings(max_examples=100)
@given(data=partial_loss_ping_output())
def test_ping_parser_partial_loss_is_reachable(data):
    """Property 6f: For partial loss (1-99%), host is reachable and response_time_ms is set.

    **Validates: Requirements 5.2**
    """
    output, loss_percent, expected_avg, _ = data
    result = parse_ping_output(output)

    assert result["reachable"] is True, (
        f"Should be reachable with {loss_percent}% loss (< 100%)"
    )
    assert 1 <= result["packet_loss_percent"] <= 99, (
        f"Expected partial loss (1-99%), got {result['packet_loss_percent']}%"
    )
    assert result["response_time_ms"] is not None, (
        "response_time_ms should not be None for partial loss (some replies received)"
    )
    assert result["response_time_ms"] == expected_avg, (
        f"Expected avg time {expected_avg}ms, got {result['response_time_ms']}ms"
    )
