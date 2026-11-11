"""Create an allowlisted, hashed Linux release bundle without env or user data."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def release_files() -> list[str]:
    files = set()
    for line in (ROOT / 'scripts/ai-sandbox/GatewayContainerfile').read_text(encoding='utf-8').splitlines():
        parts = line.split()
        if parts and parts[0] == 'COPY' and not parts[1].startswith('--'):
            files.add(parts[1])
    files.add('WEB-itinvent/backend/ai_sandbox_worker_main.py')
    files.add('WEB-itinvent/backend/ai_chat/access.py')
    files.add('WEB-itinvent/backend/ai_chat/__init__.py')
    files.add('WEB-itinvent/backend/services/authorization_service.py')
    for module in ('control', 'executor', 'paths', 'repository', 'runtime', 'sqlalchemy_repository', 'transfer', 'worker', 'worker_control'):
        files.add(f'WEB-itinvent/backend/ai_sandbox/{module}.py')
    for name in ('Containerfile', 'GatewayContainerfile', 'requirements.lock', 'gateway-requirements.lock',
                 'opencode.json', 'seccomp-opencode.json', 'quota_root.py', 'quota-wrapper.sh',
                 'hub-ai-sandbox.sudoers', 'preflight.py', 'run_gateway.py', 'containers-service.conf',
                 'prepare-workspace-volume.sh', 'DEPLOYMENT.md', 'ROLLOUT_PLAN.md'):
        files.add(f'scripts/ai-sandbox/{name}')
    for service in ('gateway', 'worker', 'cleanup'):
        files.add(f'scripts/ai-sandbox/systemd/hub-ai-{service}.service')
    return sorted(files)


def build_release(destination: Path) -> dict:
    contents = {}
    for relative in release_files():
        path = ROOT / relative
        if path.is_symlink() or not path.is_file():
            raise ValueError('Release source is missing or a symlink')
        contents[relative] = path.read_bytes().replace(b'\r\n', b'\n')
    manifest = {name: hashlib.sha256(data).hexdigest() for name, data in contents.items()}
    release_id = hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()[:20]
    destination.mkdir(parents=True, exist_ok=True)
    output = destination / f'hub-ai-{release_id}.tar.gz'
    if output.exists():
        raise ValueError('Release archive already exists; choose an empty output directory')
    with output.open('xb') as stream, tarfile.open(fileobj=stream, mode='w:gz') as archive:
        for name, data in {**contents, 'release-manifest.json': json.dumps(manifest, indent=2).encode()}.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mode = 0o644
            archive.addfile(info, io.BytesIO(data))
    return {'release_id': release_id, 'archive': str(output),
            'sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'files': len(contents)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(build_release(args.output_dir), indent=2))
