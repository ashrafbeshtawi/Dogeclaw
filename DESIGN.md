# DogeClaw Frontend Design Guide

Everything a designer (human or Claude) needs to restyle or redesign DogeClaw's
web UI without breaking the product. Read this before touching any HTML or CSS.

## What DogeClaw is

A self-hosted personal AI agent in a Docker container: a chat UI backed by
pluggable LLMs, plus an admin panel that manages models, agents, skills,
channels (Telegram), MCP servers, search engines, cron jobs, event logs, and
settings. Single user, password-protected, runs on someone's own box.

**Brand personality:** dark, technical, self-aware doge-meme humor
("wow. much AI. very agent." / "SUCH SECURE ● VERY LOGIN ● WOW"). The mascot
logo (`frontend/public/logo.png`, also the favicon) is front and center on
login and the chat empty state. Accent color is an assertive red. A redesign
can evolve the look, but the playful-dark-red identity is the brand.

## The three surfaces

| Page | Source | Purpose |
|---|---|---|
| Login | `frontend/src/pages/login/main.tsx` | Centered card, logo, username + Rare UI password input, meme footer |
| Chat | `frontend/src/pages/index/main.tsx` | Sidebar (logo, agent select, session list, admin/logout) + message pane + Rare UI prompt box (attach, mic, send). Streams responses via SSE: AI status row while working, streaming-response bubbles (markdown), collapsible "thinking" and tool-call blocks, tool details in a code-block modal |
| Admin | `frontend/src/pages/admin/` | Top navbar, Rare UI gooey-nav tab bar (Models, Agents, Skills, Channels, MCP, Search, Cron Jobs, Events, Settings), each tab (`tabs/*.tsx`) a table + "＋ New" button opening a modal. Crons tab adds All/Active/Inactive/Failing view buttons with animated counts, an agent filter and a text filter |

Each page is a small React app. Vite builds them (multi-page, `base: /static/`)
into `agent/src/web/public/`, which Express serves under `/static` (pages
themselves at `/login`, `/`, `/admin`). There is no SPA router — the admin tab
state lives in the URL hash (`/admin#crons`).

## Tech stack and build

- **React 19 + TypeScript + Vite**, **Tailwind CSS v4 + daisyUI v5**, dark-only
  custom theme named `dogeclaw` (`data-theme="dogeclaw"` and `class="dark"` on
  `<html>` — the `.dark` class switches Rare UI components to their dark look).
