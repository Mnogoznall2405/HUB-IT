set -euo pipefail
exec 2>&1
cd /opt/hub-ai/current
stage=/home/user/hub-ai-rollout
install -d -o hub-ai-sandbox -g hub-ai-sandbox -m 0700 /home/hub-ai-sandbox/gateway
install -o hub-ai-sandbox -g hub-ai-sandbox -m 0600 "$stage/gateway.env" /home/hub-ai-sandbox/gateway/gateway.env
install -o root -g root -m 0600 "$stage/worker.env" /etc/hub-ai-sandbox/worker.env
printf 'AI_SANDBOX_IMAGE=%s\n' "$(cat /etc/hub-ai-sandbox/image.pin)" >> /etc/hub-ai-sandbox/worker.env
install -o root -g root -m 0644 "$stage/control-ca.pem" /etc/hub-ai-sandbox/control-ca.pem
printf 'HUB_AI_GATEWAY_IMAGE=%s\nHUB_AI_GATEWAY_ENV_FILE=/home/hub-ai-sandbox/gateway/gateway.env\n' "$(cat /etc/hub-ai-sandbox/gateway.image.pin)" > /etc/hub-ai-sandbox/gateway-runtime.env
chmod 0600 /etc/hub-ai-sandbox/gateway-runtime.env
if ! getent hosts hub-ai-control >/dev/null; then printf '\n10.103.0.217 hub-ai-control\n' >> /etc/hosts; fi
rm -- "$stage/gateway.env" "$stage/worker.env"
as_sandbox() { sudo -u hub-ai-sandbox -H env XDG_RUNTIME_DIR=/run/user/10001 "$@"; }
test_workspace=/var/lib/hub-ai-sandbox/workspaces/ws-00000000000000000000000000000001
test ! -e "$test_workspace"
as_sandbox mkdir -m 0700 "$test_workspace"
as_sandbox /usr/local/libexec/hub-ai-sandbox-quota ensure "$test_workspace" 1073741824
as_sandbox /usr/local/libexec/hub-ai-sandbox-quota verify "$test_workspace" 1073741824
systemctl enable --now hub-ai-gateway.service
sleep 2
systemctl is-active hub-ai-gateway.service
python3 - <<'PY'
import ssl,urllib.request
ctx=ssl.create_default_context(cafile='/etc/hub-ai-sandbox/control-ca.pem')
with urllib.request.urlopen('https://hub-ai-control:8443/health',context=ctx,timeout=10) as r: print('CONTROL_TLS_HEALTH',r.status,r.read().decode())
PY
echo CONFIGURED
