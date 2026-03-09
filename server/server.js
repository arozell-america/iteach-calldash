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
const { DynamoDBClient, PutItemCommand, DeleteItemCommand, ScanCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const dynamo = new DynamoDBClient({
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  }
});
const AGENTS_TABLE = 'calldash-agents';

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
      if (saved.stats) Object.assign(state.stats, saved.stats);
    }
  } catch(e) { console.error('Load state error:', e.message); }
}

async function loadAgentsFromDynamo() {
  try {
    const result = await dynamo.send(new ScanCommand({ TableName: AGENTS_TABLE }));
    const items = (result.Items || []).map(i => unmarshall(i));
    for (const agent of items) {
      state.agents[agent.id] = {
        ...agent,
        status: 'offline',
        callsToday: 0,
        enrollmentsToday: 0,
        greatCallsToday: 0,
      };
    }
    console.log('[DynamoDB] Loaded', items.length, 'agents');
  } catch(e) {
    console.error('[DynamoDB] Load agents error:', e.message);
  }
}

loadState();
loadAgentsFromDynamo();

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
  broadcast({ type: 'STATE_UPDATE', payload: getPublicState() });
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
    status: 'available', callStartTime: null, callerId: null, callDirection: null,
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
      state.agents[key].callDirection = 'inbound';
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
      state.agents[key].callDirection = null;
      state.agents[key].callsToday = (state.agents[key].callsToday || 0) + 1;
      state.stats.callsToday++;
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
      state.agents[key].callDirection = 'outbound';
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
      state.agents[key].callDirection = null;
      state.agents[key].callsToday = (state.agents[key].callsToday || 0) + 1;
      state.stats.callsToday++;
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
      'Mobile_signed_in': 'away', 'Busy': 'dnd',
      'In_A_Calendar_Event': 'away', 'Presenting': 'dnd',
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

app.get('/api/debug-sf', async (req, res) => {
  try {
    if (!sfAccessToken) await getSfAccessToken();
    const query = `SELECT Id, Great_Call__c, LastModifiedBy.Name FROM Contact WHERE Great_Call__c = TODAY LIMIT 10`;
    const url = `${process.env.SF_INSTANCE_URL}/services/data/v59.0/query?q=${encodeURIComponent(query)}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${sfAccessToken}` } });
    const data = await r.json();
    res.json(data);
  } catch(e) {
    res.json({ error: e.message });
  }
});

app.post('/api/agents', async (req, res) => {
  const { id, name, team, extension, email } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id and name required' });
  const agent = { id, name, team: team || '', extension: extension || '', email: email || '', status: 'available', callsToday: 0, enrollmentsToday: 0, greatCallsToday: 0 };
  state.agents[id] = agent;
  try {
    await dynamo.send(new PutItemCommand({ TableName: AGENTS_TABLE, Item: marshall({ id, name, team: team || '', extension: extension || '', email: email || '' }) }));
    console.log('[DynamoDB] Saved agent:', name);
  } catch(e) { console.error('[DynamoDB] Save agent error:', e.message); }
  broadcast({ type: 'STATE_UPDATE', payload: getPublicState() });
  saveState();
  res.json(state.agents[id]);
});

