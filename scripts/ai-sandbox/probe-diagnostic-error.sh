set -euo pipefail
exec 2>&1
cd /
python3 - <<'PY'
from pathlib import Path
import sqlite3,json
root=Path('/var/lib/hub-ai-sandbox/workspaces/ws-8986d7749133498da06f6335ba5e048d/.hub-opencode')
for path in root.rglob('opencode.db'):
    db=sqlite3.connect('file:'+str(path)+'?mode=ro',uri=True)
    for (raw,) in db.execute('SELECT data FROM message ORDER BY time_created DESC LIMIT 4'):
        obj=json.loads(raw)
        err=obj.get('error',{})
        if err:
            data=err.get('data',{})
            print('ERROR_NAME',err.get('name'),'DATA_KEYS',list(data))
            metadata=data.get('metadata',{})
            print('METADATA_KEYS',list(metadata))
            for key in ('requestBodyValues','request_body'):
                value=data.get(key) or metadata.get(key)
                if isinstance(value,dict): print('REQUEST_KEYS',list(value))
PY
