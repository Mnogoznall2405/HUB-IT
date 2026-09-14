from pathlib import Path
import sys, json
from dotenv import load_dotenv
from sqlalchemy import inspect, text
root=Path(__file__).resolve().parents[2]
load_dotenv(root/'.env')
sys.path.insert(0,str(root/'WEB-itinvent'))
from backend.appdb.db import app_session
from backend.ai_sandbox.models import AppBase
with app_session() as db:
    db.execute(text('SET TRANSACTION READ ONLY'))
    inspector=inspect(db.connection())
    print('revision',db.execute(text('SELECT version_num FROM system.almbic_version'.replace('almbic','alembic'))).scalars().all())
    for table in AppBase.metadata.sorted_tables:
        if not table.name.startswith('ai_sandbox_'): continue
        columns={x['name'] for x in inspector.get_columns(table.name,schema='app')}
        indexes={x['name'] for x in inspector.get_indexes(table.name,schema='app')}
        checks=inspector.get_check_constraints(table.name,schema='app')
        print(json.dumps({'table':table.name,'rows':db.execute(text('SELECT count(*) FROM app.'+table.name)).scalar(), 'missing_columns':[c.name for c in table.columns if c.name not in columns], 'missing_indexes':[x.name for x in table.indexes if x.name not in indexes], 'checks':checks},default=str))
