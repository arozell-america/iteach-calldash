/**
 * iTeach Call Floor Dashboard - Backend Server
 * Receives Zoom webhooks → broadcasts to dashboard via WebSocket
 */

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// CORS - allow requests from any origin (including local file:// admin page)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json());

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  agents: {},
  queues: {
    'q1': { id: 'q1', name: 'Lead Team',     waiting: 0, avgWait: 0, callsHandled: 0 },
    'q2': { id: 'q2', name: 'Educational',   waiting: 0, avgWait: 0, callsHandled: 0 },
    'q3': { id: 'q3', name: 'Relational',    waiting: 0, avgWait: 0, callsHandled: 0 },
    'q4': { id: 'q4', name: 'Engagement',    waiting: 0, avgWait: 0, callsHandled: 0 },
    'q5': { id: 'q5', name: 'Certification', waiting: 0, avgWait: 0, callsHandled: 0 },
    'q6': { id: 'q6', name: 'Curriculum',    waiting: 0, avgWait: 0, callsHandled: 0 },
  },
  callLog: [],
  stats: { callsToday: 0, applicationsToday: 0, avgSpeedToCall: null },
};

// ─── Persistence ──────────────────────────────────────────────────────────────

const STATE_FILE = path.join(__dirname, 'state.json');

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ agents: state.agents, stats: state.stats }, null, 2));
  } catch(e) { console.error('Save state error:', e.message); }
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (saved.agents) Object.assign(state.agents, saved.agents);
      if (saved.stats) Object.assign(state.stats, saved.stats);
      console.log('State loaded:', Object.keys(state.agents).length, 'agents');
    }
  } catch(e) { console.error('Load state error:', e.message); }
}

loadState();

// ─── WebSocket ────────────────────────────────────────────────────────────────

function broadcast(message) {
  const data = JSON.stringify(message);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(data);
  });
}

wss.on('connection', (ws) => {
  console.log('Dashboard client connected');
  ws.send(JSON.stringify({ type: 'STATE_UPDATE', payload: getPublicState() }));
  ws.on('close', () => console.log('Dashboard client disconnected'));
});

function getPublicState() {
  return { agents: state.agents, queues: state.queues, stats: state.stats, timestamp: Date.now() };
}

// ─── Agent Lookup (case-insensitive — Zoom sends IDs lowercase) ───────────────

function findAgentKey(userId) {
  if (!userId) return null;
  const lower = userId.toLowerCase();
  const match = Object.keys(state.agents).find(k => k.toLowerCase() === lower);
  if (!match) console.log('[LOOKUP MISS] userId:', userId, 'lower:', lower, 'keys:', Object.keys(state.agents).map(k => k.toLowerCase()));
  return match || null;
}

// ─── Zoom Webhook ─────────────────────────────────────────────────────────────

function verifyZoomWebhook(req) {
  const secret = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;
  if (!secret) return true;
  const message = `v0:${req.headers['x-zm-request-timestamp']}:${JSON.stringify(req.body)}`;
  const hash = crypto.createHmac('sha256', secret).update(message).digest('hex');
  return req.headers['x-zm-signature'] === `v0=${hash}`;
}

app.get('/webhook/zoom', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/webhook/zoom', (req, res) => {
  if (req.body?.event === 'endpoint.url_validation') {
    const hash = crypto
      .createHmac('sha256', process.env.ZOOM_WEBHOOK_SECRET_TOKEN || '')
      .update(req.body.payload.plainToken)
      .digest('hex');
    return res.json({ plainToken: req.body.payload.plainToken, encryptedToken: hash });
  }

  if (!verifyZoomWebhook(req)) return res.status(401).json({ error: 'Invalid signature' });

  const { event, payload } = req.body;
  console.log('Zoom event name:', event);
  console.log('Zoom payload:', JSON.stringify(payload, null, 2));

  handleZoomEvent(event, payload);
  saveState();
  broadcast();
  res.json({ received: true });
});

