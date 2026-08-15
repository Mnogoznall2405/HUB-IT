from __future__ import annotations

import re
import shlex
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Mapping

from .contracts import PermissionDisposition, PermissionGrantScope, PermissionRequest


READ_ONLY_TOOLS = frozenset({"read", "glob", "grep", "list", "lsp"})
CONFIRMATION_TOOLS = frozenset({"edit", "bash"})
DENIED_TOOLS = frozenset(
    {
        "external_directory",
        "web",
        "webfetch",
        "websearch",
        "codesearch",
        "package_install",
        "git_external",
    }
)

_PACKAGE_COMMANDS = frozenset(
    {
        "pip",
        "pip3",
        "uv",
        "poetry",
        "conda",
        "mamba",
        "npm",
        "npx",
        "pnpm",
        "yarn",
        "bun",
        "apt",
        "apt-get",
        "apk",
        "dnf",
        "yum",
        "pacman",
    }
)
_NETWORK_COMMANDS = frozenset(
    {"curl", "wget", "nc", "ncat", "netcat", "ssh", "scp", "sftp", "ftp", "telnet", "socat"}
)
_DENIED_GIT_SUBCOMMANDS = frozenset(
    {"clone", "fetch", "pull", "push", "remote", "submodule", "ls-remote", "archive"}
)
_SHELL_OPERATOR_RE = re.compile(r"(?:&&|\|\||[|;<>`]|\$\(|\n|\r)")
_SENSITIVE_SYSTEM_PATH_RE = re.compile(
    r"(?:^|[\s'\"])(?:/proc|/sys|/dev|/etc|/run|/var/run)(?:/|[\s'\"]|$)",
    re.IGNORECASE,
)
_ENV_READ_RE = re.compile(
    r"(?:^|\s)(?:env|printenv|set)(?:\s|$)|os\.environ|getenv\s*\(|/proc/(?:self|\d+)/environ",
    re.IGNORECASE,
)
_PYTHON_PIP_RE = re.compile(r"(?:python(?:3(?:\.12)?)?|py)\s+-m\s+pip(?:\s|$)", re.IGNORECASE)
_SYMLINK_RE = re.compile(r"(?:^|\s)ln\s+(?:-[^\s]*s[^\s]*\s|--symbolic\s)|os\.symlink", re.IGNORECASE)
_PATH_ARGUMENT_KEYS = frozenset({"path", "file", "file_path", "filepath", "directory", "cwd", "root"})
_RESERVED_CONFIG_PATHS = frozenset({".opencode", "opencode.json", "opencode.jsonc"})


class SandboxPermissionError(ValueError):
    """Raised when a client attempts an unsupported permission escalation."""


@dataclass(frozen=True)
class PermissionDecision:
    disposition: PermissionDisposition
    reason: str
    may_remember_for_session: bool = False


