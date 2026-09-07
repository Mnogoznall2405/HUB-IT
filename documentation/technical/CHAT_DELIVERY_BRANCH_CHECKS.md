# Проверки ветки доставки чата

Исходный SHA запуска: `8b7629227f8df133a41210739aee6e61df30683d`.

| Этап | Результат |
| --- | --- |
| APPLY | success |
| INSTALL | success |
| LOGIC | success |
| LINT | success |
| JEST | failure |

Сгенерированные изменения экранов включаются в коммит только при успешных APPLY, LOGIC и LINT. Даже тогда PR остаётся черновым до проверки результатов Jest и Android.

Android, APK, production и реальные сообщения: **NOT RUN / не изменялись**.

## APPLY

```text
mobile-hub/src/screens/chat/NativeChatThreadScreen.tsx: 9d9ce63ff07636c6579fd1a3062b986a4ed036ae -> 282d8fa7e1bc22db19a1be8c6de62d1d4fc5bf2e
mobile-hub/src/auth/AppLockGate.tsx: 95e30732e1cf85df696bc4c2b6970c1cbaf09142 -> 6e067533b0ee4fe4b56b5d6d021ac87dcb4ba920
mobile-hub/app/(shell)/chat/[conversationId].tsx: 76a0f03fbe6b226d9234b61922b13ad2606eec4f -> d97a333a9dc76448efe68e2c6642aa7c4fadecb2
mobile-hub/src/screens/chat/NativeChatOutboxScreen.tsx: a80ad3be61ccb15e7efa8498e466786816cb5bef -> 79ddead8c35baa8142ef2619d755e8db46cc2bce
mobile-hub/src/chat/NativeChatDeliveryHost.tsx: e47486d2a650568ee0c67472f3505ccc6bc587ec -> 3571a0331a278a6b5a10ae09b0ece5d52b345639
mobile-hub/src/screens/chat/NativeChatInboxScreen.tsx: c6af3ab875b4b03e8155b2a995a02e58845ab353 -> 37294053df0461fb40898dd9b6253bb8d9ce99a9
mobile-hub/src/screens/chat/NativeChatOutboxScreen.test.tsx: compose real delivery host in test
mobile-hub/src/screens/chat/NativeChatTypingPerformance.test.tsx: compose real delivery host in test
mobile-hub/src/screens/chat/NativeChatScreens.test.tsx: compose real delivery host in test
Applied source-only changes. Run project checks; no commit/deployment performed.
```

## INSTALL

```text
npm warn deprecated whatwg-encoding@2.0.0: Use @exodus/bytes instead for a more spec-conformant and faster implementation
npm warn deprecated inflight@1.0.6: This module is not supported, and leaks memory. Do not use it. Check out lru-cache if you want a good and tested way to coalesce async requests by a key value, which is much more comprehensive and powerful.
npm warn deprecated domexception@4.0.0: Use your platform's native DOMException instead
npm warn deprecated abab@2.0.6: Use your platform's native atob() and btoa() methods instead
npm warn deprecated glob@7.2.3: Old versions of glob are not supported, and contain widely publicized security vulnerabilities, which have been fixed in the current version. Please update. Support for old versions may be purchased (at exorbitant rates) by contacting i@izs.me
npm warn deprecated glob@7.2.3: Old versions of glob are not supported, and contain widely publicized security vulnerabilities, which have been fixed in the current version. Please update. Support for old versions may be purchased (at exorbitant rates) by contacting i@izs.me
npm warn deprecated glob@7.2.3: Old versions of glob are not supported, and contain widely publicized security vulnerabilities, which have been fixed in the current version. Please update. Support for old versions may be purchased (at exorbitant rates) by contacting i@izs.me
npm warn deprecated glob@7.2.3: Old versions of glob are not supported, and contain widely publicized security vulnerabilities, which have been fixed in the current version. Please update. Support for old versions may be purchased (at exorbitant rates) by contacting i@izs.me

added 922 packages in 17s
```

## LOGIC

```text
  ...
# Subtest: FIFO blocks later same-dialog rows, not a different dialog
ok 12 - FIFO blocks later same-dialog rows, not a different dialog
  ---
  duration_ms: 35.09522
  type: 'test'
  ...
# Subtest: logout rejects a late response before recreating history
ok 13 - logout rejects a late response before recreating history
  ---
  duration_ms: 29.853355
  type: 'test'
  ...
# Subtest: runner resumes only after connection is restored
ok 14 - runner resumes only after connection is restored
  ---
  duration_ms: 39.826073
  type: 'test'
  ...
# Subtest: permanent failure does not spin timers
ok 15 - permanent failure does not spin timers
  ---
  duration_ms: 53.266383
  type: 'test'
  ...
# Subtest: session suspension pauses intent rather than cancelling it
ok 16 - session suspension pauses intent rather than cancelling it
  ---
  duration_ms: 46.084524
  type: 'test'
  ...
# Subtest: a blocked upload does not stop a second dialog
ok 17 - a blocked upload does not stop a second dialog
  ---
  duration_ms: 44.980515
  type: 'test'
  ...
# Subtest: screen back navigates only once on rapid accepted clicks
ok 18 - screen back navigates only once on rapid accepted clicks
  ---
  duration_ms: 185.752291
  type: 'test'
  ...
# Subtest: cancelled draft warning does not block a later exit
ok 19 - cancelled draft warning does not block a later exit
  ---
  duration_ms: 119.614457
  type: 'test'
  ...
# Subtest: pending mark-read does not block or later repeat navigation
ok 20 - pending mark-read does not block or later repeat navigation
  ---
  duration_ms: 82.517349
  type: 'test'
  ...
# Subtest: offline jump focuses newest saved message without API
ok 21 - offline jump focuses newest saved message without API
  ---
  duration_ms: 50.94242
  type: 'test'
  ...
# Subtest: composer clears only after queue persistence, without HTTP
ok 22 - composer clears only after queue persistence, without HTTP
  ---
  duration_ms: 62.600967
  type: 'test'
  ...
# Subtest: failed queue persistence does not clear composer
ok 23 - failed queue persistence does not clear composer
  ---
  duration_ms: 67.183365
  type: 'test'
  ...
# Subtest: missing offline quote does not call bootstrap
ok 24 - missing offline quote does not call bootstrap
  ---
  duration_ms: 65.214038
  type: 'test'
  ...
# Subtest: late remote search cannot replace newer local results
ok 25 - late remote search cannot replace newer local results
  ---
  duration_ms: 59.525607
  type: 'test'
  ...
# Subtest: snapshot cleanup cancels only debounce, actual scope cleanup flushes latest
ok 26 - snapshot cleanup cancels only debounce, actual scope cleanup flushes latest
  ---
  duration_ms: 1.09793
  type: 'test'
  ...
1..26
# tests 26
# suites 0
# pass 26
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1566.168416
```

