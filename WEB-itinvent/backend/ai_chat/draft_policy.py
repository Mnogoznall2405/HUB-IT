"""Evidence and channel checks for model-requested communication drafts."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from backend.ai_chat.tools.base import AiToolValidationError

MAIL_DRAFT = "office.action.mail_send_draft"
MAIL_REPLY_DRAFT = "office.action.mail_reply_draft"
CHAT_DRAFT = "chat.action.message_send_draft"
COMMUNICATION_DRAFTS = {MAIL_DRAFT, MAIL_REPLY_DRAFT, CHAT_DRAFT}
_EMAIL = re.compile(r"[\w.!#$%&'*+/=?^`{|}~-]+@[\w.-]+\.[a-zA-Z]{2,}")
_AD = re.compile(r"\bAD\b|Active\s+Directory", re.IGNORECASE)
_FOLLOWUP = re.compile(r"исправ|поправ|обнов|добав|пропуст|опечат|неверн|черновик|вместо|букв", re.IGNORECASE)
_RETRY = re.compile(
    r"(?:давай\s+)?(?:ещ[её]\s+раз|повтори|попробуй\s+(?:снова|ещ[её]\s+раз))"
    r"|(?:покажи(?:\s+мне)?|не\s+вижу)\s+черновик",
    re.IGNORECASE,
)
_EMPLOYEE_EMAIL = re.compile(
    r"(?:внес\w*|внест\w*|добав\w*|укаж\w*|указ\w*|заполн\w*|обнов\w*)"
    r"[^.!?\n]{0,80}(?:электро[н]+\w*\s+адрес|адрес\s+электро[н]+\w*\s+почт\w*)",
    re.IGNORECASE,
)
# A communication draft may be created only when the USER asked for a
# send/reply/message action. Grounding (a resolved peer/mail/conversation from
# tool results) is a separate check and never substitutes intent.
#
# Strong verbs unambiguously mean "send something to someone"; ambiguous verbs
# («напиши», «составь», «скажи») also mean "write an answer for me" or "make a
# summary", so they count as send intent only together with an explicit target:
# a named person, a role noun, an e-mail address or the word «черновик»/«draft».
_SEND_STRONG = re.compile(
    r"\b(?:отправ\w*|ответь\w*|ответить|перешл\w*|пересл\w*|переда[йт]\w*|"
    r"доставь\w*)\b|\b(?:send|reply|forward|resend)\b",
    re.IGNORECASE,
)
_SEND_AMBIG = re.compile(
    r"\b(?:напиш\w*|состав\w*|подготов\w*|наброса\w*|скажи(?:те)?\b|"
    r"сообщи(?:те|ть)?\b|скинь\w*|сбрось\w*)\b|\b(?:write|draft|compose|tell)\b",
    re.IGNORECASE,
)
_SEND_TARGET = re.compile(
    r"черновик\w*|\bdraft\b|@\w|клиент\w*|заказчик\w*|сотрудник\w*|коллег\w*|"
    r"администратор\w*|руководител\w*|директор\w*|менеджер\w*|бухгалтер\w*|"
    r"кадровик\w*|юрист\w*|поддержк\w*|шеф\w*|босс\w*|"
    r"\bему\b|\bей\b|\bим\b|\bнём\b|\bней\b|\bних\b",
    re.IGNORECASE,
)
_WORD = re.compile(r"[А-ЯЁA-Zа-яёa-z\-]{4,}")


def _send_intent(text: str) -> bool:
    if _SEND_STRONG.search(text):
        return True
    if not _SEND_AMBIG.search(text):
        return False
    if _SEND_TARGET.search(text):
        return True
    # «Напиши Ивану» — a capitalized token after the first word is a person name.
    words = _WORD.findall(text)
    return any(word[0].isupper() for word in words[1:])
_MAIL_CHANNEL = re.compile(
    r"письм\w*|почт\w*|e-?mail|\bmail\b|ответ\w*|\breply\b|forward|перешл\w*|пересл\w*",
    re.IGNORECASE,
)
_CHAT_CHANNEL = re.compile(r"\bчат\w*|сообщени\w*|мессендж\w*|\bhub\b|\bchat\b|\bmessage\b", re.IGNORECASE)


def draft_retry(text: str) -> bool:
    return bool(_RETRY.fullmatch(text.strip().rstrip(".!?")))


def draft_followup(text: str) -> bool:
    return bool(draft_retry(text) or _FOLLOWUP.search(text) or _EMAIL.fullmatch(text.strip()))


def explicit_channel(text: str) -> str | None:
    # "адрес почты" and an email in the body do not request a channel change.
    matches = list(re.finditer(
        r"(?P<mail>\bписьм\w*|по\s+почте|на\s+почту|\be-?mail\b)|(?P<chat>\bчат\w*|в\s+HUB\b)",
        text, re.IGNORECASE,
    ))
    # "Вместо письма напиши в чат" explicitly selects the last channel.
    return (MAIL_DRAFT if matches[-1].lastgroup == "mail" else CHAT_DRAFT) if matches else None


def _norm(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _name_tokens(text: str) -> list[str]:
    return [token.lower() for token in re.findall(r"[\w\-]{4,}", text or "")]


@dataclass
class AiDraftPolicy:
    trigger_text: str = ""
    user_messages: list[str] = field(default_factory=list)
    previous_action: dict[str, Any] | None = None
    ambiguous_previous: bool = False
    verified_addresses: set[str] = field(default_factory=set)
    successful_drafts: list[dict[str, Any]] = field(default_factory=list)
    rejection: str = ""
    ad_checked: bool = False
    # Server-observed anchors gathered from tool results of THIS run. A recipient or
    # target is "grounded" only when it came from the user's own text or was resolved
    # by a server tool call in this run — never from document/KB/tool-result text.
    observed_mail_message_ids: set[str] = field(default_factory=set)
    observed_mail_senders: dict[str, str] = field(default_factory=dict)
    observed_peer_user_ids: set[int] = field(default_factory=set)
    observed_conversation_ids: set[str] = field(default_factory=set)
    # id -> name/title tokens: binds a numeric target to the person or
    # conversation the server actually resolved, so a model-supplied name
    # cannot ground a foreign id.
    observed_peer_names: dict[int, list[str]] = field(default_factory=dict)
    observed_conversation_titles: dict[str, list[str]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        for text in [self.trigger_text, *self.user_messages]:
            self.verified_addresses.update(address.lower() for address in _EMAIL.findall(text))

    @property
    def requires_ad(self) -> bool:
        informational = re.search(r"что такое|что означает|что ты умеешь|расскажи об", self.trigger_text, re.IGNORECASE)
        excluded = re.search(r"(?:без|не используй|не проверяй|не ищи)\s+(?:в\s+)?(?:AD\b|Active Directory)", self.trigger_text, re.IGNORECASE)
        # Follow-ups may be only "В AD посомтри"; preserve typos and context.
        return bool(_AD.search(self.trigger_text) and not informational and not excluded)

    def validate_employee_email(self, body: str, *, existing_draft: bool = False) -> None:
        # Only the current intent requires an address; unrelated old letters do not.
        intent = self.trigger_text
        if draft_followup(intent) and not _EMPLOYEE_EMAIL.search(intent):
            intent = next((text for text in reversed(self.user_messages)
                           if text != self.trigger_text and not draft_retry(text)), intent)
        if not (_EMPLOYEE_EMAIL.search(intent) or _EMPLOYEE_EMAIL.search(body)):
            return
        addresses = {address.lower() for address in _EMAIL.findall(body)}
        if not addresses:
            self.rejection = "В письме отсутствует электронный адрес сотрудника, который нужно внести. Уточните этот адрес."
            raise AiToolValidationError(self.rejection)
        # Redisplaying an unchanged persisted draft introduces no new addresses.
        if not existing_draft and not addresses.issubset(self.verified_addresses):
            self.rejection = "Электронный адрес сотрудника в тексте письма не подтверждён. Найдите его в справочнике или уточните у пользователя."
            raise AiToolValidationError(self.rejection)

    def prepare(self, tool_id: str, args: dict[str, Any], enabled_tools: list[str]) -> tuple[str, dict[str, Any]]:
        args = dict(args)
        if self.requires_ad and tool_id == "directory.people.search":
            if "ad.user.password_status" not in enabled_tools:
                raise AiToolValidationError("Данные AD не проверены: инструмент поиска в Active Directory недоступен.")
            # This existing LDAP lookup includes the safe 'mail' attribute.
            tool_id = "ad.user.password_status"
            args = {"query": args.get("query") or args.get("q"), "limit": args.get("limit", 5)}
        if tool_id not in COMMUNICATION_DRAFTS:
            return tool_id, args
        if self.ambiguous_previous and not args.get("replace_action_id"):
            raise AiToolValidationError(self.rejection)
        selected_channel = explicit_channel(self.trigger_text)
        if self.previous_action and draft_followup(self.trigger_text):
            previous_channel = (
                MAIL_DRAFT if self.previous_action["action_type"] in ("office.mail.send", "office.mail.reply") else CHAT_DRAFT
            )
            selected_channel = selected_channel or previous_channel
            # A change of channel replaces the same pending intent too.
            args["replace_action_id"] = self.previous_action["id"]
        mail_drafts = {MAIL_DRAFT, MAIL_REPLY_DRAFT}
        if selected_channel == MAIL_DRAFT and tool_id not in mail_drafts:
            self.rejection = "Сохраните выбранный канал: обновите черновик письма."
            raise AiToolValidationError(self.rejection)
        if selected_channel == CHAT_DRAFT and tool_id != CHAT_DRAFT:
            self.rejection = "Сохраните выбранный канал: обновите черновик сообщения в чате."
            raise AiToolValidationError(self.rejection)
        # A replace_action_id is valid only for the pending action the server
        # actually surfaced for this request — an arbitrary id cannot launder
        # a destination change past the checks below.
        replace_id = _norm(args.get("replace_action_id"))
        stored = None
        if replace_id:
            if self.previous_action and replace_id == _norm(self.previous_action.get("id")):
                stored = self.previous_action.get("payload") or {}
            else:
                self.rejection = "Указанный черновик не является активным в этом запросе. Создайте действие заново или уточните, какой черновик нужен."
                raise AiToolValidationError(self.rejection)
        destination_unchanged = stored is not None and self._same_destination(tool_id, args, stored)
        if not destination_unchanged:
            # (1) Intent: the user must have asked for a send/reply/message action.
            self._enforce_intent(tool_id, args, is_replace=stored is not None)
        if tool_id == MAIL_DRAFT:
            if not destination_unchanged:
                from backend.ai_chat.tools.office import coerce_mail_recipients

                recipients = [address for key in ("to", "cc", "bcc") for address in coerce_mail_recipients(args.get(key))]
                if any(address.lower() not in self.verified_addresses for address in recipients):
                    self.rejection = (
                        "Адрес получателя не подтверждён. Выполните office.mail.contacts.resolve "
                        "и используйте адрес из результата либо попросите пользователя указать его."
                    )
                    raise AiToolValidationError(self.rejection)
            self.validate_employee_email(str(args.get("body") or ""))
        elif tool_id == MAIL_REPLY_DRAFT:
            if not destination_unchanged:
                from backend.ai_chat.tools.office import coerce_mail_recipients

                anchor = _norm(args.get("reply_to_message_id"))
                if anchor not in self.observed_mail_message_ids:
                    self.rejection = (
                        "Черновик ответа отклонён: исходное письмо не было получено инструментом "
                        "office.mail.get_message/office.mail.search в этом запросе. Сначала найдите и откройте письмо."
                    )
                    raise AiToolValidationError(self.rejection)
                recipients = [address for key in ("to", "cc", "bcc") for address in coerce_mail_recipients(args.get(key))]
                allowed = set(self.verified_addresses)
                original_sender = self.observed_mail_senders.get(anchor)
                if original_sender:
                    allowed.add(original_sender)
                if any(address.lower() not in allowed for address in recipients):
                    self.rejection = (
                        "Адрес получателя в ответе не подтверждён: используйте отправителя исходного письма "
                        "или адрес, явно указанный пользователем."
                    )
                    raise AiToolValidationError(self.rejection)
            self.validate_employee_email(str(args.get("body") or ""))
        elif tool_id == CHAT_DRAFT:
            if not destination_unchanged and not self._chat_target_grounded(args):
                self.rejection = (
                    "Черновик сообщения отклонён: получатель не подтверждён запросом пользователя. "
                    "Сначала найдите сотрудника (chat.users.search) или чат (chat.conversations.search) "
                    "по имени из запроса пользователя."
                )
                raise AiToolValidationError(self.rejection)
        self.rejection = ""
        return tool_id, args

    def _trusted_text(self) -> str:
        return " ".join([self.trigger_text, *self.user_messages]).lower()

    def _chat_target_grounded(self, args: dict[str, Any]) -> bool:
        # The destination must be grounded in this run's server tool results or
        # in the user's own text — a document/mail/KB snippet cannot pick the
        # target, and a model-supplied name never grounds a foreign numeric id.
        trusted_text = self._trusted_text()

        def stems_in_text(name: str) -> bool:
            return any(token[:4] in trusted_text for token in _name_tokens(name))

        def stems_overlap(first: list[str], second: list[str]) -> bool:
            return any(one[:4] == two[:4] for one in first for two in second)

        peer_id = args.get("peer_user_id")
        peer_name = _norm(args.get("peer_name"))
        conversation_id = _norm(args.get("conversation_id"))
        conversation_title = _norm(args.get("conversation_title"))
        if peer_id:
            try:
                pid = int(peer_id)
            except (TypeError, ValueError):
                return False
            # Only a chat-side lookup in THIS run grounds a numeric peer id.
            if pid not in self.observed_peer_user_ids:
                return False
            observed_tokens = self.observed_peer_names.get(pid) or []
            # A model-supplied peer_name must describe the SAME person the id
            # resolved to — merging a verified name with another id is rejected.
            if peer_name and observed_tokens and not stems_overlap(_name_tokens(peer_name), observed_tokens):
                return False
            if observed_tokens:
                # The resolved person must be who the user asked for.
                return any(token[:4] in trusted_text for token in observed_tokens)
            return bool(peer_name) and stems_in_text(peer_name)
        if conversation_id:
            if conversation_id not in self.observed_conversation_ids:
                return False
            title_tokens = self.observed_conversation_titles.get(conversation_id) or []
            if conversation_title and title_tokens and not stems_overlap(_name_tokens(conversation_title), title_tokens):
                return False
            if title_tokens:
                return any(token[:4] in trusted_text for token in title_tokens) or (
                    bool(conversation_title) and stems_in_text(conversation_title)
                )
            return True
        # No id at all: the model named the target, so ground it on the user's
        # own text only (a 4-char stem covers Cyrillic declension).
        for name in (peer_name, conversation_title):
            if name and stems_in_text(name):
                return True
        return False

    def _same_destination(self, tool_id: str, args: dict[str, Any], stored_payload: dict[str, Any]) -> bool:
        if tool_id in (MAIL_DRAFT, MAIL_REPLY_DRAFT):
            from backend.ai_chat.tools.office import coerce_mail_recipients

            def recipients(source: dict[str, Any]) -> tuple[tuple[str, ...], ...]:
                # to/cc/bcc compared per field: moving an address between
                # roles IS a destination change and needs fresh grounding.
                return tuple(
                    tuple(sorted(address.lower() for address in coerce_mail_recipients(source.get(key))))
                    for key in ("to", "cc", "bcc")
                )
            try:
                if recipients(args) != recipients(stored_payload):
                    return False
            except ValueError:
                return False
            if tool_id == MAIL_REPLY_DRAFT:
                return _norm(args.get("reply_to_message_id")) == _norm(stored_payload.get("reply_to_message_id"))
            return True
        if tool_id == CHAT_DRAFT:
            return all(
                _norm(args.get(key)) == _norm(stored_payload.get(key))
                for key in ("peer_user_id", "conversation_id", "peer_name", "conversation_title")
            )
        return False

    def _enforce_intent(self, tool_id: str, args: dict[str, Any], *, is_replace: bool = False) -> None:
        """Require an explicit user instruction to send/reply/message.

        A resolved tool result never counts as intent: it is data produced
        inside this run and can be steered by injected content. Intent comes
        from the current request, or — for draft-edit phrasing — from the
        pending action the user already created plus its original request.
        """
        text = self.trigger_text
        if draft_followup(text) and not _send_intent(text):
            # A pending draft the server surfaced + draft-edit phrasing is itself
            # user direction: the intent was established when the draft was made.
            if is_replace:
                return
            # Otherwise inherit intent from the last non-retry user request —
            # the one that created the draft being edited.
            text = next(
                (item for item in reversed(self.user_messages) if item != text and not draft_retry(item)),
                text,
            )
        if not _send_intent(text):
            self.rejection = (
                "В запросе пользователя нет поручения отправить письмо или сообщение. "
                "Уточните у пользователя, нужно ли готовить черновик."
            )
            raise AiToolValidationError(self.rejection)
        if tool_id == CHAT_DRAFT:
            if _CHAT_CHANNEL.search(text):
                return
            # A peer/conversation name present in the user's own text is also a
            # chat-channel signal ("напиши Ивану" without the word "чат").
            trusted = self._trusted_text()
            for name in (_norm(args.get("peer_name")), _norm(args.get("conversation_title"))):
                if name and any(token[:4] in trusted for token in _name_tokens(name)):
                    return
            self.rejection = (
                "Канал не подтверждён: в запросе нет указания отправить сообщение в чат. "
                "Уточните у пользователя."
            )
            raise AiToolValidationError(self.rejection)
        else:
            if _MAIL_CHANNEL.search(text) or _EMAIL.search(text):
                return
            self.rejection = (
                "Канал не подтверждён: в запросе нет указания написать или ответить письмом. "
                "Уточните у пользователя."
            )
            raise AiToolValidationError(self.rejection)

    def observe(self, result: dict[str, Any]) -> None:
        if not result.get("ok"):
            return
        tool_id = result.get("tool_id")
        data = result.get("data") or {}
        if not isinstance(data, dict):
            return
        if str(tool_id).startswith("ad."):
            self.ad_checked = True
        contacts: list[dict[str, Any]] = []
        if tool_id == "office.mail.contacts.resolve":
            contacts = data.get("items") or []
        elif tool_id in ("office.mail.search", "office.mail.get_message"):
            items = data.get("items") if isinstance(data.get("items"), list) else [data]
            for item in items:
                if not isinstance(item, dict):
                    continue
                message_id = _norm(item.get("id") or item.get("message_id"))
                if not message_id:
                    continue
                self.observed_mail_message_ids.add(message_id)
                sender = next(iter(_EMAIL.findall(str(item.get("sender") or ""))), "")
                if sender:
                    self.observed_mail_senders[message_id] = sender.lower()
        elif tool_id == "chat.users.search":
            for item in data.get("items") or []:
                if isinstance(item, dict):
                    try:
                        peer_id = int(item.get("id") or item.get("user_id") or 0)
                    except (TypeError, ValueError):
                        peer_id = 0
                    if peer_id > 0:
                        self.observed_peer_user_ids.add(peer_id)
                        tokens: list[str] = []
                        for field_name in ("display_name", "full_name", "name", "username"):
                            tokens.extend(_name_tokens(str(item.get(field_name) or "")))
                        if tokens:
                            self.observed_peer_names[peer_id] = tokens
        elif tool_id == "chat.conversations.search":
            for item in data.get("items") or []:
                if isinstance(item, dict):
                    conv_id = _norm(item.get("id") or item.get("conversation_id"))
                    if conv_id:
                        self.observed_conversation_ids.add(conv_id)
                        tokens = _name_tokens(str(item.get("title") or item.get("name") or ""))
                        if tokens:
                            self.observed_conversation_titles[conv_id] = tokens
        elif tool_id == "directory.people.search":
            for person in data.get("items") or []:
                for email in person.get("work_emails") or []:
                    value = email.get("value") if isinstance(email, dict) else email
                    self.verified_addresses.update(address.lower() for address in _EMAIL.findall(str(value or "")))
        elif tool_id == "ad.user.password_status" and data.get("status") == "matched":
            contacts = [data.get("user") or {}]
        for contact in contacts:
            if isinstance(contact, dict):
                self.verified_addresses.update(address.lower() for address in _EMAIL.findall(str(contact.get("email") or contact.get("mail") or "")))
        if tool_id in COMMUNICATION_DRAFTS and isinstance(data.get("action_card"), dict):
            self.successful_drafts.append(data["action_card"])

    def answer(self, model_answer: str, *, budget_exhausted: bool = False) -> str:
        if self.successful_drafts:
            channels = {card.get("action_type") for card in self.successful_drafts}
            noun = "письма" if channels == {"office.mail.send"} else "сообщения в чате" if channels == {"chat.message.send"} else "сообщений"
            verb = "Обновил" if self.previous_action and draft_followup(self.trigger_text) else "Подготовил"
            return f"{verb} черновик {noun}. Проверьте получателя и текст в карточке и подтвердите отправку."
        if budget_exhausted:
            return "Не удалось завершить запрос: достигнут лимит обработки агента. Повторите запрос или уточните его."
        if self.rejection:
            return "Черновик не создан. " + self.rejection
        if self.requires_ad and not self.ad_checked:
            return "Данные Active Directory не проверены: поиск в AD не выполнен успешно. Не могу подтвердить наличие или отсутствие адреса в AD."
        return model_answer
