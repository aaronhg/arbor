// arbor · webServer — start the game server before a run and stop it after (like playwright.config's
// webServer). config.webServer = { command, url?, timeout?, reuseExisting? }. If the url is already up
// (a dev server you started), it's reused. Returns a stop() the caller runs in a finally.
import { spawn } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isUp = async (url) => { try { const r = await fetch(url); return r.status < 500; } catch { return false; } };

export async function startWebServer(config) {
  const ws = config.webServer;
  if (!ws || !ws.command) return () => {};
  const url = ws.url || config.url;

  if (ws.reuseExisting !== false && await isUp(url)) { console.log(`webServer · reusing already-running ${url}`); return () => {}; }

  console.log(`webServer · $ ${ws.command}`);
  // detached → the child leads its own process GROUP, so a compound command (`cd x && serve …`) whose real
  // server is a grandchild still dies: we signal the whole group with process.kill(-pid), not just the shell.
  const child = spawn(ws.command, { cwd: config._dir, stdio: 'ignore', shell: true, detached: true });
  const stop = () => { try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* already gone */ } } };
  process.once('exit', stop); // belt-and-braces if the caller forgets

  const timeout = ws.timeout || 30000, t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (child.exitCode !== null) { throw new Error(`webServer · command exited (${child.exitCode}) before ${url} came up`); }
    if (await isUp(url)) { console.log(`webServer · up at ${url}`); return stop; }
    await sleep(300);
  }
  stop();
  throw new Error(`webServer · ${url} did not come up within ${timeout}ms`);
}
