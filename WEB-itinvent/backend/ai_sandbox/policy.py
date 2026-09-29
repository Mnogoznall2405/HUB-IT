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
def _has_unquoted_shell_operator(text: str) -> bool:
    """Detect shell composition outside single/double quotes.

    A plain regex flags `;` or `<` even inside `"python3 -c ..."` strings,
    which would deny ordinary Python one-liners. Track quoting instead:
    only unquoted operators split or redirect in shell.
    """
    in_single = False
    in_double = False
    escaped = False
    index = 0
    length = len(text)
    while index < length:
        char = text[index]
        if escaped:
            escaped = False
            index += 1
            continue
        if char == "\\" and not in_single:
            escaped = True
            index += 1
            continue
        if char == "'" and not in_double:
            in_single = not in_single
            index += 1
            continue
        if char == '"' and not in_single:
            in_double = not in_double
            index += 1
            continue
        if not in_single and not in_double:
            if text.startswith("&&", index) or text.startswith("||", index) or text.startswith("$(", index):
                return True
            if char in "|;<>`" or char in "\n\r":
                return True
        index += 1
    return False
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
_TRAVERSAL_RE = re.compile(r"(?:^|[\s'\"(/])\.\.(?:/|$|['\")\s])")
_PATH_ARGUMENT_KEYS = frozenset({"path", "file", "file_path", "filepath", "directory", "cwd", "root"})
_RESERVED_CONFIG_PATHS = frozenset({".opencode", "opencode.json", "opencode.jsonc"})
# Bare interpreters that may run without per-command confirmation. The sandbox
# container itself stays isolated (internal-only network, read-only root,
# workspace-only writes, short-lived scoped tokens), so this trades per-action
# oversight for usability without widening the containment boundary.
_PYTHON_EXECUTABLES = frozenset({"python", "python3", "python3.12", "py"})
# Read-only and workspace-local coreutils without exec/eval capability.
# Anything destructive (rm), privileged (chmod/chown/sudo), networked or
# scriptable (sed/awk with system()) still asks or is denied. Redirections
# and composition are rejected separately for every command.
_SAFE_BASH_COMMANDS = frozenset(
    {
        "ls", "cat", "head", "tail", "wc", "pwd", "mkdir", "touch",
        "cp", "mv", "echo", "printf", "sort", "uniq", "diff", "file",
        "stat", "du", "df", "uname", "whoami", "date", "grep",
    }
)
# Quoted heredocs only: an unquoted marker would let the shell expand $vars,
# $(...) and backticks inside the body before Python sees it.
_PYTHON_HEREDOC_RE = re.compile(
    r"^(?:python(?:3(?:\.12)?)?|py)\s+<<-?\s*['\"]([A-Za-z_][A-Za-z0-9_]*)['\"]\s*\n(.*)\n\1\s*$",
    re.IGNORECASE | re.DOTALL,
)


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
        if request.tool.strip().lower() == "edit":
            # Path guards above already rejected traversal, absolute paths and
            # reserved OpenCode configs. Python execution already permits the
            # same workspace writes, so confirming every edit adds no safety —
            # oversight happens when results are delivered to the chat.
            return PermissionDecision(
                PermissionDisposition.ALLOW,
                "Запись в workspace разрешена политикой",
            )

        if request.tool.strip().lower() == "bash":
            command = str(request.arguments_preview.get("command") or "")
            heredoc_body = self.python_heredoc_body(command)
            if heredoc_body is not None:
                body_denied = self.denied_python_body_reason(heredoc_body)
                if body_denied:
                    return PermissionDecision(PermissionDisposition.DENY, body_denied)
                return PermissionDecision(
                    PermissionDisposition.ALLOW,
                    "Python heredoc в workspace разрешён политикой",
                )
            denied_reason = self.denied_bash_reason(command)
            if denied_reason:
                return PermissionDecision(PermissionDisposition.DENY, denied_reason)
            if self.is_python_execution(command):
                return PermissionDecision(
                    PermissionDisposition.ALLOW,
                    "Запуск Python в workspace разрешён политикой",
                )
            if self.is_safe_bash_command(command):
                return PermissionDecision(
                    PermissionDisposition.ALLOW,
                    "Безопасная команда workspace разрешена политикой",
                )

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

    def is_python_execution(self, command: str) -> bool:
        """Detect a bare interpreter invocation for confirmation-free runs.

        Runs only after every deny check, so pip installs, env reads, symlink
        tricks, traversal and shell composition stay denied or confirmed.
        """
        try:
            argv = shlex.split(str(command or "").strip(), posix=True)
        except ValueError:
            return False
        if not argv:
            return False
        return argv[0].rsplit("/", 1)[-1].lower() in _PYTHON_EXECUTABLES

    @staticmethod
    def python_heredoc_body(command: str) -> str | None:
        """Extract the script of a quoted `python3 <<'MARK' ... MARK` heredoc.

        Returns None for anything else (including unquoted markers, where the
        shell would expand the body). Newlines inside the body are payload,
        not command composition, so the generic shell-composition rule must
        not apply here; the body gets its own targeted guards instead.
        """
        value = str(command or "")
        if len(value) > 8_192:
            return None
        match = _PYTHON_HEREDOC_RE.match(value.strip())
        if not match:
            return None
        return match.group(2)

    @staticmethod
    def denied_python_body_reason(body: str) -> str | None:
        """String-level guards for heredoc script content (runs as Python)."""
        if len(body) > 8_192:
            return "Скрипт превышает допустимый размер"
        if _SENSITIVE_SYSTEM_PATH_RE.search(body) or _ENV_READ_RE.search(body):
            return "Доступ к системным путям и окружению запрещён"
        if _PYTHON_PIP_RE.search(body):
            return "Установка пакетов запрещена"
        if _SYMLINK_RE.search(body):
            return "Создание ссылок в workspace запрещено"
        if _TRAVERSAL_RE.search(body):
            return "Выход за пределы workspace запрещён"
        return None

    def is_safe_bash_command(self, command: str) -> bool:
        """Detect read-only/workspace-local coreutils for confirmation-free runs.

        Runs only after every deny check, so composition, redirects, package
        managers, network tools and traversal stay denied or confirmed.
        """
        try:
            argv = shlex.split(str(command or "").strip(), posix=True)
        except ValueError:
            return False
        if not argv:
            return False
        return argv[0].rsplit("/", 1)[-1].lower() in _SAFE_BASH_COMMANDS

    def denied_bash_reason(self, command: str) -> str | None:
        value = str(command or "").strip()
        if not value:
            return "Пустая команда запрещена"
        if len(value) > 8_192:
            return "Команда превышает допустимый размер"
        if _has_unquoted_shell_operator(value):
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
