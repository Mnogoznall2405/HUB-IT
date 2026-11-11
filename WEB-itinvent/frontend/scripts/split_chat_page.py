from pathlib import Path

root = Path(__file__).resolve().parents[1] / "src" / "pages"
src = root / "Chat.jsx"
dst = root / "chat" / "ChatPageContent.jsx"
text = src.read_text(encoding="utf-8")
text = text.replace("export default function Chat()", "export function ChatPageContent()")
text = text.replace("from './chat/", "from './")
dst.write_text(text, encoding="utf-8")

(root / "chat" / "Chat.jsx").write_text(
    """import { ChatPageContent } from './ChatPageContent';

export default function Chat() {
  return <ChatPageContent />;
}
""",
    encoding="utf-8",
)

src.write_text(
    """export { default } from './chat/Chat';
export * from './chat/chatModel';
""",
    encoding="utf-8",
)

print(f"ChatPageContent lines: {len(text.splitlines())}")
