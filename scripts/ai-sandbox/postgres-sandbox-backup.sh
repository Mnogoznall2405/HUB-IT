set -euo pipefail
test "$(hostname)" = tmn-srv-db-06
backup=/var/backups/hubit-opencode-20260914
install -d -o postgres -g postgres -m 700 "$backup"
test ! -e "$backup/sandbox-before-0116.dump"
sudo -u postgres pg_dump -Fc -d hubit_chat -t 'app.ai_sandbox*' -t system.alembic_version -f "$backup/sandbox-before-0116.dump"
sudo -u postgres pg_restore -l "$backup/sandbox-before-0116.dump" >/dev/null
sha256sum "$backup/sandbox-before-0116.dump"
sudo -u postgres psql -X -d hubit_chat -Atqc "SELECT count(*) FROM pg_locks WHERE NOT granted;"
