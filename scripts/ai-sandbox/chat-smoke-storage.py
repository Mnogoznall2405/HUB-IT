"""Verify storage roundtrip for the diagnostic input independently of LLM access."""
from pathlib import Path
import json, sys
from dotenv import load_dotenv
from sqlalchemy import select
root = Path(__file__).resolve().parents[2]
load_dotenv(root / '.env')
sys.path.insert(0, str(root / 'WEB-itinvent'))
from backend.appdb.db import app_session
from backend.ai_sandbox.models import AppAiSandboxFile
from backend.chat.service import chat_service
from backend.api.v1.chat.attachments import _save_attachment_to_my_files
from backend.models.auth import User
from backend.services.my_files_service import my_files_service, MyFilesRequestMeta
path = root / 'artifacts/ai-sandbox/smoke-20260914.json'
state = json.loads(path.read_text())
assert state['user_id'] == 1900000914
expected = b'OpenCode deployment check: 19 + 23 = 42.\n'
if not state.get('storage_input_id'):
    with app_session() as db:
        row = db.execute(select(AppAiSandboxFile).where(
            AppAiSandboxFile.job_id == state['job_id'], AppAiSandboxFile.file_kind == 'input')).scalar_one()
        mid, aid = row.source_message_id, row.source_attachment_id
    attachment = chat_service.get_attachment_for_download(current_user_id=state['user_id'], message_id=mid, attachment_id=aid)
    assert Path(attachment['path']).read_bytes() == expected
    actor = User(id=state['user_id'], username='__opencode_smoke_20260914', is_active=False)
    saved = _save_attachment_to_my_files(attachment=attachment, current_user=actor, retention_days=1,
        meta=MyFilesRequestMeta(user_agent='OpenCode deployment check'))
    state['storage_input_id'] = saved['id']
    path.write_text(json.dumps(state))
    print('STORAGE_RESERVED', saved['status'])
else:
    grant = my_files_service.create_download_grant(file_id=state['storage_input_id'], user_id=state['user_id'])
    payload = my_files_service.consume_download_grant(token=grant['token'])
    assert Path(payload.path).read_bytes() == expected
    print('STORAGE_ROUNDTRIP_VERIFIED', len(expected))
