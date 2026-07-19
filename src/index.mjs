// arbor · public API. `import { defineConfig } from 'arbor'` in arbor.config.mjs; `run(mode, opts)` to
// drive a mode programmatically (the CLI is a thin wrapper over this).
export { defineConfig } from './config.mjs';
import { loadConfig } from './config.mjs';

export const GATE_MODES = ['coverage', 'visual', 'gate'];         // zero-LLM (the always-on floor)
export const AI_MODES = ['calibrate', 'verify', 'orchestrate', 'impact', 'explore', 'agentic']; // opt-in (need an LLM)
export const MODES = [...GATE_MODES, ...AI_MODES];

export async function run(mode, opts = {}) {
  if (!MODES.includes(mode)) throw new Error(`unknown mode: ${mode} (one of ${MODES.join(', ')})`);
  const config = opts.config && typeof opts.config === 'object' ? opts.config : await loadConfig(typeof opts.config === 'string' ? opts.config : undefined);
  if (opts.model && !process.env.ANTHROPIC_MODEL) process.env.ANTHROPIC_MODEL = opts.model;
  else if (config.model && !process.env.ANTHROPIC_MODEL) process.env.ANTHROPIC_MODEL = config.model;
  const mod = await import(`./modes/${mode}.mjs`);
  return mod[mode](config, opts);
}
