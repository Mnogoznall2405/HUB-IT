"""Write bounded, source-check diagnostics; never read secrets or user data."""
import json
import os
from pathlib import Path
results = {key: os.environ.get(key + '_RESULT', 'skipped') for key in ('APPLY', 'INSTALL', 'LOGIC', 'LINT', 'JEST')}
lines = ['# Проверки ветки доставки чата', '', f"Исходный SHA запуска: `{os.environ.get('GITHUB_SHA', '')}`.", '',
         '| Этап | Результат |', '| --- | --- |']
lines += [f'| {key} | {value} |' for key, value in results.items()]
lines += ['', 'Сгенерированные изменения экранов включаются в коммит только при успешных APPLY, LOGIC и LINT. '
          'Даже тогда PR остаётся черновым до проверки результатов Jest и Android.', '',
          'Android, APK, production и реальные сообщения: **NOT RUN / не изменялись**.', '']
for key, filename in [('APPLY', 'hub-apply.log'), ('INSTALL', 'hub-install.log'), ('LOGIC', 'hub-logic.log'), ('LINT', 'hub-lint.log')]:
    path = Path('/tmp') / filename
    if not path.exists():
        continue
    text = path.read_text(errors='replace')
    selected = text.splitlines()[-100:]
    lines.extend([f'## {key}', '', '```text', *selected, '```', ''])
path = Path('/tmp/hub-jest.json')
if path.exists():
    data = json.loads(path.read_text())
    lines += ['## Jest', '', f"Тестов: {data.get('numTotalTests', 0)}; passed: {data.get('numPassedTests', 0)}; failed: {data.get('numFailedTests', 0)}.", '']
    for suite in data.get('testResults', []):
        failed = [test for test in suite.get('assertionResults', []) if test.get('status') == 'failed']
        if suite.get('status') == 'failed' and not failed:
            lines.extend([str(suite.get('name', '')), str(suite.get('message', ''))[:2500], ''])
        for test in failed[:10]:
            lines.extend([f"### {test.get('fullName', '')}", '```text', '\n'.join(test.get('failureMessages', []))[:2000], '```', ''])
else:
    path = Path('/tmp/hub-jest.log')
    if path.exists():
        lines.extend(['## Jest log', '```text', *path.read_text(errors='replace').splitlines()[-30:], '```'])
output = Path('documentation/technical/CHAT_DELIVERY_BRANCH_CHECKS.md')
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text('\n'.join(lines) + '\n')
