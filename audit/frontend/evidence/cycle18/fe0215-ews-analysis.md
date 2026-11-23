# FE-0215 — Exchange EWS analysis (cycle 18)

## Transport actually used

- `WEB-itinvent/backend/services/mail_exchange_transport.py:139-171`
  - `exchangelib.Account` + `Configuration`;
  - `Credentials(username, password)`, `auth_type=NTLM`;
  - `service_endpoint=EWS_URL` or `server=EXCHANGE_HOST`;
  - `autodiscover=False`.
- IMAP/SMTP are not used anywhere in the mail path. A local IMAP/SMTP fixture
  would not be exercised by the backend.

## Draft / autosave path

- `WEB-itinvent/backend/services/mail_draft_lifecycle.py:88-137`
  - new draft: `Message(account=..., folder=account.drafts, subject=..., body=HTMLBody(...),
    to_recipients=...)`; `FileAttachment(**exchange_attachment_kwargs(...))` for
    attachments (inline images are cid attachments); `draft_item.save()`.
  - existing draft: fetch from `account.drafts`; update `save(update_fields=[subject,
    body, to_recipients, cc_recipients, bcc_recipients])`; remove/add attachments.
  - delete: `DeleteItem`.
- `WEB-itinvent/backend/services/mail_service.py:4777+` (`save_draft`) orchestrates
  the draft payload and calls the lifecycle.

## Minimal EWS contracts for the draft chain

| Operation | Purpose |
|---|---|
| GetFolder / FindFolder | resolve the Drafts folder |
| CreateItem | create a draft Message (HTML body + recipients) |
| UpdateItem | autosave subject/body/recipients and attachment changes |
| GetItem | read a draft back (reopen) |
| CreateAttachment / GetAttachment / DeleteAttachment | inline images and files |
| DeleteItem | delete a draft |
| SendItem | send (out of scope for FE-0215 autosave, but needed for full mail) |

Authentication: NTLM over TLS; a test double must terminate TLS or allow HTTP
loopback and parse SOAP EWS. `exchangelib` also expects a WSDL/EWS endpoint and
well-formed SOAP responses.

## Is an isolated EWS-compatible test double enough?

- **Full UI -> backend -> EWS -> reopen E2E:** not currently possible. There is no
  EWS test server in the repo or on the stand. Building a SOAP EWS double for the
  operations above is a separate service/project; the audit may not install a new
  server or dependencies without the owner's permission. The local stack also
  forces `MAIL_MODULE_ENABLED=0`.
- **Service-level contract test (limited):** possible with a fake
  `Account`/`Message`/`FileAttachment` boundary (monkey-patched in a Python test)
  to assert that the draft payload contains the HTML body and inline attachments,
  and that update calls use the expected fields. It would not prove UI autosave or
  EWS round-trip; label it a contract test, not E2E.
- **Frontend route-mock (limited):** possible for compose UI/attachment rendering,
  but it cannot validate server autosave, EWS persistence or draft reopen.

## Decision

FE-0215 remains **blocked-environment** for live verification. The minimal
contracts are documented above. A service-level fake is the only safe next step
without owner approval; it must be reported as a limited contract test. No real
mailbox was used.
