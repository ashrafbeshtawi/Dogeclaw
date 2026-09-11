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
logo (`agent/src/web/public/logo.png`, also the favicon) is front and center on
login and the chat empty state. Accent color is an assertive red. A redesign
can evolve the look, but the playful-dark-red identity is the brand.

## The three surfaces

| Page | File | Purpose |
|---|---|---|
| Login | `agent/src/web/public/login.html` | Centered card, logo, two fields, meme footer |
| Chat | `agent/src/web/public/index.html` | Sidebar (logo, agent select, session list, admin/logout) + message pane + composer (attach, mic, textarea, send). Streams responses via SSE with a spinner/status row, collapsible "thinking" blocks, image/audio chips |
| Admin | `agent/src/web/public/admin.html` | Top navbar, horizontal tab bar (Models, Agents, Skills, Channels, MCP, Search, Cron Jobs, Events, Settings), each tab a table + "＋ New" button opening a modal. Crons tab adds All/Active/Inactive sub-tabs with counts and a text filter |

All three are **self-contained HTML files**: inline vanilla JS (no framework,
no bundler, no imports), served statically by Express from
`agent/src/web/public/` under `/static` (pages themselves at `/login`, `/`,
`/admin`). There is no SPA router — the admin tab state lives in the URL hash
(`/admin#crons`).

## Tech stack and build

- **Tailwind CSS v4 + daisyUI v5**, dark-only custom theme named `dogeclaw`
  (`data-theme="dogeclaw"` on `<html>`).
- Source of truth: `frontend/app.css`. Build:
  ```bash
  cd frontend && npm install && npm run build   # or npm run watch
  ```
  Output `agent/src/web/public/app.css` is **committed** — the Docker image
  has no build step and just serves the generated file. Never edit the
  generated file; edit `frontend/app.css` and rebuild.
- `@source "../agent/src/web/public/*.html"` — Tailwind scans the three pages,
  so utility classes used only in JS string templates are NOT seen by the
  scanner. That's why JS-emitted DOM uses **semantic legacy classes** styled in
  `@layer components` instead of utilities.

## Design tokens (the `dogeclaw` daisyUI theme)

Defined in `frontend/app.css` via `@plugin "daisyui/theme"`. Recoloring the
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

**Static markup** (in the HTML files) uses daisyUI/Tailwind directly:
`btn btn-primary|ghost|outline btn-xs|sm|square`, `input`/`select`/`textarea`
(+ `input-sm`, `select-sm`), `table table-sm` inside
`div.overflow-x-auto.rounded-2xl.border.border-white/5.bg-base-100`,
`badge badge-sm`, `card`/`card-body` (login), `toggle toggle-primary toggle-sm`,
`navbar`.

**JS-emitted DOM** uses semantic classes defined in `@layer components` of
`frontend/app.css`:

- Admin: `.section`/`.section.active` (tab panels), `.tab-button`(.active),
  `.hint` + `.field-hint` (with red inline `code` chips), `td.actions` +
  its buttons, `button.danger`, badge variants `.badge-on` (green),
  `.badge-off` (red), `.badge-tag` (blue).
- Modals: `.modal-overlay`(.open toggled by JS) → `.dc-modal` card
  (max-width 500px, `base-300`, red-tinted border). Inside: block `label`s,
  full-width inputs/selects/textareas with focus ring, `.dc-toggle`,
  `.checks` (checkbox grids), `.btn-row` (right-aligned Cancel/Save).
  **Every modal's inner container must be `dc-modal`** — `class="modal"` has
  no styles (that bug shipped once).
- Chat: `.msg.user|.assistant` bubbles, `.media-chip`, `.thinking-block`
  (+ `.thinking-toggle`, `.thinking-content.open`), `.spinner` + `.status-text`
  + `.status-row` (shown while `.streaming`), `.session-item`(.active, `.src`
  badge, hover-revealed `.del`), `.empty-state` (breathing logo),
  `.new-chat-btn` (dashed red), `.media-btn.recording` (pulsing).
- Login: `.login-bg` (red radial glows), `.login-card` (entry animation),
  `.login-logo` (drop shadow + breathe), `.error` (shake), `.login-dot` (blink).
- Keyframes: `dc-spin`, `dc-pulse`, `dc-breathe`, `dc-card-entry`, `dc-shake`,
  `dc-blink`.

**Two cascade gotchas** documented in the CSS: badge color variants must stay
**outside** any `@layer` (daisyUI's own layer would outrank them), and the
action-cell selector is the compound `td.actions`, not `td .actions`.

## Interaction patterns

- Admin tabs: `showTab(name)` toggles `.active` and writes the URL hash;
  valid tab list lives in the inline JS.
- CRUD: every entity = table row → Edit/Delete buttons → `dc-modal` prefilled
  by `open*Modal(idOrObject)`; Save calls the JSON API then `load()` re-fetches
  everything and re-renders. Deletes use native `confirm()`; errors use
  `alert()`.
- Crons tab: sub-tab buttons (`data-cron-view`, labels carry live counts),
  free-text filter input, active-first sorting, "No jobs match." empty state.
- Search engines tab: ↑/↓ buttons per row reorder priority; provider select in
  the modal shows/hides the Google-only `cx` field; provider options are
  rendered from the API (`providers` field), not hardcoded.
- Chat: Enter sends (Shift+Enter newline), SSE streaming appends into the last
  assistant bubble, tool-call/thinking events render as collapsible blocks,
  🗄️/🔧 icon line is appended by the backend.

## Load-bearing contracts — do not break these

1. **Element ids** are the API between markup, the inline JS, and the
   Playwright suite (`tests/specs/*.spec.js`, the deployment gate — CI blocks
   the Docker publish if it fails). Examples: `#agentsTable`, `#skillModal`,
   `#mcpAgentsCheckboxes`, `#searchEnginesTable`, `#cronFilterInput`,
   `#agentSelect`, `#messages`, `#sendBtn`, `#settingTimezone`. Renaming an id
   means updating the JS *and* the tests in the same change.
2. **Visible text is asserted**: badge texts `on`/`off`, `public`, `hidden`,
   tab labels like `Active (2)`, table cell content, `No jobs match.` Keep the
   semantics if you restyle.
3. **JS-toggled state classes**: `.open` (modals, thinking blocks), `.active`
   (sections, tabs, session items), `.streaming`, `.recording`. The JS adds and
   removes exactly these names.
4. JS-emitted class names (`badge-on`, `dc-modal`, `session-item`, …) are
   referenced in dozens of string templates — restyle them in CSS rather than
   renaming, or sweep every template + test.

## Previewing and verifying a redesign

```bash
docker compose up -d          # stack on http://localhost:3000, login admin/changeme
cd frontend && npm run watch  # rebuild app.css on save
```
`./agent` is bind-mounted, so HTML/CSS edits are live after a browser reload
(the agent process itself hot-reloads via `node --watch`). Verify with the full
suite — it must stay green:

```bash
cd tests && npm test
```

A finished redesign ships: `frontend/app.css` changes + the rebuilt committed
`agent/src/web/public/app.css` + any HTML changes + updated Playwright specs
if ids/visible text moved. One PR per surface keeps review sane.

## Known freedoms

Things a redesign may change without breaking contracts: all colors/spacing/
radii/typography (via the theme block and component layer), layout of the
login page, sidebar width and chat bubble styling, table visual treatment,
modal visuals (keep the `.modal-overlay`/`.open` mechanics), animations, the
meme copy (the user owns the tone — ask first), and responsive behavior (the
admin is currently desktop-first; the chat sidebar hides below `md`).
