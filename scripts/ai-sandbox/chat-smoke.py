"""Explicit rollout smoke in a dedicated bot-only diagnostic conversation."""
from pathlib import Path
import sys,json,io
from uuid import uuid4
from dotenv import load_dotenv
from sqlalchemy import select
from fastapi import UploadFile
from starlette.datastructures import Headers
root=Path(__file__).resolve().parents[2]
load_dotenv(root/'.env')
sys.path.insert(0,str(root/'WEB-itinvent'))
from backend.appdb.db import app_session
from backend.appdb.models import AppUser,AppAiBot
from backend.ai_chat.service import ai_chat_service
from backend.ai_sandbox.app_service import ai_sandbox_app_service
from backend.chat.service import chat_service
uid=1900000914
state=root/'artifacts/ai-sandbox/smoke-20260914.json'
if state.exists(): raise RuntimeError('Smoke already created; inspect its state')
with app_session() as db:
    row=db.get(AppUser,uid)
    if row is None:
        db.add(AppUser(id=uid,username='__opencode_smoke_20260914',full_name='OpenCode deployment check',
            auth_source='bot',is_active=False,role='viewer',use_custom_permissions=True,
            custom_permissions_json=json.dumps(['chat.read','chat.write','chat.ai.use','chat.ai.sandbox'])))
    else: assert row.username=='__opencode_smoke_20260914'
    bot=db.execute(select(AppAiBot).where(AppAiBot.slug=='opencode')).scalar_one()
    bot_id=bot.id
conversation=ai_chat_service.create_bot_conversation(bot_id=bot_id,current_user_id=uid)
cid=conversation['id']
state.parent.mkdir(parents=True,exist_ok=True)
state.write_text(json.dumps({'user_id':uid,'conversation_id':cid}),encoding='utf-8')
upload=UploadFile(file=io.BytesIO(b'OpenCode deployment check: 19 + 23 = 42.\n'),filename='opencode-check.txt',headers=Headers({'content-type':'text/plain'}))
message=chat_service.send_files(current_user_id=uid,conversation_id=cid,body='Read opencode-check.txt. Create result.txt containing exactly OPENCODE_FILE_OK 42 and reply with that same text. Do not use bash or network.',uploads=[upload],client_message_id=str(uuid4()),defer_push_notifications=True)
job=ai_sandbox_app_service.enqueue_message(conversation_id=cid,trigger_message_id=message['id'],current_user_id=uid)
state.write_text(json.dumps({'user_id':uid,'conversation_id':cid,'message_id':message['id'],'job_id':job['id']}),encoding='utf-8')
print('SMOKE_QUEUED',job['id'])
