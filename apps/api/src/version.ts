/**
 * Reported by `GET /health` so a running instance can be identified after a deploy.
 * Kept in sync with `package.json` by hand — reading the manifest at runtime breaks as soon as the
 * build output layout changes, which is exactly when you need the health check to work.
 */
export const API_VERSION = '0.1.0';
