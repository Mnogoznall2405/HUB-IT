"""Run an explicitly authorized rollout script over SSH without logging secrets."""
import argparse
import shlex
import sys
from pathlib import Path

import paramiko
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--script', type=Path, required=True)
    parser.add_argument('--upload', type=Path, action='append', default=[])
    args = parser.parse_args()
    values = dotenv_values(ROOT / '.env')
    secrets = [v for k, v in values.items() if v and len(v) >= 8 and any(x in k for x in ('PASSWORD', 'TOKEN', 'KEY', 'DATABASE_URL'))]
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(values['AI_SANDBOX_SSH_HOST'], username=values['AI_SANDBOX_SSH_USER'],
                   password=values['AI_SANDBOX_SSH_USER_PASSWORD'], timeout=20, allow_agent=False, look_for_keys=False)
    try:
        if args.upload:
            sftp = client.open_sftp()
            stage = '/home/' + values['AI_SANDBOX_SSH_USER'] + '/hub-ai-rollout'
            try:
                sftp.mkdir(stage, mode=0o700)
            except IOError:
                pass
            for path in args.upload:
                target = stage + '/' + path.name
                sftp.put(str(path), target)
                sftp.chmod(target, 0o600)
            sftp.close()
        script = args.script.read_text(encoding='utf-8').replace('\r\n', '\n')
        stdin, stdout, stderr = client.exec_command('sudo -S -p "" bash -c ' + shlex.quote(script), timeout=1800)
        stdin.write(values['AI_SANDBOX_SSH_USER_PASSWORD'] + '\n')
        stdin.flush()
        # Merge streams at the remote shell; no PTY/password echo.
        for line in stdout:
            for secret in secrets:
                line = line.replace(secret, '<redacted>')
            print(line, end='', flush=True)
        error = stderr.read().decode('utf-8', 'replace')
        for secret in secrets:
            error = error.replace(secret, '<redacted>')
        if error:
            print(error, end='', flush=True)
        return stdout.channel.recv_exit_status()
    finally:
        client.close()


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    raise SystemExit(main())
