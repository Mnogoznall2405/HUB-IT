"""Apply the reviewed repair through the project Alembic entrypoint."""
from pathlib import Path
import sys,os
from dotenv import load_dotenv
from sqlalchemy import text
root=Path(__file__).resolve().parents[2]
load_dotenv(root/'.env')
sys.path.insert(0,str(root/'WEB-itinvent'))
from backend.appdb.db import app_session
from backend.db_migrations import upgrade_internal_database
with app_session() as db:
    assert db.execute(text('SELECT version_num FROM system.alembic_version')).scalars().all()==['20260912_0115']
    assert db.execute(text('SELECT count(*) FROM app.ai_sandbox_jobs')).scalar()==0
os.environ['PGOPTIONS']='-c lock_timeout=5s -c statement_timeout=60s'
os.environ['SKIP_PG_SCHEMA_DOCS']='1'
upgrade_internal_database(os.environ['APP_DATABASE_URL'],'20260914_0116',scope='app')
print('MIGRATION_0116_APPLIED')
