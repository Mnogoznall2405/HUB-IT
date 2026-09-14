"""Validated foreground gateway launcher for the dedicated systemd unit."""
from __future__ import annotations

import os
import stat
import sys
from pathlib import Path

from dotenv import dotenv_values

from preflight import check_configuration
from backend.ai_sandbox.config import validate_digest_image


def build_command(image: str, env_file: Path) -> list[str]:
    validate_digest_image(image)
    if not env_file.is_absolute() or env_file.is_symlink() or env_file.parent.is_symlink():
        raise ValueError('Invalid gateway env location')
    for path, mode in ((env_file, 0o600), (env_file.parent, 0o700)):
        info = path.stat()
        if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != mode:
            raise ValueError('Invalid gateway env ownership or permissions')
    values = {k: v or '' for k, v in dotenv_values(env_file, interpolate=False).items()}
    if not check_configuration(values, role='gateway')['configuration_ok']:
        raise ValueError('Gateway configuration preflight failed')
    return [
        '/usr/bin/podman', 'run', '--rm', '--pull=never', '--name=hub-ai-llm-gateway',
        '--user=10001:10001', '--userns=keep-id:uid=10001,gid=10001',
        '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
        '--pids-limit=128', '--cpus=1', '--memory=1073741824', '--memory-swap=1073741824',
        '--tmpfs=/tmp:rw,nosuid,nodev,noexec,size=67108864,mode=1777',
        '--network=hub-ai-internal:alias=hub-ai-llm-gateway',
        '--network=hub-ai-gateway-egress', '--env-file', str(env_file), image,
    ]


if __name__ == '__main__':
    try:
        if os.getuid() != 10001:
            raise ValueError('Gateway must run under the dedicated service account')
        command = build_command(os.environ['HUB_AI_GATEWAY_IMAGE'], Path(os.environ['HUB_AI_GATEWAY_ENV_FILE']))
        os.execv(command[0], command)
    except Exception:
        print('Gateway launch preflight failed', file=sys.stderr)
        raise SystemExit(1)
