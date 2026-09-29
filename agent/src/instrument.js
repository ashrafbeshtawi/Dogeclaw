// Sentry-compatible error reporting (GlitchTip). Loaded before anything else
// so the SDK can hook express/pg/http. With SENTRY_DSN unset the SDK stays
// inert: no client, no network, no log output.
import * as Sentry from '@sentry/node';

if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, environment: 'production' });
}
