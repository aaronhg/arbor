// arbor · join — the coir × copse coverage JOIN. Given coir's STATIC ClickEvent map and copse's RUNTIME
// click surface (cp.clickSurface()), bucket every wired button into covered / blocked / unreached /
// codeOnly (+ ambiguous / uncertain / codeRegistered) on the shared key `(nodePath, method)`. Moved out
// of copse: the join needs NEITHER project files NOR a live game — it's pure control-layer reconciliation
// over the two surfaces each tool supplies, so by the boundary rule it's arbor's. copse keeps the runtime
// half (clickSurface) and its resolveCoirPath/resolveCopseRef adapters (which DO need a live tree).
//
// Matching is two-tier so prefab-internal buttons join too (EXACT ref===nodePath, else a UNIQUE fuzzy
// tail — see match.mjs). Ambiguity is bounded BOTH ways and never guessed: one static → many live =
// `fan-out`; one live → many static = `fan-in`. See copse docs/COVERAGE.md for the full recipe.
import { tailMatch } from './match.mjs';

/**
 * @param {Array<{nodePath:string, method:string|null, [k:string]:any}>} staticRows coir side (rows with method:null are skipped)
 * @param {Array<{ref:string, method:string|null, interactable?:boolean, reachable?:boolean|'unsure', blockedBy?:string, occludedBy?:string, codeHandlers?:any[], [k:string]:any}>} runtimeRows copse `clickSurface()` rows
 * @returns {{covered:any[], blocked:any[], unreached:any[], ambiguous:any[], uncertain:any[], codeRegistered:any[], codeOnly:any[]}}
 */
export function coverageJoin(staticRows, runtimeRows) {
  const covered = [], blocked = [], unreached = [], ambiguous = [], uncertain = [], codeRegistered = [], codeOnly = [];
  const live = (runtimeRows || []).filter(Boolean);
  const exact = new Map(live.filter((r) => r.method != null).map((r) => [`${r.ref} ${r.method}`, r]));
  const consumed = new Set();

  // Pass 1 — resolve each static row to AT MOST ONE runtime row (exact, else a UNIQUE fuzzy tail). >1
  // fuzzy candidate is `fan-out` ambiguity. No live match → `unreached`. Bucketing is DEFERRED to pass 2:
  // a single live button can be claimed by >1 static row (fan-in), reconciled before anything is `covered`.
  /** @type {Map<any, Array<{s:any, via:string, tail:any}>>} */
  const claims = new Map();
  for (const s of staticRows || []) {
    if (!s || s.method == null) continue; // can't join without a method key
    let hit = exact.get(`${s.nodePath} ${s.method}`);
    let via = 'exact', tail;
    if (!hit) {
      const cands = live.filter((r) => r.method === s.method && tailMatch(s.nodePath, r.ref));
      // >1 tail candidate → ambiguous (never guessed). Mark them consumed so they don't ALSO leak into codeOnly.
      if (cands.length > 1) { ambiguous.push({ ...s, candidates: cands.map((c) => c.ref), reason: 'fan-out' }); cands.forEach((c) => consumed.add(c)); continue; }
      if (cands.length === 1) { hit = cands[0]; via = 'prefix'; tail = tailMatch(s.nodePath, hit.ref); }
    }
    if (!hit) { unreached.push(s); continue; }
    const arr = claims.get(hit); if (arr) arr.push({ s, via, tail }); else claims.set(hit, [{ s, via, tail }]);
  }

  // Pass 2 — reconcile fan-in, then bucket. A live row claimed by exactly ONE static row buckets normally.
  // Claimed by >1 (same-named buttons across scenes/prefabs) → all `fan-in` ambiguous, never double-counted.
  // Either way the live row is `consumed` (so it can't leak into codeOnly), which kills exact+prefix double-count.
  for (const [hit, rows] of claims) {
    consumed.add(hit);
    if (rows.length > 1) { for (const { s } of rows) ambiguous.push({ ...s, candidates: [hit.ref], reason: 'fan-in' }); continue; }
    const { s, via, tail } = rows[0];
    const row = via === 'prefix' ? { ...s, runtime: hit, via, mount: tail.mount, dropped: tail.dropped } : { ...s, runtime: hit, via };
    if (hit.reachable === false || hit.interactable === false) blocked.push(row);
    // wired + live but copse can't CONFIRM a player reaches/sees it: reachable:'unsure' or occludedBy →
    // NOT a confident `covered` (fail-loud uncertainty survives the join).
    else if (hit.reachable === 'unsure' || hit.occludedBy) uncertain.push(row);
    else covered.push(row);
  }

  // Runtime rows with no editor-clickEvent match. `codeHandlers` (live node.on() listeners) → codeRegistered
  // (a downgraded level: wired in code, but registration alone doesn't prove it's an action — NOT `covered`).
  // None → truly bare `codeOnly`.
  for (const r of live) {
    if (consumed.has(r)) continue;
    if (r.codeHandlers && r.codeHandlers.length) codeRegistered.push(r); else codeOnly.push(r);
  }
  return { covered, blocked, unreached, ambiguous, uncertain, codeRegistered, codeOnly };
}
