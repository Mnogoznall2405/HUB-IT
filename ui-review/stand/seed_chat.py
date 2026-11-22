"""Seed deterministic chat data into the local E2E backend (port 18001).

Creates the same fixture for web and WPF parity captures:
  - direct conversation e2e_admin <-> e2e_user with alternating messages,
    a reply and a link;
  - direct conversation e2e_admin <-> user ("Regular User"), short;
  - group "IT-отдел" (admin + e2e_user + e2e_fresh) with messages;
  - "Заметки" (self notes) with a few entries;
  - a long-title group for ellipsis checks.

Usage:  python ui-review/stand/seed_chat.py [base_url]
"""
from __future__ import annotations

import json
import sys
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:18001"
API = BASE.rstrip("/") + "/api/v1"


def login(username: str, password: str) -> urllib.request.HTTPCookieProcessor:
    req = urllib.request.Request(
        API + "/auth/login",
        data=json.dumps({"username": username, "password": password}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor())
    with opener.open(req, timeout=30) as resp:
        json.loads(resp.read())
    return opener


def call(opener, method: str, path: str, payload=None):
    req = urllib.request.Request(
        API + path,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"Content-Type": "application/json"},
        method=method,
    )
    with opener.open(req, timeout=30) as resp:
        return json.loads(resp.read())


def main() -> None:
    admin = login("e2e_admin", "e2e-local-admin-pass")
    user = login("e2e_user", "e2e-local-user-pass")
    fresh = login("e2e_fresh", "e2e-local-fresh-pass")

    users = call(admin, "GET", "/chat/users")["items"]
    by_name = {u["username"]: u for u in users}
    uid_user = by_name["e2e_user"]["id"]
    uid_fresh = by_name["e2e_fresh"]["id"]
    uid_regular = by_name["user"]["id"]

    # --- Direct: admin <-> e2e_user -------------------------------------
    dm = call(admin, "POST", "/chat/conversations/direct", {"peer_user_id": uid_user})
    dm_id = dm["id"]
    script = [
        (admin, "Привет! Есть минутка обсудить инвентаризацию?"),
        (user, "Да, я как раз смотрю отчёт по филиалу."),
        (admin, "Отлично. Пришли акт по ноутбукам, пожалуйста."),
        (user, "Уже формирую. Заодно посмотри ссылку https://example.com/report — там сводная таблица."),
        (admin, "Вижу, спасибо. Насчёт периферии: сканеры в кладовой ещё на балансе?"),
        (user, "Три штуки. Один отправлю вам завтра курьером."),
        (admin, "Договорились."),
        (user, "И ещё: принтер в переговорной не печатает с утра."),
        (admin, "Посмотрю драйверы, отпишусь к обеду."),
    ]
    reply_to = None
    for who, text in script:
        msg = call(who, "POST", f"/chat/conversations/{dm_id}/messages", {"body": text})
        if text.startswith("Уже формирую"):
            reply_to = msg["id"]
    if reply_to:
        call(admin, "POST", f"/chat/conversations/{dm_id}/messages",
             {"body": "Таблица открылась, данные свежие.", "reply_to_message_id": reply_to})

    # --- Direct: admin <-> user ------------------------------------------
    dm2 = call(admin, "POST", "/chat/conversations/direct", {"peer_user_id": uid_regular})
    dm2_id = dm2["id"]
    for text in (
        "Добрый день! Заявка на картриджи одобрена.",
        "Заберите их на складе до пятницы.",
    ):
        call(admin, "POST", f"/chat/conversations/{dm2_id}/messages", {"body": text})

    # --- Group: IT-отдел ---------------------------------------------------
    grp = call(admin, "POST", "/chat/conversations/group",
               {"title": "IT-отдел", "member_user_ids": [uid_user, uid_fresh]})
    grp_id = grp["id"]
    group_script = [
        (admin, "Коллеги, в четверг плановое обновление портала."),
        (user, "Во сколько начинаем?"),
        (fresh, "Могу присутствовать с 9:00."),
        (admin, "Стартуем в 10:00, окно до 12:00."),
        (user, "Подготовлю список затронутых сервисов."),
        (admin, "Отлично. После обновления проверим чат и задачи."),
    ]
    for who, text in group_script:
        call(who, "POST", f"/chat/conversations/{grp_id}/messages", {"body": text})

    # --- Long-title group (ellipsis check) --------------------------------
    grp2 = call(admin, "POST", "/chat/conversations/group",
                {"title": "Рабочая группа по сопровождению корпоративной инфраструктуры и инвентаризации",
                 "member_user_ids": [uid_user]})
    call(admin, "POST", f"/chat/conversations/{grp2['id']}/messages",
         {"body": "Первое сообщение в очень длинно названной группе."})

    # --- Notes -------------------------------------------------------------
    notes = call(admin, "POST", "/chat/conversations/notes")
    notes_id = notes["id"]
    for text in (
        "Не забыть продлить сертификат портала до конца месяца.",
        "Идеи для апгрейда чата: реакции, голосовые, закрепы.",
        "Позвонить провайдеру по каналу в филиал.",
    ):
        call(admin, "POST", f"/chat/conversations/{notes_id}/messages", {"body": text})

    summary = {
        "dm": dm_id, "dm2": dm2_id, "group": grp_id,
        "long_group": grp2["id"], "notes": notes_id,
    }
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
