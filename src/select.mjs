// arbor · select — which frozen flow tests a change AFFECTS (the runtime-format sibling of coir's `impact`).
// Pure, runs no game AND needs no project files: a test is affected iff a nodePath it drives tail-matches
// an impacted button. By the boundary rule that makes it neither coir's nor copse's — it's control-layer
// test SELECTION, so it lives in arbor (moved out of copse, which used to ship it as `copse affected`).
import { tailMatch } from './match.mjs';

// The nodePaths a frozen flow script statically DRIVES: press `ref`, get/call/patch `sel` (the path before
// `:Comp.member`), and each `cc.find('path')` inside an `eval` expression. Pure string work.
export function drivenPaths(script) {
  const out = new Set();
  for (const st of (script && script.steps) || []) {
    if (st.ref) out.add(st.ref);
    if (st.sel) out.add(String(st.sel).split(':')[0]);
    if (st.expr) for (const m of String(st.expr).matchAll(/cc\.find\(\s*['"]([^'"]+)['"]/g)) out.add(m[1]);
  }
  return [...out];
}

/**
 * Which frozen flow tests are affected by a change. A scene/prefab-level impact (no specific buttons)
 * can't be narrowed, so every test is kept (`sceneOnly`).
 * @param {{impactedButtons?:Array<{nodePath:string}>, impactedScenes?:Array<any>}} risk  a `coir impact` result
 * @param {Array<{name?:string, script:any}>} tests
 * @returns {{affected:Array<{name:string, hits:string[]}>, skipped:string[], sceneOnly:boolean}}
 */
export function affectedData(risk, tests) {
  const riskPaths = ((risk && risk.impactedButtons) || []).map((b) => b.nodePath);
  // Keep ALL tests whenever coir reports an impacted SCENE. Real coir output carries the host scene for
  // any code impact, and a scene's behaviour can be affected BEYOND the individual buttons whose handlers
  // changed (a script tweak alters shared state a different flow reads), so narrowing to the button hits
  // would risk MISSING a cross-flow effect — the unsafe direction for a QA gate. The button-narrowing
  // path fires only for a finer impact with NO scene. The gate's other lever — SKIP when the risk set is
  // empty (a docs/README PR) — is unaffected, and is where the impact-scoping earns its keep.
  // (A code review flagged the mixed scene+button case; keep-all is the resolution. The button-narrow path
  // is still covered by select.test.mjs's crafted no-scene fixtures; the contract golden locks this one.)
  const sceneOnly = (((risk && risk.impactedScenes) || []).length > 0);
  const affected = [], skipped = [];
  for (const t of tests || []) {
    const name = t.name || '?';
    const hits = sceneOnly
      ? ['(scene changed — all kept)']
      : [...new Set(drivenPaths(t.script).filter((d) => riskPaths.some((rp) => tailMatch(rp, d))))];
    if (hits.length) affected.push({ name, hits }); else skipped.push(name);
  }
  return { affected, skipped, sceneOnly };
}
