# FE-0230 — independent analysis (cycle 18)

## Code path

- `WEB-itinvent/frontend/src/pages/account/settings/notifications/ChatNotificationsSettingsCard.jsx:29-45`
  - `if (isNativeShellRuntime()) return null;` is the first statement.
  - Hooks executed when the flag is false: `useTheme` (1), `useMemo` (2), `useAuth` (3),
    `useNotification` (4), `useState` x2 (5-6), `useEffect` x2 (7-8), `useCallback` (9).
  - When the flag is true the component executes 0 hooks.
- `WEB-itinvent/frontend/src/pages/account/AccountWorkspace.jsx:53,250`
  - `const nativeShell = isNativeShellRuntime();` is recomputed on every render.
  - The card is rendered only when `!nativeShell && !mobileApp`.
- `WEB-itinvent/frontend/src/components/layout/MainLayout.jsx:441-449`
  - `handleDesktopCapabilities` calls `setDesktopActionsAvailable(...)` on
    `DESKTOP_CAPABILITIES_CHANGED_EVENT`, so the layout tree re-renders after the
    capabilities message.
- `WEB-itinvent/frontend/src/lib/desktopBridge.js`
  - The hostReady handler sets `bridgeReady` and `data-desktop-shell`;
  - the capabilities message is processed next and dispatches the capabilities event.

## Reachability

1. A same-instance re-render with the flag flipped from false to true would violate
   the Rules of Hooks: 9 hooks -> 0 hooks. React would throw "Rendered fewer hooks
   than expected".
2. The parent computes `nativeShell` on every render and does not render the card
   when true. The capabilities event immediately after hostReady calls a state
   setter in MainLayout, so the layout/AccountWorkspace re-renders and the card is
   unmounted (clean path).
3. The card itself has no hostReady subscription. Its local updates come from
   `subscribeChatNotificationState` listener calls (`emitChange` from async push/
   notification operations) and user actions (button click -> setBusy). These are
   asynchronous relative to the hostReady/capabilities pair.
4. Cycle 17 real WebView2 test: `desktop.ready` was delayed 8 s so the card was
   mounted with `shell=null`; at hostReady the update button was clicked
   synchronously. Result: no pageerror/console error; the parent unmounted the card.
   This is a negative live result, not proof that the defect cannot occur.

## Conclusion

The static invariant violation is real, but no reachable card-local re-render was
demonstrated in the real host. The dangerous window is between the hostReady
handler and the capabilities-driven parent re-render; the card has no synchronous
update on that path. `It remains a potential settings-page crash if a future change adds a
hostReady-driven card update or removes the parent guard`.

Registry action: **status Suspected**, **severity High** (potential impact if
reached; reachability unproven), `runtimeStatus: not-reproduced-live`.

The WebView2 diagnostic host and CDP port used in cycle 17 were stopped; no
debugging port remains.
