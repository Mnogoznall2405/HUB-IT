"""Smoke: read open MAX chat, crop photo previews, print media_path."""

from __future__ import annotations

import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT)]

import win32gui
import win32process

from telegram_probe.history_reader import read_history_messages
from telegram_probe.profile import MAX
from telegram_probe.process_watch import find_main_hwnd
from telegram_probe.screen_media import attach_screen_crops
from telegram_probe.screenshot import capture_window
from telegram_probe.watcher import TelegramUiaWatcher


def main() -> int:
    import win32con

    hwnd = find_main_hwnd(MAX)
    if not hwnd:
        print("NO_MAX_WINDOW")
        return 2
    win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
    for _ in range(8):
        try:
            win32gui.SetForegroundWindow(hwnd)
        except Exception:
            pass
        time.sleep(0.12)

    hist = read_history_messages(hwnd, profile=MAX)
    print("messages", len(hist.messages))
    for m in hist.messages:
        print(
            f"  [{m.direction}] media={m.media!r} bbox={m.bbox} media_bbox={m.media_bbox} text={m.text[:50]!r}"
        )

    out = Path(r"C:\ProgramData\HUB-IT\MaxProbe")
    media_dir = out / "media"
    tmp = out / "_smoke_shots"
    tmp.mkdir(parents=True, exist_ok=True)
    _rel, png, err = capture_window(hwnd, tmp, "max_media_smoke")
    print("screenshot", err, "bytes", len(png or b""))
    dicts = [m.to_dict() for m in hist.messages]
    n = attach_screen_crops(dicts, hwnd=hwnd, png_bytes=png or b"", media_dir=media_dir)
    print("cropped", n)
    for m in dicts:
        if m.get("media_path"):
            print("  MEDIA", m.get("media_path"), m.get("media_match"), m.get("text", "")[:40])

    # Full observe path too
    w = TelegramUiaWatcher(output_dir=out, fresh=False, media_cache=False, profile=MAX)
    pid = win32process.GetWindowThreadProcessId(hwnd)[1]
    title = win32gui.GetWindowText(hwnd) or "MAX"
    w._on_activate(hwnd, pid, title)
    w._observe(hwnd, pid, title)
    w.chat_state.flush()
    for c in w.chat_state.list_chats()[:5]:
        print("chat", c.chat_name, "msgs", c.message_count)
        for row in w.chat_state.load_chat_messages(c.chat_id)[-6:]:
            if row.get("media") or row.get("media_path"):
                print(
                    "   ",
                    row.get("media"),
                    row.get("media_path"),
                    row.get("media_match"),
                    (row.get("text") or "")[:40],
                )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
