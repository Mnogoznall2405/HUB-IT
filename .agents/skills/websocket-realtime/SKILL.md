---
name: websocket-realtime
description: Implement or diagnose realtime protocol behavior using the existing client/server contract.
---

# Realtime Communication

Use the existing protocol and runtime architecture as the starting point. Inspect the affected client/server contract and existing tests for the requested behavior. User instructions and repository constraints take precedence over these references.

Read only the relevant guide: [patterns](references/patterns.md) for implementation choices, [failure modes](references/sharp_edges.md) for diagnosis, or [validation](references/validations.md) for a review. Treat them as advisory examples; verify compatibility with current dependencies and deployed topology. Do not introduce a broker, service or transport migration solely because a reference uses it.

For the changed scenario, consider reconnect, ordering, duplicate delivery, backpressure, slow clients and authorization. Verify the relevant failure path with an isolated harness or existing tests. Diagnosis-only requests remain read-only; production instrumentation, configuration and restarts need the applicable authorization.
