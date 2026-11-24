# Google connection (Gmail + Calendar): what it takes

Status: research only, no code yet. Written by the night shift **without web access**,
so everything below is from prior knowledge of Google's OAuth policies (as of mid-2026)
and must be checked against the linked pages before acting on it.

## TL;DR

Google's app verification is required **only to publish an app to the public**. A
self-hosted DogeClaw used by its owner never has to go through it. Each operator creates
their own Google Cloud OAuth client, so the "apply via a Google form and nobody replies"
step doesn't block us.

| Path | Verification | Catch |
|---|---|---|
| **A. Own OAuth client, "Testing" mode** | none | max 100 listed test users; **refresh tokens expire after 7 days** → reconnect weekly |
| **B. Own OAuth client, "In production", unverified** | none for personal use | "Google hasn't verified this app" warning on consent (click through); 100-user cap on sensitive/restricted scopes; tokens don't expire weekly |
| **C. Google Workspace, "Internal" user type** | none | needs a paid Workspace domain; only accounts in that domain |
| **D. Public verified app (one client for all DogeClaw users)** | brand + sensitive-scope review; Gmail **restricted** scopes also need a yearly third-party security assessment (CASA) | weeks to months plus cost: the process that doesn't get answered. Not worth it for a self-hosted tool |
| **E. No OAuth: IMAP/SMTP + app password, CalDAV/ICS** | none | needs 2FA and an app password; Calendar write over CalDAV is clunky; Google may restrict app passwords further |

**Recommendation:** B, with A as the fallback. The operator brings their own client ID
and secret (admin UI), DogeClaw runs the standard authorization-code flow with
`access_type=offline` and stores the refresh token per agent or per user.

## Scope classes (check: developers.google.com/identity/protocols/oauth2/scopes)

- Calendar: `calendar.events` / `calendar.readonly` are **sensitive**: in production they
  need verification only when the app is used by people outside the owner's own project.
- Gmail: `gmail.readonly`, `gmail.modify`, `gmail.compose` are **restricted** (the strictest
  class, which is what CASA covers). `gmail.send` is sensitive, not restricted. Reading
  mail at all means a restricted scope, so options A–C are the realistic ones.

## What we'd build (for the follow-up PR)

1. Admin → *Connections* tab: Google client ID + secret, redirect URI shown for copy
   (`<instance URL>/oauth/google/callback`, e.g. `http://localhost:3000/oauth/google/callback`).
2. `GET /oauth/google/start` → consent screen with the chosen scopes, `prompt=consent`,
   `access_type=offline`. Callback stores the refresh token encrypted (DOGECLAW_WEB_SECRET-derived key),
   in a new `oauth_connections` table, revoked from the restricted DB role like `models.api_key` (V18).
   - Both `/oauth/google/start` and the callback need an authenticated admin session.
   - CSRF: `start` creates a random `state` value, binds it to the admin session and sends it
     to Google; the callback rejects the request unless `state` matches, then drops it. Without
     this, another site can make the admin's browser finish a flow with the attacker's Google
     account, and the agent then reads and sends mail through that account.
   - PKCE: `start` also creates a `code_verifier` (kept in the session) and sends its S256
     `code_challenge`; the callback sends the verifier with the code exchange.
3. Tools: `gmail_search`, `gmail_read`, `gmail_send` (draft-first, with a confirm flag),
   `calendar_list_events`, `calendar_create_event`. Plain `fetch` against the REST APIs:
   no `googleapis` dependency needed.
4. A token refresh helper that shows `invalid_grant` (7-day expiry in Testing mode, or a revoked grant) as
   "reconnect Google in /admin" instead of a stack trace.

The callback must be reachable from the user's browser, not from Google: `localhost`
works for local installs, so no public URL is required.

## Open questions for you

- Is one Google account per DogeClaw instance enough, or one per agent?
- Is read+send enough for Gmail, or do you also want labels/archiving (`gmail.modify`)?
- Should the agent send email without asking, or only create drafts?

## To verify (couldn't be fetched tonight)

- support.google.com/cloud/answer/13463073 (unverified apps, 100-user cap)
- developers.google.com/identity/protocols/oauth2#expiration (7-day Testing-mode refresh tokens)
- support.google.com/cloud/answer/9110914 (restricted scopes and the security assessment)
