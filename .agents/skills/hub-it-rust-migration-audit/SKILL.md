---
name: hub-it-rust-migration-audit
description: Profile HUB-IT workloads, rank Rust migration candidates, and verify explicitly authorized native prototypes with differential tests and reproducible benchmarks. Use for Rust adoption, native acceleration, CPU or memory bottlenecks, and migration GO/NO-GO decisions; do not use to justify blanket rewrites.
---

# HUB-IT Rust Performance & Migration Audit

## Mission and authority

Act as performance engineer, systems architect, Rust specialist and independent reviewer. The goal is measurable end-to-end benefit, not Rust adoption for its own sake. This is a project-specific adaptation of [Google migrate-to-rust](https://github.com/google/skills/tree/main/skills/developers/migrate-to-rust), upstream v1.0.0 (SKILL.md blob `8b51977ab7518e94013760ac3fb765af0d725354` inspected on 2026-11-28). The upstream workflow's automatic transition to implementation is deliberately replaced with approval gates. This is a standalone local skill, not an installation of Google's telemetry scripts.

Read root AGENTS.md, CONTEXT.md, documentation/technical/REPOSITORY_MAP.md and TESTING.md, relevant subsystem docs and ADRs before work. Use diagnose, tdd, security-best-practices and differential-review skills as relevant. Delegate independent profiling, parity and review to separate agents when available; the lead verifies evidence, deduplicates findings and owns the decision.

- Audit-only: read-only repository diagnostics and isolated measurements; no application edits, new dependencies or commits. If execution of external cloned code is needed, inspect build/run commands and obtain confirmation first.
- Implementation: only explicitly approved candidates, in an isolated worktree/branch; never proceed from an audit to migration automatically.
- Never deploy, restart, change production config/data, run production migrations or test against production. No mandatory Docker, Redis, broker or new service without direct authorization. Never expose real documents, secrets, prompts or user data in traces or fixtures.
- Preserve API, permissions, transaction boundaries, compatibility, ordering, idempotency, fallback and error behavior. Do not mix Scan and Inventory or reintroduce excluded DLP functionality. No client rewrite by default.
- Do not merge; open a separate PR per approved component when requested.

## 0. Establish scope and reproducible baseline

Record HEAD, dirty status, target OS/architecture, Python/Rust versions, compiler flags, dependency versions, CPU/RAM, storage, DB fixture, commands, dataset hashes, seeds, workload mix and limitations. Use synthetic/anonymized data and isolated DB/cache/spool; no live IIS dist output. Record cold and warm runs separately. Use representative small, normal and large workloads plus concurrent load. Capture raw samples and reproducible scripts in an approved artifact location; redact before committing.

Measure CPU self/cumulative time, wall time, peak RSS (including child processes), allocations when available, DB query count/time, disk/network I/O, queue wait, serialization, event-loop lag and user-visible/API p50/p95/p99, throughput and error rates. Use suitable tools (e.g. cProfile, py-spy, tracemalloc, OS counters) and isolate profiler overhead. Do not assume Python is the bottleneck; account for native libraries, GPU, SQL Server/PostgreSQL and external model latency.

## 1. Inventory, profile and rank

Investigate actual reachable code, not just filenames. Initial hypotheses (not confirmed findings):

| Candidate | What to measure / alternative |
| --- | --- |
| scan_agent / scan_server PDF, images, text extraction | Python CPU vs native OCR/PDF/GPU, disk, IPC; reuse existing native libraries |
| File processing, hashing, archives, metadata, indexing | Chunking, I/O, native stdlib, bounded memory, Windows file semantics |
| My Files search, traversal, ETag computation | SQL plans/indexes, caching, batching, serialization; avoid invalidating prior perf improvements |
| Mail MIME and attachments | Streaming, parsing, encoding, malformed inputs, existing native operations |
| Search / indexing | DB full-text search and existing engine vs custom native component; ACL correctness |
| Chat / WebSocket and background jobs | Backpressure, fanout, DB locks, queue wait; only consider native code after profiling |
| Inventory agent and MSI | Windows APIs, compatibility, updater/installer behavior; scope remains separate from Scan |

React/Vite, Expo React Native, WPF/WebView2, general FastAPI business logic and ML orchestration are not rewrite targets by default. Check actual versions of Pydantic/native dependencies before proposing replacement.

For each candidate record ID, code path and call stack, workload, measured CPU/RSS and end-to-end share, reproducibility, user impact, current native dependencies, non-Rust optimization, integration option, security/operational risk, estimated effort, confidence and evidence links. Rank by measured benefit, not language preference. Mark unmeasured items HYPOTHESIS and missing tools BLOCKED. Estimate an Amdahl upper bound where applicable; reject I/O-dominated candidates unless there is a measured CPU opportunity.

## 2. Compare alternatives and obtain approval

First propose a minimal Python/SQL/algorithm/caching/streaming fix and measure it where authorized. Compare original baseline A, optimized existing implementation B, and proposed Rust C on identical workloads. Only proceed with Rust after the user approves an experimental scope. Recommend NO-GO if B removes the bottleneck or expected end-to-end improvement is negligible.

Prefer a narrow PyO3 + maturin extension for CPU-bound Python functions with a stable boundary; validate Python ABI, wheel/build availability and GIL/release behavior. Consider a standalone CLI only for a suitable isolated batch workload; account for process startup and IPC. A separate service (e.g. Axum/Tokio) is not authorized by this skill and requires a separate architectural decision. Prefer existing maintained libraries over custom parsers; review licenses, advisories and transitive dependencies.

Design input/output contract, allocation/copy budget, ownership, cancellation, timeout, error mapping, observability, feature flag default off, fallback and rollback. Fallback must not bypass access checks or duplicate side effects; never blindly retry a partially completed write. No schema or public contract change without approval.

## 3. Implement approved prototype

Implement smallest useful boundary. Use release builds; require safe project Rust (`#![forbid(unsafe_code)]` where compatible; any unavoidable FFI/macro exception is a documented approval blocker, not silently waived). Audit unsafe in dependencies separately; safe application code is not a guarantee of safe dependencies. Pin versions and lockfiles, run dependency/security/license checks. Preserve deterministic semantics, bound resource usage, handle malformed/untrusted inputs and document Windows-specific assumptions. Do not use SIMD, SoA, parallelism, LTO or PGO until baseline Rust parity and profiling justify them. Do not ship CPU-native flags to heterogeneous Windows hosts without compatibility checks.

## 4. Verification and measurement

- Golden fixtures from original behavior, differential tests across deterministic seeds, unit/integration/doc tests and property tests (proptest where appropriate). Verify error/status parity, ordering, Unicode/Cyrillic, paths (long paths, UNC, junctions/reparse points, traversal), file locks, permissions, cancellation, corruption, retries, concurrent clients and crash/restart where relevant. Exact byte equality when contract requires; documented tolerances only where domain permits. Keep known legacy bugs explicit rather than silently encoding or correcting them.
- Security tests: cross-user isolation, ACLs, malicious file inputs, resource exhaustion, path traversal, auth checks and redaction. Include relevant existing HUB-IT tests and negative controls.
- Run cargo fmt --check, cargo clippy --all-targets -- -D warnings, cargo test --all-targets and cargo test --doc where applicable; target >=95% branch coverage of new critical logic, document measurement tool and gaps. No fabricated coverage, PASS or parity claims.
- For each representative workload compare A (original), B (optimized current), C (safe Rust), D (optional SoA/SIMD), E (optional PGO/LTO). Measure the complete path including conversion, copies, IPC, I/O and queueing. Separate microbenchmarks from API/user-visible results. Use same hardware, data, settings and concurrency, interleave variants, warm up, record at least 30 measured repetitions for stable latency workloads and increase sample count for tail estimates; report sample size and dispersion/uncertainty. For p99 use a sufficiently large request sample or mark it unreliable.
- If Windows Server target cannot be tested, mark production compatibility BLOCKED. Validate x64 MSVC target, relevant Python wheel ABI, dependency DLLs, clean installation, existing PM2/IIS/MSI integration as applicable, cold startup, path/ACL behavior and rollback in an isolated Windows environment. Linux/cloud-only evidence cannot certify Windows readiness.
- For failing test/parity/lint phases use up to 5 diagnosed repair attempts; log every failure, fix and re-run. Stop with a blocker if unresolved. Never disable a test or relax parity merely to pass.

## 5. Decision gate and deliverables

Suggested screening thresholds (proposals, not existing HUB-IT SLOs; agree per candidate before measurement): >=20% improvement in end-to-end p95 or >=25% sustainable throughput or >=25% peak memory reduction against optimized B, with no meaningful regression on other representative workloads (investigate >5% deterioration beyond measured noise), no new correctness/security failures and no unacceptable maintenance or operational costs. For narrowly scoped CPU kernels a microbenchmark win alone is insufficient. Report p50/p95/p99, CPU, RSS, throughput, errors, overhead and uncertainty. Require parity, tests, Windows evidence and rollback for GO to implementation/review; otherwise NO-GO or BLOCKED. A research GO never authorizes production rollout.

For each audit maintain:
- RUST_MIGRATION_AUDIT.md: scope, architecture map, candidate register, ranked backlog, Amdahl bounds, alternatives, per-candidate evidence and GO/NO-GO/BLOCKED.
- migration_telemetry.json: baseline environment, commands, dataset hashes, samples, variants, failures/fixes, parity and security checks, missing measurements; use local schema documented in the report. Google's optional telemetry/infographic tooling may be adopted only after review and authorization.
- For approved prototypes: reproducible benchmark harness, tests, raw sanitized metrics, compatibility report, feature-flag/fallback/rollback plan and separate PR. Optional HTML visualization is derived from actual metrics only.

Final response in Russian: result first, source SHA, measured candidates vs hypotheses, A/B/C results, tests and skipped checks, blockers, decisions, next bounded task and PR link if created. Do not report unexecuted tests as passed. If no candidate wins, explicitly recommend retaining the existing implementation.
