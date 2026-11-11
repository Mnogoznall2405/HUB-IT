import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('quota_root', ROOT / 'scripts/ai-sandbox/quota_root.py')
quota = importlib.util.module_from_spec(spec)
spec.loader.exec_module(quota)


@pytest.mark.parametrize('target', ['/tmp/ws-' + 'a' * 32, '/var/lib/hub-ai-sandbox/workspaces/../etc', '/var/lib/hub-ai-sandbox/workspaces/ws-' + 'a' * 32 + '/child'])
def test_quota_rejects_targets_outside_direct_workspace(target):
    with pytest.raises(ValueError):
        quota.validate_target(target, quota.LIMIT)


def test_quota_requires_dedicated_ext4_and_kernel_hard_limit():
    mount = {'target': str(quota.ROOT), 'source': '/dev/test-only', 'fstype': 'ext4', 'options': 'rw,prjquota,nodev,nosuid,noexec'}
    assert quota.check_mount({'filesystems': [mount]}) == '/dev/test-only'
    with pytest.raises(ValueError):
        quota.check_mount({'filesystems': [{**mount, 'target': '/'}]})
    with pytest.raises(ValueError):
        quota.check_mount({'filesystems': [{**mount, 'options': 'rw'}]})
    limits = quota.Quota()
    limits.soft = quota.LIMIT // 1024
    with pytest.raises(ValueError):
        quota.verify_project([quota.PROJECT_INHERIT, 0, 0, 100], limits, 100, quota.LIMIT)
    limits.hard = limits.soft
    quota.verify_project([quota.PROJECT_INHERIT, 0, 0, 100], limits, 100, quota.LIMIT)
    with pytest.raises(ValueError):
        quota.verify_project([0, 0, 0, 100], limits, 100, quota.LIMIT)


def test_container_cannot_remove_project_inheritance_using_legacy_ioctls():
    profile = json.loads((ROOT / 'scripts/ai-sandbox/seccomp-opencode.json').read_text())
    # Kernel ioctl request is unsigned int: high bits must not bypass seccomp.
    blocked = {arg['valueTwo'] for rule in profile['syscalls'] if rule['names'] == ['ioctl'] and rule['action'] == 'SCMP_ACT_ERRNO' for arg in rule['args'] if arg['index'] == 1 and arg['op'] == 'SCMP_CMP_MASKED_EQ' and arg['value'] == 0xffffffff}
    assert {0x401C5820, 0x40086602, 0x40046602} <= blocked
