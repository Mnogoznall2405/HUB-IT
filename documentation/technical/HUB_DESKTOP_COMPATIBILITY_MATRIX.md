# HUB Desktop — compatibility and release acceptance matrix

Статус: обязательный шаблон evidence для release candidate. Автоматические проверки выполняются скриптами; строки с реальной Windows/UI/UAC требуют ручной фиксации результата и не считаются пройденными по факту успешной сборки.

## Правила evidence

Для каждого release candidate создать каталог или запись вида:

```text
HUB-Desktop-<version>/
├── automated-gate.txt
├── win10-22h2-x64.md
├── win11-current-x64.md
├── update-0.1.6-to-<version>.md
└── hashes-and-manifest.md
```

Каждая ручная строка содержит: дату, Windows edition/build, тип сессии, имя тестера, исходную/целевую версии, `Pass/Fail/Blocked`, краткий результат и ссылку на безопасный screenshot/log. Cookies, tokens, private keys, содержимое документов и полный Windows SID в evidence запрещены.

## Automated gate

| ID | Проверка | Команда | Release criterion |
|---|---|---|---|
| AG-01 | .NET unit/integration tests | `dotnet test desktop/Hub.Desktop.Tests -c Release` | 0 failed |
| AG-02 | Desktop Release build | `dotnet build desktop/Hub.Desktop.sln -c Release` | 0 errors/warnings |
| AG-03 | React Desktop regression | входит в `scripts/desktop/test-release.ps1` | 0 failed |
| AG-04 | Frontend production build | `npm run build` | exit 0 |
| AG-05 | NuGet vulnerability audit | `scripts/desktop/test-dependencies.ps1` | query successful, 0 known vulnerabilities |
| AG-06 | ADMX/ADML validation | `scripts/desktop/validate-policy-templates.ps1` | exact supported policy set |
| AG-07 | Installer/package validation | `scripts/desktop/validate-release.ps1` | hashes, metadata, prereqs, forbidden files all pass |
| AG-08 | CycloneDX SBOM | `scripts/desktop/generate-sbom.ps1` then validator | deterministic output, valid SHA sidecar |
| AG-09 | Update manifest verification | `scripts/desktop/verify-update-manifest.ps1` | signature, size and setup hash pass |

Основная команда: `powershell -ExecutionPolicy Bypass -File scripts\desktop\test-release.ps1`.

## Supported environment matrix

| Axis | Required values |
|---|---|
| OS | Windows 10 22H2 x64; current supported Windows 11 x64 |
| Session | local console; RDP |
| Device | physical; VMware/Hyper-V with working driver; software-render fallback |
| Locale | RU; at least one non-RU system locale |
| Scale | 100%, 125%, 150%, 200%; mixed-DPI two-monitor transition |
| Identity | `zsgp.corp` joined PC; workgroup/non-domain PC |
| File handlers | Office/PDF installed; selected handler absent |
| App state | visible; minimized; hidden in tray; started with Windows |

## Manual acceptance scenarios

