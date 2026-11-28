# PR Gate — изолированный пилот (CI-01)

Рекомендательный (advisory) gate для pull request'ов. **Не является required check**,
не включён в защиту main, не меняет deploy, не имеет production-доступа и секретов.
Реализует быстрый уровень из [`.project/QUALITY_GATES.md`](../../.project/QUALITY_GATES.md)
(предложение «Быстрый PR»), когда тот документ будет принят в main.

## Что запускается

Workflow: [`.github/workflows/pr-gate.yml`](../../.github/workflows/pr-gate.yml),
триггер `pull_request` (opened/synchronize/reopened/ready_for_review). Проверки
выполняются на merge-результате PR с актуальным base — то, что GitHub реально
соберёт при merge, а не на голом head ветки.

Один стабильный итоговый check: job **`PR Gate`**. Остальные jobs — внутренние.

| job | когда | что делает |
|---|---|---|
| `prepare` | всегда | diff base…head, классификация профиля, запись base/head/tested SHA в summary |
| `hygiene` | всегда | whitespace/conflict-маркеры на diff; secret scan добавленных строк с редактированным выводом |
| `alembic` | всегда | статическая проверка трёх независимых графов (app/chat, scan, voice) без БД + self-test на синтетике |
| `frontend` | профиль | `npm ci`, существующий `npm run lint` (chat-scope), `npm run test:unit` (node-проект), изолированный `vite build --outDir` вне `dist` |
| `backend` | профиль | `compileall` backend/scan/voice, узкий pytest-профиль `test_chat_sticker_security_http.py` на изолированных sqlite-URL в `runner.temp` |
| `PR Gate` | всегда | агрегатор: один итоговый вердикт |

## Матрица путей (профили)

Классификация — `scripts/ci/pr_gate_profile.py`:

| затронутые пути | профиль |
|---|---|
| только `*.md`, `documentation/`, `docs/`, `.project/`, корневые доки | docs-only: hygiene + alembic, продуктовые jobs пропускаются (ожидаемый skip) |
| `WEB-itinvent/frontend/` | frontend |
| `WEB-itinvent/backend/`, `WEB-itinvent/shared/`, корневые `tests/`, `requirements.txt`, `pytest.ini` | backend |
| `scan_server/`, `voice_server/` | backend-профиль не включается автоматически путём scan/voice — но `compileall` внутри backend-job покрывает эти деревья, а графы alembic проверяются всегда; отдельные scan/voice runtime-профили — следующий шаг |
| `mobile-hub/` | вне скоупа пилота (есть отдельный mobile workflow); учитывается в профиле, но не блокирует |
| любой неизвестный путь | **эскалация в полный профиль frontend+backend** — молчаливого обхода нет |

Alembic-графы проверяются при любом diff: проверка статическая и занимает секунды,
а стоимость пропуска битой миграции высока.

## Как читать итоговый check

`PR Gate` различает в summary таблицу по каждому job:

- `pass` — job успешен;
- `expected skip (not in profile)` — осознанный пропуск по матрице путей, это **не** обход;
- `UNEXPECTED SKIP` — job нужен профилю, но не выполнился → FAIL;
- `CANCELLED` — отмена (concurrency/таймаут) → FAIL, отдельно от ошибок;
- `FAILURE` — падение → FAIL.

Docs-only PR: `frontend`/`backend` будут `expected skip`, итоговый check зелёный
при чистых hygiene/alembic.

## Артефакты и диагностика

- base/head/tested SHA, профиль и список изменённых файлов — в **step summary** job `prepare`;
- таблица вердиктов — в summary job `PR Gate`;
- логи узких проверок — в логах соответствующих jobs (Actions → выбранный run).
Пилот не публикует файловых артефактов: diff и профиль целиком помещаются в summary.

## Локальная проверка скриптов (без Actions)

```bash
# alembic-графы репозитория + синтетические негативные кейсы
python scripts/ci/check_alembic_graphs.py .
python scripts/ci/check_alembic_graphs.py --self-test

# hygiene/secrets на любом diff
git diff <base>...<head> > /tmp/pr.diff
python scripts/ci/check_diff_hygiene.py /tmp/pr.diff
python scripts/ci/check_secrets_diff.py /tmp/pr.diff

# классификация профиля
git diff --name-only <base>...<head> | python scripts/ci/pr_gate_profile.py
```

## Границы пилота

- Нет `pull_request_target`, нет production-секретов, `permissions: contents: read`,
  actions закреплены по SHA, `persist-credentials: false`.
- Backend-профиль намеренно узкий (проверенный security-набор на sqlite); полный
  pytest — отдельная задача после сравнительной валидации.
- `npm run lint` покрывает только chat-дерево — это известное ограничение исходного
  скрипта, а не ошибка CI; расширение lint — отдельное решение.
- Mobile-проверки не дублируются: у mobile-hub собственный workflow.
- Нет расписаний, нет required checks, нет auto-merge.

## Следующие шаги (предложение, не включено)

1. После повторяемых зелёных прогонов на реальных PR — просить владельца включить
   `PR Gate` как required check в защите main.
2. Merge-уровень: пересчёт проверок на свежем merge-результате перед фактическим
   merge (re-run после обновления base), затем — при поддержке и одобрении — merge queue.
3. Nightly (ручной запуск сначала): полный Vitest, расширенные pytest-профили
   (bot/voice/scan), PG-матрица миграций на изолированном PostgreSQL, flake-отчёт.
4. Release-уровень: ручной GO/NO-GO для неизменяемого SHA — production build вне
   live-worktree, изолированная PG, restore/rollback-репетиция, security review.
5. Расширение backend-профиля узкими наборами scan/voice и профильными e2e по мере
   подтверждения стабильности.
