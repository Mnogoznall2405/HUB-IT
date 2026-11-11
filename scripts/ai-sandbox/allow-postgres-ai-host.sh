# Run as root on the PostgreSQL host 10.103.0.10 after confirming that target.
# This changes only client authentication; no application data or schema changes.
set -euo pipefail
rule='hostssl hubit_chat hubit_chat_app 10.103.0.11/32 scram-sha-256'
hba=$(sudo -u postgres psql -p 5432 -d postgres -Atqc 'SHOW hba_file')
test -n "$hba" && test -f "$hba" && test ! -L "$hba"
if grep -Fxq "$rule" "$hba"; then
  echo 'Exact OpenCode rule already exists; inspect rule ordering before changing it.'
  exit 1
fi
backup="${hba}.hub-ai-$(date -u +%Y%m%dT%H%M%SZ).bak"
cp -p -- "$hba" "$backup"
HBA_PATH="$hba" HBA_RULE="$rule" python3 - <<'PY'
import os
from pathlib import Path
p=Path(os.environ['HBA_PATH'])
original=p.read_bytes()
with p.open('wb') as stream:
    stream.write(('# HUB OpenCode dedicated host; TLS and SCRAM only\n'+os.environ['HBA_RULE']+'\n').encode()+original)
PY
errors=$(sudo -u postgres psql -p 5432 -d postgres -Atqc 'SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL')
if [ "$errors" != 0 ]; then
  cp -p -- "$backup" "$hba"
  echo 'Invalid HBA configuration; backup restored without reload.' >&2
  exit 1
fi
sudo -u postgres psql -p 5432 -d postgres -Atqc 'SELECT pg_reload_conf()'
echo "Backup: $backup"
echo 'Post-check: connect from AI host over TLS, then start worker and verify a chat job.'
echo 'Rollback: restore the printed backup to hba_file and call pg_reload_conf().'