- **Rare UI** components (https://rareui.com) live in
  `frontend/src/components/ui/`, added with
  `npx shadcn@latest add swamimalode07/rare-ui/<name>`: `prompt-box`,
  `ai-status`, `streaming-response`, `code-block`, `toast`, `password-input`,
  `gooey-nav`, `animated-counter`, `fluid-orb`. They are owned source, not a dependency;
  keep the copyright header and the visible "UI components by Rare UI" credit
  (`src/RareUiCredit.tsx`) — the license requires both. `prompt-box` carries
  one local addition (`allowEmpty`, so an attachment can be sent without text).
  The components import `next/link` and `next/navigation`; `src/shims/` stands
  in for those.
- Source of truth: `frontend/`. Build:
  ```bash
  cd frontend && npm install && npm run build   # or npm run watch
  npm test                                      # node --test over test/*.test.ts
  ```
  The output in `agent/src/web/public/` is **committed** — the Docker image
  has no build step and just serves the generated files. Never edit the
  generated files; CI rebuilds and fails if they differ from what is committed.

## Design tokens (the `dogeclaw` daisyUI theme)

Defined in `frontend/src/app.css` via `@plugin "daisyui/theme"`. Recoloring the
whole app = editing this block + rebuild.

| Token | Value | Used for |
|---|---|---|
| `--color-base-100` | `#0e0e16` | panels, sidebar, tables |
| `--color-base-200` | `#0a0a0f` | page background |
| `--color-base-300` | `#12121c` | modals, raised surfaces, assistant bubbles |
| `--color-base-content` | `#e2e8f0` | text |
| `--color-primary` | `#dc2626` | the red: buttons, active tab underline, focus rings, logo glow |
| `--color-secondary` | `#b91c1c` | darker red |
| `--color-accent` | `#fca5a5` | light red: active-tab text, gradient headings |
| `--color-neutral` | `#1e293b` | user chat bubbles |
| `--color-info` / `success` / `warning` / `error` | `#60a5fa` / `#34d399` / `#fbbf24` / `#f87171` | badges, status, danger buttons |
| `--radius-field` / `--radius-selector` | `0.5rem` | inputs, buttons |
| `--radius-box` | `1rem` | cards, modals, table containers |

Muted text is consistently produced with
`color-mix(in oklab, var(--color-base-content) N%, transparent)` (70% body-muted,
45% hints, 55% thinking text). Hairline borders are `rgb(255 255 255 / 0.05–0.1)`.
Typography is the daisyUI/Tailwind default system stack; sizes run small
(0.7–0.95rem; the app is information-dense).

## Component inventory

**daisyUI/Tailwind** for plain controls:
`btn btn-primary|ghost|outline btn-xs|sm|square`, `input`/`select`/`textarea`
(+ `input-sm`, `select-sm`), `table table-sm` inside
`div.overflow-x-auto.rounded-2xl.border.border-white/5.bg-base-100`,
`badge badge-sm`, `card`/`card-body` (login), `toggle toggle-primary toggle-sm`,
`navbar`.

**Rare UI** for the expressive pieces: prompt box (chat composer), AI status
(the streaming status row), streaming response (assistant text, markdown),
code block (tool-call arguments/results), toast (save confirmations and API
errors — replaces `alert()`), password input (login, model API key), gooey
nav (admin tabs), animated counter (cron view counts), fluid orb (the living sphere behind the logo on login and the empty chat).

**Semantic classes** styled in `@layer components` of `frontend/src/app.css`
(the Playwright suite selects on many of them):

- Admin: `.section`/`.section.active` (tab panels), `.hint` + `.field-hint`
  (with red inline `code` chips), `td.actions` + its buttons, `button.danger`,
  badge variants `.badge-on` (green), `.badge-off` (red), `.badge-tag` (blue).
- Modals: `.modal-overlay`(.open) → `.dc-modal` card (max-width 500px,
  `base-300`, red-tinted border). Inside: block `label`s, full-width
  inputs/selects/textareas with focus ring, `.dc-toggle`, `.checks`
  (checkbox grids), `.btn-row` (right-aligned Cancel/Save). Admin modals use
  the `Modal` component in `pages/admin/ui.tsx`, which keeps them mounted and
  toggles `.open`.
- Chat: `.msg.user|.assistant` bubbles, `.media-chip`, `.thinking-block`
  (+ `.thinking-toggle`, `.thinking-content.open`), `.status-row` (shown while
  `.streaming`), `.session-item`(.active, `.src` badge, hover-revealed `.del`),
  `.empty-state` (breathing logo), `.new-chat-btn` (dashed red),
  `.media-btn.recording` (pulsing).
- Login: `.login-bg` (red radial glows), `.login-card` (entry animation),
  `.login-logo` (drop shadow + breathe), `.error` (shake), `.login-dot` (blink).
- Keyframes: `dc-pulse`, `dc-breathe`, `dc-card-entry`, `dc-shake`, `dc-blink`.

**Two cascade gotchas** documented in the CSS: badge color variants must stay
**outside** any `@layer` (daisyUI's own layer would outrank them), and the
action-cell selector is the compound `td.actions`, not `td .actions`.

## Interaction patterns

- Admin tabs: the gooey nav sets the tab and rewrites the URL hash; a
  `hashchange` listener follows external changes. The tab list is `TABS` in
  `pages/admin/main.tsx`.
- CRUD: every entity = table row → Edit/Delete buttons → modal prefilled from
  the row (the form is keyed by the row id, so fields start from fresh
  defaults). Save sends the JSON API call through `write()` in
  `pages/admin/ui.tsx`, which toasts errors and reloads all admin data on
  success. Deletes use native `confirm()`.
- Crons tab: view buttons (`data-cron-view`, labels carry live counts), agent
  filter, free-text filter, sortable columns (`th[data-cron-sort]`, ▲/▼),
  active-first default order, "No jobs match." empty state. The filtering and
  sorting are pure functions in `pages/admin/data.ts`, unit-tested in
  `frontend/test/`.
- Search engines tab: ↑/↓ buttons per row reorder priority; provider select in
  the modal shows/hides the Google-only `cx` field; provider options are
  rendered from the API (`providers` field), not hardcoded.
- Chat: Enter sends (Shift+Enter newline), SSE events update the last
  assistant message in React state; tool-call/thinking blocks are open while
  the turn streams and fold away when it ends.

## Load-bearing contracts — do not break these

1. **Element ids** are the API between the components and the
   Playwright suite (`tests/specs/*.spec.js`, the deployment gate — CI blocks
   the Docker publish if it fails). Examples: `#agentsTable`, `#skillModal`, `#adminTabs`, `#input`,
   `#mcpAgentsCheckboxes`, `#searchEnginesTable`, `#cronFilterInput`,
   `#agentSelect`, `#messages`, `#sendBtn`, `#settingTimezone`. Renaming an id
   means updating the component *and* the tests in the same change.
2. **Visible text is asserted**: badge texts `on`/`off`, `public`, `hidden`,
   tab labels like `Active (2)`, table cell content, `No jobs match.` Keep the
   semantics if you restyle.
3. **State classes**: `.open` (modals, thinking blocks, tool calls), `.active`
   (sections, session items), `.streaming`, `.recording`. The components set
   exactly these names.
4. Semantic class names (`badge-on`, `dc-modal`, `session-item`, …) are
   selected on by the tests — restyle them in CSS rather than renaming, or
   sweep every component + test.

## Previewing and verifying a redesign

```bash
docker compose up -d          # stack on http://localhost:3000, login admin/changeme
cd frontend && npm run watch  # rebuild the pages on save
```
`./agent` is bind-mounted, so HTML/CSS edits are live after a browser reload
(the agent process itself hot-reloads via `node --watch`). Verify with the full
suite — it must stay green:

```bash
cd tests && npm test
```

A finished redesign ships: `frontend/` changes + the rebuilt committed
`agent/src/web/public/` + updated Playwright specs if ids/visible text moved. One PR per surface keeps review sane.

## Known freedoms

Things a redesign may change without breaking contracts: all colors/spacing/
radii/typography (via the theme block and component layer), layout of the
login page, sidebar width and chat bubble styling, table visual treatment,
modal visuals (keep the `.modal-overlay`/`.open` mechanics), animations, the
meme copy (the user owns the tone — ask first), and responsive behavior (the
admin is currently desktop-first; the chat sidebar hides below `md`).
