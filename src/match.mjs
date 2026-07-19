// arbor · match — the coir↔copse ref-matching vocabulary: does a coir STATIC nodePath correspond to a
// copse RUNTIME ref? A faithful mirror of copse/src/coverage.js `tailMatch`. arbor's control-layer work —
// the coverage JOIN and test SELECTION (affected) — both key on it, and arbor resolves copse dynamically
// (config-driven), so it can't statically import copse's copy. copse keeps its own for
// resolveCoirPath/resolveCopseRef (which need a live tree). The two are the SAME contract; match.test.mjs
// pins the shared cases on this side and copse's coverage.test.js on the other, so they can't drift apart.
const segs = (p) => String(p == null ? '' : p).split('/').filter(Boolean);
const nameOf = (seg) => seg.replace(/\[\d+\]$/, '');   // drop a trailing [i] for fuzzy name compare
const MIN_FUZZY_TAIL = 2;                               // a lone generic leaf ('btn') is too weak as a partial suffix

/**
 * Do `staticPath` and `runtimeRef` share a full tail — the SHORTER path's segments a suffix of the
 * longer's (segment-aligned, `[i]` ignored)? Returns the differing heads `{mount, dropped}` (coir's
 * scene/prefab-file root that copse omits, and a prefab's instantiation mount) or null. A 1-segment
 * PARTIAL tail (below MIN_FUZZY_TAIL) is too weak → null; a full 1-segment alignment still matches.
 * @param {string} staticPath @param {string} runtimeRef
 * @returns {{mount:string, dropped:string}|null}
 */
export function tailMatch(staticPath, runtimeRef) {
  const s = segs(staticPath), r = segs(runtimeRef);
  const n = Math.min(s.length, r.length);
  if (!n) return null;
  for (let k = 1; k <= n; k++) if (nameOf(s[s.length - k]) !== nameOf(r[r.length - k])) return null;
  if (n < MIN_FUZZY_TAIL && s.length !== r.length) return null;
  return { mount: r.slice(0, r.length - n).join('/'), dropped: s.slice(0, s.length - n).join('/') };
}
