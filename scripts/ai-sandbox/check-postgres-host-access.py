"""Read-only SSH check on the PostgreSQL host, without printing credentials."""
from pathlib import Path
import argparse
import paramiko
from dotenv import dotenv_values
from sqlalchemy.engine import make_url

values = dotenv_values(Path(__file__).resolve().parents[2] / '.env')
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--credential', required=True, choices=('user', 'root', 'root-alt'))
args = parser.parse_args()
user_key, password_key = {
    'user': ('AI_SANDBOX_SSH_USER', 'AI_SANDBOX_SSH_USER_PASSWORD'),
    'root': ('AI_SANDBOX_SSH_ROOT_USER', 'AI_SANDBOX_SSH_PASSWORD'),
    'root-alt': ('AI_SANDBOX_SSH_ROOT_USER', 'AI_SANDBOX_SSH_PASSWORD_ALT'),
}[args.credential]
host = make_url(values['APP_DATABASE_URL']).host
assert host == '10.103.0.10'
client = paramiko.SSHClient()
client.load_system_host_keys()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
try:
    client.connect(host, username=values[user_key],
                   password=values[password_key],
                   timeout=10, auth_timeout=10, allow_agent=False, look_for_keys=False)
    _, stdout, _ = client.exec_command('hostname; id -u', timeout=10)
    print('POSTGRES_SSH_CONNECTED', stdout.read().decode().strip())
except Exception as exc:
    print('POSTGRES_SSH_CHECK', type(exc).__name__)
finally:
    client.close()
