# HUB Desktop — ротация ключа update manifest

## Текущий ключ

| Поле | Значение |
|---|---|
| `key_id` | `hubit-zsgp-ru-tls-2026-04` |
| Subject | `CN=*.zsgp.ru` |
| Thumbprint | `0A9CFEF49EB1E11819D81A351978BAFA05EF7CBE` |
| Истекает | 7 ноября 2026 года |
| Начать плановую ротацию не позднее | 7 октября 2026 года |

Private key production TLS-сертификата используется по принятому владельцем продукта исключению
одновременно для HTTPS и прикладной RSA-PSS-подписи update manifest.

## Плановая ротация

1. Получить новый публично доверенный TLS-сертификат, покрывающий `hubit.zsgp.ru`, с RSA private key.
2. Не переключать IIS binding и manifest signer немедленно.
3. Назначить новому ключу новый неизменяемый `key_id`, например по месяцу выдачи.
4. Экспортировать только public certificate DER.
5. Добавить новый `key_id → public certificate` в доверенный набор `DesktopUpdateTrust` рядом со
   старым ключом.
6. Добавить unit-тесты: оба ключа принимаются, неизвестный `key_id` и перекрёстная подпись
   отклоняются.
7. Выпустить промежуточную Desktop-версию, подписанную ещё старым ключом.
8. Дождаться достаточного rollout промежуточной версии на пилотной и массовой группах.
9. Переключить IIS TLS binding и `publish-update.ps1` на новый thumbprint/key_id.
10. Опубликовать тестовый manifest новым ключом и проверить его клиентским `UpdateCore`.
11. После согласованного overlap удалить старый ключ из следующей Desktop-версии.
12. Старый private key удалить по корпоративной PKI-процедуре только после завершения overlap и
    сохранения обязательного release evidence.

Перевыпуск сертификата с новым private key без предварительного пункта 5 разрывает автоматическое
обновление старых клиентов.

## Аварийная ротация

Если private key потерян или скомпрометирован:

1. Немедленно убрать `stable/latest.json`.
2. Заменить/отозвать TLS-сертификат по процедуре PKI.
3. Запретить release-учётной записи доступ к старому key container.
4. Не подписывать новый manifest скомпрометированным ключом даже для «последнего перехода».
5. Если новый public key уже встроен в установленную версию, переключить signer и провести пилот.
6. Если новый public key не встроен, выпустить и вручную/GPO установить новый bootstrap MSI/Setup.
7. После восстановления проверить HTTPS, manifest signature, SHA-256, UAC cancel и сохранение
   WebView2 profile.
8. Зафиксировать incident timeline и список затронутых release manifest.

## Инварианты

- private keys не попадают в Git, PFX release archive, IIS content root, логи и support bundle;
- клиент доверяет только compile-time allowlist `key_id`;
- `key_id` не переиспользуется для другого public key;
- version folder не перезаписывается;
- смена TLS-сертификата сама по себе не расширяет доверие updater;
- ошибки TLS не игнорируются;
- kill switch — отсутствие `latest.json`, а не downgrade manifest.
