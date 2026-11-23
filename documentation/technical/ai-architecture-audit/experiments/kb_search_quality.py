# -*- coding: utf-8 -*-
"""Изолированный эксперимент: качество текущего KB-поиска (Python scorer).

Запуск: из корня репозитория
    .venv\\Scripts\\python.exe documentation\\technical\\ai-architecture-audit\\experiments\\kb_search_quality.py

Создаёт одноразовую sqlite-БД, заполняет AppAiKbChunk синтетическими
RU-документами и прогоняет тестовый набор запросов через реальный
AiKbRetrievalService.retrieve() — без сети, без прод-данных.
"""
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "WEB-itinvent"))

os.environ["APP_ENV"] = "development"
_tmp = Path(tempfile.mkdtemp(prefix="kb_exp_"))
os.environ["APP_DATABASE_URL"] = f"sqlite:///{(_tmp / 'app.sqlite3').as_posix()}"

from backend.appdb.db import app_session, ensure_app_schema_initialized  # noqa: E402
from backend.appdb.models import AppAiKbChunk  # noqa: E402
from backend.ai_chat.retrieval import AiKbRetrievalService  # noqa: E402

# --- Синтетический корпус «как в реальной KB» ----------------------------------
DOCS = [
    ("d1", "Порядок разблокировки доменной учётной записи",
     "Если учётная запись Active Directory заблокирована после нескольких "
     "неудачных попыток ввода пароля, обратитесь в службу ИТ. Разблокировка "
     "выполняется администратором домена через оснастку ADUC. Причина блокировки "
     "проверяется по журналу событий."),
    ("d2", "Сброс пароля домена и Windows",
     "Пароль домена истекает каждые 90 дней. Для смены нажмите Ctrl+Alt+Del и "
     "выберите «Сменить пароль». Если пароль уже истёк, администратор выполняет "
     "сброс вручную."),
    ("d3", "Подключение сетевого принтера и МФУ",
     "Откройте \\\\print-server, найдите принтер по имени кабинета, дважды "
     "щёлкните для установки драйвера."),
    ("d4", "Заявка на закупку картриджей",
     "Заявки на расходные материалы оформляются через раздел «Склад». Укажите "
     "модель принтера и номер картриджа."),
    ("d5", "Настройка VPN для удалённой работы",
     "Скачайте конфигурационный файл OpenVPN, импортируйте в клиент, введите "
     "доменные учётные данные."),
    ("d6", "Замена картриджа HP LaserJet",
     "Откройте переднюю крышку, извлеките использованный картридж, установите "
     "новый до щелчка. Утилизация — через ИТ-отдел."),
    ("d7", "Типовые ошибки при входе в 1С",
     "Ошибка «Информационная база не обнаружена» означает недоступность "
     "сервера 1С. Проверьте сетевое подключение."),
    ("d8", "Выдача ноутбука новому сотруднику",
     "По заявке руководителя ИТ выделяет ноутбук из фонда, оформляет акт "
     "передачи и заводит учётку за 1 рабочий день."),
    ("d9", "Шаблоны заявлений кадрового учёта",
     "Здесь собраны бланки. Файл: Zayavlenie_na_otpusk.docx"),
    ("d10", "Выдача мониторов со склада",
     "Мониторы выдаются по заявке с подписью руководителя подразделения."),
    ("d11", "Инструкция по Wi-Fi в офисе",
     "Сотрудники подключаются к сети CORP-WIFI с доменной учёткой. Гостевая "
     "сеть GUEST-WIFI не даёт доступа к внутренним ресурсам."),
    ("d12", "Порядок действий при утере корпоративного телефона",
     "Немедленно сообщите в ИТ для блокировки SIM и удалённого стирания данных."),
    ("d13", "Инвентарные номера и маркировка оборудования",
     "Каждой единице оборудования присваивается номер вида ИНВ-XXXX, "
     "например ИНВ-0042. Номер наносится на корпус и указывается в акте."),
]

