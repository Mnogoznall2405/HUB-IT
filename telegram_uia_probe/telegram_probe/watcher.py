"""Long-run observation loop: Telegram foreground → compact chat deltas."""

from __future__ import annotations

import logging
import signal
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from .chat_detector import (
    ChatGuess,
    anonymous_max_chat_name,
    detect_chat,
    detect_max_open_chat,
)
from .chat_kind import resolve_chat_kind
from .chat_state import ChatStateStore, detect_message_edits, safe_chat_id
from .compose_reader import read_compose_draft
from .disk_access import DiskAccessTracker, enrich_messages_with_source_paths
from .history_reader import read_history_messages
from .sync import (
    build_disk_file_left,
    drop_file_left_to_inbox,
    extract_outgoing_file_left,
)
from .media_cache import MediaLibrary
from .message_filter import (
    filter_messages_for_chat,
    history_looks_like_chat,
)
from .message_parser import extract_dialogue
from .models import ProbeEvent, utc_now_iso
from .process_watch import get_foreground_window, get_windows_identity
from .profile import TELEGRAM, MessengerProfile
from .report import render_html_report
from .image_match import average_hash, crop_screen_region
from .media_cache import message_wants_media
from .screen_media import attach_screen_crops
from .screenshot import capture_window, image_fingerprint, window_rect
from .storage import OutputStore
from .uia_tree import UiDump, dump_uia_tree, extract_file_names

logger = logging.getLogger(__name__)

POLL_INTERVAL_SEC = 0.5
INSPECT_INTERVAL_SEC = 1.5


