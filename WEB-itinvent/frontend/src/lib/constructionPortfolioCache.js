// Scoped to the actual authenticated user object, never persisted to browser storage.
// A new login/session object cannot access the previous session's snapshots.
let sessions = new WeakMap();
let generation = 0;
export const portfolioCacheGeneration = () => generation;
const MAX_QUERIES = 6;
const MAX_AGE_MS = 30 * 60 * 1000;
export const CONSTRUCTION_PORTFOLIO_FRESH_MS = 5 * 60 * 1000;

function session(user) {
  if (!user || typeof user !== 'object') return null;
  if (!sessions.has(user)) sessions.set(user, { selection: { search: '', kind: 'all' }, queries: new Map() });
  return sessions.get(user);
}
export const portfolioSelection = (user) => session(user)?.selection || { search: '', kind: 'all' };
export function rememberPortfolioSelection(user, search, kind) {
  const state = session(user);
  if (state) state.selection = { search, kind };
}
export function readPortfolioCache(user, search, kind) {
  const state = session(user);
  const key = JSON.stringify([search, kind]);
  const cached = state?.queries.get(key);
  if (!cached) return null;
  if (Date.now() - cached.savedAt > MAX_AGE_MS) { state.queries.delete(key); return null; }
  return cached;
}
export function writePortfolioCache(user, search, kind, response, expectedGeneration = generation) {
  if (expectedGeneration !== generation) return;
  const state = session(user);
  if (!state) return;
  const key = JSON.stringify([search, kind]);
  state.queries.delete(key);
  state.queries.set(key, { response, savedAt: Date.now() });
  while (state.queries.size > MAX_QUERIES) state.queries.delete(state.queries.keys().next().value);
}
export function clearConstructionPortfolioCache() { sessions = new WeakMap(); generation += 1; }
