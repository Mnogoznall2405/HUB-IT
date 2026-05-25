from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from backend.ai_chat.tools.base import AiTool, AiToolResult
from backend.ai_chat.tools.context import (
    AD_TOOL_USER_PASSWORD_STATUS,
    AD_TOOL_USERS_EXPIRING_SOON,
    AD_TOOL_MAILBOX_PASSWORD_STATUS,
    AD_TOOL_MAILBOXES_EXPIRING_SOON,
    AD_TOOL_USER_LOCKOUT_STATUS,
    AD_TOOL_ACTION_UNLOCK_DRAFT,
    AD_TOOL_USER_GROUPS,
    AD_TOOL_USER_LOGON_HISTORY,
    AiToolExecutionContext,
)
from backend.ai_chat.tools.registry import ai_tool_registry
from backend.services.ad_users_service import (
    lookup_ad_user_password_status,
    list_ad_users_expiring_soon,
    lookup_ad_mailbox_password_status,
    list_ad_mailboxes_expiring_soon,
    get_ad_user_lockout_status,
    get_ad_user_groups,
    get_ad_user_logon_history,
)


class AdUserPasswordStatusArgs(BaseModel):
    query: str = Field(
        ...,
        min_length=1,
        max_length=160,
        description=(
            "Employee display name (Russian or Latin), surname, login (e.g. kozlovskii_me), "
            "or email-like AD identifier (e.g. kozlovskii.me). "
            "Supports partial matches and transliteration."
        ),
    )
    limit: int = Field(default=5, ge=1, le=10, description="Maximum candidates to return when the match is ambiguous.")


class AdUserPasswordStatusTool(AiTool):
    tool_id = AD_TOOL_USER_PASSWORD_STATUS
    description = (
        "Find an Active Directory user by name, surname, login (sAMAccountName like kozlovskii_me) or email "
        "and return a safe password expiry status. "
        "Use for questions about when a user's password was last changed, when it expires, "
        "how many days remain before the company password rotation, or whether the password must be changed now. "
        "The query can be in Russian (Козловский Максим) or Latin (kozlovskii_me). "
        "The result never includes passwords, hashes, or raw LDAP dumps. "
        "If status=ambiguous, ask the user to choose one candidate."
    )
    input_model = AdUserPasswordStatusArgs
    admin_only = False
    stage = "checking_ad"

    def execute(self, *, context: AiToolExecutionContext, args: BaseModel) -> AiToolResult:
        typed_args = args if isinstance(args, AdUserPasswordStatusArgs) else AdUserPasswordStatusArgs.model_validate(args)
        payload: dict[str, Any] = lookup_ad_user_password_status(typed_args.query, limit=typed_args.limit)
        status = str(payload.get("status") or "").strip().lower()
        ok = status in {"matched", "ambiguous", "not_found"}
        return AiToolResult(
            tool_id=self.tool_id,
            ok=ok,
            database_id=None,
            data=payload if ok else None,
            error=str(payload.get("error") or "AD password status lookup failed.") if not ok else None,
        )


class AdUsersExpiringSoonArgs(BaseModel):
    days_threshold: int = Field(
        default=3,
        ge=1,
        le=30,
        description="Show users whose password expires within this many days (default 3).",
    )
    limit: int = Field(default=50, ge=1, le=200, description="Maximum users to return.")


class AdUsersExpiringSoonTool(AiTool):
    tool_id = AD_TOOL_USERS_EXPIRING_SOON
    description = (
        "List Active Directory users whose password expires within N days (default 3). "
        "Returns users sorted by urgency: already expired first, then by days remaining. "
        "Use when the user asks 'у кого скоро закончится пароль', 'список истекающих паролей', "
        "'who needs to change password soon', or similar bulk expiry questions."
    )
    input_model = AdUsersExpiringSoonArgs
    admin_only = False
    stage = "checking_ad"

    def execute(self, *, context: AiToolExecutionContext, args: BaseModel) -> AiToolResult:
        typed_args = args if isinstance(args, AdUsersExpiringSoonArgs) else AdUsersExpiringSoonArgs.model_validate(args)
        payload: dict[str, Any] = list_ad_users_expiring_soon(
            days_threshold=typed_args.days_threshold,
            limit=typed_args.limit,
        )
        status = str(payload.get("status") or "").strip().lower()
        ok = status == "ok"
        return AiToolResult(
            tool_id=self.tool_id,
            ok=ok,
            database_id=None,
            data=payload if ok else None,
            error=str(payload.get("error") or "AD expiring users lookup failed.") if not ok else None,
        )


