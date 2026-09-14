#!/usr/bin/python3 -I
"""Restricted ext4 project-quota helper; install root-owned, never in workspace.

Linux x86_64 UAPI: include/uapi/linux/{fs,quota}.h. No marker fallback.
Only an exclusively dedicated ext4 mount at ROOT is supported. Existing
nonempty directories without the expected project are rejected, not migrated.
"""
from __future__ import annotations

import ctypes
import json
import os
import platform
import re
import stat
import struct
import subprocess
import sys
from pathlib import Path

ROOT = Path('/var/lib/hub-ai-sandbox/workspaces')
LIMIT = 1024 ** 3
PROJECT_INHERIT = 0x200
GET_ATTR = 0x801C581F
SET_ATTR = 0x401C5820


class Quota(ctypes.Structure):
    _fields_ = [(name, ctypes.c_uint64) for name in (
        'hard', 'soft', 'space', 'ihard', 'isoft', 'inodes', 'btime', 'itime'
    )] + [('valid', ctypes.c_uint32)]


def validate_target(workspace: str, limit: int) -> Path:
    path = Path(workspace)
    if path.parent != ROOT or not re.fullmatch(r'ws-[0-9a-f]{32}', path.name):
        raise ValueError('Invalid quota workspace')
    if limit != LIMIT:
        raise ValueError('Only the fixed 1 GiB quota is supported')
    return path


def quota_call(device: str, project: int, *, setting: Quota | None = None) -> Quota:
    libc = ctypes.CDLL(None, use_errno=True)
    libc.quotactl.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_void_p]
    libc.quotactl.restype = ctypes.c_int
    quota = setting if setting is not None else Quota()
    command = ((0x800008 if setting is not None else 0x800007) << 8) | 2
    if libc.quotactl(command, os.fsencode(device), project, ctypes.byref(quota)) != 0:
        raise OSError(ctypes.get_errno(), 'Kernel project quota operation failed')
    return quota


def check_mount(data: dict) -> str:
    mounts = data.get('filesystems', [])
    if len(mounts) != 1:
        raise ValueError('Dedicated workspace mount is required')
    mount = mounts[0]
    options = set(str(mount.get('options', '')).split(','))
    if (mount.get('target') != str(ROOT) or mount.get('fstype') != 'ext4'
            or not {'prjquota', 'nodev', 'nosuid', 'noexec'}.issubset(options)
            or not str(mount.get('source', '')).startswith('/dev/')):
        raise ValueError('Dedicated hardened ext4 project-quota mount is required')
    return mount['source']


def verify_project(attrs: list, quota: Quota, project: int, limit: int) -> None:
    if attrs[3] != project or not attrs[0] & PROJECT_INHERIT or quota.hard * 1024 != limit:
        raise ValueError('Kernel hard quota or project inheritance is not verified')


def run(mode: str, workspace: str, limit: int) -> None:
    import fcntl

    path = validate_target(workspace, limit)
    if mode not in {'ensure', 'verify'} or os.geteuid() != 0 or platform.machine() != 'x86_64':
        raise ValueError('Unsupported invocation')
    if ROOT.resolve(strict=True) != ROOT:
        raise ValueError('Workspace root must not contain symlinks')
    mounted = subprocess.run(
        ['/usr/bin/findmnt', '--json', '--target', str(ROOT), '--output', 'TARGET,SOURCE,FSTYPE,OPTIONS'],
        check=True, capture_output=True, text=True, timeout=5,
        env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C'},
    )
    device = check_mount(json.loads(mounted.stdout))
    root_fd = os.open(ROOT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        root_stat = os.fstat(root_fd)
        # Worker may create child workspaces; no other local account may do so.
        if root_stat.st_uid != 10001 or stat.S_IMODE(root_stat.st_mode) != 0o700:
            raise ValueError('Invalid workspace root ownership')
        fd = os.open(path.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root_fd)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            info = os.fstat(fd)
            if info.st_dev != root_stat.st_dev or info.st_uid != 10001 or stat.S_IMODE(info.st_mode) != 0o700:
                raise ValueError('Invalid workspace ownership or filesystem')
            project = info.st_ino
            if not 0 < project < 2 ** 31:
                raise ValueError('Workspace inode is outside project ID range')
            attrs = list(struct.unpack('=IIIII8s', fcntl.ioctl(fd, GET_ATTR, bytes(28))))
            quota = quota_call(device, project)
            if mode == 'ensure' and attrs[3] == 0:
                if os.listdir(fd) or quota.space or quota.inodes:
                    raise ValueError('Only an empty unassigned workspace may be provisioned')
                limits = Quota()
                limits.hard = limit // 1024
                limits.soft = limit // 1024
                limits.valid = 1  # QIF_BLIMITS
                quota_call(device, project, setting=limits)
                attrs[0] |= PROJECT_INHERIT
                attrs[3] = project
                fcntl.ioctl(fd, SET_ATTR, struct.pack('=IIIII8s', *attrs))
                attrs = list(struct.unpack('=IIIII8s', fcntl.ioctl(fd, GET_ATTR, bytes(28))))
                quota = quota_call(device, project)
            verify_project(attrs, quota, project, limit)
            print(f'verified:{limit}')
        finally:
            os.close(fd)
    finally:
        os.close(root_fd)


if __name__ == '__main__':
    try:
        if len(sys.argv) != 4:
            raise ValueError('Expected mode, workspace and bytes')
        run(sys.argv[1], sys.argv[2], int(sys.argv[3]))
    except Exception:
        # No paths or configuration values in error output.
        print('Quota not verified', file=sys.stderr)
        raise SystemExit(1)
