set -u
exec 2>&1
cd /
run() { sudo -u hub-ai-sandbox -H env XDG_RUNTIME_DIR=/run/user/10001 CONTAINERS_CONF=/etc/hub-ai-sandbox/containers-service.conf "$@"; }
name=hub-opencode-32d2547bbc2af474-4538124ec41fe4e7
run podman inspect --format '{{json .HostConfig.PortBindings}} {{json .NetworkSettings.Ports}}' "$name"
port=$(run podman port "$name" 4096/tcp)
echo "control=$port"
curl --max-time 5 -s -o /dev/null -w 'CONTROL_HTTP %{http_code}\n' "http://$port/global/health"
run /opt/hub-ai/venv/bin/python - <<'PY'
import subprocess,json,httpx
name='hub-opencode-32d2547bbc2af474-4538124ec41fe4e7'
details=json.loads(subprocess.check_output(['podman','inspect',name]))[0]
values=dict(x.split('=',1) for x in details['Config']['Env'] if '=' in x)
port=details['NetworkSettings']['Ports']['4096/tcp'][0]['HostPort']
with httpx.Client(auth=(values['OPENCODE_SERVER_USERNAME'],values['OPENCODE_SERVER_PASSWORD']),timeout=5) as client:
    for path in ('/global/health','/session'):
        try:
            r=client.post('http://127.0.0.1:'+port+path,json={}) if path=='/session' else client.get('http://127.0.0.1:'+port+path)
            print(path,r.status_code)
        except Exception as e: print(path,type(e).__name__)
PY
ss -tnp | grep 'pid=54280' || true
python3 - <<'PY'
from pathlib import Path
env=dict(x.split(b'=',1) for x in Path('/proc/54280/environ').read_bytes().split(b'\0') if b'=' in x)
print('PROXY_KEYS', [k.decode() for k in env if b'PROXY' in k.upper()])
PY
