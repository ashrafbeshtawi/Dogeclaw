// Last error middleware in the chain. index.js mounts it after Sentry's
// handler (which passes every error on), so reporting still sees all of them.
//
// Express 5 routes a rejected handler promise here. Without this the default
// handler answers with an HTML page, which the admin UI's api() helper hands
// straight to res.json() — the user then sees a parse error instead of the
// reason. Postgres constraint violations are the one class of throw that is
// the caller's fault, so they get a 4xx carrying pg's own detail line
// ("Key (name)=(x) already exists."). Everything else is a 500.
const PG_CLIENT_ERROR_STATUS = {
  '23505': 409, // unique_violation
  '23503': 409, // foreign_key_violation
  '22P02': 400, // invalid_text_representation, e.g. a non-numeric :id
};

export function jsonErrorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = PG_CLIENT_ERROR_STATUS[err?.code];
  if (status) return res.status(status).json({ error: err.detail || err.message });
  console.error(`[web] ${req.method} ${req.originalUrl}:`, err);
  res.status(500).json({ error: 'internal error' });
}
