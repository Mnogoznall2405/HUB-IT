from pathlib import Path
import sys,json,io
from uuid import uuid4
from dotenv import load_dotenv
from fastapi import UploadFile
from starlette.datastructures import Headers
root=Path(__file__).resolve().parents[2]
load_dotenv(root/'.env')
sys.path.insert(0,str(root/'WEB-itinvent'))
from backend.ai_sandbox.app_service import ai_sandbox_app_service
from backend.chat.service import chat_service
path=root/'artifacts/ai-sandbox/smoke-20260914.json'
state=json.loads(path.read_text())
upload=UploadFile(file=io.BytesIO(b'OpenCode deployment check: 19 + 23 = 42.\n'),filename='opencode-check.txt',headers=Headers({'content-type':'text/plain'}))
message=chat_service.send_files(current_user_id=state['user_id'],conversation_id=state['conversation_id'],body='Read opencode-check.txt. Create result.txt containing exactly OPENCODE_FILE_OK 42 and reply with that same text. Do not use bash or network.',uploads=[upload],client_message_id=str(uuid4()),defer_push_notifications=True)
job=ai_sandbox_app_service.enqueue_message(conversation_id=state['conversation_id'],trigger_message_id=message['id'],current_user_id=state['user_id'])
state.update(job_id=job['id'],message_id=message['id'])
path.write_text(json.dumps(state))
print('SMOKE_QUEUED',job['id'])
