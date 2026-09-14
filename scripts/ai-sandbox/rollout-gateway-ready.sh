set -euo pipefail
exec 2>&1
cd /
systemctl is-active hub-ai-gateway hub-ai-worker
sudo -u hub-ai-sandbox -H env XDG_RUNTIME_DIR=/run/user/10001 podman exec hub-ai-llm-gateway python3 -c 'import ctypes,psycopg,urllib.request; print("GATEWAY_HTTP",urllib.request.urlopen("http://127.0.0.1:8080/health",timeout=5).status)'
