---
name: prompt-master
version: 1.5.0
description: Write or improve prompts for a specified AI tool, preserving the user's scope and acceptance criteria.
---

# Prompt Master

Write or improve a usable prompt for the user's intended tool and task. Infer the target from the request and conversation; ask only when an unresolved choice materially changes the prompt. Return the prompt in a copyable block, with a brief usage note only when needed. Explain prompting theory only when requested.

For a standalone prompt request, the prompt is the deliverable. When another authorized workflow invokes this skill as a helper, return the prepared prompt to that workflow and continue its implementation and verification; do not end the parent task with a prompt instead of its requested result.

## Preserve intent

State the desired outcome, relevant input, output format and actual constraints. For coding agents, include the agreed scope, acceptance criteria, and permission boundaries. Describe how to discover relevant files when their paths are unknown rather than inventing paths. Existing approvals remain valid; do not add a new approval checkpoint to ordinary authorized work.

Separate requirements from preferences and examples. Use strict language for real constraints, not to amplify every stylistic choice. Define completion and genuine blockers so the agent can finish implementation, verification and relevant fixes without stopping at its first draft or expanding into unrelated work.

## Match the target

- For LLMs, provide sufficient task context and evidence expectations. Ask for conclusions, concise explanations and verifiable outputs rather than private chain-of-thought or fabricated self-verification.
- For coding or browser agents, distinguish reversible preparation from authorized external actions. An example is not permission to submit, publish, deploy or change credentials.
- For image, video or audio tools, describe the requested result and edit invariants. Use only supported parameters and prompt fields; do not require a negative-prompt field or separate upload if the tool already has the reference.
- For tool-specific syntax or model-dependent behavior, inspect supplied/local documentation and verify current primary documentation when necessary. Do not infer capability, parameter ranges or prompting rules from an old model-family label.

## Optional references

Read [templates](references/templates.md) only when a task needs a starting structure; read [patterns](references/patterns.md) only when diagnosing a weak prompt. These are examples to adapt, not extra requirements. Verify tool-specific claims and discard recipes that conflict with the user's scope or current tool behavior.

## Delivery check

Check that the prompt preserves the requested outcome, contains no invented facts or permissions, and defines an observable result. Remove repeated instructions and unrelated scaffolding. If safe execution of a sample prompt is part of the request, test it against representative input; otherwise distinguish a prepared prompt from a demonstrated successful run. Do not promise first-attempt success without evidence.
