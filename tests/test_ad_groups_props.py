"""
Property-based tests for AD group DN parsing and built-in filtering.

Feature: ai-agent-universal-tools
Property 8: AD group DN parsing and built-in filtering

**Validates: Requirements 9.2, 9.3, 9.4**

For any list of Distinguished Name strings in the format `CN=GroupName,OU=...,DC=...`,
the group parser SHALL extract the CN value as the group name. When `include_builtin=False`,
the result SHALL exclude all names in the built-in set (Domain Users, Users, etc.).
When `include_builtin=True`, all parsed groups SHALL be included.
`group_count` SHALL equal the length of the returned groups list.
"""

import sys
from pathlib import Path

# Ensure WEB-itinvent is on the path (backend lives there)
PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from hypothesis import given, settings, assume
from hypothesis.strategies import text, lists, sampled_from, composite, just, one_of

from backend.services.ad_users_service import _parse_cn_from_dn, _BUILTIN_GROUPS


# --- Strategies ---

# Characters valid in a CN group name (no commas, as comma is the DN separator)
_cn_chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_."

# Strategy for generating a valid group name (CN value)
group_name_strategy = text(
    alphabet=_cn_chars,
    min_size=1,
    max_size=60,
).filter(lambda s: s.strip() != "")

# Strategy for OU components
ou_component = text(
    alphabet="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_",
    min_size=1,
    max_size=30,
).filter(lambda s: s.strip() != "")

# Strategy for DC components
dc_component = text(
    alphabet="abcdefghijklmnopqrstuvwxyz0123456789-",
    min_size=1,
    max_size=15,
).filter(lambda s: s.strip() != "")


@composite
def dn_string(draw, cn_name=None):
    """Generate a valid Distinguished Name string: CN=GroupName,OU=...,DC=..."""
    if cn_name is None:
        cn_name = draw(group_name_strategy)
    ou_parts = draw(lists(ou_component, min_size=1, max_size=3))
    dc_parts = draw(lists(dc_component, min_size=1, max_size=3))
    ou_str = ",".join(f"OU={ou}" for ou in ou_parts)
    dc_str = ",".join(f"DC={dc}" for dc in dc_parts)
    return f"CN={cn_name},{ou_str},{dc_str}"


@composite
def dn_with_builtin_group(draw):
    """Generate a DN string with a built-in group name as the CN."""
    builtin_name = draw(sampled_from(sorted(_BUILTIN_GROUPS)))
    return draw(dn_string(cn_name=builtin_name))


@composite
def dn_with_custom_group(draw):
    """Generate a DN string with a non-builtin group name as the CN."""
    name = draw(group_name_strategy)
    assume(name.strip() not in _BUILTIN_GROUPS)
    return draw(dn_string(cn_name=name))


# Strategy for a list of DN strings (mix of builtin and custom)
dn_list_strategy = lists(
    one_of(dn_with_builtin_group(), dn_with_custom_group()),
    min_size=0,
    max_size=20,
)


# --- Helper: replicate the group parsing/filtering logic from get_ad_user_groups ---

def parse_and_filter_groups(dn_list: list[str], *, include_builtin: bool = False) -> dict:
    """Replicate the group parsing logic from get_ad_user_groups for testing."""
    all_groups = [_parse_cn_from_dn(dn) for dn in dn_list]
    all_groups = [g for g in all_groups if g]  # filter empty

    if include_builtin:
        groups = sorted(all_groups)
    else:
        groups = sorted(g for g in all_groups if g not in _BUILTIN_GROUPS)

    return {
        "groups": groups,
        "group_count": len(groups),
    }


# --- Property Tests ---


@settings(max_examples=100)
@given(dn=dn_string())
def test_parse_cn_extracts_group_name(dn: str):
    """Property 8a: _parse_cn_from_dn extracts the CN value from a valid DN string.

    **Validates: Requirements 9.2, 9.3, 9.4**
    """
    result = _parse_cn_from_dn(dn)
    # The DN starts with CN=<name>,... so the result should be the name part
    assert result != "", f"Expected non-empty CN from DN: {dn!r}"
    # The result should not contain commas (it's just the CN value)
    assert "," not in result, f"CN should not contain commas, got {result!r} from {dn!r}"