class AdMailboxPasswordStatusArgs(BaseModel):
    query: str = Field(
        ...,
        min_length=1,
        max_length=160,
        description=(
            "Mailbox identifier: dot-separated login (e.g. kozlovskii.me), display name, "
            "or email address. Supports partial matches."
        ),
    )
    limit: int = Field(default=5, ge=1, le=10, description="Maximum candidates to return when the match is ambiguous.")


class AdMailboxPasswordStatusTool(AiTool):
    tool_id = AD_TOOL_MAILBOX_PASSWORD_STATUS
    description = (
        "Find an Active Directory mailbox account (Exchange shared/personal mailbox with dot-separated login "
        "like kozlovskii.me) and return password expiry status. "
        "Use for questions about mailbox password expiration, rotation, or when a mailbox password was last changed. "
        "The query can be a dot-separated login, display name in Russian (Козловский Максим), or email. "
        "If status=ambiguous, ask the user to choose one candidate."
    )
    input_model = AdMailboxPasswordStatusArgs
    admin_only = False
    stage = "checking_ad"

    def execute(self, *, context: AiToolExecutionContext, args: BaseModel) -> AiToolResult:
        typed_args = args if isinstance(args, AdMailboxPasswordStatusArgs) else AdMailboxPasswordStatusArgs.model_validate(args)
        payload: dict[str, Any] = lookup_ad_mailbox_password_status(typed_args.query, limit=typed_args.limit)
        status = str(payload.get("status") or "").strip().lower()
        ok = status in {"matched", "ambiguous", "not_found"}
        return AiToolResult(
            tool_id=self.tool_id,
            ok=ok,
            database_id=None,
            data=payload if ok else None,
            error=str(payload.get("error") or "AD mailbox password status lookup failed.") if not ok else None,
        )


class AdMailboxesExpiringSoonArgs(BaseModel):
    days_threshold: int = Field(
        default=3,
        ge=1,
        le=30,
        description="Show mailboxes whose password expires within this many days (default 3).",
    )
    limit: int = Field(default=50, ge=1, le=200, description="Maximum mailboxes to return.")


class AdMailboxesExpiringSoonTool(AiTool):
    tool_id = AD_TOOL_MAILBOXES_EXPIRING_SOON
    description = (
        "List Active Directory mailbox accounts (Exchange mailboxes with dot-separated logins) "
        "whose password expires within N days (default 3). "
        "Returns mailboxes sorted by urgency: already expired first, then by days remaining. "
        "Use when the user asks about expiring mailbox passwords, 'у каких ящиков скоро закончится пароль', "
        "'список ящиков с истекающими паролями', or similar bulk mailbox expiry questions."
    )
    input_model = AdMailboxesExpiringSoonArgs
    admin_only = False
    stage = "checking_ad"

    def execute(self, *, context: AiToolExecutionContext, args: BaseModel) -> AiToolResult:
        typed_args = args if isinstance(args, AdMailboxesExpiringSoonArgs) else AdMailboxesExpiringSoonArgs.model_validate(args)
        payload: dict[str, Any] = list_ad_mailboxes_expiring_soon(
            days_threshold=typed_args.days_threshold,
            limit=typed_args.limit,
        )
        status = str(payload.get("status") or "").strip().lower()
        ok = status == "ok"
        return AiToolResult(
            tool_id=self.tool_id,
            ok=ok,
            database_id=None,
            data=payload if ok else None,
            error=str(payload.get("error") or "AD mailbox expiring lookup failed.") if not ok else None,
        )


class AdUserLockoutStatusArgs(BaseModel):
    query: str = Field(
        ...,
        min_length=1,
        max_length=160,
        description=(
            "Employee display name (Russian or Latin), surname, login (e.g. kozlovskii_me), "
            "or email-like AD identifier. Supports partial matches."
        ),
    )


