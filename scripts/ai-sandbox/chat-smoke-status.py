from pathlib import Path
import sys,json
from dotenv import load_dotenv
from sqlalchemy import select
root=Path(__file__).resolve().parents[2]
load_dotenv(root/'.env')
sys.path.insert(0,str(root/'WEB-itinvent'))
from backend.appdb.db import app_session
from backend.ai_sandbox.models import AppAiSandboxJob,AppAiSandboxFile,AppAiSandboxPermission
state=json.loads((root/'artifacts/ai-sandbox/smoke-20260914.json').read_text())
with app_session() as db:
    job=db.get(AppAiSandboxJob,state['job_id'])
    print('JOB',job.status,job.error_code,job.finalization_state)
    for f in db.execute(select(AppAiSandboxFile).where(AppAiSandboxFile.job_id==job.id)).scalars():
        print('FILE',f.file_kind,f.file_name,f.size_bytes,f.delivery_status)
    for p in db.execute(select(AppAiSandboxPermission).where(AppAiSandboxPermission.job_id==job.id)).scalars():
        print('PERMISSION',p.id,p.status,p.tool,p.operation)
