// Shared helper for the per-router unit tests. Not a test file itself.

/**
 * The routes a Router registers, as "METHOD /path", in registration order.
 * Reading the stack directly means these tests need no DB and no server.
 */
export function routesOf(router) {
  return router.stack
    .filter(layer => layer.route)
    .flatMap(layer =>
      Object.keys(layer.route.methods)
        .filter(m => layer.route.methods[m])
        .map(m => `${m.toUpperCase()} ${layer.route.path}`));
}