// Auto-register agent from webhook payload
function autoRegister(userId, userObj) {
  if (!userId || findAgentKey(userId)) return;
  const name = userObj?.display_name || userObj?.name ||
    [userObj?.first_name, userObj?.last_name].filter(Boolean).join(' ') ||
    userObj?.email?.split('@')[0] || 'Unknown';
  const email = userObj?.email || '';
  if (!email.endsWith('@iteach.net')) {
    console.log('[autoRegister] Skipping non-iTeach user:', email);
    return;
  }
  let team = 'Lead Team';
  const hint = (name + ' ' + email).toLowerCase();
  if (hint.includes('cert')) team = 'Certification';
  else if (hint.includes('curr')) team = 'Curriculum';
  else if (hint.includes('support') || hint.includes('tech')) team = 'Engagement';
  console.log(`Auto-registering: ${name} (${userId})`);
  state.agents[userId] = {
    id: userId, name, team, extension: userObj?.extension_number || '', email,
    status: 'available', callStartTime: null, callerId: null,
    enrollmentsToday: 0, callsToday: 0, autoRegistered: true,
  };
  saveState();
}

function handleZoomEvent(event, payload) {
  console.log('[ZOOM EVENT]', event);
  const caller_uid = payload?.caller?.user_id || payload?.object?.caller?.user_id;
  const callee_uid = payload?.callee?.user_id || payload?.object?.callee?.user_id;
  console.log('[ZOOM IDs] caller_uid:', caller_uid, 'callee_uid:', callee_uid);
  console.log('[ZOOM AGENTS]', Object.keys(state.agents));

  // Callee side (inbound) — supports both phone. and phone_call. prefixes
  if (['phone.callee_ringing', 'phone_call.callee_ringing', 'phone_call.ringing'].includes(event)) {
    const userId = payload?.callee?.user_id || payload?.object?.callee?.user_id;
    autoRegister(userId, payload?.callee || payload?.object?.callee);
    const key = findAgentKey(userId);
    console.log('[caller_ringing] key:', key);
    if (key) {
      state.agents[key].status = 'ringing';
      console.log('[caller_ringing] SET ringing:', state.agents[key].name);
      state.agents[key].callerId = payload?.caller?.phone_number || payload?.object?.caller?.phone_number || 'Unknown';
    }
  }

  else if (['phone.callee_answered', 'phone_call.callee_answered', 'phone_call.answered'].includes(event)) {
    const userId = payload?.callee?.user_id || payload?.object?.callee?.user_id;
    autoRegister(userId, payload?.callee || payload?.object?.callee);
    const key = findAgentKey(userId);
    console.log('[caller_connected] key:', key);
    if (key) {
      state.agents[key].status = 'on_call';
      console.log('[caller_connected] SET on_call:', state.agents[key].name);
      state.agents[key].callStartTime = Date.now();
      state.stats.callsToday++;
    }
  }

  else if (['phone.callee_ended', 'phone_call.callee_ended', 'phone_call.ended'].includes(event)) {
    const userId = payload?.callee?.user_id || payload?.object?.callee?.user_id;
    const key = findAgentKey(userId);
    console.log('[caller_ended] key:', key);
    if (key) {
      state.agents[key].status = 'available';
      console.log('[caller_ended] SET available:', state.agents[key].name);
      state.agents[key].callStartTime = null;
      state.agents[key].callerId = null;
      state.agents[key].callsToday = (state.agents[key].callsToday || 0) + 1;
    }
  }

  // Caller side (outbound) — supports both phone. and phone_call. prefixes
  else if (['phone.caller_ringing', 'phone_call.caller_ringing', 'phone_call.started'].includes(event)) {
    const userId = payload?.caller?.user_id || payload?.object?.caller?.user_id;
    autoRegister(userId, payload?.caller || payload?.object?.caller);
    const key = findAgentKey(userId);
    console.log('[caller_ringing] key:', key);
    if (key) {
      state.agents[key].status = 'ringing';
      console.log('[caller_ringing] SET ringing:', state.agents[key].name);
      state.agents[key].callerId = payload?.callee?.phone_number || payload?.object?.callee?.phone_number || 'Outbound';
    }
  }

  else if (['phone.caller_connected', 'phone_call.caller_answered', 'phone_call.caller_connected'].includes(event)) {
    const userId = payload?.caller?.user_id || payload?.object?.caller?.user_id;
    const key = findAgentKey(userId);
    console.log('[caller_connected] key:', key);
    if (key) {
      state.agents[key].status = 'on_call';
      console.log('[caller_connected] SET on_call:', state.agents[key].name);
      state.agents[key].callStartTime = Date.now();
      state.stats.callsToday++;
    }
  }

  else if (['phone.caller_ended', 'phone_call.caller_ended'].includes(event)) {
    const userId = payload?.caller?.user_id || payload?.object?.caller?.user_id;
    const key = findAgentKey(userId);
    console.log('[caller_ended] key:', key);
    if (key) {
      state.agents[key].status = 'available';
      console.log('[caller_ended] SET available:', state.agents[key].name);
      state.agents[key].callStartTime = null;
      state.agents[key].callerId = null;
      state.agents[key].callsToday = (state.agents[key].callsToday || 0) + 1;
    }
  }

  // Presence
  else if (event === 'user.presence_status_updated') {
    const userId = payload?.id || payload?.user_id || payload?.object?.id;
    autoRegister(userId, payload?.object || payload);
    const key = findAgentKey(userId);
    const presenceMap = {
      'Available': 'available', 'Away': 'away',
      'Do_Not_Disturb': 'dnd', 'In_A_Zoom_Meeting': 'meeting',
      'On_Phone_Call': 'on_call', 'Offline': 'offline',
    };
    if (key) {
      const mapped = presenceMap[payload?.presence_status || payload?.object?.presence_status] || 'available';
      // Don't let presence override an active call (ringing or on_call)
      const isActive = ['on_call', 'ringing'].includes(state.agents[key].status);
      if (!isActive || mapped === 'on_call') {
        console.log('[Presence webhook]', state.agents[key].name + ':', state.agents[key].status, '->', mapped);
        state.agents[key].status = mapped;
      }
    }
  }

  else {
    console.log('Unhandled Zoom event:', event);
  }

  broadcast({ type: 'STATE_UPDATE', payload: getPublicState() });
  saveState();

  state.callLog.unshift({ event, payload, timestamp: Date.now() });
  if (state.callLog.length > 500) state.callLog.pop();
}

