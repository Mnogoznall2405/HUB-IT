#!/usr/bin/env bash
# Reversible I/O remediation for TMN-SRV-DB-06. Runtime-only OS changes; PG via ALTER SYSTEM+reload.
set -u
echo "=== identity ==="
id -un; hostname; date '+%F %T %z'

echo "=== kernel/io errors (this boot) ==="
( dmesg -T 2>/dev/null | grep -iE 'mpt|i/o error|reset|timeout|blocked|abort' | tail -20 ) || true
( journalctl -k -b --no-pager 2>/dev/null | grep -iE 'mpt|i/o error|reset|timeout|blocked|abort' | tail -20 ) || true

echo "=== vmware quiesce/snapshot evidence ==="
( grep -iE 'quiesce|snapshot|freeze|thaw' /var/log/vmware*.log* /var/log/syslog* 2>/dev/null | tail -20 ) || true
( journalctl --no-pager -b 2>/dev/null | grep -iE 'quiesce|snapshot|freeze|vmtools' | tail -15 ) || true

echo "=== adapters ==="
lsscsi 2>/dev/null; cat /sys/class/scsi_host/host*/proc_name 2>/dev/null | sort -u
cat /sys/block/sda/device/queue_depth 2>/dev/null

echo "=== baseline ==="
cat /proc/pressure/io
LC_ALL=C iostat -x sda 1 2 | tail -6

echo "=== OS tuning (runtime only) ==="
mount -o remount,noatime / && echo "remount noatime: OK"
echo 0 > /sys/block/sda/queue/rotational && echo "rotational=0: OK"
echo 512 > /sys/block/sda/queue/read_ahead_kb && echo "read_ahead_kb=512: OK"
sysctl -w vm.dirty_background_bytes=67108864 vm.dirty_bytes=268435456

echo "=== PostgreSQL ALTER SYSTEM (reload, no restart) ==="
sudo -u postgres psql -X -v ON_ERROR_STOP=1 <<'SQL'
ALTER SYSTEM SET checkpoint_timeout = '30min';
ALTER SYSTEM SET backend_flush_after = '512kB';
ALTER SYSTEM SET effective_io_concurrency = 16;
ALTER SYSTEM SET maintenance_io_concurrency = 16;
SELECT pg_reload_conf();
SQL

echo "=== verify ==="
sudo -u postgres psql -Xt -c "SELECT name,setting||' '||COALESCE(unit,'') AS val,source FROM pg_settings WHERE name IN ('checkpoint_timeout','backend_flush_after','effective_io_concurrency','maintenance_io_concurrency') ORDER BY name;"

echo "=== re-measure sync write path ==="
dd if=/dev/zero of=/var/tmp/hubit_io_probe bs=1M count=128 oflag=direct,dsync 2>&1 | tail -1
rm -f /var/tmp/hubit_io_probe
/usr/lib/postgresql/16/bin/pg_test_fsync -f /var/tmp/hubit_fpt -s 5 2>/dev/null | sed -n '/single fdatasync/,/open_sync/p' | head -10
rm -f /var/tmp/hubit_fpt

echo "=== iostat after (10s) ==="
LC_ALL=C iostat -x sda 1 10 | tail -14

echo "=== UNDO (run to revert) ==="
cat <<'UNDO'
mount -o remount,relatime /
echo 1 > /sys/block/sda/queue/rotational
echo 128 > /sys/block/sda/queue/read_ahead_kb
sysctl -w vm.dirty_background_bytes=0 vm.dirty_bytes=0
sudo -u postgres psql -X -c "ALTER SYSTEM RESET checkpoint_timeout; ALTER SYSTEM RESET backend_flush_after; ALTER SYSTEM RESET effective_io_concurrency; ALTER SYSTEM RESET maintenance_io_concurrency; SELECT pg_reload_conf();"
UNDO
echo "=== done ==="
