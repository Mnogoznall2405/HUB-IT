set -euo pipefail
test "$(hostname)" = tmn-srv-db-06
sudo -u postgres psql -p 5432 -d postgres -X -c "SELECT type,database,user_name,address,auth_method,error FROM pg_hba_file_rules ORDER BY rule_number;"
sudo -u postgres psql -p 5432 -d postgres -X -Atqc 'SHOW hba_file; SHOW ssl;'