class OpenCodePermissionPolicy:
    """Canonical HUB policy applied in addition to OpenCode's own rules.

    The OpenCode config is defence in depth. HUB still evaluates every
    permission request, because a model-provided command must never be treated
    as trusted input.
    """

    def disposition_for_tool(self, tool: str) -> PermissionDisposition:
        normalized = str(tool or "").strip().lower()
        if normalized in READ_ONLY_TOOLS:
            return PermissionDisposition.ALLOW
        if normalized in CONFIRMATION_TOOLS:
            return PermissionDisposition.ASK
        return PermissionDisposition.DENY

    def evaluate_request(self, request: PermissionRequest) -> PermissionDecision:
        disposition = self.disposition_for_tool(request.tool)
        if disposition is PermissionDisposition.DENY:
            return PermissionDecision(disposition, "Инструмент запрещён политикой HUB")
        path_reason = self.denied_path_reason(request.arguments_preview)
        if path_reason:
            return PermissionDecision(PermissionDisposition.DENY, path_reason)
        if disposition is PermissionDisposition.ALLOW:
            return PermissionDecision(disposition, "Чтение разрешено только внутри workspace")

        if request.tool.strip().lower() == "bash":
            command = str(request.arguments_preview.get("command") or "")
            denied_reason = self.denied_bash_reason(command)
            if denied_reason:
                return PermissionDecision(PermissionDisposition.DENY, denied_reason)

        return PermissionDecision(
            PermissionDisposition.ASK,
            "Требуется явное подтверждение пользователя",
            may_remember_for_session=True,
        )

    def denied_path_reason(self, arguments: Mapping[str, object]) -> str | None:
        for key, raw_value in arguments.items():
            if str(key).strip().lower() not in _PATH_ARGUMENT_KEYS or raw_value is None:
                continue
            value = str(raw_value).strip().replace("\\", "/")
            if not value:
                continue
            path = PurePosixPath(value)
            if path.is_absolute() or re.match(r"^[a-zA-Z]:/", value):
                return "Разрешены только относительные пути внутри workspace"
            if any(part in {"", ".", ".."} for part in path.parts):
                return "Выход за пределы workspace запрещён"
            if path.parts and path.parts[0].lower() in _RESERVED_CONFIG_PATHS:
                return "Конфигурация OpenCode доступна только для чтения"
        return None

    def validate_grant_scope(self, scope: PermissionGrantScope | str) -> PermissionGrantScope:
        if isinstance(scope, PermissionGrantScope):
            return scope
        try:
            normalized = PermissionGrantScope(str(scope))
        except ValueError as exc:
            raise SandboxPermissionError("Permission may only be granted once or for this session") from exc
        return normalized

    def denied_bash_reason(self, command: str) -> str | None:
        value = str(command or "").strip()
        if not value:
            return "Пустая команда запрещена"
        if len(value) > 8_192:
            return "Команда превышает допустимый размер"
        if _SHELL_OPERATOR_RE.search(value):
            return "Составные shell-команды и перенаправления запрещены"
        if _SENSITIVE_SYSTEM_PATH_RE.search(value) or _ENV_READ_RE.search(value):
            return "Доступ к системным путям и окружению запрещён"
        if _PYTHON_PIP_RE.search(value):
            return "Установка пакетов запрещена"
        if _SYMLINK_RE.search(value):
            return "Создание ссылок в workspace запрещено"

        try:
            argv = shlex.split(value, posix=True)
        except ValueError:
            return "Команда не прошла безопасный разбор"
        if not argv:
            return "Пустая команда запрещена"

        executable = argv[0].rsplit("/", 1)[-1].lower()
        if executable in _PACKAGE_COMMANDS:
            return "Менеджеры пакетов запрещены"
        if executable in _NETWORK_COMMANDS:
            return "Произвольный сетевой доступ запрещён"
        if executable == "git" and len(argv) > 1 and argv[1].lower() in _DENIED_GIT_SUBCOMMANDS:
            return "Внешние Git-операции запрещены"
        if any(part == ".." or part.startswith("../") or "/../" in part for part in argv):
            return "Выход за пределы workspace запрещён"
        return None

    def opencode_config(self) -> Mapping[str, object]:
        """Return OpenCode's defence-in-depth permission configuration."""

        bash_rules: dict[str, str] = {
            "*": "ask",
            "pip *": "deny",
            "pip3 *": "deny",
            "python -m pip *": "deny",
            "python3 -m pip *": "deny",
            "uv *": "deny",
            "poetry *": "deny",
            "npm install *": "deny",
            "npm add *": "deny",
            "npx *": "deny",
            "pnpm *": "deny",
            "yarn *": "deny",
            "bun install *": "deny",
            "apt *": "deny",
            "apt-get *": "deny",
            "apk *": "deny",
            "dnf *": "deny",
            "yum *": "deny",
            "git clone *": "deny",
            "git fetch *": "deny",
            "git pull *": "deny",
            "git push *": "deny",
            "git remote *": "deny",
            "git submodule *": "deny",
            "curl *": "deny",
            "wget *": "deny",
            "ssh *": "deny",
            "scp *": "deny",
        }
        return {
            "$schema": "https://opencode.ai/config.json",
            "permission": {
                "read": "allow",
                "glob": "allow",
                "grep": "allow",
                "list": "allow",
                "lsp": "allow",
                "edit": "ask",
                "bash": bash_rules,
                "external_directory": "deny",
                "webfetch": "deny",
                "websearch": "deny",
            },
            "share": "disabled",
            "autoupdate": False,
        }
