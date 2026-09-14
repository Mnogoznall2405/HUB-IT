set -euo pipefail
exec 2>&1
release=b3962611c0fef7714aed
archive=/home/user/hub-ai-rollout/hub-ai-$release.tar.gz
echo "066c1dd0f5cb277525a7ff2aba46bc9ac61fff52da1f822c2cc66e0e10ec8d60  $archive" | sha256sum -c -
python3 - "$archive" "/opt/hub-ai/releases/$release" <<'PY'
import sys,tarfile,json,hashlib
from pathlib import Path
archive,dest=sys.argv[1],Path(sys.argv[2])
with tarfile.open(archive) as tar:
    for item in tar.getmembers():
        if not item.isfile() or Path(item.name).is_absolute() or '..' in Path(item.name).parts:
            raise RuntimeError('Unsafe archive')
    dest.mkdir(exist_ok=True)
    tar.extractall(dest,filter='data')
manifest=json.loads((dest/'release-manifest.json').read_text())
for name,digest in manifest.items():
    assert hashlib.sha256((dest/name).read_bytes()).hexdigest()==digest
PY
systemctl stop hub-ai-worker
readlink /opt/hub-ai/current > /root/hub-ai-backup-20260913/previous-runtime-20260914
ln -sfn "/opt/hub-ai/releases/$release" /opt/hub-ai/current
systemctl start hub-ai-worker
sleep 2
systemctl is-active hub-ai-worker
