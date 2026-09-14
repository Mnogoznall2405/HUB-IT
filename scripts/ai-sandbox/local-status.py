import sys
from pathlib import Path
from dotenv import load_dotenv
root=Path(__file__).resolve().parents[2]
load_dotenv(root/'.env')
sys.path.insert(0,str(root/'WEB-itinvent'))
from backend.appdb.db import app_session
from sqlalchemy import text
with app_session() as db:
    for row in db.execute(text("SELECT slug,is_enabled,required_permission FROM app.ai_bots WHERE slug='opencode'")):
        print(tuple(row))
    for row in db.execute(text('SELECT status,count(*) FROM app.ai_sandbox_jobs GROUP BY status')):
        print(tuple(row))
