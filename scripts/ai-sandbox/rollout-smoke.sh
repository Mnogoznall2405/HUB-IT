set -euo pipefail
exec 2>&1
cd /
as_sandbox() { sudo -u hub-ai-sandbox -H env XDG_RUNTIME_DIR=/run/user/10001 "$@"; }
image=$(cat /etc/hub-ai-sandbox/image.pin)
workspace=/var/lib/hub-ai-sandbox/workspaces/ws-00000000000000000000000000000001
as_sandbox podman run --rm --network=hub-ai-internal --read-only --cap-drop=ALL --security-opt=no-new-privileges --entrypoint=python3 "$image" -c 'import urllib.request; print(urllib.request.urlopen("http://hub-ai-llm-gateway:8080/health",timeout=10).read().decode())'
as_sandbox podman run --rm --user=10001:10001 --userns=keep-id:uid=10001,gid=10001 --network=hub-ai-internal --read-only --cap-drop=ALL --security-opt=no-new-privileges --security-opt=seccomp=/etc/hub-ai-sandbox/seccomp-opencode.json --memory=2147483648 --pids-limit=128 --tmpfs=/tmp:rw,nosuid,nodev,noexec,size=268435456 --volume="$workspace:/workspace:rw,nodev,nosuid,noexec" --entrypoint=python3 "$image" -c '
import errno,fcntl,os,socket
fd=os.open("/workspace",os.O_RDONLY)
try:
 try: fcntl.ioctl(fd,0x401c5820,bytes(28)); raise RuntimeError("ioctl unexpectedly allowed")
 except OSError as e: assert e.errno==errno.EPERM; print("QUOTA_IOCTL_BLOCKED")
finally: os.close(fd)
try:
 with open("/workspace/quota-smoke.bin","xb") as f:
  for i in range(1025): f.write(bytes(1024*1024))
 raise RuntimeError("Hard quota not enforced")
except OSError as e:
 assert e.errno==errno.EDQUOT; print("KERNEL_EDQUOT_VERIFIED")
finally:
 os.unlink("/workspace/quota-smoke.bin")
try:
 socket.create_connection(("1.1.1.1",443),timeout=3); raise RuntimeError("Unexpected Internet access")
except OSError: print("DIRECT_INTERNET_BLOCKED")
'
as_sandbox rmdir "$workspace"
python3 - <<'PY'
import ssl,urllib.request
ctx=ssl.create_default_context(cafile='/etc/hub-ai-sandbox/control-ca.pem')
with urllib.request.urlopen('https://hub-ai-control:8443/health',context=ctx,timeout=10) as r: print('CONTROL_TLS_HEALTH',r.status,r.read().decode())
PY
test -z "$(as_sandbox podman port hub-ai-llm-gateway)"
echo SANDBOX_SMOKE_OK