class AdUserLockoutStatusTool(AiTool):
    tool_id = AD_TOOL_USER_LOCKOUT_STATUS
    description = (
        "Check Active Directory account lockout status for a user. "
        "Returns whether the account is locked, when it was locked, how long it has been locked, "
        "and the number of bad password attempts. "
        "The query can be a surname (Пахотин), full name (Пахотин Алексей), login (pahotin_aa), or email. "
        "If this tool returns status='not_found', try using ad.user.password_status first to find the user's "
        "exact login, then retry with that login. "
        "Use when the user asks 'заблокирован ли аккаунт', 'статус блокировки', "
        "'is the account locked', 'lockout status', or similar lockout questions."
    )
    input_model = AdUserLockoutStatusArgs
    admin_only = False
    stage = "checking_ad"

    def execute(self, *, context: AiToolExecutionContext, args: BaseModel) -> AiToolResult:
        typed_args = args if isinstance(args, AdUserLockoutStatusArgs) else AdUserLockoutStatusArgs.model_validate(args)
        payload: dict[str, Any] = get_ad_user_lockout_status(typed_args.query)
        status = str(payload.get("status") or "").strip().lower()
        ok = status in {"ok", "not_found"}
        return AiToolResult(
            tool_id=self.tool_id,
            ok=ok,
            database_id=None,
            data=payload if ok else None,
            error=str(payload.get("error") or "AD lockout status lookup failed.") if not ok else None,
        )


class AdUnlockDraftArgs(BaseModel):
    login: str = Field(
        ...,
        min_length=1,
        max_length=160,
        description=(
            "The sAMAccountName (login) of the AD account to unlock. "
            "Must be the exact login returned by the lockout_status tool."
        ),
    )


class AdUnlockDraftTool(AiTool):
    tool_id = AD_TOOL_ACTION_UNLOCK_DRAFT
    description = (
        "Create a pending action card to unlock a locked Active Directory account. "
        "Does not unlock the account until the user confirms the action card. "
        "Use after checking lockout status with ad.user.lockout_status and confirming the account is locked. "
        "Requires admin access."
    )
    input_model = AdUnlockDraftArgs
    admin_only = True
    stage = "checking_ad"

    def execute(self, *, context: AiToolExecutionContext, args: BaseModel) -> AiToolResult:
        typed_args = args if isinstance(args, AdUnlockDraftArgs) else AdUnlockDraftArgs.model_validate(args)
        login = str(typed_args.login).strip()

        # Verify the account exists and is actually locked
        lockout_info = get_ad_user_lockout_status(login)
        lockout_status = str(lockout_info.get("status") or "").strip().lower()

        if lockout_status == "error":
            return AiToolResult(
                tool_id=self.tool_id,
                ok=False,
                error=str(lockout_info.get("error") or "Failed to verify account lockout status."),
            )

        if lockout_status == "not_found":
            return AiToolResult(
                tool_id=self.tool_id,
                ok=False,
                error=f"Account '{login}' not found in Active Directory.",
            )

        is_locked = bool(lockout_info.get("is_locked"))
        display_name = str(lockout_info.get("display_name") or login)
        lockout_time = lockout_info.get("lockout_time")

        if not is_locked:
            return AiToolResult(
                tool_id=self.tool_id,
                ok=True,
                data={
                    "login": login,
                    "display_name": display_name,
                    "is_locked": False,
                    "message": "Account is not locked. No action needed.",
                },
            )

        # Build the draft/confirmation card
        payload = {
            "login": login,
            "display_name": display_name,
            "lockout_time": lockout_time,
        }

        try:
            from backend.ai_chat.action_cards import create_pending_action

            card = create_pending_action(
                action_type="ad.unlock",
                conversation_id=context.conversation_id,
                run_id=context.run_id,
                requester_user_id=int(context.user_id),
                database_id=context.effective_database_id,
                payload=payload,
                preview={
                    "title": "Разблокировка учётной записи AD",
                    "description": f"Разблокировать учётную запись {display_name} ({login})",
                    "login": login,
                    "display_name": display_name,
                    "lockout_time": lockout_time,
                },
            )
            return AiToolResult(
                tool_id=self.tool_id,
                ok=True,
                data={"action_card": card, "requires_confirmation": True},
            )
        except Exception as exc:
            return AiToolResult(
                tool_id=self.tool_id,
                ok=False,
                error=f"Failed to create unlock action card: {exc}",
            )


