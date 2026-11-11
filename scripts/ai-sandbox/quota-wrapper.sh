#!/bin/sh
# Root-owned mode 0755. Only this fixed root helper is permitted in sudoers.
exec /usr/bin/sudo -n /usr/local/libexec/hub-ai-sandbox-quota-root "$@"
