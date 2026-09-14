---
name: telegram-rich-messages
description: Design Telegram message formatting and inline actions using the available authorized tool or bot library.
metadata:
  openclaw:
    requires:
      plugins:
      - telegram
---

# Telegram Rich Messages

Use this guidance when the current delivery channel is Telegram. For development of a Telegram bot, use the repository's Telegram library and handlers rather than assuming the assistant can send messages. Skill selection alone does not authorize sending or editing messages.

## Core Principle: Low-Friction Interaction
**Typing is slow and error-prone.** Always prioritize Rich UI elements to minimize the user's need to reply with text. If a user has a choice to make, give them a button.

## Quick Navigation
Detailed guides for each feature:

1. **[decision-matrix.md](references/decision-matrix.md)**: When to use which UI element.
2. **[formatting.md](references/formatting.md)**: Markdown V2, HTML, and Auto-Copy (Monospace) tricks.
3. **[interactive-ui.md](references/interactive-ui.md)**: How to send stable Inline Buttons and Quick Replies.
4. **[media-and-actions.md](references/media-and-actions.md)**: Sending files, stickers, using reactions, and editing/deleting messages.

## Best Practices
- **Monospace for Data**: Use code blocks for IDs, addresses, or snippets. Users can tap to copy them instantly on mobile.
- **Stable Buttons**: If an authorized Telegram sending tool exposes inline buttons, use its documented schema. Otherwise provide code or a preview for the existing bot library. Do not call an unavailable `message` tool or claim buttons were sent without confirmation from the tool.
- **Contextual Actions**: After completing a task, provide buttons for the most likely next steps (e.g., "Check Status", "Delete", "Settings").
- **Direct Uploads**: Telegram supports direct file uploads. No need for Google Drive or external hosting.