ai_tool_registry.register(AdUserPasswordStatusTool())
ai_tool_registry.register(AdUsersExpiringSoonTool())
ai_tool_registry.register(AdMailboxPasswordStatusTool())
ai_tool_registry.register(AdMailboxesExpiringSoonTool())
ai_tool_registry.register(AdUserLockoutStatusTool())
ai_tool_registry.register(AdUnlockDraftTool())


class AdUserGroupsArgs(BaseModel):
    query: str = Field(
        ...,
        min_length=1,
        max_length=160,
        description=(
            "Employee display name (Russian or Latin), surname, login (e.g. kozlovskii_me), "
            "or email-like AD identifier. Supports partial matches."
        ),
    )
    include_builtin: bool = Field(
        default=False,
        description="Include built-in groups (Domain Users, Users, etc.) in the result. Default is False.",
    )


class AdUserGroupsTool(AiTool):
    tool_id = AD_TOOL_USER_GROUPS
    description = (
        "Get Active Directory group membership for a user. "
        "Returns the list of AD groups the user belongs to (parsed from the memberOf attribute). "
        "By default, built-in groups like 'Domain Users' and 'Users' are excluded. "
        "Set include_builtin=True to include them. "
        "The query can be a surname (Пахотин), full name (Пахотин Алексей), login (pahotin_aa), or email. "
        "If this tool returns status='not_found', try using ad.user.password_status first to find the user's "
        "exact login, then retry with that login. "
        "Use when the user asks 'в каких группах состоит пользователь', 'группы пользователя AD', "
        "'what groups does the user belong to', or similar group membership questions."
    )
    input_model = AdUserGroupsArgs
    admin_only = False
    stage = "checking_ad"

    def execute(self, *, context: AiToolExecutionContext, args: BaseModel) -> AiToolResult:
        typed_args = args if isinstance(args, AdUserGroupsArgs) else AdUserGroupsArgs.model_validate(args)
        payload: dict[str, Any] = get_ad_user_groups(typed_args.query, include_builtin=typed_args.include_builtin)
        status = str(payload.get("status") or "").strip().lower()
        ok = status in {"ok", "not_found"}
        return AiToolResult(
            tool_id=self.tool_id,
            ok=ok,
            database_id=None,
            data=payload if ok else None,
            error=str(payload.get("error") or "AD user groups lookup failed.") if not ok else None,
        )


class AdUserLogonHistoryArgs(BaseModel):
    query: str = Field(
        ...,
        min_length=1,
        max_length=160,
        description=(
            "Employee display name (Russian or Latin), surname, login (e.g. kozlovskii_me), "
            "or email-like AD identifier. Supports partial matches."
        ),
    )


class AdUserLogonHistoryTool(AiTool):
    tool_id = AD_TOOL_USER_LOGON_HISTORY
    description = (
        "Get Active Directory logon history for a user: last logon time, logon count, and last password change. "
        "Uses the lastLogon and lastLogonTimestamp attributes (returns the most recent of the two). "
        "The query can be a surname (Пахотин), full name (Пахотин Алексей), login (pahotin_aa), or email. "
        "If this tool returns status='not_found', try using ad.user.password_status first to find the user's "
        "exact login (sAMAccountName), then retry this tool with that login. "
        "Use when the user asks 'когда последний раз входил пользователь', 'история входов AD', "
        "'when did the user last log in', 'logon count', or similar logon history questions."
    )
    input_model = AdUserLogonHistoryArgs
    admin_only = False
    stage = "checking_ad"

    def execute(self, *, context: AiToolExecutionContext, args: BaseModel) -> AiToolResult:
        typed_args = args if isinstance(args, AdUserLogonHistoryArgs) else AdUserLogonHistoryArgs.model_validate(args)
        payload: dict[str, Any] = get_ad_user_logon_history(typed_args.query)
        status = str(payload.get("status") or "").strip().lower()
        ok = status in {"ok", "not_found"}
        return AiToolResult(
            tool_id=self.tool_id,
            ok=ok,
            database_id=None,
            data=payload if ok else None,
            error=str(payload.get("error") or "AD logon history lookup failed.") if not ok else None,
        )


ai_tool_registry.register(AdUserGroupsTool())
ai_tool_registry.register(AdUserLogonHistoryTool())