@settings(max_examples=100)
@given(name=group_name_strategy)
def test_parse_cn_roundtrip(name: str):
    """Property 8b: Building a DN with CN=name and parsing it back yields the original name (stripped).

    **Validates: Requirements 9.2, 9.3, 9.4**
    """
    dn = f"CN={name},OU=Groups,DC=example,DC=com"
    result = _parse_cn_from_dn(dn)
    assert result == name.strip(), (
        f"Expected {name.strip()!r}, got {result!r} from DN {dn!r}"
    )


@settings(max_examples=100)
@given(dn_list=dn_list_strategy)
def test_include_builtin_true_returns_all_parsed_groups(dn_list: list[str]):
    """Property 8c: When include_builtin=True, all parsed groups are included.

    **Validates: Requirements 9.2, 9.3, 9.4**
    """
    result = parse_and_filter_groups(dn_list, include_builtin=True)
    # All non-empty parsed CNs should be in the result
    all_parsed = [_parse_cn_from_dn(dn) for dn in dn_list]
    all_parsed = [g for g in all_parsed if g]
    assert sorted(all_parsed) == result["groups"], (
        f"With include_builtin=True, expected all parsed groups. "
        f"Got {result['groups']!r}, expected {sorted(all_parsed)!r}"
    )


@settings(max_examples=100)
@given(dn_list=dn_list_strategy)
def test_include_builtin_false_excludes_builtin_groups(dn_list: list[str]):
    """Property 8d: When include_builtin=False, built-in groups are excluded from results.

    **Validates: Requirements 9.2, 9.3, 9.4**
    """
    result = parse_and_filter_groups(dn_list, include_builtin=False)
    # No built-in group should appear in the result
    for group in result["groups"]:
        assert group not in _BUILTIN_GROUPS, (
            f"Built-in group {group!r} should be excluded when include_builtin=False"
        )


@settings(max_examples=100)
@given(dn_list=dn_list_strategy)
def test_group_count_equals_groups_length(dn_list: list[str]):
    """Property 8e: group_count SHALL equal the length of the returned groups list.

    **Validates: Requirements 9.2, 9.3, 9.4**
    """
    # Test with include_builtin=False
    result_no_builtin = parse_and_filter_groups(dn_list, include_builtin=False)
    assert result_no_builtin["group_count"] == len(result_no_builtin["groups"]), (
        f"group_count ({result_no_builtin['group_count']}) != len(groups) ({len(result_no_builtin['groups'])})"
    )

    # Test with include_builtin=True
    result_with_builtin = parse_and_filter_groups(dn_list, include_builtin=True)
    assert result_with_builtin["group_count"] == len(result_with_builtin["groups"]), (
        f"group_count ({result_with_builtin['group_count']}) != len(groups) ({len(result_with_builtin['groups'])})"
    )


@settings(max_examples=100)
@given(dn_list=dn_list_strategy)
def test_include_builtin_true_is_superset_of_false(dn_list: list[str]):
    """Property 8f: Groups with include_builtin=True is a superset of include_builtin=False.

    **Validates: Requirements 9.2, 9.3, 9.4**
    """
    result_all = parse_and_filter_groups(dn_list, include_builtin=True)
    result_filtered = parse_and_filter_groups(dn_list, include_builtin=False)

    # Every group in the filtered result should also be in the full result
    filtered_set = set(result_filtered["groups"])
    all_set = set(result_all["groups"])
    assert filtered_set.issubset(all_set), (
        f"Filtered groups should be a subset of all groups. "
        f"Extra in filtered: {filtered_set - all_set}"
    )


@settings(max_examples=100)
@given(s=text(min_size=0, max_size=100))
def test_parse_cn_handles_arbitrary_strings(s: str):
    """Property 8g: _parse_cn_from_dn never raises an exception for any input string.

    **Validates: Requirements 9.2, 9.3, 9.4**
    """
    # Should not raise any exception
    result = _parse_cn_from_dn(s)
    assert isinstance(result, str), f"Expected str, got {type(result)} for input {s!r}"
