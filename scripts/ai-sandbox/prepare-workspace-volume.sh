#!/bin/bash
# Explicit production approval required. Creates ONLY a new dedicated 20 GiB LV.
set -euo pipefail
export LC_ALL=C
test "$(id -u)" = 0
workspace_root=/var/lib/hub-ai-sandbox/workspaces
volume=/dev/ubuntu-vg/hub_ai_workspace
test ! -e "$volume"
test "$(readlink -f "$workspace_root")" = "$workspace_root"
test -d "$workspace_root"
! mountpoint -q "$workspace_root"
test -z "$(find "$workspace_root" -mindepth 1 -maxdepth 1 -print -quit)"
free_bytes=$(vgs --noheadings --units b --nosuffix -o vg_free ubuntu-vg | tr -d ' ')
awk -v free="$free_bytes" 'BEGIN {exit !(free >= 21474836480)}'
unit=$(systemd-escape --path --suffix=mount "$workspace_root")
test ! -e "/etc/systemd/system/$unit"
lvcreate --yes --size 20G --name hub_ai_workspace ubuntu-vg
# The exact target was absent before lvcreate; never use -F on an existing FS.
test -b "$volume"
test -z "$(blkid -p -s TYPE -o value "$volume" || true)"
mkfs.ext4 -O quota,project -E quotatype=prj "$volume"
cat > "/etc/systemd/system/$unit" <<EOF
[Unit]
Description=Dedicated HUB OpenCode workspace volume
[Mount]
What=$volume
Where=$workspace_root
Type=ext4
Options=prjquota,nodev,nosuid,noexec
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now "$unit"
chown 10001:10001 "$workspace_root"
chmod 0700 "$workspace_root"
findmnt --target "$workspace_root" --output TARGET,SOURCE,FSTYPE,OPTIONS
# Rollback preserves this volume and data. Unmount only after worker drain;
# removal/reformatting of the LV is never part of application rollback.