// ─── REST API ─────────────────────────────────────────────────────────────────

app.get('/api/state', (req, res) => res.json(getPublicState()));

app.post('/api/agents', (req, res) => {
  const { id, name, team, extension } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id and name required' });
  state.agents[id] = { id, name, team, extension, status: 'available', callsToday: 0, enrollmentsToday: 0 };
  broadcast({ type: 'STATE_UPDATE', payload: getPublicState() });
  saveState();
  res.json(state.agents[id]);
});

app.delete('/api/agents/:id', (req, res) => {
  const id = req.params.id;
  const key = findAgentKey(id);
  if (!key) return res.status(404).json({ error: 'Agent not found' });
  delete state.agents[key];
  broadcast({ type: 'STATE_UPDATE', payload: getPublicState() });
  saveState();
  res.json({ ok: true });
});

app.post('/api/agents/:id/enrollment', (req, res) => {
  const key = findAgentKey(req.params.id);
  if (!key) return res.status(404).json({ error: 'Agent not found' });
  state.agents[key].enrollmentsToday = (state.agents[key].enrollmentsToday || 0) + 1;
  state.stats.applicationsToday++;
  broadcast({ type: 'STATE_UPDATE', payload: getPublicState() });
  saveState();
  res.json({ ok: true });
});

app.post('/api/reset-daily', (req, res) => {
  Object.values(state.agents).forEach(a => { a.callsToday = 0; a.enrollmentsToday = 0; });
  Object.values(state.queues).forEach(q => { q.callsHandled = 0; q.waiting = 0; });
  state.stats.callsToday = 0;
  state.stats.applicationsToday = 0;
  broadcast({ type: 'STATE_UPDATE', payload: getPublicState() });
  saveState();
  res.json({ ok: true });
});

