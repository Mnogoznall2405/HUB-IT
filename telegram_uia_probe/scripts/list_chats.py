import json
from pathlib import Path

st = json.loads(Path("output/state.json").read_text(encoding="utf-8"))
for c in st.get("chats", []):
    print(
        f"{c.get('chat_kind')!s:8} | {c.get('message_count'):4} | {c.get('chat_name')!r}"
    )