class TelegramUiaWatcher:
    def __init__(
        self,
        output_dir: Path,
        poll_interval: float = POLL_INTERVAL_SEC,
        inspect_interval: float = INSPECT_INTERVAL_SEC,
        snapshot_interval: float = 5.0,  # kept for CLI compat; unused in long-run
        *,
        fresh: bool = False,
        media_cache: bool = True,
        media_passcode: str = "",
        tdata_path: Path | None = None,
        profile: MessengerProfile | None = None,
    ) -> None:
        self.profile = profile or TELEGRAM
        self.store = OutputStore(output_dir, fresh=fresh)
        self.chat_state = ChatStateStore(output_dir)
        if fresh:
            # OutputStore already archived; ensure in-memory state is empty
            self.chat_state.reset()
            self.chat_state = ChatStateStore(output_dir)
        self.poll_interval = poll_interval
        self.inspect_interval = inspect_interval
        self.snapshot_interval = snapshot_interval
        self._stop = False
        self._active = False
        self._session_id: str | None = None
        self._last_inspect_at = 0.0
        self._last_open_chat: str | None = None
        self._last_compose_text: str = ""
        self._last_surface_shot_at = 0.0
        self.disk = DiskAccessTracker(self.profile)
        self.windows_user, self.computer_name = get_windows_identity()
        self.media = MediaLibrary(
            output_dir,
            tdata=tdata_path,
            passcode=media_passcode,
            enabled=bool(media_cache and self.profile.media_cache_default),
        )

    def request_stop(self, *_args: Any) -> None:
        logger.info("Stop requested (Ctrl+C) — завершаем корректно…")
        self._stop = True

    def run(self) -> None:
        signal.signal(signal.SIGINT, self.request_stop)
        try:
            signal.signal(signal.SIGTERM, self.request_stop)
        except Exception:  # noqa: BLE001
            pass

        # Ask Windows to advertise a screen reader so Qt/Chromium expand UIA trees.
        try:
            import ctypes

            ctypes.windll.user32.SystemParametersInfoW(0x0047, 1, 0, 0)
        except Exception:  # noqa: BLE001
            pass

        logger.info(
            "Long-run %s probe started. User=%s Host=%s Output=%s chats=%d",
            self.profile.display_name,
            self.windows_user,
            self.computer_name,
            self.store.root,
            len(self.chat_state.list_chats()),
        )
        logger.info(
            "Логирование только при активном %s. "
            "Новый чат = полная видимая история один раз, далее только дельты. Ctrl+C — отчёт.",
            self.profile.display_name,
        )

        try:
            while not self._stop:
                self._tick()
                time.sleep(self.poll_interval)
        finally:
            self._finalize()

    def _tick(self) -> None:
        fg = get_foreground_window(self.profile)
        is_target = bool(fg and fg.is_target)

        if is_target and not self._active:
            assert fg is not None
            self._on_activate(fg.hwnd, fg.pid, fg.title)
            return

        if not is_target and self._active:
            self._on_deactivate(fg.title if fg else "")
            return

        if is_target and self._active:
            assert fg is not None
            # Poll disk handles every tick — file open during attach is short-lived.
            self._poll_disk_access(fg.pid, fg.title)
            now = time.monotonic()
            if (now - self._last_inspect_at) >= self.inspect_interval:
                self._observe(fg.hwnd, fg.pid, fg.title)

    def _on_activate(self, hwnd: int, pid: int, title: str) -> None:
        self._active = True
        prefix = self.profile.egress_prefix
        self._session_id = f"{prefix}_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"
        self.store.reset_session_dedup()
        self._last_inspect_at = 0.0
        logger.info(
            "%s activated pid=%s title=%r session=%s",
            self.profile.display_name,
            pid,
            title,
            self._session_id,
        )
        self.store.append_event(
            ProbeEvent(
                event_type=f"{self.profile.event_prefix}_activated",
                timestamp=utc_now_iso(),
                windows_user=self.windows_user,
                computer_name=self.computer_name,
                pid=pid,
                window_title=title or "",
                chat_name=None,
                chat_confidence=0.0,
                chat_detection_note=f"{self.profile.display_name} в фокусе",
                session_id=self._session_id,
                details={},
            )
        )
        # Immediate inspect of current chat
        self._poll_disk_access(pid, title)
        if self.profile.key == "max":
            # Always capture visible MAX surface even when HistoryListView is missing.
            self._maybe_max_surface_shot(hwnd, reason="activate")
        self._observe(hwnd, pid, title)

    def _on_deactivate(self, other_title: str) -> None:
        logger.info("%s deactivated (foreground=%r)", self.profile.display_name, other_title)
        self.chat_state.flush()
        self.store.append_event(
            ProbeEvent(
                event_type=f"{self.profile.event_prefix}_deactivated",
                timestamp=utc_now_iso(),
                windows_user=self.windows_user,
                computer_name=self.computer_name,
                pid=None,
                window_title=other_title or "",
                chat_name=None,
                chat_confidence=0.0,
                chat_detection_note=(
                    f"Фокус ушёл с {self.profile.display_name} — логирование приостановлено"
                ),
                session_id=self._session_id,
                details={"reason": "focus_lost"},
            )
        )
        self._active = False
        self._session_id = None
        self._last_open_chat = None
        self._last_compose_text = ""
        self.store.reset_session_dedup()

    def _poll_disk_access(self, pid: int | None, title: str) -> None:
        try:
            fresh = self.disk.poll(preferred_pid=pid)
        except Exception as exc:  # noqa: BLE001
            logger.debug("disk access poll failed: %s", exc)
            return
        for acc in fresh:
            self.store.append_event(
                ProbeEvent(
                    event_type="disk_file_access",
                    timestamp=utc_now_iso(),
                    windows_user=self.windows_user,
                    computer_name=self.computer_name,
                    pid=acc.pid or pid,
                    window_title=title or "",
                    chat_name=self._last_open_chat,
                    chat_confidence=0.0,
                    chat_detection_note="Файл с диска открыт процессом мессенджера",
                    file_names=[acc.file_name],
                    visible_text=[acc.path],
                    messages=[],
                    dialogue_note=f"Доступ к файлу на диске: {acc.path}",
                    session_id=self._session_id,
                    details={
                        "source_path": acc.path,
                        "file_name": acc.file_name,
                        "access_source": acc.source,
                        "process_name": acc.process_name,
                    },
                )
            )
            logger.info(
                "disk_file_access %s via=%s proc=%s",
                acc.path,
                acc.source,
                acc.process_name,
            )
            # Hub Files tab reads fs_egress file_left — local probe events alone are not enough.
            try:
                left = build_disk_file_left(
                    src_path=acc.path,
                    file_name=acc.file_name,
                    chat_name=self._last_open_chat,
                    windows_user=self.windows_user,
                    computer_name=self.computer_name,
                    channel=self.profile.channel,
                    access_source=acc.source,
                )
                if left and drop_file_left_to_inbox(
                    left, egress_prefix=self.profile.egress_prefix
                ):
                    logger.info(
                        "file_left queued for Hub src=%s chat=%s",
                        acc.path,
                        self._last_open_chat,
                    )
            except Exception as exc:  # noqa: BLE001
                logger.debug("file_left queue failed: %s", exc)

    def _observe(self, hwnd: int, pid: int, title: str) -> None:
        self._last_inspect_at = time.monotonic()
        self._poll_disk_access(pid, title)

        # Light path: history list + window title (no full UIA tree by default)
        if self.profile.key == "max":
            # Read history first so anonymous MAX chats get distinct fingerprints
            # instead of one shared "MAX (открытый чат)" bucket.
            dialogue = read_history_messages(hwnd, chat_name=None, profile=self.profile)
            hist_texts = [m.text for m in dialogue.messages if m.text]
            guess = detect_max_open_chat(hwnd, history_texts=hist_texts)
            if dialogue.messages and (not guess.chat_name or guess.confidence < 0.7):
                overlap = self.chat_state.find_chat_by_message_overlap(
                    [m.to_dict() for m in dialogue.messages],
                    min_hits=2,
                )
                if overlap is not None:
                    guess = ChatGuess(
                        overlap.chat_name,
                        0.72,
                        "Чат MAX сопоставлен по пересечению уже известных сообщений.",
                        ["message_overlap"],
                    )
                elif not guess.chat_name or guess.chat_name.startswith("MAX ·"):
                    anon = anonymous_max_chat_name(hist_texts)
                    if anon:
                        guess = ChatGuess(
                            anon,
                            0.55,
                            "Имя собеседника в UIA пустое — чат разведён по отпечатку; кто это видно на скрине.",
                            list(guess.evidence) + [f"fingerprint:{anon}"],
                        )
            if guess.chat_name:
                for msg in dialogue.messages:
                    if msg.direction == "incoming":
                        msg.sender = guess.chat_name
        else:
            guess = detect_chat(title, UiDump(), profile=self.profile)
            dialogue = read_history_messages(
                hwnd, chat_name=guess.chat_name, profile=self.profile
            )

        dump: UiDump | None = None
        if not dialogue.messages:
            # Fallback: heavy dump only when history list is empty / unavailable
            dump = dump_uia_tree(hwnd)
            if self.profile.key == "max":
                if not guess.chat_name or guess.confidence < 0.5:
                    guess = detect_max_open_chat(hwnd)
            elif not guess.chat_name or guess.confidence < 0.5:
                guess = detect_chat(title, dump, profile=self.profile)
            dialogue = extract_dialogue(dump=dump, chat_name=guess.chat_name)

        chat_name = guess.chat_name
        if not chat_name:
            if self.profile.key == "max":
                # MAX title stays "MAX"; still screenshot open messenger and keep trying.
                self._maybe_max_surface_shot(hwnd, reason="no_chat_name")
                if dialogue.messages:
                    anon = anonymous_max_chat_name([m.text for m in dialogue.messages if m.text])
                    chat_name = anon or "MAX · открытый чат"
                    guess = ChatGuess(
                        chat_name,
                        0.5,
                        "MAX без заголовка чата — используем отпечаток/placeholder.",
                        list(guess.evidence) + ["fallback_chat_name"],
                    )
                else:
                    logger.debug("No peer chat detected (title=%r) — skip", title)
                    return
            else:
                # No open peer chat (list screen) — do not log noisy snapshots
                logger.debug("No peer chat detected (title=%r) — skip", title)
                return

        raw_messages = dialogue.to_dicts()
        existing_rec = self.chat_state.get_chat(chat_name)
        chat_kind = resolve_chat_kind(
            chat_name,
            raw_messages,
            dump=dump,
            window_title=title,
            stored_kind=existing_rec.chat_kind if existing_rec else None,
        )
        messages = filter_messages_for_chat(
            chat_name, raw_messages, kind=chat_kind
        )
        is_new_chat = not self.chat_state.has_chat(chat_name)
        chat_switched = self._last_open_chat != chat_name

        # Do not mark a chat as "known" until HistoryInner actually returned messages.
        if is_new_chat and not messages:
            logger.warning(
                "New chat %r but HistoryInner empty/filtered — wait (%s)",
                chat_name,
                dialogue.note or "no note",
            )
            return

        # Guard against chat-switch lag: title already new, HistoryInner still old peer.
        # Groups/channels skip the 1:1 sender-ratio check.
        if not history_looks_like_chat(chat_name, raw_messages, kind=chat_kind):
            logger.info(
                "Skip window: HistoryInner does not match chat %r (switch lag)",
                chat_name,
            )
            return

        if is_new_chat:
            new_only = messages
        else:
            new_only = self.chat_state.diff_messages(
                chat_name, messages, tail_only=True, kind=chat_kind
            )

        edited_only: list[dict[str, Any]] = []
        if not is_new_chat:
            known_rows = self.chat_state.load_chat_messages(safe_chat_id(chat_name))
            edited_only = detect_message_edits(known_rows, messages)

        media_backfill = [
            m
            for m in messages
            if message_wants_media(m) and not m.get("media_path")
        ]

        draft = ""
        try:
            draft = read_compose_draft(hwnd, profile=self.profile)
        except Exception as exc:  # noqa: BLE001
            logger.debug("compose draft read failed: %s", exc)
        compose_changed = bool(draft) and draft != self._last_compose_text
        compose_cleared = (
            bool(self._last_compose_text) and not draft and self._last_open_chat == chat_name
        )

        if (
            not is_new_chat
            and not new_only
            and not media_backfill
            and not edited_only
            and not chat_switched
            and not compose_changed
            and not compose_cleared
        ):
            self.chat_state.get_or_create_chat(chat_name, chat_kind=chat_kind)
            self.chat_state.maybe_flush(every=20)
            return

        # For MAX photo backfill without new text deltas, still crop visible media.
        work_msgs = list(new_only) if new_only else list(media_backfill)
        if edited_only:
            work_msgs = list(work_msgs) + list(edited_only)

        files = extract_file_names(
            [m.get("text") or "" for m in work_msgs]
            + [m.get("media") or "" for m in work_msgs]
        )

        need_shot = (
            is_new_chat
            or chat_switched
            or bool(new_only)
            or bool(media_backfill)
            or bool(edited_only)
        )
        wants_visual = any(message_wants_media(m) for m in work_msgs)
        screenshot_path = None
        screenshot_hash = None
        screenshot_note = None
        png_bytes: bytes | None = None
        if need_shot or wants_visual:
            screenshot_path, screenshot_hash, screenshot_note, png_bytes = (
                self._take_screenshot(hwnd, chat_name)
            )
            if png_bytes:
                self._fill_visual_hashes(hwnd, work_msgs, png_bytes)
                if self.profile.key == "max":
                    try:
                        crop_targets = list(work_msgs)
                        # Also crop any other visible photo bubbles for backfill.
                        for msg in media_backfill:
                            if msg not in crop_targets:
                                crop_targets.append(msg)
                        cropped = attach_screen_crops(
                            crop_targets,
                            hwnd=hwnd,
                            png_bytes=png_bytes,
                            media_dir=self.store.root / "media",
                        )
                        if cropped:
                            logger.info(
                                "Screen-cropped %d MAX media in %r",
                                cropped,
                                chat_name,
                            )
                            patched = self.chat_state.patch_media_fields(
                                chat_name, crop_targets
                            )
                            if patched:
                                logger.info(
                                    "Backfilled media_path on %d stored MAX message(s)",
                                    patched,
                                )
                    except Exception as exc:  # noqa: BLE001
                        logger.warning("MAX screen media crop failed: %s", exc)

        # Compose typing log (even when no message delta).
        if compose_changed or compose_cleared:
            prev_draft = self._last_compose_text
            self._last_compose_text = draft
            self.store.append_event(
                ProbeEvent(
                    event_type="compose_draft" if draft else "compose_cleared",
                    timestamp=utc_now_iso(),
                    windows_user=self.windows_user,
                    computer_name=self.computer_name,
                    pid=pid,
                    window_title=title or "",
                    chat_name=chat_name,
                    chat_confidence=float(guess.confidence),
                    chat_detection_note=guess.note,
                    visible_text=[draft] if draft else [],
                    messages=[],
                    dialogue_note=(
                        "Черновик в поле ввода (UIA)."
                        if draft
                        else "Поле ввода очищено (отправка или отмена)."
                    ),
                    screenshot_path=None,
                    session_id=self._session_id,
                    details={
                        "chat_kind": chat_kind,
                        "compose_text": draft,
                        "compose_previous": prev_draft,
                        "compose_via": "uia",
                    },
                )
            )
            logger.info(
                "compose chat=%r chars=%d",
                chat_name,
                len(draft),
            )

        # Chat just opened/switched: screenshot + event even without new messages.
        if chat_switched and not is_new_chat and not new_only and not edited_only:
            self._last_open_chat = chat_name
            self.chat_state.append_messages(
                chat_name,
                [],
                screenshot_path=screenshot_path,
                already_diffed=True,
                kind=chat_kind,
            )
            self.store.append_event(
                ProbeEvent(
                    event_type="chat_opened",
                    timestamp=utc_now_iso(),
                    windows_user=self.windows_user,
                    computer_name=self.computer_name,
                    pid=pid,
                    window_title=title or "",
                    chat_name=chat_name,
                    chat_confidence=float(guess.confidence),
                    chat_detection_note=guess.note,
                    file_names=[],
                    visible_text=[draft] if draft else [],
                    messages=[],
                    dialogue_note=(
                        f"Чат открыт/переключён — скрин сразу. {dialogue.note}"
                    ),
                    screenshot_path=screenshot_path,
                    session_id=self._session_id,
                    details={
                        "chat_evidence": guess.evidence,
                        "chat_kind": chat_kind,
                        "screenshot_note": screenshot_note,
                        "is_new_chat": False,
                        "chat_switched": True,
                        "compose_text": draft,
                        "total_known": (
                            self.chat_state.get_chat(chat_name).message_count
                            if self.chat_state.get_chat(chat_name)
                            else 0
                        ),
                    },
                )
            )
            self.chat_state.flush()
            logger.info(
                "chat_opened(switch) chat=%r shot=%s",
                chat_name,
                bool(screenshot_path),
            )
            return

        if not is_new_chat and not new_only and not edited_only:
            # Media backfill / compose-only — no new dialogue event.
            self._last_open_chat = chat_name
            self.chat_state.get_or_create_chat(chat_name, chat_kind=chat_kind)
            self.chat_state.flush()
            return

        # Attach decrypted media-cache files (photos/videos) before persist.
        # Telegram only; MAX uses on-screen crops above.
        if self.profile.key != "max":
            try:
                linked = self.media.attach_to_messages(new_only, sync=True)
                if linked:
                    logger.info("Attached media to %d message(s) in %r", linked, chat_name)
            except Exception as exc:  # noqa: BLE001
                logger.warning("media attach failed: %s", exc)

        ui_tree_path = None
        if is_new_chat and dump is not None and (dump.error or not messages):
            stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
            try:
                payload = dump.to_serializable() or [
                    {
                        "error": dump.error or "empty",
                        "backend": dump.backend,
                    }
                ]
                ui_tree_path = self.store.save_ui_tree(
                    self._session_id or "nosession",
                    stamp,
                    payload,
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("save ui tree failed: %s", exc)

        kind_label = {
            "group": "группа",
            "channel": "канал",
            "private": "личный",
            "unknown": "чат",
        }.get(chat_kind, chat_kind)

        to_store = list(new_only) + list(edited_only)
        try:
            linked_src = enrich_messages_with_source_paths(to_store, self.disk)
            if linked_src:
                logger.info(
                    "bound source_path on %d outgoing file message(s) in %r",
                    linked_src,
                    chat_name,
                )
        except Exception as exc:  # noqa: BLE001
            logger.debug("source_path enrich failed: %s", exc)

        # Immediate Hub file_left (do not wait for 15‑min sync). Covers drag-drop
        # when open_files missed the path but basename resolves under Desktop/Downloads.
        try:
            left_events = extract_outgoing_file_left(
                to_store,
                chat_name=chat_name,
                windows_user=self.windows_user,
                computer_name=self.computer_name,
                channel=self.profile.channel,
            )
            queued = 0
            for left in left_events:
                if drop_file_left_to_inbox(
                    left, egress_prefix=self.profile.egress_prefix
                ):
                    queued += 1
            if queued:
                logger.info(
                    "file_left queued %d outgoing file(s) for Hub chat=%r",
                    queued,
                    chat_name,
                )
        except Exception as exc:  # noqa: BLE001
            logger.debug("outgoing file_left queue failed: %s", exc)

        if is_new_chat:
            stored = self.chat_state.append_messages(
                chat_name,
                to_store,
                screenshot_path=screenshot_path,
                already_diffed=True,
                kind=chat_kind,
            )
            event_type = "chat_opened"
            event_messages = stored or to_store
            note = (
                f"Новый {kind_label}: сохранена видимая история HistoryInner "
                f"({len(event_messages)} сообщ.). {dialogue.note}"
            )
        elif edited_only and not new_only:
            stored = self.chat_state.append_messages(
                chat_name,
                edited_only,
                screenshot_path=screenshot_path,
                already_diffed=True,
                kind=chat_kind,
            )
            event_type = "message_edited"
            event_messages = stored
            note = (
                f"Редактирование ({kind_label}): +{len(event_messages)} версий "
                f"(старый текст сохранён в previous_text). {dialogue.note}"
            )
        else:
            stored = self.chat_state.append_messages(
                chat_name,
                to_store,
                screenshot_path=screenshot_path,
                already_diffed=True,
                kind=chat_kind,
            )
            event_type = "messages_delta"
            event_messages = stored
            note = (
                f"Дельта хвоста ({kind_label}): +{len(event_messages)} новых сообщ. "
                f"(прокрутка вверх и чужие чаты игнорируются). {dialogue.note}"
            )
            if edited_only:
                note += f" В т.ч. правок: {len(edited_only)}."

        self._last_open_chat = chat_name
        event = ProbeEvent(
            event_type=event_type,
            timestamp=utc_now_iso(),
            windows_user=self.windows_user,
            computer_name=self.computer_name,
            pid=pid,
            window_title=title or "",
            chat_name=chat_name,
            chat_confidence=float(guess.confidence),
            chat_detection_note=guess.note,
            file_names=files if is_new_chat else extract_file_names(
                [m.get("text") or "" for m in event_messages]
                + [m.get("media") or "" for m in event_messages]
            ),
            visible_text=[draft] if draft else [],
            messages=event_messages,
            dialogue_note=note,
            screenshot_path=screenshot_path,
            ui_tree_path=ui_tree_path,
            session_id=self._session_id,
            details={
                "chat_evidence": guess.evidence,
                "chat_kind": chat_kind,
                "screenshot_note": screenshot_note,
                "messages_count": len(event_messages),
                "is_new_chat": is_new_chat,
                "chat_switched": chat_switched,
                "edited_count": len(edited_only),
                "compose_text": draft,
                "total_known": (self.chat_state.get_chat(chat_name).message_count
                                if self.chat_state.get_chat(chat_name) else 0),
            },
        )
        self.store.append_event(event)
        self.chat_state.flush()
        logger.info(
            "%s chat=%r kind=%s conf=%.2f wrote=%d total=%s shot=%s edits=%d",
            event_type,
            chat_name,
            chat_kind,
            guess.confidence,
            len(event_messages),
            event.details.get("total_known"),
            bool(screenshot_path),
            len(edited_only),
        )

    def _fill_visual_hashes(
        self,
        hwnd: int,
        messages: list[dict[str, Any]],
        png_bytes: bytes,
    ) -> None:
        win = window_rect(hwnd)
        if not win:
            return
        for msg in messages:
            if not message_wants_media(msg) and not msg.get("media_path"):
                continue
            bbox = msg.get("media_bbox") or msg.get("bbox")
            if not bbox or len(bbox) != 4:
                continue
            try:
                item_rect = (
                    int(bbox[0]),
                    int(bbox[1]),
                    int(bbox[2]),
                    int(bbox[3]),
                )
            except (TypeError, ValueError):
                continue
            crop = crop_screen_region(png_bytes, win, item_rect)
            if crop is None:
                continue
            try:
                msg["visual_ahash"] = average_hash(crop)
            except Exception:  # noqa: BLE001
                continue

    def _maybe_max_surface_shot(self, hwnd: int, *, reason: str) -> None:
        """Throttled screenshot of the MAX window without forcing restore/focus."""
        now = time.monotonic()
        if (now - self._last_surface_shot_at) < 8.0:
            return
        rel, shot_hash, err, _png = self._take_screenshot(hwnd, f"surface_{reason}")
        self._last_surface_shot_at = now
        if rel:
            logger.info("MAX surface screenshot (%s) shot=%s", reason, rel)
            self.store.append_event(
                ProbeEvent(
                    event_type="surface_snapshot",
                    timestamp=utc_now_iso(),
                    windows_user=self.windows_user,
                    computer_name=self.computer_name,
                    pid=None,
                    window_title="MAX",
                    chat_name=self._last_open_chat or "MAX",
                    chat_confidence=0.3,
                    chat_detection_note=f"surface_shot:{reason}",
                    session_id=self._session_id,
                    screenshot_path=rel,
                    screenshot_hash=shot_hash,
                    details={"surface_shot": True, "reason": reason, "screenshot_note": err},
                )
            )
        else:
            logger.debug("MAX surface screenshot skipped (%s): %s", reason, err)

    def _take_screenshot(
        self, hwnd: int, chat_name: str
    ) -> tuple[str | None, str | None, str | None, bytes | None]:
        prefix = f"{self._session_id or 'tg'}_{chat_name[:40]}"
        safe_prefix = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in prefix)[:80]
        rel, png_bytes, err = capture_window(hwnd, self.store.screenshots_dir, safe_prefix)
        if not png_bytes:
            return None, None, err, None
        shot_hash = image_fingerprint(png_bytes)
        if self.store.is_duplicate_screenshot(shot_hash):
            # Keep bytes for visual matching even if we skip saving a duplicate PNG.
            try:
                if rel:
                    (self.store.root / rel).unlink(missing_ok=True)
            except Exception:  # noqa: BLE001
                pass
            return None, shot_hash, (err or "") + "; duplicate_screenshot_skipped", png_bytes
        self.store.mark_screenshot(shot_hash)
        return rel, shot_hash, err, png_bytes

    def _finalize(self) -> None:
        if self._active:
            self._on_deactivate("probe_stopped")
        self.chat_state.flush()
        events = self.store.load_events()
        try:
            render_html_report(
                events,
                self.store.report_path,
                meta={
                    "windows_user": self.windows_user,
                    "computer_name": self.computer_name,
                    "generated_at": utc_now_iso(),
                },
                chat_state=self.chat_state,
            )
            logger.info("Отчёт: %s", self.store.report_path)
            logger.info("События: %s", self.store.events_path)
            logger.info("Чаты: %s (%d)", self.store.chats_dir, len(self.chat_state.list_chats()))
            logger.info("Снимки: %s", self.store.screenshots_dir)
            logger.info("Медиа: %s", self.store.media_dir)
        except Exception as exc:  # noqa: BLE001
            logger.exception("Не удалось сформировать HTML-отчёт: %s", exc)
