"""Store the explicitly provided gateway key via stdin, never argv or logs."""
import getpass
from pathlib import Path
from dotenv import set_key
key=getpass.getpass('Provider key: ').strip()
if len(key)<32 or any(c.isspace() for c in key): raise SystemExit('Invalid key format')
set_key(str(Path(__file__).resolve().parents[2]/'.env'),'AI_SANDBOX_PROVIDER_API_KEY',key)
print('Sandbox provider key stored')
