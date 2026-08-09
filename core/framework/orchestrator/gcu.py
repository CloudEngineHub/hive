"""Browser automation best-practices prompt.

This module provides ``GCU_BROWSER_SYSTEM_PROMPT`` — a canonical set of
browser automation guidelines that can be included in any node's system
prompt that drives the browser via the ``hive-browser`` terminal CLI.

The browser is driven from the terminal: nodes run ``hive-browser
<command> ... --json`` through ``terminal_exec`` rather than calling MCP
tools. Nodes that need browser access declare ``tools: {policy: "all"}``
in their agent.json config so they can reach ``terminal_exec``.

Note: the canonical source of truth for browser automation guidance is
the ``hive.browser-automation`` default skill at
``core/framework/skills/_default_skills/browser-automation/SKILL.md``.
Activate that skill for the full decision tree. This module holds a
compact subset suitable for direct inlining into a node's system prompt
when a skill activation is not desired.
"""

GCU_BROWSER_SYSTEM_PROMPT = """\
# Browser Automation Best Practices

Follow these rules for reliable, efficient browser interaction.

The browser is driven from the terminal: run every command through
`terminal_exec` as `hive-browser <command> ... --json`. Always pass
`--json` so results come back as structured data you can parse.

## The `hive-browser interact` command

All page interaction goes through one command, `hive-browser interact
--action <a>`:

- Clicks: `--action left_click` (also `right_click`, `middle_click`,
  `double_click`, `triple_click`)
- Text: `--action type` (set `--text`; `--selector` optional — omit to
  type into the focused element)
- Keys: `--action key` (set `--text`, e.g. `"Enter"` or `"ctrl+a"`)
- `--action hover`, `--action scroll`, `--action drag`
- `--action screenshot`, `--action zoom`, `--action wait`

Every action targets either a CSS `--selector` or a `--coordinate`
(viewport fractions — see below). `hive-browser select` (dropdowns),
`hive-browser screenshot`, the navigation/tab commands, and the
page-reading commands remain separate.

## Pick the right reading command

- **`hive-browser page snapshot`** — compact accessibility tree. Fast,
  cheap, good for static / text-heavy pages where the DOM matches
  what's visually rendered (docs, forms, search results, settings
  pages).
- **`hive-browser screenshot --intent "..."`** (or `hive-browser
  interact --action screenshot`) — visual capture + scale metadata. It
  saves the JPEG and auto-attaches it to the session, returning a
  `saved_to` path. Use when the snapshot does not show the thing you
  need, when refs look stale, or when you need visual position/layout to
  act. This is common on complex SPAs (LinkedIn, X / Twitter, Reddit,
  Gmail, Notion, Slack, Discord), shadow DOM, and virtual scrolling.
- **`hive-browser interact --action zoom --region x0,y0,x1,y1`** — a
  high-resolution capture of one rectangle, for inspecting small or
  dense UI (icons, tight rows) that a full-page screenshot renders too
  small to read.

Use snapshot first for structure and ordinary controls; switch to
screenshot when snapshot can't find or verify the target. State-changing
`hive-browser interact` actions (clicks, `type`, `scroll`) wait 0.5 s
for the page to settle after a successful action, then attach a fresh
snapshot under the `snapshot` key of their JSON result — so don't run
`hive-browser page snapshot` separately after an interaction unless you
need a newer view. Tune with `--auto-snapshot-mode`: `simple` (the
default) trims unnamed structural nodes; `default` returns the full
tree; `interactive` returns only controls (tightest token footprint);
`off` skips the capture entirely — use when batching several
interactions.

Only fall back to `hive-browser page text "<selector>"` for extracting
small elements by CSS selector.

## Coordinates

Every `hive-browser interact` action that takes a `--coordinate` — and
every command that returns one — operates in **fractions of the viewport
(0..1 for both axes)**. Read a target's proportional position off a
screenshot — "this button is ~35% from the left, ~20% from the top" →
pass `--coordinate 0.35,0.20`. `hive-browser page shadow-query` returns
`rect.cx` / `rect.cy` as fractions in the
same space. The CLI handles the fraction → CSS-px multiplication
internally; you do not need to track image pixels, DPR, or any scale
factor.

Why fractions: every vision model (Claude, GPT-4o, Gemini, local
VLMs) resizes or tiles images differently before the model sees the
pixels. Proportions survive every such transform; pixel coordinates
only "work" per-model and break when you swap backends.

Avoid raw `hive-browser evaluate` + `getBoundingClientRect()` for coord
lookup — that returns CSS px and will be wrong when fed to a
`--coordinate`. Prefer `hive-browser page shadow-query`, which
returns fractions.

## Rich-text editors (X, LinkedIn DMs, Gmail, Reddit, Slack, Discord)

Click the input area first — `hive-browser interact --action left_click`
with a `--coordinate` or a `--selector` — BEFORE typing. React /
Draft.js / Lexical / ProseMirror only register input as "real" after a
native pointer-sourced focus event; JS `.focus()` is not enough.
Without a real click first, the editor stays empty and the send button
stays disabled.

`hive-browser interact --action type` does this automatically when you
have a selector — it clicks the element, then inserts text via CDP
`Input.insertText`. For shadow-DOM inputs where selectors can't reach,
click with a `--coordinate` to focus, then `hive-browser interact
--action type --text ...` with no selector to type into the active
element. Before clicking send, verify the submit button's `disabled` /
`aria-disabled` state via `hive-browser evaluate`.

## Shadow DOM

Sites like LinkedIn messaging (`#interop-outlet`), Reddit (faceplate
Web Components), and some X elements live inside shadow roots.
`document.querySelector` and `wait_for_selector` do **not** see into
shadow roots. But a `--coordinate`-targeted `hive-browser interact`
**does** — CDP hit testing walks shadow roots natively, so
coordinate-based operations reach shadow elements transparently.

**Shadow-heavy site workflow:**
1. `hive-browser interact --action screenshot` → visual image
2. Identify target visually → fraction `x,y` read straight off the image
3. `hive-browser interact --action left_click --coordinate x,y` → lands
   via native hit test; inputs get focused regardless of shadow depth
4. `hive-browser interact --action type --text ...` with no selector —
   types into the already-focused element

For selector-style access when you know the shadow path:
`hive-browser page shadow-query "#interop-outlet >>> #msg-overlay >>> p"`
— returns a fractional rect you can feed straight into a `--coordinate`.

## Navigation & waiting

- `hive-browser navigate <url> --wait-until load` returns when the page
  fires load. On SPAs (LinkedIn especially — 4–5 seconds), add a 2–3 s
  sleep after to let React/Vue hydrate before querying for chrome
  elements.
- Never re-navigate to the same URL after scrolling — resets scroll.
- Use `--timeout-ms 20000` for heavy SPAs.
- `hive-browser interact --action wait --wait-for-selector ...` /
  `--wait-for-text ...` resolve in milliseconds when the element is
  already in the DOM — no need for a fixed `--duration` if you can
  express the wait condition.

## Keyboard shortcuts

`hive-browser interact --action key --text "ctrl+a"` for Ctrl+A.
Modifiers can be joined into `--text` with `+`, or passed in
`--modifiers`. Accepted modifiers: `alt`, `ctrl`/`control`,
`meta`/`cmd`, `shift`. The CLI dispatches the modifier key first, then
the main key with `code` and `windowsVirtualKeyCode` populated (Chrome's
shortcut dispatcher requires both), then releases in reverse order.

## Scrolling

- `hive-browser interact --action scroll --scroll-direction down
  --scroll-amount ...`. Use large amounts (~2000+ px) for lazy-loaded
  sites (X, LinkedIn).
- The scroll result includes a snapshot — don't run `hive-browser page
  snapshot` separately.

## Batching

- Multiple `terminal_exec` calls per turn execute in parallel. Batch
  independent actions together: fill multiple fields, navigate +
  snapshot, different-target click + scroll.
- Set `--auto-snapshot-mode off` on all but the last when batching.
- Aim for 3–5 commands per turn minimum.

## Tab management

Close tabs as soon as you're done with them — not only at the end of
the task. `hive-browser tab close <id>` closes one; close every finished
tab rather than letting them pile up. Never accumulate more than 3 open
tabs. `hive-browser tab list` reports an `origin` field: `"agent"` (you
own it, close when done), `"popup"` (close after extracting),
`"startup"`/`"user"` (leave alone).

## Login & auth walls

Report the auth wall and stop — do NOT attempt to log in. Dismiss
cookie consent banners if they block content.

## Error recovery

- Retry once on failure, then switch approach.
- If `hive-browser page snapshot` fails, try `hive-browser page text
  "<selector>"` with a narrow selector as fallback.
- If `hive-browser open <url>` fails or the page seems stale,
  `hive-browser stop` → `hive-browser open <url>` to lazy-create a fresh
  context.

## `hive-browser evaluate`

Use for reading state inside a shadow root that standard commands don't
handle, for one-shot site-specific actions, or to measure layout the
commands don't expose. Pass small scripts inline with `--js '<JS>'`; for
large scripts use `--js @file` or pipe via `--js -`. Do NOT use it on a
strict-CSP site (LinkedIn, some X surfaces) with `innerHTML` — Trusted
Types silently drops the assignment. Always use `createElement` +
`appendChild` + `setAttribute` for DOM injection on those sites.
`style.cssText`, `textContent`, and `.value` assignments are fine.
"""
