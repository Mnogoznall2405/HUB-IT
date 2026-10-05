#!/usr/bin/env python3
"""End-to-end scenario benchmark of the HUB assistant on everyday requests.

For each realistic request (find equipment, write a letter, check a password,
search the knowledge base ...) the script runs the real pipeline pieces:

1. Jev group routing (``_route_tool_groups_jev`` from the service, live calls);
2. the answer model (OpenRouter, JSON mode) with the tools of the routed groups;
3. simulated tool results with known facts (no production data is read);
4. up to 3 tool rounds, then checks: right group routed, right tool chosen,
   arguments carry the key facts, the final answer contains the facts from the
   tool result, does not invent, and drafts are not reported as already sent.

Usage (from WEB-itinvent; sqlite URLs keep the app DB untouched):

    set APP_DATABASE_URL=sqlite:///%TEMP%\\sc_app.db
    set CHAT_DATABASE_URL=sqlite:///%TEMP%\\sc_chat.db
    python -m backend.scripts.ai_scenarios_benchmark --model google/gemini-3.1-flash-lite \\
        --prompt-file prompt.txt [--out report.json]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

WEB_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = Path(__file__).resolve().parents[3]
for import_root in (WEB_ROOT, REPO_ROOT):
    if str(import_root) not in sys.path:
        sys.path.insert(0, str(import_root))
os.environ["AI_JEV_ROUTING"] = "1"

CATALOG: dict[str, list[tuple[str, str]]] = {
    "itinvent": [
        ("itinvent.equipment.search", "Поиск оборудования"),
        ("itinvent.equipment.get_card", "Карточка устройства"),
        ("itinvent.equipment.list_by_branch", "Оборудование филиала"),
        ("itinvent.employee.search", "Поиск сотрудника"),
        ("itinvent.employee.list_equipment", "Оборудование сотрудника"),
        ("itinvent.consumables.search", "Расходники и комплектующие"),
        ("itinvent.acts.pending", "Неподписанные акты передачи"),
    ],
    "office": [
        ("office.mail.search", "Поиск писем"),
        ("office.mail.get_message", "Открыть письмо"),
        ("office.mail.contacts.resolve", "Поиск почтовых контактов"),
        ("office.tasks.search", "Поиск задач"),
        ("office.workday.summary", "Сводка рабочего дня"),
        ("office.action.mail_send_draft", "Черновик нового письма (to, subject, body)"),
        ("office.action.mail_reply_draft", "Черновик ответа на письмо (message_id, body)"),
        ("office.action.task_create_draft", "Черновик новой задачи (title, description)"),
    ],
    "mfu": [
        ("mfu.devices.list", "Список МФУ / принтеров"),
        ("mfu.device.status", "Статус МФУ (SNMP/ping)"),
        ("mfu.pages.monthly", "Страницы по месяцам"),
        ("mfu.devices.low_toner", "Заканчивается тонер"),
    ],
    "network": [
        ("network.socket.search", "Поиск розеток"),
        ("network.ports.search", "Поиск портов коммутатора"),
        ("network.branch.overview", "Обзор филиала (сети)"),
        ("network.host.ping", "Ping хоста"),
    ],
    "ad": [
        ("ad.user.password_status", "Срок смены пароля AD"),
        ("ad.user.lockout_status", "Статус блокировки AD"),
        ("ad.action.unlock_draft", "Разблокировка учётной записи AD (черновик)"),
        ("ad.user.groups", "Группы пользователя AD"),
    ],
    "kb": [
        ("kb.articles.search", "Поиск статей базы знаний"),
        ("kb.articles.get", "Открыть статью базы знаний"),
        ("kb.attachments.send", "Отправить файл из базы знаний"),
    ],
    "chat": [
        ("chat.users.search", "Поиск пользователей Hub"),
        ("chat.action.message_send_draft", "Черновик сообщения в чат (to, text)"),
    ],
    "self": [
        ("me.equipment", "Моя техника"),
        ("me.computer.health", "Состояние моего компьютера"),
        ("me.account.status", "Моя учётная запись: пароль и блокировка"),
        ("helpdesk.request_draft", "Заявка в IT письмом на it@zsgp.ru (title — тему придумай сам, description). Если из слов не ясно, в чём проблема, НЕ вызывай: попроси описать подробно"),
    ],
    "directory": [
        ("directory.people.search", "Справочник сотрудников"),
        ("directory.department.get", "Оргструктура: руководитель подразделения"),
    ],
    "warehouse": [
        ("warehouse.balances.search", "Остатки на складах 1С"),
        ("warehouse.it_requests.search", "ИТ-заявки на закупку"),
    ],
    "files": [
        ("ai.files.report", "Красивые отчёты (format, title, rows)"),
        ("ai.files.create", "Создание файлов"),
    ],
}

RULES = (
    "Return JSON only. Top-level keys: answer_markdown, tool_calls. tool_calls is optional, up to 3 objects "
    "{tool_id,args}. If you request tool_calls leave answer_markdown empty. Tool results arrive in the next "
    "user message. Do not invent live data without tool results. Drafts (letters, tasks, messages, unlocks) "
    "are only prepared for the employee's confirmation - never say they were already sent or done. "
    "When the employee asks for a request to IT, call helpdesk.request_draft right away with a title you choose; "
    "do not look up their equipment first."
)

SENT = r"(отправил[аи]?\b|разблокировал[аи]?\b|создал[аи]? задачу|письмо отправлено|уже отправлен)"


def R(*patterns: str):
    return list(patterns)


# id, text, expected groups, acceptable first-round tools (any call over rounds), arg regex (on the matching call),
# mocks, answer must (all), answer must not (any)
S = [
    ("find-laptop", "найди ноутбук 100234", {"itinvent"}, {"itinvent.equipment.search", "itinvent.equipment.get_card"}, None,
     {"itinvent.equipment.search": {"items": [{"inv_no": "100234", "model": "Lenovo ThinkPad T14", "employee": "Иванов Пётр", "branch": "Москва", "status": "в эксплуатации"}]},
      "itinvent.equipment.get_card": {"inv_no": "100234", "model": "Lenovo ThinkPad T14", "employee": "Иванов Пётр", "branch": "Москва", "status": "в эксплуатации"}},
     R(r"ThinkPad T14", r"Иванов"), R()),
    ("employee-equipment", "что числится за Ивановым Петром?", {"itinvent"}, {"itinvent.employee.list_equipment", "itinvent.employee.search", "itinvent.equipment.search"}, None,
     {"itinvent.employee.list_equipment": {"employee": "Иванов Пётр", "items": [{"inv_no": "100234", "model": "Lenovo ThinkPad T14"}, {"inv_no": "100877", "model": "Dell P2422H монитор"}]},
      "itinvent.employee.search": {"items": [{"id": 51, "name": "Иванов Пётр"}]}},
     R(r"100234", r"100877"), R()),
    ("pending-acts", "какие акты передачи ещё не подписаны?", {"itinvent"}, {"itinvent.acts.pending"}, None,
     {"itinvent.acts.pending": {"items": [{"number": "15"}, {"number": "16"}, {"number": "22"}]}},
     R(r"15", r"16", r"22"), R()),
    ("mfu-online", "сколько МФУ сейчас онлайн?", {"mfu"}, {"mfu.devices.list"}, None,
     {"mfu.devices.list": [{"name": "HP-LJ-402", "status": "online"}, {"name": "Ricoh-22", "status": "online"}, {"name": "Kyocera-17", "status": "error"}, {"name": "Canon-03", "status": "online"}]},
     R(r"\b3\b|три"), R()),
    ("low-toner", "у какого принтера заканчивается тонер?", {"mfu"}, {"mfu.devices.low_toner", "mfu.devices.list"}, None,
     {"mfu.devices.low_toner": [{"name": "Kyocera-17", "toner_pct": 4, "location": "бухгалтерия"}]},
     R(r"Kyocera-17", r"\b4\b"), R()),
    ("pages-month", "сколько страниц напечатал Ricoh-22 в сентябре?", {"mfu"}, {"mfu.pages.monthly"}, None,
     {"mfu.pages.monthly": {"device": "Ricoh-22", "months": {"2026-09": 18420}}},
     R(r"18[\s ]?420"), R()),
    ("write-letter", "напиши Сидорову письмо, что отчёт будет готов в пятницу", {"office"}, {"office.action.mail_send_draft"}, r"пятниц",
     {"office.mail.contacts.resolve": {"items": [{"name": "Сидоров Алексей", "email": "sidorov@company.ru"}]}, "office.action.mail_send_draft": {"status": "draft_ready"}},
     R(r"черновик|подтверд"), R(SENT)),
    ("reply-letter", "ответь на последнее письмо директора, что я согласен", {"office"}, {"office.action.mail_reply_draft"}, r"777|соглас",
     {"office.mail.search": {"items": [{"id": "777", "from": "Директор", "subject": "Бюджет на квартал"}]}, "office.action.mail_reply_draft": {"status": "draft_ready"}},
     R(r"черновик|подтверд"), R(SENT)),
    ("my-tasks", "какие у меня задачи на сегодня?", {"office"}, {"office.tasks.search", "office.workday.summary"}, None,
     {"office.tasks.search": {"items": [{"title": "Согласовать смету"}, {"title": "Подготовить акт приёмки"}]},
      "office.workday.summary": {"tasks_today": [{"title": "Согласовать смету"}, {"title": "Подготовить акт приёмки"}]}},
     R(r"смет", r"акт"), R()),
    ("create-task", "создай задачу позвонить подрядчику завтра", {"office"}, {"office.action.task_create_draft"}, r"подрядчик",
     {"office.action.task_create_draft": {"status": "draft_ready"}},
     R(r"черновик|подтверд"), R(SENT)),
    ("search-mail", "найди письма от поставщика за эту неделю", {"office"}, {"office.mail.search"}, None,
     {"office.mail.search": {"items": [{"subject": "Счёт №4471 на оплату"}, {"subject": "График поставки"}]}},
     R(r"4471", r"График поставки"), R()),
    ("ad-expiry", "когда у petrov истекает пароль?", {"ad"}, {"ad.user.password_status"}, r"petrov",
     {"ad.user.password_status": {"username": "petrov", "expires_at": "2026-10-21", "days_left": 16}},
     R(r"21\.10\.2026|21 октября|2026-10-21", r"16"), R()),
    ("ad-unlock", "разблокируй учётку Иванова", {"ad"}, {"ad.action.unlock_draft", "ad.user.lockout_status"}, None,
     {"ad.user.lockout_status": {"username": "ivanov", "locked": True}, "ad.action.unlock_draft": {"status": "draft_ready"}},
     R(r"подтверд|черновик"), R(SENT)),
    ("kb-vpn", "как настроить VPN? посмотри в базе знаний", {"kb"}, {"kb.articles.search", "kb.articles.get"}, None,
     {"kb.articles.search": {"items": [{"id": 12, "title": "Настройка VPN", "snippet": "Установите OpenVPN, сервер vpn.company.ru, импортируйте профиль"}]},
      "kb.articles.get": {"title": "Настройка VPN", "text": "1. Установите OpenVPN. 2. Адрес сервера vpn.company.ru. 3. Импортируйте профиль из письма."}},
     R(r"OpenVPN", r"vpn\.company\.ru"), R()),
    ("kb-file", "пришли инструкцию по VPN файлом", {"kb"}, {"kb.attachments.send"}, None,
     {"kb.articles.search": {"items": [{"id": 12, "title": "Настройка VPN", "attachments": [{"id": 3, "name": "vpn.pdf"}]}]}, "kb.attachments.send": {"status": "sent", "name": "vpn.pdf"}},
     R(r"vpn\.pdf|файл"), R()),
    ("socket", "к какому порту подключена розетка 12-A-04?", {"network"}, {"network.socket.search"}, r"12-A-04",
     {"network.socket.search": {"socket": "12-A-04", "switch": "SW-2F-01", "port": "Gi1/0/17", "vlan": 20}},
     R(r"SW-2F-01", r"Gi1/0/17"), R()),
    ("ping", "пингани 10.0.0.5", {"network"}, {"network.host.ping"}, r"10\.0\.0\.5",
     {"network.host.ping": {"host": "10.0.0.5", "alive": False, "loss_pct": 100}},
     R(r"недоступ|не отвечает|не пингуется|потер"), R()),
    ("patch-panels", "покажи патч-панели в серверной", {"network"}, {"network.ports.search", "network.branch.overview", "network.socket.search"}, None,
     {"network.ports.search": {"items": [{"panel": "PP-1", "ports": 24, "location": "серверная"}]}, "network.branch.overview": {"panels": [{"panel": "PP-1", "ports": 24}]}},
     R(r"PP-1"), R()),
    ("chat-msg", "напиши Петрову в чат, что совещание переносится на 15:00", {"chat"}, {"chat.action.message_send_draft"}, r"15[:.]00",
     {"chat.users.search": {"items": [{"id": 9, "name": "Петров Сергей"}]}, "chat.action.message_send_draft": {"status": "draft_ready"}},
     R(r"черновик|подтверд"), R(SENT)),
    ("my-computer", "какой у меня компьютер?", {"self"}, {"me.equipment"}, None,
     {"me.equipment": {"items": [{"type": "Ноутбук", "model": "HP EliteBook 840", "inv_no": "100412"}]}},
     R(r"EliteBook"), R()),
    ("slow-pc", "мой комп тормозит", {"self"}, {"me.computer.health"}, None,
     {"me.computer.health": {"uptime_days": 43, "disk_free_pct": 3, "ram_used_pct": 91}},
     R(r"диск|перезагруз"), R()),
    ("it-request", "не печатает принтер, создай заявку в IT", {"self"}, {"helpdesk.request_draft"}, r"принтер",
     {"helpdesk.request_draft": {"status": "draft_ready"}},
     R(r"подтверд|черновик|обращени|заявк"), R(SENT)),
    ("it-vague", "создай заявку в IT", set(), set(), None, {}, R(r"опиш|подроб|уточн|что (именно|случилось)|\?"), R(SENT)),
    ("phone", "какой рабочий телефон у Смирновой из отдела кадров?", {"directory"}, {"directory.people.search"}, None,
     {"directory.people.search": {"items": [{"name": "Смирнова Ольга", "department": "Отдел кадров", "phone": "+7 495 123-45-67 доб. 214"}]}},
     R(r"214"), R()),
    ("head-dept", "кто руководитель отдела закупок?", {"directory"}, {"directory.department.get"}, None,
     {"directory.department.get": {"department": "Отдел закупок", "head": "Орлов Андрей Сергеевич"}},
     R(r"Орлов"), R()),
    ("stock", "сколько картриджей CF259A на складе?", {"warehouse"}, {"warehouse.balances.search"}, r"CF259A",
     {"warehouse.balances.search": {"items": [{"name": "Картридж CF259A", "qty": 12, "warehouse": "Центральный"}]}},
     R(r"\b12\b"), R()),
    ("overdue-requests", "какие ИТ-заявки на закупку просрочены?", {"warehouse"}, {"warehouse.it_requests.search"}, None,
     {"warehouse.it_requests.search": {"items": [{"number": "123-ИТ", "overdue_days": 5}, {"number": "131-ИТ", "overdue_days": 2}]}},
     R(r"123-ИТ", r"131-ИТ"), R()),
    ("excel-report", "сделай excel-отчёт по технике в Москве", {"files", "itinvent"}, {"ai.files.report", "ai.files.create"}, None,
     {"itinvent.equipment.list_by_branch": {"items": [{"inv_no": "100234", "model": "ThinkPad T14"}, {"inv_no": "100877", "model": "Dell P2422H"}]}, "ai.files.report": {"status": "created", "name": "Техника Москва.xlsx"}},
     R(r"xlsx|файл|отч"), R()),
    ("hello", "привет", set(), set(), None, {}, R(r"."), R()),
    ("translate", "переведи на английский: добрый день, коллеги", set(), set(), None, {}, R(r"Good (day|afternoon)|Hello|Dear colleagues"), R()),
    ("usd", "какой сегодня курс доллара?", set(), set(), None, {}, R(r"не (могу|имею|располагаю|знаю)|нет доступа|недоступ"), R(r"\d{2},\d{2}")),
    ("not-found", "что числится за Несуществующим Иваном?", {"itinvent"}, {"itinvent.employee.list_equipment", "itinvent.employee.search", "itinvent.equipment.search"}, None,
     {"itinvent.employee.search": {"items": []}, "itinvent.employee.list_equipment": {"items": []}, "itinvent.equipment.search": {"items": []}},
     R(r"не найден|не нашёл|не нашла|нет данных|ничего не"), R(r"inv_no|ноутбук|монитор")),
    ("forbidden", "когда истекает пароль у admin?", {"ad"}, {"ad.user.password_status"}, None,
     {"ad.user.password_status": {"error": "forbidden", "message": "Недостаточно прав"}},
     R(r"прав|доступ|IT|ИТ"), R(r"\d{2}\.\d{2}\.\d{4}")),
    ("forgot-password", "забыл пароль от учётки", {"ad", "self"}, {"me.account.status", "ad.user.lockout_status", "ad.user.password_status"}, None,
     {"me.account.status": {"locked": False, "expires_at": "2026-12-01", "days_left": 57}},
     R(r"IT|ИТ|сброс|администратор|обрат"), R()),
]


def _percentile(values, pct):
    if not values:
        return 0
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(round(pct / 100 * (len(ordered) - 1))))]


def _parse(text: str):
    cleaned = re.sub(r"^```(?:json)?|```$", "", (text or "").strip()).strip()
    return json.loads(cleaned)


def _llm(model, key, base, messages):
    body = {"model": model, "messages": messages, "temperature": 0.2, "max_tokens": 1500, "response_format": {"type": "json_object"}}
    request = urllib.request.Request(
        base + "/chat/completions", data=json.dumps(body).encode(),
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
    )
    started = time.perf_counter()
    response = json.load(urllib.request.urlopen(request, timeout=120))
    usage = response.get("usage", {})
    return (
        response["choices"][0]["message"].get("content") or "",
        time.perf_counter() - started,
        usage.get("prompt_tokens", 0),
        usage.get("completion_tokens", 0),
    )


def run_one(scenario, model, key, base, system_prompt, all_groups, service):
    sid, text, groups, tools_ok, arg_re, mocks, must, must_not = scenario
    result = {"id": sid, "text": text, "routing_ok": True, "tool_ok": True, "args_ok": True, "answer_ok": False,
              "routed": [], "calls": [], "ms_jev": 0, "ms_llm": 0, "rounds": 0, "error": "", "answer": ""}
    started = time.perf_counter()
    routed = service._route_tool_groups_jev(trigger_text=text, available_groups=set(all_groups))
    result["ms_jev"] = round((time.perf_counter() - started) * 1000)
    routed = set(all_groups) if routed is None else set(routed)
    result["routed"] = sorted(routed)
    if groups and not groups <= routed:
        result["routing_ok"] = False
    if not groups and routed:
        result["routing_note"] = "extra tools for a no-tool request"
    visible = [(tid, label) for g in sorted(routed) for tid, label in CATALOG.get(g, [])]
    tools_text = "\n".join(f"- {tid} — {label}" for tid, label in visible) or "(инструменты не нужны)"
    messages = [
        {"role": "system", "content": system_prompt + "\n\n" + RULES + "\n\nДоступные инструменты:\n" + tools_text},
        {"role": "user", "content": text},
    ]
    all_calls = []
    final = ""
    try:
        for round_no in range(1, 4):
            content, elapsed, _pt, _ct = _llm(model, key, base, messages)
            result["ms_llm"] += round(elapsed * 1000)
            result["rounds"] = round_no
            data = _parse(content)
            calls = data.get("tool_calls") or []
            if not calls:
                final = data.get("answer_markdown") or ""
                break
            all_calls.extend(calls)
            results_payload = {}
            for call in calls:
                tid = str(call.get("tool_id"))
                results_payload[tid] = mocks.get(tid, {"items": [], "note": "нет данных"})
            messages.append({"role": "assistant", "content": content})
            messages.append({"role": "user", "content": "Результаты инструментов: " + json.dumps(results_payload, ensure_ascii=False)})
    except Exception as exc:  # noqa: BLE001
        result["error"] = f"{type(exc).__name__}: {str(exc)[:100]}"
    result["calls"] = [str(c.get("tool_id")) for c in all_calls]
    result["answer"] = final[:400]
    if tools_ok:
        matching = [c for c in all_calls if str(c.get("tool_id")) in tools_ok]
        result["tool_ok"] = bool(matching)
        if arg_re:
            result["args_ok"] = any(re.search(arg_re, json.dumps(c.get("args") or {}, ensure_ascii=False), re.I) for c in matching)
    else:
        result["tool_ok"] = not all_calls
    answer_ok = bool(final) and all(re.search(p, final, re.I) for p in must) and not any(re.search(p, final, re.I) for p in must_not)
    result["answer_ok"] = answer_ok
    result["pass"] = bool(result["routing_ok"] and result["tool_ok"] and result["args_ok"] and answer_ok and not result["error"])
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="google/gemini-3.1-flash-lite")
    parser.add_argument("--prompt-file", required=True)
    parser.add_argument("--out", default="")
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()

    from backend.ai_chat import service
    from shared.llm import jev_client
    from shared.llm.env import read_env

    if not jev_client.is_configured():
        print("Jev is not configured.")
        return 2
    key = str(read_env("OPENROUTER_API_KEY") or "").strip()
    base = str(read_env("OPENROUTER_BASE_URL") or "https://openrouter.ai/api/v1").strip().rstrip("/")
    system_prompt = Path(args.prompt_file).read_text(encoding="utf-8")
    all_groups = set(CATALOG)

    with ThreadPoolExecutor(args.workers) as pool:
        results = list(pool.map(lambda s: run_one(s, args.model, key, base, system_prompt, all_groups, service), S))

    total = len(results)
    passed = sum(1 for r in results if r["pass"])
    summary = {
        "model": args.model,
        "scenarios": total,
        "passed": f"{passed}/{total}",
        "routing_ok": f"{sum(1 for r in results if r['routing_ok'])}/{total}",
        "tool_ok": f"{sum(1 for r in results if r['tool_ok'] and r['args_ok'])}/{total}",
        "answer_ok": f"{sum(1 for r in results if r['answer_ok'])}/{total}",
        "jev_ms_p50": round(_percentile([r["ms_jev"] for r in results], 50)),
        "llm_ms_p50": round(_percentile([r["ms_llm"] for r in results], 50)),
        "llm_ms_p95": round(_percentile([r["ms_llm"] for r in results], 95)),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    for r in results:
        if not r["pass"]:
            flags = [n for n, ok in (("маршрут", r["routing_ok"]), ("инструмент", r["tool_ok"]), ("аргументы", r["args_ok"]), ("ответ", r["answer_ok"])) if not ok]
            print(f"\nПРОВАЛ [{r['id']}] {r['text']!r}: {', '.join(flags) or r['error']}")
            print(f"   маршрут={r['routed']} вызовы={r['calls']} {('ошибка=' + r['error']) if r['error'] else ''}")
            print(f"   ответ: {r['answer'][:260]!r}")
    if args.out:
        Path(args.out).write_text(json.dumps({"summary": summary, "results": results}, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"\nreport: {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
