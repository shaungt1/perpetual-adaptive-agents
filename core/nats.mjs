// NATS JetStream: the live side of the board.
//
// Subjects:   pa.<project-id>.board.<to>   (to = all | planner | owner | agent id)
//             pa.<project-id>.control      (runner wake-ups: stop, reset, tick)
// Stream:     PA_BOARD captures pa.> with age/count/size limits and discard-oldest,
//             so the board stays bounded and cleans itself up.
// KV bucket:  pa_presence, keys <project>.<agent>, entries expire after the TTL;
//             a live agent refreshes its key, a dead one disappears on its own.
//
// Everything here is best effort. SQLite already holds every message, so if the
// NATS server is not running the system keeps working and the runner falls back to
// polling on its tick.

// Client: the official NATS JavaScript client, version 3 (@nats-io/transport-node,
// @nats-io/jetstream, @nats-io/kv). Loaded lazily so a missing install never breaks the CLI.
let natsLib = null;
async function lib() {
  if (natsLib === false) return null;
  if (natsLib) return natsLib;
  try {
    const [t, j, k] = await Promise.all([import('@nats-io/transport-node'), import('@nats-io/jetstream'), import('@nats-io/kv')]);
    natsLib = { connect: t.connect, nanos: t.nanos, jetstream: j.jetstream, jetstreamManager: j.jetstreamManager, DiscardPolicy: j.DiscardPolicy, StorageType: j.StorageType, Kvm: k.Kvm };
  } catch { natsLib = false; return null; }
  return natsLib;
}

const conns = new Map();

export function natsDisabled() {
  return process.env.PA_NATS === 'off';
}

// Short-lived CLI processes connect once and give up quickly. Long-lived processes
// (runner, dashboard) keep reconnecting forever, so a NATS restart does not leave them deaf.
export async function getConnection(url, { longLived = false } = {}) {
  if (natsDisabled()) return null;
  const key = `${longLived ? 'L' : 'S'}:${url}`;
  const cached = conns.get(key);
  if (cached && !cached.isClosed()) return cached;
  conns.delete(key);
  const n = await lib();
  if (!n) return null;
  try {
    const nc = await n.connect(longLived
      ? { servers: url, timeout: 1500, reconnect: true, maxReconnectAttempts: -1, reconnectTimeWait: 2000, name: 'pa-runner' }
      : { servers: url, timeout: 1500, reconnect: false, name: 'pa-cli' });
    conns.set(key, nc);
    return nc;
  } catch {
    return null;
  }
}

export async function closeConnections() {
  for (const nc of conns.values()) { try { await nc.drain(); } catch {} }
  conns.clear();
}

const ensured = new Set();
export async function ensureBoardStream(nc, settings) {
  const key = `${settings.board.max_age_hours}:${settings.board.max_msgs}:${settings.board.max_bytes}`;
  if (ensured.has(key)) return;
  const n = await lib();
  const jsm = await n.jetstreamManager(nc);
  const cfg = {
    name: 'PA_BOARD',
    subjects: ['pa.>'],
    max_age: n.nanos(settings.board.max_age_hours * 3600 * 1000),
    max_msgs: settings.board.max_msgs,
    max_bytes: settings.board.max_bytes,
    discard: n.DiscardPolicy.Old,
    storage: n.StorageType.File,
    duplicate_window: n.nanos(settings.board.duplicate_window_seconds * 1000),
  };
  try { await jsm.streams.info('PA_BOARD'); await jsm.streams.update('PA_BOARD', cfg); }
  catch { await jsm.streams.add(cfg); }
  ensured.add(key);
}

export const boardSubject = (projectId, to = 'all') => `pa.${projectId}.board.${String(to).replace(/[^A-Za-z0-9_-]/g, '_')}`;
export const controlSubject = (projectId) => `pa.${projectId}.control`;

// Publish one board message. msgID makes JetStream drop a duplicate if the same
// message is published twice inside the duplicate window.
export async function publishBoard(settings, projectId, message) {
  const nc = await getConnection(settings.board.nats_url);
  if (!nc) return false;
  try {
    await ensureBoardStream(nc, settings);
    const js = (await lib()).jetstream(nc);
    await js.publish(boardSubject(projectId, message.to_agent), new TextEncoder().encode(JSON.stringify(message)), { msgID: message.id });
    return true;
  } catch {
    return false;
  }
}

export async function publishControl(settings, projectId, payload) {
  const nc = await getConnection(settings.board.nats_url);
  if (!nc) return false;
  try { nc.publish(controlSubject(projectId), new TextEncoder().encode(JSON.stringify(payload))); await nc.flush(); return true; }
  catch { return false; }
}

export async function putPresence(settings, projectId, agentId) {
  const nc = await getConnection(settings.board.nats_url);
  if (!nc) return false;
  try {
    const n = await lib();
    const kv = await new n.Kvm(nc).create('pa_presence', { ttl: settings.runner.presence_ttl_seconds * 1000, history: 1 });
    await kv.put(`${projectId}.${agentId}`, new TextEncoder().encode(new Date().toISOString()));
    return true;
  } catch { return false; }
}

// Subscribe to everything for one project (runner and dashboard use this to wake up).
export async function subscribeProject(settings, projectId, onMessage) {
  const nc = await getConnection(settings.board.nats_url, { longLived: true });
  if (!nc) return null;
  const sub = nc.subscribe(`pa.${projectId}.>`);
  (async () => {
    for await (const m of sub) {
      try { onMessage(m.subject, JSON.parse(new TextDecoder().decode(m.data))); } catch {}
    }
  })();
  return sub;
}

export async function natsStatus(url) {
  const nc = await getConnection(url);
  if (!nc) return { connected: false };
  try {
    const jsm = await (await lib()).jetstreamManager(nc);
    const info = await jsm.streams.info('PA_BOARD').catch(() => null);
    return { connected: true, server: nc.info?.server_name, version: nc.info?.version, jetstream: true, board: info ? { messages: info.state.messages, bytes: info.state.bytes } : null };
  } catch {
    return { connected: true, jetstream: false };
  }
}
