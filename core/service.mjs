// The service: one long-running process that serves every registered project.
//
//   start.sh (in perpetual-adaptive-agents) checks everything and starts it; stop.sh stops it.
//   Underneath: pa up [--foreground], pa down, pa service status.
//
// It runs two things side by side:
//   - the runner for every project in the registry (projects registered later are picked
//     up on the next pass), which wakes agent sessions when they have work;
//   - the dashboard and API on http://127.0.0.1:<port> (default 4777).
// The NATS message board server is a separate program; `pa up` starts it first.

import { runLoop, heartbeat } from './runner.mjs';
import { startDashboard } from '../dashboard/server.mjs';

import { serviceInfo } from './paths.mjs';
const port = serviceInfo().port;
const stamp = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const log = (s) => process.stdout.write(`${stamp()} ${s}\n`);

log(`service starting (pid ${process.pid})`);
try { await startDashboard({ port }); }
catch (e) { log(`service could not start: ${e.message}`); process.exit(3); }
try {
  await runLoop({ projectIds: null, log });
} catch (e) {
  // The dashboard keeps serving so the health check can report what went wrong.
  heartbeat.error = e.message;
  log(`runner stopped: ${e.message}`);
}
