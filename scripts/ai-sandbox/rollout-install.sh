set -euo pipefail
exec 2>&1
export LC_ALL=C
backup=/root/hub-ai-backup-20260913
test ! -e "$backup"
install -d -m 0700 "$backup"
cp -a /etc/hub-ai-sandbox "$backup/"
cp -a /usr/local/libexec/hub-ai-sandbox-quota "$backup/quota.old"
vgs --units g -o vg_name,vg_free > "$backup/vgs.txt"
stage=/home/user/hub-ai-rollout
archive="$stage/hub-ai-939b91f21ff985c6f057.tar.gz"
echo '7567daca09d880c76463a5dfcfe73c7c09fc7462118558ed8f99c4c2f435aabe  '"$archive" | sha256sum -c -
release=/opt/hub-ai/releases/939b91f21ff985c6f057
test ! -e "$release"
install -d -m 0755 "$release"
python3 - "$archive" "$release" <<'PY'
import tarfile,sys,pathlib,json,hashlib
with tarfile.open(sys.argv[1]) as t:
 for m in t.getmembers():
  p=pathlib.PurePosixPath(m.name)
  if not m.isfile() or p.is_absolute() or '..' in p.parts: raise ValueError('Unsafe release')
 t.extractall(sys.argv[2],filter='data')
r=pathlib.Path(sys.argv[2]); manifest=json.loads((r/'release-manifest.json').read_text())
for name,digest in manifest.items():
 assert hashlib.sha256((r/name).read_bytes()).hexdigest()==digest
print('RELEASE_HASHES_OK')
PY
bash "$release/scripts/ai-sandbox/prepare-workspace-volume.sh"
install -o root -g root -m 0755 "$release/scripts/ai-sandbox/quota_root.py" /usr/local/libexec/hub-ai-sandbox-quota-root
install -o root -g root -m 0755 "$release/scripts/ai-sandbox/quota-wrapper.sh" /usr/local/libexec/hub-ai-sandbox-quota
visudo -cf "$release/scripts/ai-sandbox/hub-ai-sandbox.sudoers"
install -o root -g root -m 0440 "$release/scripts/ai-sandbox/hub-ai-sandbox.sudoers" /etc/sudoers.d/hub-ai-sandbox
install -o root -g root -m 0444 "$release/scripts/ai-sandbox/seccomp-opencode.json" /etc/hub-ai-sandbox/seccomp-opencode.json
python3 -m venv /opt/hub-ai/venv
/opt/hub-ai/venv/bin/pip install --disable-pip-version-check -r "$release/scripts/ai-sandbox/gateway-requirements.lock"
ln -s "$release" /opt/hub-ai/current
for unit in "$release"/scripts/ai-sandbox/systemd/*.service; do install -m 0644 "$unit" /etc/systemd/system/; done
systemctl daemon-reload
loginctl enable-linger hub-ai-sandbox
systemd-analyze verify /etc/systemd/system/hub-ai-{gateway,worker,cleanup}.service
echo LINUX_RUNTIME_INSTALLED
