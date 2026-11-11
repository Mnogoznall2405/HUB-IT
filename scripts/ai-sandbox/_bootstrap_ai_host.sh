#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a
export APT_LISTCHANGES_FRONTEND=none

echo "=== pre ==="
hostname
whoami
. /etc/os-release
echo "OS=$PRETTY_NAME"
uname -r
df -h /
free -h

echo "=== apt update ==="
apt-get update

echo "=== apt upgrade ==="
apt-get -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" upgrade

echo "=== install system tools ==="
apt-get -y install \
  ca-certificates \
  curl \
  wget \
  gnupg \
  jq \
  ripgrep \
  git \
  unzip \
  zip \
  tree \
  htop \
  tmux \
  build-essential \
  pkg-config \
  uidmap \
  dbus-user-session \
  slirp4netns \
  fuse-overlayfs \
  podman \
  buildah \
  poppler-utils \
  qpdf \
  ghostscript \
  imagemagick \
  tesseract-ocr \
  tesseract-ocr-rus \
  tesseract-ocr-eng \
  pandoc \
  python3 \
  python3-pip \
  python3-venv \
  python3-dev \
  python3-setuptools \
  python3-wheel \
  python3-lxml \
  python3-pil \
  python3-numpy \
  python3-yaml \
  python3-requests \
  python3-bs4

echo "=== python venv for AI tools ==="
VENV=/opt/hub-ai-tools
python3 -m venv "$VENV"
"$VENV/bin/pip" install --upgrade pip setuptools wheel
"$VENV/bin/pip" install --no-cache-dir \
  pymupdf \
  pypdf \
  pdfplumber \
  pdfminer.six \
  reportlab \
  pillow \
  pytesseract \
  img2pdf \
  ocrmypdf \
  openpyxl \
  xlsxwriter \
  python-docx \
  python-pptx \
  pandas \
  numpy \
  lxml \
  beautifulsoup4 \
  requests \
  httpx \
  pyyaml \
  rich \
  typer \
  jinja2

# Convenience wrappers on PATH
install -d /usr/local/libexec/hub-ai-tools
cat > /usr/local/bin/hub-ai-python <<EOF
#!/bin/bash
exec $VENV/bin/python "\$@"
EOF
cat > /usr/local/bin/hub-ai-pip <<EOF
#!/bin/bash
exec $VENV/bin/pip "\$@"
EOF
chmod 755 /usr/local/bin/hub-ai-python /usr/local/bin/hub-ai-pip
ln -sfn "$VENV/bin/python" /usr/local/bin/hub-ai-python3

echo "=== verify python/pdf ==="
python3 --version
"$VENV/bin/python" - <<'PY'
import importlib
mods = [
  "fitz", "pypdf", "pdfplumber", "reportlab", "PIL",
  "pytesseract", "docx", "pptx", "pandas", "numpy", "openpyxl",
]
for m in mods:
    importlib.import_module(m)
    print("ok", m)
PY
pdftotext -v 2>&1 | head -1 || true
pdfinfo -v 2>&1 | head -1 || true
tesseract --version | head -1 || true

echo "=== podman ==="
podman --version || true

echo "=== install OpenCode ==="
export PATH="/root/.opencode/bin:/usr/local/bin:$PATH"
if ! command -v opencode >/dev/null 2>&1; then
  curl -fsSL https://opencode.ai/install | bash
fi
hash -r || true
if ! command -v opencode >/dev/null 2>&1; then
  for p in /root/.opencode/bin/opencode /usr/local/bin/opencode /usr/bin/opencode; do
    if [ -x "$p" ]; then
      ln -sfn "$p" /usr/local/bin/opencode
      break
    fi
  done
fi
command -v opencode
opencode --version || opencode version || true

echo "=== post ==="
df -h /
free -h
echo DONE
