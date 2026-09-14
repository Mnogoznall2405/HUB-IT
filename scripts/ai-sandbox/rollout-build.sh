set -euo pipefail
exec 2>&1
cd /opt/hub-ai/current
as_sandbox() { sudo -u hub-ai-sandbox -H env XDG_RUNTIME_DIR=/run/user/10001 "$@"; }
as_sandbox podman build -f scripts/ai-sandbox/GatewayContainerfile -t localhost/hub/ai-llm-gateway:reviewed .
as_sandbox podman build -f scripts/ai-sandbox/Containerfile -t localhost/hub/opencode-sandbox:reviewed scripts/ai-sandbox
for entry in 'ai-llm-gateway gateway.image.pin' 'opencode-sandbox image.pin'; do
  read -r image pin <<< "$entry"
  digest=$(as_sandbox podman image inspect --format '{{.Digest}}' "localhost/hub/$image:reviewed")
  [[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]]
  reference="localhost/hub/$image@$digest"
  as_sandbox podman image exists "$reference"
  printf '%s\n' "$reference" > "/etc/hub-ai-sandbox/$pin"
done
echo IMAGES_BUILT_AND_PINNED
