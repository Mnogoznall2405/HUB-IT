# A11 Benchmark Pack

Обновлено: 2026-11-29. Этот документ описывает воспроизводимый measurement pack для PR #105. Он не является разрешением на запуск платного benchmark, merge, deploy или production-миграции.

## Состав

| Файл | Назначение | SHA256 |
| --- | --- | --- |
| `a9-artifacts/bench_intel_corpus.json` | frozen corpus, 205 сценариев: dev 140, holdout 65 | `0fb9a10337585f13afa0635095a3f20e932f1aa20c2bc245489c42c777658841` |
| `a9-artifacts/bench_seed.py` | синтетический contour: users, directory, tasks, KB, announcements, files | `493900202b2618ae442a69220d8efb03f45256dc37ed221ee979958d9c9c0c97` |
| `a9-artifacts/bench_corpus_gen.py` | генератор/источник корпуса для аудита разметки | `75fea9e6d7e58ebcb78112fd3e813a4d4b93c8c19e7a5b85f3adb9f2e3307248` |
| `a9-artifacts/a9_real_run.py` | real-provider end-to-end harness | `3fa057fe2a41160e80caea1d77b16e02f5f07f0db08331c26dac7418de89d928` |

Важно: `meta.version` внутри corpus остаётся `a11-v12` по историческим причинам, но SHA256 файла совпадает с финальным hash `0fb9a1033758...`, который прежний отчёт называл corpus v13. Сам файл не редактируется только ради номера версии, чтобы не разрушить сравнимость hash.

## Принципы безопасного запуска

1. `--env` больше не имеет implicit default на соседний checkout. Provider keys и test-contour settings загружаются только из явно указанного dotenv файла.
2. Нельзя использовать production `.env`, если он содержит подключения к реальным confidential external systems.
3. Синтетический contour покрывает пользователей, справочник, задачи, KB, объявления и файлы. ITINVENT SQL, Exchange, AD и 1C не seed'ятся. Сценарии с такими external dependencies должны использовать отдельно approved isolated contour или честно классифицироваться `BLOCKED`; они не должны silently читать production data.
4. `--seed-only` выполняет только локальную подготовку sqlite contour и manifest; paid/provider calls не выполняются.
5. Полный benchmark запускается только после approval численного бюджета, provider/model и immutable run configuration.

## Локальная проверка pack без платных вызовов

Выполнено на SHA `0321938ed88545a4b35745785c6897c6c7f3b74e` до commit интеграции pack:

```powershell
python documentation\technical\ai-architecture-audit\a9-artifacts\a9_real_run.py `
  --label seedcheck --seed --seed-only --out .codex_tmp\a11_seedcheck.json
```

Результат: PASS, manifest записан, `scenarios=205`, `provider_calls=0`, `env_keys_loaded=0`, corpus hash совпадает с таблицей выше. Проверка затрагивает только временную sqlite DB в `%TEMP%`.

Дополнительно:

```powershell
python -m py_compile `
  documentation\technical\ai-architecture-audit\a9-artifacts\a9_real_run.py `
  documentation\technical\ai-architecture-audit\a9-artifacts\bench_seed.py `
  documentation\technical\ai-architecture-audit\a9-artifacts\bench_corpus_gen.py
```

Результат: PASS.

## Draft full-run configuration

Не запускать до budget approval. Конфигурация фиксируется заранее и не меняется после начала измерения:

```powershell
python documentation\technical\ai-architecture-audit\a9-artifacts\a9_real_run.py `
  --label final_holdout --split holdout --seed `
  --env <approved-bench-env-file> `
  --provider <approved-provider> `
  --set AI_READ_FAST_PATH_ENABLED=0 `
  --set AI_RUN_RESULT_REUSE_ENABLED=0 `
  --set AI_COMPACT_SPECS_ENABLED=0 `
  --out <approved-artifact-path>
```

Затем тем же immutable config:

```powershell
python documentation\technical\ai-architecture-audit\a9-artifacts\a9_real_run.py `
  --label final_dev --split dev --seed `
  --env <approved-bench-env-file> `
  --provider <approved-provider> `
  --set AI_READ_FAST_PATH_ENABLED=0 `
  --set AI_RUN_RESULT_REUSE_ENABLED=0 `
  --set AI_COMPACT_SPECS_ENABLED=0 `
  --out <approved-artifact-path>
```

`AI_JEV_ROUTING` не скрывается в draft command: harness по умолчанию ставит `--jev 1`. Перед запуском владелец должен явно утвердить исследуемую production candidate configuration. Если выбрано `--jev 0`, ceilings не активны; если выбрано `--jev 1`, нужен отдельный качественный verdict по routing.

## Новые aggregate fields

Harness теперь дополнительно пишет `aggregate.quality`:

- `pass_rate_all_scenarios` — PASS / все сценарии; BLOCKED и NO_CHECK не являются PASS;
- `pass_rate_scored_scenarios` — PASS / (PASS+FAIL+PARTIAL), чтобы видеть качество измеримых сценариев отдельно от blocked contour;
- `scored_scenarios`, `blocked_scenarios`, `no_check_scenarios`.

Эти поля введены до следующего measurement campaign и не являются post-hoc изменением критериев. Production GO по-прежнему невозможен при unresolved BLOCKED в критических сценариях.

## Что не входит в pack

- raw `real_run_*.json` outputs из PR #74;
- `_fc2_*`, `_fd2_*`, `_fh2_*`, `_smk_*` logs;
- ad-hoc root `_*.py` probe/patch scripts;
- secrets, connection strings, реальные персональные данные;
- production configuration values.

## Текущий статус

Pack подготовлен для review и воспроизводимого запуска, но full benchmark всё ещё **BLOCKED** до:

1. approval численного бюджета/provider/model;
2. approved isolated contour для external-dependent сценариев или осознанного BLOCKED verdict;
3. точного final SHA после commit pack;
4. explicit decision по JEV/routing configuration.