app.delete('/api/agents/:id', async (req, res) => {
  const id = req.params.id;
  const key = findAgentKey(id);
  if (!key) return res.status(404).json({ error: 'Agent not found' });
  const agentId = state.agents[key].id;
  delete state.agents[key];
  try {
    await dynamo.send(new DeleteItemCommand({ TableName: AGENTS_TABLE, Key: marshall({ id: agentId }) }));
    console.log('[DynamoDB] Deleted agent:', agentId);
  } catch(e) { console.error('[DynamoDB] Delete agent error:', e.message); }
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
    "Available":           "available",
    "Away":                "away",
    "Do_Not_Disturb":      "dnd",
    "In_A_Zoom_Meeting":   "meeting",
    "On_Phone_Call":       "on_call",
    "Offline":             "offline",
    "Busy":                "dnd",
    "Mobile_signed_in":    "away",
    "In_A_Calendar_Event": "away",
    "Presenting":          "dnd",
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
  broadcast({ type: 'STATE_UPDATE', payload: getPublicState() });
}

setTimeout(pollPresence, 5000);
setInterval(pollPresence, 60 * 1000);
console.log("[Presence] Polling enabled — every 60s");

// ─── Salesforce Great Call Polling ────────────────────────────────────────────

let sfAccessToken = null;

async function getSfAccessToken() {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: process.env.SF_CLIENT_ID,
    client_secret: process.env.SF_CLIENT_SECRET,
    refresh_token: process.env.SF_REFRESH_TOKEN,
  });
  const res = await fetch(`${process.env.SF_INSTANCE_URL}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('SF auth failed: ' + JSON.stringify(data));
  sfAccessToken = data.access_token;
  return sfAccessToken;
}

async function pollGreatCalls() {
  try {
    if (!process.env.SF_CLIENT_ID || !process.env.SF_REFRESH_TOKEN) return;
    if (!sfAccessToken) await getSfAccessToken();

    const query = `SELECT LastModifiedBy.Name, COUNT(Id) total FROM Contact WHERE Great_Call__c = TODAY GROUP BY LastModifiedBy.Name`;
    const url = `${process.env.SF_INSTANCE_URL}/services/data/v59.0/query?q=${encodeURIComponent(query)}`;

    let res = await fetch(url, { headers: { Authorization: `Bearer ${sfAccessToken}` } });

    // Token expired — refresh and retry once
    if (res.status === 401) {
      await getSfAccessToken();
      res = await fetch(url, { headers: { Authorization: `Bearer ${sfAccessToken}` } });
    }

    const data = await res.json();
    if (!data.records) { console.log('[SF] No records:', JSON.stringify(data)); return; }

    // Build a map: agentName -> count
    const greatCallMap = {};
    for (const row of data.records) {
      greatCallMap[row.LastModifiedBy.Name.toLowerCase()] = row.total;
    }

    // Update each agent's greatCallsToday
    // Match SF name (e.g. "Andrew Rozell") against agent name which may be "Andrew Rozell" or "andrew.rozell"
    let totalGreatCalls = 0;
    for (const key of Object.keys(state.agents)) {
      const agent = state.agents[key];
      const agentName = agent.name?.toLowerCase() || '';
      // Try exact match first, then try matching by first+last name parts
      let count = greatCallMap[agentName] || 0;
      if (!count) {
        for (const [sfName, sfCount] of Object.entries(greatCallMap)) {
          const sfParts = sfName.split(' ');
          const sfFirst = sfParts[0];
          const sfLast = sfParts[sfParts.length - 1];
          if (agentName.includes(sfFirst) && agentName.includes(sfLast)) {
            count = sfCount;
            break;
          }
          // Also match agent name against SF name parts (e.g. "andrew.rozell" vs "Andrew Rozell")
          const agentClean = agentName.replace(/[._]/g, ' ');
          if (agentClean === sfName) { count = sfCount; break; }
        }
      }
      state.agents[key].greatCallsToday = count;
      totalGreatCalls += count;
    }
    state.stats.greatCallsToday = totalGreatCalls;

    saveState();
    broadcast({ type: 'STATE_UPDATE', payload: getPublicState() });
    console.log(`[SF] Great calls today: ${totalGreatCalls}`);
  } catch (e) {
    console.log('[SF] Poll error:', e.message);
    sfAccessToken = null; // force re-auth next time
  }
}

setTimeout(pollGreatCalls, 10000);
setInterval(pollGreatCalls, 60 * 1000);
console.log('[SF] Great call polling enabled — every 60s');

// ─── Daily Midnight Reset ────────────────────────────────────────────────────

function scheduleMidnightReset() {
  const now = new Date();
  // Calculate ms until next midnight CT (UTC-6 standard, UTC-5 daylight)
  const ct = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const nextMidnight = new Date(ct);
  nextMidnight.setHours(24, 0, 0, 0);
  const msUntilMidnight = nextMidnight - ct;

  console.log(`[Reset] Next daily reset in ${Math.round(msUntilMidnight / 60000)} minutes`);

  setTimeout(() => {
    console.log('[Reset] Running daily reset...');
    Object.values(state.agents).forEach(a => {
      a.callsToday = 0;
      a.enrollmentsToday = 0;
      a.greatCallsToday = 0;
    });
    state.stats.callsToday = 0;
    state.stats.greatCallsToday = 0;
    saveState();
    broadcast({ type: 'STATE_UPDATE', payload: getPublicState() });
    console.log('[Reset] Daily reset complete');
    scheduleMidnightReset(); // schedule next one
  }, msUntilMidnight);
}

scheduleMidnightReset();

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