| ID | Scenario | Required result | Win10 | Win11 |
|---|---|---|---|---|
| CM-01 | Fresh offline Setup as standard user | One UAC request; all prerequisites install without Internet; correct logo/Start shortcut; one tray process | Not run | Not run |
| CM-02 | Launch and single instance | First launch opens; tray click restores; second process activates first; X/Alt+F4 hides; Exit terminates | Not run | Not run |
| CM-03 | Maximize/titlebar/mixed DPI | Header remains visible above taskbar; no extra border/scrollbar; hit targets and focus remain correct after monitor move | Not run | Not run |
| CM-04 | Existing WebView2 session | Restart, reboot and ordinary app update preserve the authenticated profile until server policy expires/revokes it | Not run | Not run |
| CM-05 | Ordinary login fallback | Domain and non-domain PCs can always use current HUB login/2FA/passkey; Windows username is only a login hint | Not run | Not run |
| CM-06 | Realtime visible/minimized/tray | WebSocket reconnects after sleep/network loss; new events arrive in all three app states | Not run | Not run |
| CM-07 | Native notification | One event produces one Desktop notification; click restores and navigates; latest fallback remains until acted on | Not run | Not run |
| CM-08 | Browser notification regression | Chrome/browser delivery still works independently; Desktop presence never globally suppresses other PCs | Not run | Not run |
| CM-09 | Download only | Browser and Desktop download complete correctly; cancellation is not reported as failure | Not run | Not run |
| CM-10 | Download and open | Desktop opens only allowed Office/ODF/RTF/CSV/PDF file after completion; parallel downloads do not consume wrong intent | Not run | Not run |
| CM-11 | Missing file handler/dangerous type | Friendly error for missing app; `exe/msi/bat/cmd/ps1/js/lnk` and partial downloads never auto-open | Not run | Not run |
| CM-12 | VNC/external navigation | Existing allowed `vnc:` flow works in web and Desktop; unapproved schemes/origins remain blocked | Not run | Not run |
| CM-13 | Autostart and GPO absent | First-run/default and explicit user choice survive upgrade; no policy behaves exactly as unmanaged client | Not run | Not run |
| CM-14 | Managed GPO | Each exact DWORD policy applies; forced autostart cannot be toggled; removing policy restores saved user choice | Not run | Not run |
| CM-15 | Diagnostics/recovery | About/status accurate; support bundle redacted; controlled WebView recovery preserves recoverable settings | Not run | Not run |
| CM-16 | Accessibility | Keyboard-only operation, visible focus, Narrator names/status, 200% scale and high contrast remain usable | Not run | Not run |
| CM-17 | RDP/VM performance | Diagnostics identifies render tier; no forced GPU flags; UI remains functionally correct in software rendering | Not run | Not run |
| CM-18 | Deep links/workspace | `hubit://`, `--route`, Jump List and second-instance activation open only allowlisted internal routes; removed monitor restores visible bounds; logout clears last protected route | Not run | Not run |
| CM-19 | Print/download controls | `Ctrl+P` opens the system print UI; taskbar progress, Cancel, Clear finished and Open Downloads folder behave correctly with parallel transfers | Not run | Not run |
| CM-20 | Palette/settings/theme | `Ctrl+K`, permission filtering, startup page/visibility, one-time X prompt, hotkey conflict and Windows system theme work with keyboard and Narrator | Not run | Not run |
| CM-21 | VNC preflight | Browser keeps the existing flow; Desktop handles installed/missing/incomplete registration, validates endpoint, never logs token/address and explicit copy contains only host/port | Not run | Not run |

## Mandatory update transition: 0.1.6 → 0.1.7

Проверить отдельно на Windows 10 и 11:

1. вручную установить именно bootstrap `0.1.6`;
2. убедиться, что Setup/MSI hashes совпадают с release archive;
3. опубликовать подписанный manifest `0.1.7` только тестовой группе;
4. проверить обнаружение при visible, minimized и hidden-in-tray состоянии;
5. оборвать download и подтвердить безопасное продолжение через `.partial`;
6. проверить недостаток места и повреждённый package — установка не начинается;
7. выбрать «Позже», перезапустить Windows и проверить 24-часовое defer-поведение;
8. отменить UAC — остаётся рабочая `0.1.6` и она снова запускается без elevation;
9. смоделировать Setup failure — прежняя версия и WebView2 profile остаются рабочими;
10. подтвердить UAC — устанавливается `0.1.7`, сохраняются login/session, autostart, route и настройки;
11. проверить отсутствие `.partial`, старых повреждённых download и лишних процессов;
12. проверить опубликованный manifest тем же `UpdateCore` и сохранить sanitized evidence.

До двух успешных реальных строк этого перехода исходная версия проекта остаётся `0.1.6`. Успешная локальная сборка не разрешает публикацию `0.1.7` в stable.

## 0.3 device-bound reauthentication pilot

Этот блок неприменим, пока реализация gated по ADR-0005 и threat model. Когда появится код, обязательны дополнительные сценарии:

- регистрация только после обычного login + текущей 2FA policy;
- точное eligibility `zsgp.corp`, совпадающий normalized HUB/Windows username;
- non-domain и mismatch всегда используют обычный login;
- одна подпись challenge принимается ровно один раз при параллельной отправке;
- copied WebView2 profile без CNG key не проходит повторный вход;
- TPM/software provider отображается корректно;
- потеря/удаление ключа безопасно возвращает login form;
- self/admin revoke и inactive user немедленно запрещают новый device login;
- session limit, idle/absolute expiry, logout, admin IP policy и WebSocket не обходятся.

## Release decision

Release owner отмечает кандидат `Go` только если AG-01..09 прошли, обе требуемые OS-колонки соответствующего этапа заполнены `Pass`, нет открытых P0/P1 и приложены hashes/manifest/SBOM. Любой `Not run`, `Fail` или необъяснённый `Blocked` в обязательной строке означает `No-go`.
