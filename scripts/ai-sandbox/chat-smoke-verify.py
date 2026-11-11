"""Continue only the dedicated deployment check, never a human conversation."""
from pathlib import Path
import argparse, json, sys
from dotenv import load_dotenv
from sqlalchemy import select

root = Path(__file__).resolve().parents[2]
load_dotenv(root / '.env')
sys.path.insert(0, str(root / 'WEB-itinvent'))
from backend.appdb.db import app_session
from backend.ai_sandbox.models import AppAiSandboxJob, AppAiSandboxFile, AppAiSandboxPermission
from backend.ai_sandbox.app_service import ai_sandbox_app_service
from backend.chat.service import chat_service

parser = argparse.ArgumentParser()
parser.add_argument('--approve', action='store_true')
parser.add_argument('--save', action='store_true')
parser.add_argument('--download', action='store_true')
args = parser.parse_args()
path = root / 'artifacts/ai-sandbox/smoke-20260914.json'
state = json.loads(path.read_text())
assert state['user_id'] == 1900000914
with app_session() as db:
    job = db.get(AppAiSandboxJob, state['job_id'])
    assert job.user_id == state['user_id'] and job.conversation_id == state['conversation_id']
    print('JOB', job.status, job.finalization_state)
    permissions = list(db.execute(select(AppAiSandboxPermission).where(
        AppAiSandboxPermission.job_id == job.id, AppAiSandboxPermission.status == 'pending')).scalars())
    pending = [(p.id, p.tool, p.arguments_preview_json) for p in permissions]
    files = [(f.file_name, f.chat_message_id, f.chat_attachment_id) for f in db.execute(
        select(AppAiSandboxFile).where(AppAiSandboxFile.job_id == job.id, AppAiSandboxFile.file_kind == 'output')).scalars()]
for pid, tool, preview in pending:
    print('DIAGNOSTIC_PERMISSION', tool, preview)
    if args.approve:
        assert tool in {'edit', 'write'} and 'result.txt' in preview
        ai_sandbox_app_service.respond_permission(permission_id=pid, current_user_id=state['user_id'], decision='allow', scope='once')
        print('PERMISSION_ALLOWED_ONCE')
for name, mid, aid in files:
    if name != 'result.txt' or not mid or not aid:
        continue
    attachment = chat_service.get_attachment_for_download(current_user_id=state['user_id'], message_id=mid, attachment_id=aid)
    data = Path(attachment['path']).read_bytes()
    assert data.strip() == b'OPENCODE_FILE_OK 42'
    print('CHAT_RESULT_BYTES_VERIFIED', len(data))
    if args.save and not state.get('my_file_id'):
        from backend.api.v1.chat.attachments import _save_attachment_to_my_files
        from backend.models.auth import User
        from backend.services.my_files_service import MyFilesRequestMeta
        actor = User(id=state['user_id'], username='__opencode_smoke_20260914', is_active=False)
        saved = _save_attachment_to_my_files(attachment=attachment, current_user=actor, retention_days=1,
            meta=MyFilesRequestMeta(user_agent='OpenCode deployment check'))
        state['my_file_id'] = saved['id']
        path.write_text(json.dumps(state))
        print('MY_FILES_SAVED', saved['status'])
if args.download:
    from backend.services.my_files_service import my_files_service
    grant = my_files_service.create_download_grant(file_id=state['my_file_id'], user_id=state['user_id'])
    payload = my_files_service.consume_download_grant(token=grant['token'])
    data = Path(payload.path).read_bytes()
    assert data.strip() == b'OPENCODE_FILE_OK 42'
    print('MY_FILES_DOWNLOAD_BYTES_VERIFIED', len(data))