# (запрос, ожидаемый doc_id или None, категория проверки)
QUERIES = [
    # семантика/парафраз — ключевой кейс задания
    ("не могу войти в компьютер после отпуска", "d1", "paraphrase"),
    ("заблокировалась учётка что делать", "d1", "colloquial"),
    ("не пускает в домен пароль правильный", "d1", "paraphrase"),
    # точные формулировки
    ("разблокировка доменной учётной записи", "d1", "exact"),
    ("сброс пароля домена", "d2", "exact"),
    # словоформы
    ("заменить картридж в принтере", "d6", "wordform"),
    ("выдали монитор со склада", "d10", "wordform"),
    # опечатки
    ("замена катриджа", "d6", "typo"),
    ("подключить прентер", "d3", "typo"),
    ("заявление на отпуск бланк", "d9", "attachment_name"),
    ("Zayavlenie_na_otpusk.docx", "d9", "filename"),
    # смешанный RU/EN
    ("vpn не подключается", "d5", "mixed_lang"),
    ("wifi пароль гостевой", "d11", "mixed_lang"),
    # точные идентификаторы (инвентарный номер есть в корпусе)
    ("ИНВ-0042", "d13", "exact_id"),
    ("инвентарный номер оборудования", "d13", "exact_id"),
    # подразделение/организация
    ("заявка руководителя на ноутбук", "d8", "department"),
    # ё/е варианты
    ("учетная запись заблокирована", "d1", "ye_variant"),
    # отрицательные запросы: релевантного документа в корпусе НЕТ.
    # Скорер без порога релевантности: любая общая подстрока (>=3 симв.)
    # возвращает документ — проверяем, где возникают ложные срабатывания.
    ("инструкция по установке photoshop", None, "negative"),
    ("замена термопасты на сервере", None, "negative"),
    ("подключение гарнитуры к телефону", None, "negative"),
    ("ремонт кофемашины на кухне", None, "negative"),
]


def main() -> int:
    ensure_app_schema_initialized()
    with app_session() as session:
        for doc_id, title, content in DOCS:
            session.add(AppAiKbChunk(
                id=f"chunk-{doc_id}", document_id=doc_id, kb_article_id=doc_id,
                chunk_index=0, title=title, content=content,
                metadata_json=json.dumps({"article_id": doc_id, "title": title,
                                          "category": "general", "visibility_scope": "global"},
                                         ensure_ascii=False),
            ))
        session.commit()

    svc = AiKbRetrievalService()
    hit1 = hit3 = misses = false_hits = empty_hits = 0
    per_cat: dict[str, list[int]] = {}
    print(f"{'запрос':<52} {'ожид.':<6} {'top1':<6} {'top3':<6} категория")
    for query, expected, category in QUERIES:
        results = svc.retrieve(query=query, limit=5, current_user=None)
        found = [r["article_id"] for r in results]
        rank = (found.index(expected) + 1) if expected and expected in found else None
        if expected:
            if rank == 1:
                hit1 += 1
                hit3 += 1
                per_cat.setdefault(category, [0, 0, 0])[0] += 1
            elif rank and rank <= 3:
                hit3 += 1
                per_cat.setdefault(category, [0, 0, 0])[1] += 1
            else:
                misses += 1
                per_cat.setdefault(category, [0, 0, 0])[2] += 1
        else:
            # отрицательный запрос: любая выдача — ложное срабатывание
            if found:
                false_hits += 1
            else:
                empty_hits += 1
        print(f"{query:<52} {expected or '-':<6} {str(rank == 1):<6} "
              f"{str(bool(rank and rank <= 3)):<6} {category}  found={found[:3]}")

    expected_total = sum(1 for _, e, _ in QUERIES if e)
    negative_total = sum(1 for _, e, _ in QUERIES if not e)
    print()
    print(f"Hit@1: {hit1}/{expected_total}  Hit@3: {hit3}/{expected_total}  "
          f"Miss: {misses}/{expected_total}")
    print(f"Negative: false_hits={false_hits}/{negative_total}  "
          f"empty={empty_hits}/{negative_total}")
    print("По категориям (hit@1 / hit@3-only / miss):")
    for category, (h1, h3, m) in sorted(per_cat.items()):
        print(f"  {category:<18} {h1} / {h3} / {m}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
