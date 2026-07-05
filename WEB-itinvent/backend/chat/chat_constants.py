"""Chat domain constants shared across backend modules."""
from __future__ import annotations

import re
from datetime import timedelta

CHAT_DELETED_MESSAGE_BODY = "Сообщение удалено"
CHAT_GROUP_ROLES = {"owner", "moderator", "member"}
CHAT_GROUP_MANAGER_ROLES = {"owner", "moderator"}
NOTES_CONVERSATION_TITLE = "Заметки"

CHAT_UPLOAD_STREAM_CHUNK_BYTES = 1024 * 1024
CHAT_IMAGE_DIMENSION_PROBE_BYTES = 2 * 1024 * 1024
CHAT_UPLOAD_SESSION_CHUNK_BYTES = 2 * 1024 * 1024
CHAT_UPLOAD_SESSION_TTL_DEFAULT = 2 * 60 * 60
CHAT_UPLOAD_SESSION_CLEANUP_INTERVAL_DEFAULT = 10 * 60
CHAT_ATTACHMENT_VARIANT_MAX_DIMENSIONS = {
    "thumb": 320,
    "preview": 1280,
}
CHAT_MENTION_PATTERN = re.compile(r"(?<![\w@])@([0-9A-Za-zА-Яа-яЁё_.-]{1,64})", re.UNICODE)

CHAT_MAX_FILES_PER_MESSAGE = 5
CHAT_MAX_TOTAL_FILE_BYTES = 1024 * 1024 * 1024
CHAT_MAX_MESSAGE_BODY_LENGTH = 12000
CHAT_ALLOWED_TRANSFER_ENCODINGS = {"identity", "gzip"}
CHAT_ARCHIVE_EXTENSIONS = {
    ".zip", ".rar", ".7z", ".tar", ".gz",
}
CHAT_ARCHIVE_MIME_TYPES = {
    "application/zip",
    "application/x-zip-compressed",
    "application/x-rar-compressed",
    "application/vnd.rar",
    "application/x-7z-compressed",
    "application/gzip",
    "application/x-gzip",
    "application/x-tar",
}
CHAT_ALLOWED_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp",
    ".mp4", ".mov", ".webm", ".m4v",
    ".ogg", ".mp3", ".wav", ".aac", ".m4a", ".opus", ".flac",
    ".pdf",
    ".doc", ".docx", ".docm", ".rtf", ".odt",
    ".xls", ".xlsx", ".xlsm", ".ods",
    ".ppt", ".pptx", ".pptm", ".odp",
    ".txt", ".csv", ".tsv", ".log", ".md", ".json", ".xml",
}
CHAT_ALLOWED_MIME_PREFIXES = ("image/", "video/", "audio/")
CHAT_ALLOWED_MIME_TYPES = {
    "application/pdf",
    "application/msword",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-word.document.macroenabled.12",
    "application/vnd.ms-excel.sheet.macroenabled.12",
    "application/vnd.ms-powerpoint.presentation.macroenabled.12",
    "application/vnd.oasis.opendocument.text",
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.oasis.opendocument.presentation",
    "application/rtf",
    "text/plain",
    "text/csv",
    "text/tab-separated-values",
    "text/rtf",
    "text/markdown",
    "application/json",
    "application/xml",
    "text/xml",
}
CHAT_PRESENCE_ONLINE_WINDOW = timedelta(minutes=2)