## LINT

```text

> mobile-hub@1.1.27 lint
> tsc --noEmit

```

## Jest log
```text
    at /home/runner/work/HUB-IT/HUB-IT/mobile-hub/src/files/nativeAttachmentDownloads.ts:226:47
    at Generator.next (<anonymous>)
    at asyncGeneratorStep (/home/runner/work/HUB-IT/HUB-IT/mobile-hub/node_modules/@babel/runtime/helpers/asyncToGenerator.js:3:17)
    at _next (/home/runner/work/HUB-IT/HUB-IT/mobile-hub/node_modules/@babel/runtime/helpers/asyncToGenerator.js:17:9)
    at /home/runner/work/HUB-IT/HUB-IT/mobile-hub/node_modules/@babel/runtime/helpers/asyncToGenerator.js:22:7
    at new Promise (<anonymous>)
    at /home/runner/work/HUB-IT/HUB-IT/mobile-hub/node_modules/@babel/runtime/helpers/asyncToGenerator.js:14:12
    at apply (/home/runner/work/HUB-IT/HUB-IT/mobile-hub/src/files/nativeAttachmentDownloads.ts:218:47)
    at /home/runner/work/HUB-IT/HUB-IT/mobile-hub/src/files/nativeAttachmentDownloads.cleanup.test.ts:188:67
    at Array.map (<anonymous>)
    at Object.map (/home/runner/work/HUB-IT/HUB-IT/mobile-hub/src/files/nativeAttachmentDownloads.cleanup.test.ts:188:28)
    at Generator.next (<anonymous>)
    at asyncGeneratorStep (/home/runner/work/HUB-IT/HUB-IT/mobile-hub/node_modules/@babel/runtime/helpers/asyncToGenerator.js:3:17)
    at _next (/home/runner/work/HUB-IT/HUB-IT/mobile-hub/node_modules/@babel/runtime/helpers/asyncToGenerator.js:17:9)
    at /home/runner/work/HUB-IT/HUB-IT/mobile-hub/node_modules/@babel/runtime/helpers/asyncToGenerator.js:22:7
    at new Promise (<anonymous>)
    at Object.<anonymous> (/home/runner/work/HUB-IT/HUB-IT/mobile-hub/node_modules/@babel/runtime/helpers/asyncToGenerator.js:14:12)
    at Promise.then.completed (/home/runner/work/HUB-IT/HUB-IT/mobile-hub/node_modules/jest-circus/build/utils.js:298:28)
    at new Promise (<anonymous>)
    at callAsyncCircusFn (/home/runner/work/HUB-IT/HUB-IT/mobile-hub/node_modules/jest-circus/build/utils.js:231:10)
    at _callCircusTest (/home/runner/work/HUB-IT/HUB-IT/mobile-hub/node_modules/jest-circus/build/run.js:316:40)
    at _runTest (/home/runner/work/HUB-IT/HUB-IT/mobile-hub/node_modules/jest-circus/build/run.js:252:3)
    at _runTestsForDescribeBlock (/home/runner/work/HUB-IT/HUB-IT/mobile-hub/node_modules/jest-circus/build/run.js:126:9)
    at run (/home/runner/work/HUB-IT/HUB-IT/mobile-hub/node_modules/jest-circus/build/run.js:71:3)
    at runAndTransformResultsToJestFormat (/home/runner/work/HUB-IT/HUB-IT/mobile-hub/node_modules/jest-circus/build/legacy-code-todo-rewrite/jestAdapterInit.js:122:21)
    at jestAdapter (/home/runner/work/HUB-IT/HUB-IT/mobile-hub/node_modules/jest-circus/build/legacy-code-todo-rewrite/jestAdapter.js:79:19)
    at runTestInternal (/home/runner/work/HUB-IT/HUB-IT/mobile-hub/node_modules/jest-runner/build/runTest.js:367:16)
    at runTest (/home/runner/work/HUB-IT/HUB-IT/mobile-hub/node_modules/jest-runner/build/runTest.js:444:34)

Node.js v22.23.2
```
