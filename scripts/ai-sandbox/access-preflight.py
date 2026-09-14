"""Read-only preparation for the per-agent access migration; never prints credentials."""
import json
import sys
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

root = Path(__file__).resolve().parents[2]
load_dotenv(root / '.env')
sys.path.insert(0, str(root / 'WEB-itinvent'))
from backend.config import config


def main():
    engine = create_engine(config.app_db.database_url, connect_args={'connect_timeout': 8})
    try:
        with engine.connect() as db, db.begin():
            db.execute(text('SET TRANSACTION READ ONLY'))
            db.execute(text("SET LOCAL statement_timeout = '8s'"))
            result = {
                'revision': list(db.execute(text('SELECT version_num FROM system.alembic_version')).scalars()),
                'access_table_present': db.execute(text("SELECT to_regclass('app.ai_bot_access') IS NOT NULL")).scalar(),
                'regular_jobs': dict(db.execute(text("SELECT status, count(*) FROM app.ai_bot_runs WHERE status IN ('queued','running') GROUP BY status")).all()),
                'sandbox_jobs': dict(db.execute(text("SELECT status, count(*) FROM app.ai_sandbox_jobs WHERE status IN ('preparing','queued','claimed','running','waiting_permission','finalizing','cleanup_pending') GROUP BY status")).all()),
                'active_admins': db.execute(text("SELECT count(*) FROM app.users WHERE is_active AND role = 'admin'")).scalar(),
            }
            print(json.dumps(result))
    finally:
        engine.dispose()


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        # SQLAlchemy exceptions can include connection details; report the class only.
        print(json.dumps({'error_type': type(exc).__name__}))
        raise SystemExit(1) from None
