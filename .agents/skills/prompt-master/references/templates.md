# Prompt Templates Reference

Full template library for Prompt Master. Read the relevant template when the user's task type matches. Do not load all templates at once — only the one you need.

## Table of Contents

| Template | Best For |
|----------|----------|
| [A — RTF](#template-a--rtf) | Simple one-shot tasks |
| [B — CO-STAR](#template-b--co-star) | Professional documents, business writing |
| [C — RISEN](#template-c--risen) | Complex multi-step projects |
| [D — CRISPE](#template-d--crispe) | Creative work, brand voice |
| [E — Evidence and Verification](#template-e--evidence-and-verification) | Logic, math, analysis, debugging |
| [F — Few-Shot](#template-f--few-shot) | Consistent structured output, pattern replication |
| [G — File-Scope](#template-g--file-scope) | Cursor, Windsurf, Copilot — code editing AI |
| [H — ReAct + Stop Conditions](#template-h--react--stop-conditions) | Claude Code, Devin — autonomous agents |
| [I — Visual Descriptor](#template-i--visual-descriptor) | Midjourney, DALL-E, Stable Diffusion, Sora |
| [J — Reference Image Editing](#template-j--reference-image-editing) | Editing an existing image with a reference |
| [K — ComfyUI](#template-k--comfyui) | ComfyUI node-based image workflows |
| [L — Prompt Decompiler](#template-l--prompt-decompiler) | Breaking down, adapting, or splitting existing prompts |

---

## Template A — RTF

*Role, Task, Format. Use for fast one-shot tasks where the request is clear and simple.*

```
Role: [One sentence defining who the AI is]
Task: [Precise verb + what to produce]
Format: [Exact output format and length]
```

**Example:**
```
Role: You are a senior technical writer.
Task: Write a one-paragraph description of what a REST API is.
Format: Plain prose, 3 sentences maximum, no jargon, suitable for a non-technical audience.
```

---

## Template B — CO-STAR

*Context, Objective, Style, Tone, Audience, Response. Use for professional documents, business writing, reports, and marketing content where full context control matters.*

```
Context: [Background the AI needs to understand the situation]
Objective: [Exact goal — what success looks like]
Style: [Writing style: formal / conversational / technical / narrative]
Tone: [Emotional register: authoritative / empathetic / urgent / neutral]
Audience: [Who reads this — their knowledge level and expectations]
Response: [Format, length, and structure of the output]
```

**Example:**
```
Context: I am a founder pitching a B2B SaaS tool that automates expense reporting for mid-size companies.
Objective: Write a cold email that gets a reply from a CFO.
Style: Direct and conversational, not salesy.
Tone: Confident but not pushy.
Audience: CFO at a 200-person company, busy, skeptical of vendor emails.
Response: 5 sentences max. Subject line included. No bullet points.
```

---

## Template C — RISEN

*Role, Instructions, Steps, End Goal, Narrowing. Use for complex projects, multi-step tasks, and any output that requires a clear sequence of actions.*

```
Role: [Expert identity the AI should adopt]
Instructions: [Overall task in plain terms]
Steps:
  1. [First action]
  2. [Second action]
  3. [Continue as needed]
End Goal: [What the final output must achieve]
Narrowing: [Constraints, scope limits, what to exclude]
```

**Example:**
```
Role: You are a product manager with 10 years of experience in mobile apps.
Instructions: Write a product requirements document for a habit tracking feature.
Steps:
  1. Define the problem statement in one paragraph
  2. List user stories in the format "As a [user], I want [goal] so that [reason]"
  3. Define acceptance criteria for each story
  4. List out-of-scope items explicitly
End Goal: A PRD that an engineering team can begin sprint planning from immediately.
Narrowing: No technical implementation details. No wireframes. Under 600 words total.
```

---

## Template D — CRISPE

*Capacity, Role, Insight, Statement, Personality, Experiment. Use for creative work, brand voice writing, and any task where personality, tone, and iteration matter.*

```
Capacity: [What capability or expertise the AI should have]
Role: [Specific persona to adopt]
Insight: [Key background insight that shapes the response]
Statement: [The core task or question]
Personality: [Tone and style — witty / authoritative / casual / sharp]
Experiment: [Request variants or alternatives to explore]
```

**Example:**
```
Capacity: Expert copywriter specializing in SaaS product launches.
Role: Brand voice for a productivity tool aimed at developers.
Insight: Developers hate marketing speak and respond to honesty and specificity.
Statement: Write the hero headline and sub-headline for the landing page.
Personality: Sharp, dry, confident — no adjectives, no exclamation marks.
Experiment: Give 3 variants ranging from minimal to bold.
```

---

## Template E — Evidence and Verification

Use for analysis where assumptions and verification matter. Ask for the useful result, not a transcript of private reasoning.

```
[Task and relevant evidence]
Give the conclusion, key assumptions, a concise supporting explanation, and checks or sources that substantiate it. Label remaining uncertainty. Do not invent evidence or claim checks that were not run.
```

---

## Template F — Few-Shot

*Use when the output format is easier to show than describe. Examples outperform written instructions for format-sensitive tasks every time.*

```
[Task instruction]

Here are examples of the exact format needed:

<examples>
  <example>
    <input>[example input 1]</input>
    <output>[example output 1]</output>
  </example>
  <example>
    <input>[example input 2]</input>
    <output>[example output 2]</output>
  </example>
</examples>

Now apply this exact pattern to: [actual input]
```

**Rules:**
- 2 to 5 examples is the sweet spot. More rarely helps and wastes tokens.
- Examples must include edge cases, not just easy cases.
- Use XML tags to wrap examples — Claude parses XML reliably.
- If you have been re-prompting for the same formatting correction twice, switch to few-shot instead of rewriting instructions.

---

## Template G — File-Scope

*Use for Cursor, Windsurf, GitHub Copilot, and any AI that edits code inside a codebase. The most common failure mode here is editing the wrong file or breaking existing logic — this template prevents both.*

```
File: [exact/path/to/file.ext]
Function/Component: [exact name]

Current Behavior:
[What this code does right now — be specific]

Desired Change:
[What it should do after the edit — be specific]

Scope:
Only modify [function / component / section].
Do NOT touch: [list everything to leave unchanged]

Constraints:
- Language/framework: [specify version]
- Do not add dependencies not in [package.json / requirements.txt]
- Preserve existing [type signatures / API contracts / variable names]

Done When:
[Exact condition that confirms the change worked correctly]
```

---

## Template H — Agent Scope and Completion

Adapt to the actual request. Existing user permissions and repository constraints determine what the agent may do.

```
Outcome: [requested result]
Context: [relevant evidence and how to locate affected code]
Scope: [authorized area and operations]
Completion: [observable acceptance criteria and relevant checks]
Continue through implementation, verification and fixes caused by this change within scope. Reuse prior decisions and approvals. Choose routine reversible implementation details from existing patterns.
Ask only when a material unresolved choice or an action outside the authorized scope requires user input. Continue independent authorized work while waiting. Report a genuine blocker with evidence; do not treat a fixed retry count or the first draft as completion.
```

---

## Template I — Visual Descriptor

*Use for Midjourney, DALL-E 3, Stable Diffusion, Sora, Runway, and any image or video generation tool.*

```
Subject: [Main subject — specific, not vague]
Action/Pose: [What the subject is doing]
Setting: [Where the scene takes place]
Style: [photorealistic / cinematic / anime / oil painting / vector / etc.]
Mood: [dramatic / serene / eerie / joyful / etc.]
Lighting: [golden hour / studio / neon / overcast / candlelight / etc.]
Color Palette: [dominant colors or named palette]
Composition: [wide shot / close-up / aerial / Dutch angle / etc.]
Aspect Ratio: [16:9 / 1:1 / 9:16 / 4:3]
Negative Prompts: [blurry, watermark, extra fingers, distortion, low quality]
Style Reference: [artist / film / aesthetic reference if applicable]
```

**Tool-specific syntax:**
- **Midjourney**: Comma-separated descriptors, not prose. Add `--ar`, `--style`, `--v 6` at the end.
- **Stable Diffusion**: Use `(word:1.3)` weight syntax. CFG scale 7 to 12. Negative prompt is mandatory.
- **DALL-E 3**: Prose works well. Add "do not include any text in the image" unless text is needed.
- **Sora / video**: Add camera movement (slow dolly, static shot, crane up), duration in seconds, and cut style.

---

## Template J — Reference Image Editing

*Use when the user has an existing image they want to modify. Completely different from generation — never describe the whole scene from scratch, only describe the change.*

**Before writing the prompt, always tell the user:**
"Attach your reference image to [tool name] before sending this prompt."

**Detect the tool's editing capability:**
- Midjourney: use `--cref [image URL]` for character reference or `--sref` for style reference
- DALL-E 3: use the Edit endpoint, not the Generate endpoint. User must be in ChatGPT with image editing enabled
- Stable Diffusion: use img2img mode, not txt2img. Set denoising strength 0.3-0.6 to preserve the original

```
Reference image: [attached / URL]
What to keep exactly the same: [list everything that must not change]
What to change: [specific edit only — be precise]
How much to change: [subtle / moderate / significant]
Style consistency: maintain the exact style, lighting, and mood of the reference
Negative prompt: [what to avoid introducing]
```

**Example:**
```
Reference image: [attached portrait photo]
What to keep exactly the same: face, hair, clothing, background, lighting
What to change: head angle — rotate from facing left to facing straight forward
How much to change: subtle, preserve all facial features exactly
Style consistency: maintain photorealistic style, same lighting direction
Negative prompt: no new elements, no style changes, no background changes
```

---

## Template K — ComfyUI

*Use for ComfyUI node-based workflows. Always output Positive and Negative prompts as separate blocks. Ask for the checkpoint model before writing — syntax and token limits differ per model.*

**Ask first if not stated:**
"Which checkpoint model are you using? (SD 1.5, SDXL, Flux, or other)"

**Model-specific notes:**
- SD 1.5: shorter prompts work better, under 75 tokens per block, use (word:weight) syntax
- SDXL: handles longer prompts, supports more natural language alongside weighted syntax
- Flux: natural language works well, less reliance on weighted syntax, very responsive to style descriptions

```
POSITIVE PROMPT:
[subject], [style], [mood], [lighting], [composition], [quality boosters: highly detailed, sharp focus, 8k]

NEGATIVE PROMPT:
[what to exclude: blurry, low quality, watermark, extra limbs, bad anatomy, distorted, oversaturated]

CHECKPOINT: [model name]
SAMPLER: Euler a (recommended starting point)
CFG SCALE: 7 (increase for stricter prompt adherence)
STEPS: 20-30
RESOLUTION: [width x height — must be divisible by 64]
```

---

## Template L — Prompt Decompiler

*Use when the user pastes an existing prompt and wants to break it down, adapt it for a different tool, simplify it, or understand its structure. This is analysis and adaptation, not building from scratch.*

**Detect which Decompiler task is needed:**
- **Break down** — explain what each part of the prompt does
- **Adapt** — rewrite for a different tool while preserving intent
- **Simplify** — remove redundancy and tighten without losing meaning
- **Split** — divide a complex one-shot prompt into a cleaner sequence

**For Adapt tasks, always ask:**
"What tool is the original prompt from, and what tool are you adapting it for?"

**Break down output format:**
```
Original prompt: [paste]

Structure analysis:
- Role/Identity: [what role is assigned and why]
- Task: [what action is being requested]
- Constraints: [what limits are set]
- Format: [what output shape is expected]
- Weaknesses: [what is missing or could cause wrong output]

Recommended fix: [rewritten version with gaps filled]
```

**Adapt output format:**
```
Original ([source tool]): [original prompt]

Adapted for [target tool]:
[rewritten prompt using target tool syntax and best practices]

Key changes made:
- [change 1 and why]
- [change 2 and why]
```

**Split output format:**
```
Original prompt: [paste]

This prompt is doing [N] things. Split into [N] sequential prompts:

Prompt 1 — [what it handles]:
[prompt block]

Prompt 2 — [what it handles]:
[prompt block]

Run these in order. Each output feeds the next.
```