app.get('/health', (req, res) => res.json({ ok: true, agents: Object.keys(state.agents).length }));

// ─── Zoom Presence Polling ────────────────────────────────────────────────────

const ZOOM_ACCOUNT_ID    = process.env.ZOOM_ACCOUNT_ID;
const ZOOM_CLIENT_ID     = process.env.ZOOM_CLIENT_ID;
const ZOOM_CLIENT_SECRET = process.env.ZOOM_CLIENT_SECRET;

let zoomAccessToken = null;
let zoomTokenExpiry = 0;

async function getZoomToken() {
  if (zoomAccessToken && Date.now() < zoomTokenExpiry - 60000) return zoomAccessToken;
  try {
    const creds = Buffer.from(ZOOM_CLIENT_ID + ":" + ZOOM_CLIENT_SECRET).toString("base64");
    const res = await fetch(
      "https://zoom.us/oauth/token?grant_type=account_credentials&account_id=" + ZOOM_ACCOUNT_ID,
      { method: "POST", headers: { Authorization: "Basic " + creds } }
    );
    const data = await res.json();
    if (data.access_token) {
      zoomAccessToken = data.access_token;
      zoomTokenExpiry = Date.now() + (data.expires_in * 1000);
      console.log("[Zoom] Token refreshed, expires in", data.expires_in, "s");
      return zoomAccessToken;
    }
    console.error("[Zoom] Token error:", data);
    return null;
  } catch (e) {
    console.error("[Zoom] Token fetch failed:", e.message);
    return null;
  }
}

async function pollPresence() {
  if (!ZOOM_ACCOUNT_ID || !ZOOM_CLIENT_ID || !ZOOM_CLIENT_SECRET) return;
  const token = await getZoomToken();
  if (!token) return;

  const presenceMap = {
    "Available":         "available",
    "Away":              "away",
    "Do_Not_Disturb":    "dnd",
    "In_A_Zoom_Meeting": "meeting",
    "On_Phone_Call":     "on_call",
    "Offline":           "offline",
    "Busy":              "dnd",
  };

  const agentIds = Object.keys(state.agents);
  for (const key of agentIds) {
    const agent = state.agents[key];
    if (agent.status === "on_call" || agent.status === "ringing") continue;
    try {
      const res = await fetch("https://api.zoom.us/v2/users/" + key + "/presence_status", {
        headers: { Authorization: "Bearer " + token }
      });
      if (!res.ok) continue;
      const data = await res.json();
      const mapped = presenceMap[data.presence_status] || "offline";
      if (state.agents[key].status !== mapped) {
        console.log("[Presence]", agent.name + ":", state.agents[key].status, "->", mapped);
        state.agents[key].status = mapped;
      }
    } catch (e) {}
    await new Promise(r => setTimeout(r, 250));
  }

  saveState();
  broadcast();
}

setTimeout(pollPresence, 5000);
setInterval(pollPresence, 60 * 1000);
console.log("[Presence] Polling enabled — every 60s");

// ─── Keep-alive (prevents Render free tier sleep) ─────────────────────────────

const SELF_URL = process.env.RENDER_EXTERNAL_URL || 'https://iteach-calldash.onrender.com';
setInterval(() => {
  require('https').get(SELF_URL + '/health', (res) => {
    console.log('Keep-alive ping:', res.statusCode);
  }).on('error', (e) => console.log('Keep-alive failed:', e.message));
}, 10 * 60 * 1000);

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n🚀 iTeach Call Floor Server running on port ${PORT}`);
  console.log(`   Agents loaded: ${Object.keys(state.agents).length}`);
});
