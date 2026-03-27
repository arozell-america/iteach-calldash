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
  res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
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
  hourlyVolume: new Array(24).fill(0),
  callDurations: [],
  longestCallAgent: null,
  zoomQueues: {
    totalWaiting: 0, avgWaitTime: 0, avgSpeedToAnswer: 0, abandonmentRate: 0,
    serviceLevel: 0, maxWaitTime: 0, longestCurrentWait: 0,
    totalAnswered: 0, totalAbandoned: 0, totalOverflowed: 0, totalVoicemail: 0,
    callQuality: { mos: 0, jitter: 0, latency: 0, packetLoss: 0 },
    queues: [],
  },
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
        longestCallToday: 0,
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

function getCurrentHourCT() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })).getHours();
}

function recordCallEnd(agentKey) {
  const agent = state.agents[agentKey];
  if (!agent) return;
  agent.callsToday = (agent.callsToday || 0) + 1;
  state.stats.callsToday++;
  state.hourlyVolume[getCurrentHourCT()]++;
  if (agent.callStartTime) {
    const duration = Math.round((Date.now() - agent.callStartTime) / 1000);
    if (duration > 0 && duration < 7200) {
      state.callDurations.push(duration);
      if (duration > (agent.longestCallToday || 0)) {
        agent.longestCallToday = duration;
      }
      if (!state.longestCallAgent || duration > state.longestCallAgent.duration) {
        state.longestCallAgent = { name: agent.name, duration };
      }
    }
  }
  agent.status = 'available';
  agent.callStartTime = null;
  agent.callerId = null;
  agent.callDirection = null;
}

function getPublicState() {
  const durations = state.callDurations;
  const avgHandleTime = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
  const longestCall = durations.length > 0 ? Math.max(...durations) : 0;
  return {
    agents: state.agents, queues: state.queues,
    stats: { ...state.stats, avgHandleTime, longestCall, longestCallAgent: state.longestCallAgent?.name || null, totalCallsHandled: durations.length },
    hourlyVolume: state.hourlyVolume,
    zoomQueues: state.zoomQueues,
    timestamp: Date.now(),
  };
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
    enrollmentsToday: 0, callsToday: 0, longestCallToday: 0, autoRegistered: true,
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
      console.log('[caller_ended] SET available:', state.agents[key].name);
      recordCallEnd(key);
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
      console.log('[caller_ended] SET available:', state.agents[key].name);
      recordCallEnd(key);
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
      'On_Phone_Call': 'on_call', 'In_A_Call': 'on_call', 'Offline': 'offline',
      'Mobile_signed_in': 'away', 'Busy': 'dnd',
      'In_A_Calendar_Event': 'away', 'In_A_Meeting': 'meeting', 'Presenting': 'dnd',
    };
    if (key) {
      const mapped = presenceMap[payload?.presence_status || payload?.object?.presence_status] || 'available';
      // Don't let presence override an active call (ringing or on_call)
      const isActive = ['on_call', 'ringing'].includes(state.agents[key].status);
      if (!isActive || mapped === 'on_call') {
        const prev = state.agents[key].status;
        console.log('[Presence webhook]', state.agents[key].name + ':', prev, '->', mapped);
        state.agents[key].status = mapped;
        // Set callStartTime when transitioning into on_call via presence
        if (mapped === 'on_call' && prev !== 'on_call') {
          state.agents[key].callStartTime = state.agents[key].callStartTime || Date.now();
          state.agents[key].callDirection = state.agents[key].callDirection || 'inbound';
        }
        // Call ended via presence transition
        if (mapped !== 'on_call' && prev === 'on_call') {
          recordCallEnd(key);
          state.agents[key].status = mapped; // recordCallEnd sets available, override with actual presence
        }
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

app.get('/api/debug-queues', async (req, res) => {
  try {
    const token = await getZoomToken();
    if (!token) return res.json({ error: 'No Zoom token' });
    // Fetch all pages of call queues
    let allQueues = [];
    let nextPageToken = '';
    do {
      const url = 'https://api.zoom.us/v2/phone/call_queues?page_size=100' + (nextPageToken ? `&next_page_token=${nextPageToken}` : '');
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
      const data = await r.json();
      allQueues = allQueues.concat(data.call_queues || []);
      nextPageToken = data.next_page_token || '';
    } while (nextPageToken);
    // For each active queue, fetch detailed metrics
    const active = allQueues.filter(q => q.status === 'active');
    const details = [];
    for (const q of active) {
      try {
        const r2 = await fetch(`https://api.zoom.us/v2/phone/call_queues/${q.id}`, { headers: { Authorization: 'Bearer ' + token } });
        const d = await r2.json();
        details.push({ name: q.name, id: q.id, detail: d });
      } catch(e) { details.push({ name: q.name, id: q.id, error: e.message }); }
    }
    res.json({ total: allQueues.length, active: active.length, activeQueues: active, details });
  } catch(e) { res.json({ error: e.message }); }
});

app.get('/api/debug-powerpack', async (req, res) => {
  try {
    const token = await getZoomToken();
    if (!token) return res.json({ error: 'No Zoom token' });
    const today = new Date().toISOString().slice(0, 10);
    const auth = { headers: { Authorization: 'Bearer ' + token } };

    // Try multiple possible endpoint paths
    const endpoints = [
      { name: 'metrics/call_queues', url: `https://api.zoom.us/v2/phone/metrics/call_queues?from=${today}&to=${today}` },
      { name: 'call_queues/metrics', url: `https://api.zoom.us/v2/phone/call_queues/metrics?from=${today}&to=${today}` },
      { name: 'dashboard/phone', url: `https://api.zoom.us/v2/phone/dashboard?from=${today}&to=${today}` },
      { name: 'phone/reports/call_queues', url: `https://api.zoom.us/v2/phone/reports/call_queues?from=${today}&to=${today}` },
      { name: 'phone_reports/call_queues', url: `https://api.zoom.us/v2/phone_reports/call_queues?from=${today}&to=${today}` },
      { name: 'phone/call_history (last 50)', url: `https://api.zoom.us/v2/phone/call_history?from=${today}&to=${today}&page_size=5&type=all` },
      { name: 'phone/metrics/quality', url: `https://api.zoom.us/v2/phone/metrics/quality?from=${today}&to=${today}` },
      { name: 'phone/qualitylogs', url: `https://api.zoom.us/v2/phone/quality?from=${today}&to=${today}` },
    ];

    const results = {};
    for (const ep of endpoints) {
      try {
        const r = await fetch(ep.url, auth);
        const body = await r.text();
        let json; try { json = JSON.parse(body); } catch { json = body; }
        results[ep.name] = { status: r.status, data: json };
      } catch (e) {
        results[ep.name] = { error: e.message };
      }
    }

    // Also try getting scopes from token info
    let scopes = null;
    try {
      const tr = await fetch('https://api.zoom.us/v2/users/me/token', auth);
      if (tr.ok) scopes = await tr.json();
    } catch {}

    res.json({ tokenOk: !!token, scopes, endpoints: results, currentZoomQueues: state.zoomQueues });
  } catch(e) { res.json({ error: e.message }); }
});

app.get('/api/debug-sf', async (req, res) => {
  try {
    if (!sfAccessToken) await getSfAccessToken();
    const auth = { headers: { Authorization: `Bearer ${sfAccessToken}` } };
    const baseUrl = process.env.SF_INSTANCE_URL + '/services/data/v59.0';
    const results = {};

    // 1. Find fields related to admissions/enrollment on Contact
    try {
      const q1 = `SELECT Id, Name, Applied_Date__c, Enrolled_Date__c, Admission_Status__c, Great_Call__c, CreatedDate FROM Contact WHERE Applied_Date__c != null ORDER BY CreatedDate DESC LIMIT 5`;
      const r1 = await fetch(`${baseUrl}/query?q=${encodeURIComponent(q1)}`, auth);
      results.contact_sample = await r1.json();
    } catch(e) { results.contact_sample = { error: e.message }; }

    // 2. Check field names - try common variations
    try {
      const q2 = `SELECT Id, Name, Applied_Date__c, Enrolled_Date__c, Admission_Status__c FROM Contact WHERE Admission_Status__c != null ORDER BY CreatedDate DESC LIMIT 5`;
      const r2 = await fetch(`${baseUrl}/query?q=${encodeURIComponent(q2)}`, auth);
      results.admission_status_sample = await r2.json();
    } catch(e) { results.admission_status_sample = { error: e.message }; }

    // 3. Check for enrollment opportunity
    try {
      const q3 = `SELECT Id, Name FROM Enrollment_Opportunity__c LIMIT 1`;
      const r3 = await fetch(`${baseUrl}/query?q=${encodeURIComponent(q3)}`, auth);
      results.enrollment_opp = await r3.json();
    } catch(e) { results.enrollment_opp = { error: e.message }; }

    // 4. Check for iteach application
    try {
      const q4 = `SELECT Id, Name FROM iteach_Application__c LIMIT 1`;
      const r4 = await fetch(`${baseUrl}/query?q=${encodeURIComponent(q4)}`, auth);
      results.iteach_app = await r4.json();
    } catch(e) { results.iteach_app = { error: e.message }; }

    // 5. Today's pipeline stats
    try {
      const q5 = `SELECT Admission_Status__c, COUNT(Id) total FROM Contact WHERE Applied_Date__c = TODAY GROUP BY Admission_Status__c`;
      const r5 = await fetch(`${baseUrl}/query?q=${encodeURIComponent(q5)}`, auth);
      results.today_status_breakdown = await r5.json();
    } catch(e) { results.today_status_breakdown = { error: e.message }; }

    // 6. Enrolled today
    try {
      const q6 = `SELECT COUNT(Id) total FROM Contact WHERE Enrolled_Date__c = TODAY`;
      const r6 = await fetch(`${baseUrl}/query?q=${encodeURIComponent(q6)}`, auth);
      results.enrolled_today = await r6.json();
    } catch(e) { results.enrolled_today = { error: e.message }; }

    // 7. Applied today
    try {
      const q7 = `SELECT COUNT(Id) total FROM Contact WHERE Applied_Date__c = TODAY`;
      const r7 = await fetch(`${baseUrl}/query?q=${encodeURIComponent(q7)}`, auth);
      results.applied_today = await r7.json();
    } catch(e) { results.applied_today = { error: e.message }; }

    // 8. Avg time applied to enrolled (last 30 days)
    try {
      const q8 = `SELECT Applied_Date__c, Enrolled_Date__c FROM Contact WHERE Enrolled_Date__c = LAST_N_DAYS:30 AND Applied_Date__c != null LIMIT 20`;
      const r8 = await fetch(`${baseUrl}/query?q=${encodeURIComponent(q8)}`, auth);
      results.recent_enrollments = await r8.json();
    } catch(e) { results.recent_enrollments = { error: e.message }; }

    // 9. List all Admission_Status__c values
    try {
      const q9 = `SELECT Admission_Status__c, COUNT(Id) total FROM Contact WHERE Applied_Date__c = LAST_N_DAYS:90 GROUP BY Admission_Status__c ORDER BY COUNT(Id) DESC`;
      const r9 = await fetch(`${baseUrl}/query?q=${encodeURIComponent(q9)}`, auth);
      results.all_statuses = await r9.json();
    } catch(e) { results.all_statuses = { error: e.message }; }

    res.json(results);
  } catch(e) {
    res.json({ error: e.message });
  }
});

app.post('/api/agents', async (req, res) => {
  const { id, name, team, extension, email } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id and name required' });
  const agent = { id, name, team: team || '', extension: extension || '', email: email || '', status: 'available', callsToday: 0, enrollmentsToday: 0, greatCallsToday: 0, longestCallToday: 0 };
  state.agents[id] = agent;
  try {
    await dynamo.send(new PutItemCommand({ TableName: AGENTS_TABLE, Item: marshall({ id, name, team: team || '', extension: extension || '', email: email || '' }) }));
    console.log('[DynamoDB] Saved agent:', name);
  } catch(e) { console.error('[DynamoDB] Save agent error:', e.message); }
  broadcast({ type: 'STATE_UPDATE', payload: getPublicState() });
  saveState();
  res.json(state.agents[id]);
});

app.patch('/api/agents/:id', async (req, res) => {
  const key = findAgentKey(req.params.id);
  if (!key) return res.status(404).json({ error: 'Agent not found' });
  const { name, team, extension, email } = req.body;
  const agent = state.agents[key];
  if (name !== undefined) agent.name = name;
  if (team !== undefined) agent.team = team;
  if (extension !== undefined) agent.extension = extension;
  if (email !== undefined) agent.email = email;
  try {
    await dynamo.send(new PutItemCommand({ TableName: AGENTS_TABLE, Item: marshall({ id: agent.id, name: agent.name, team: agent.team || '', extension: agent.extension || '', email: agent.email || '' }) }));
    console.log('[DynamoDB] Updated agent:', agent.name);
  } catch(e) { console.error('[DynamoDB] Update agent error:', e.message); }
  broadcast({ type: 'STATE_UPDATE', payload: getPublicState() });
  saveState();
  res.json(agent);
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
  Object.values(state.agents).forEach(a => { a.callsToday = 0; a.enrollmentsToday = 0; a.longestCallToday = 0; });
  Object.values(state.queues).forEach(q => { q.callsHandled = 0; q.waiting = 0; });
  state.stats.callsToday = 0;
  state.stats.applicationsToday = 0;
  state.hourlyVolume = new Array(24).fill(0);
  state.callDurations = [];
  state.longestCallAgent = null;
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
  if (!ZOOM_ACCOUNT_ID || !ZOOM_CLIENT_ID || !ZOOM_CLIENT_SECRET) {
    console.log('[Presence] Skipping — missing Zoom OAuth credentials');
    return;
  }
  const token = await getZoomToken();
  if (!token) {
    console.log('[Presence] Skipping — failed to get Zoom token');
    return;
  }

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
    "In_A_Meeting":        "meeting",
    "In_A_Call":           "on_call",
    "Presenting":          "dnd",
  };

  const agentIds = Object.keys(state.agents);
  let updated = 0, errors = 0;
  for (const key of agentIds) {
    const agent = state.agents[key];
    try {
      const res = await fetch("https://api.zoom.us/v2/users/" + key + "/presence_status", {
        headers: { Authorization: "Bearer " + token }
      });
      if (!res.ok) { errors++; continue; }
      const data = await res.json();
      const rawStatus = data.presence_status || data.status || data.presence;
      if (!rawStatus) continue;
      const mapped = presenceMap[rawStatus] || "offline";
      if (!presenceMap[rawStatus]) {
        console.log(`[Presence] Unmapped status for ${agent.name}: "${rawStatus}"`);
      }
      if (state.agents[key].status !== mapped) {
        const prev = state.agents[key].status;
        state.agents[key].status = mapped;
        updated++;
        // Transitioning INTO on_call
        if (mapped === 'on_call' && prev !== 'on_call') {
          state.agents[key].callStartTime = state.agents[key].callStartTime || Date.now();
          state.agents[key].callDirection = state.agents[key].callDirection || 'inbound';
        }
        // Transitioning OUT OF on_call — call ended
        if (mapped !== 'on_call' && prev === 'on_call') {
          recordCallEnd(key);
          state.agents[key].status = mapped; // override with actual presence
        }
      }
    } catch (e) { errors++; }
    await new Promise(r => setTimeout(r, 250));
  }
  console.log(`[Presence] Poll complete: ${agentIds.length} agents, ${updated} updated, ${errors} errors`);

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

// ─── Zoom Call Queue Polling ─────────────────────────────────────────────────

// Full queue poll — runs every 60s, fetches queue list + Power Pack analytics
async function pollCallQueues() {
  if (!ZOOM_ACCOUNT_ID || !ZOOM_CLIENT_ID || !ZOOM_CLIENT_SECRET) return;
  const token = await getZoomToken();
  if (!token) return;

  try {
    // 1. Fetch all queue pages
    let allQueues = [];
    let nextPageToken = '';
    do {
      const url = 'https://api.zoom.us/v2/phone/call_queues?page_size=100' + (nextPageToken ? `&next_page_token=${nextPageToken}` : '');
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
      if (!r.ok) { console.log('[Queues] API error:', r.status); return; }
      const data = await r.json();
      allQueues = allQueues.concat(data.call_queues || []);
      nextPageToken = data.next_page_token || '';
    } while (nextPageToken);

    const active = allQueues.filter(q => q.status === 'active');
    const totalWaiting = active.reduce((sum, q) => sum + (q.overflowed_calls || 0), 0);

    // 2. Compute queue metrics from call history
    let avgWaitTime = 0, avgSpeedToAnswer = 0, abandonmentRate = 0, serviceLevel = 0;
    let maxWaitTime = 0, totalAnswered = 0, totalAbandoned = 0, totalOverflowed = 0, totalVoicemail = 0;
    let queueDetails = [];
    let callQuality = { mos: 0, jitter: 0, latency: 0, packetLoss: 0 };
    try {
      const today = new Date().toISOString().slice(0, 10);
      // Fetch all call history pages for today
      let allCalls = [];
      let nextPage = '';
      do {
        const histUrl = `https://api.zoom.us/v2/phone/call_history?from=${today}&to=${today}&page_size=100&type=all` + (nextPage ? `&next_page_token=${nextPage}` : '');
        const hr = await fetch(histUrl, { headers: { Authorization: 'Bearer ' + token } });
        if (!hr.ok) { console.log('[CallHistory] API error:', hr.status); break; }
        const hd = await hr.json();
        allCalls = allCalls.concat(hd.call_logs || hd.call_history || []);
        nextPage = hd.next_page_token || '';
      } while (nextPage);

      if (allCalls.length > 0) {
        // Filter to inbound external calls (most relevant for queue metrics)
        const inbound = allCalls.filter(c => c.direction === 'inbound' && c.connect_type === 'external');
        const queueCalls = inbound.filter(c => c.callee_ext_type === 'call_queue');

        // Compute wait times (answer_time - start_time)
        const SLA_THRESHOLD = 20; // seconds
        const waitTimes = [];
        const answerTimes = [];
        let answered = 0, abandoned = 0, slMet = 0;

        for (const call of inbound) {
          const start = new Date(call.start_time).getTime();
          const answer = call.answer_time ? new Date(call.answer_time).getTime() : null;
          const end = new Date(call.end_time).getTime();
          const waitSecs = answer ? (answer - start) / 1000 : (end - start) / 1000;

          if (waitSecs >= 0 && waitSecs < 3600) waitTimes.push(waitSecs);

          if (call.call_result === 'answered' || call.call_result === 'connected') {
            answered++;
            if (answer) {
              const asa = (answer - start) / 1000;
              if (asa >= 0 && asa < 3600) answerTimes.push(asa);
              if (asa <= SLA_THRESHOLD) slMet++;
            }
          } else if (call.call_result === 'abandoned' || call.call_result === 'missed') {
            abandoned++;
          }
        }

        totalAnswered = answered;
        totalAbandoned = abandoned;
        const totalInbound = inbound.length;
        avgWaitTime = waitTimes.length > 0 ? Math.round(waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length) : 0;
        avgSpeedToAnswer = answerTimes.length > 0 ? Math.round(answerTimes.reduce((a, b) => a + b, 0) / answerTimes.length) : 0;
        maxWaitTime = waitTimes.length > 0 ? Math.round(Math.max(...waitTimes)) : 0;
        abandonmentRate = totalInbound > 0 ? Math.round((abandoned / totalInbound) * 100) : 0;
        serviceLevel = totalInbound > 0 ? Math.round((slMet / totalInbound) * 100) : 0;

        // Per-queue breakdown
        const queueMap = {};
        for (const call of queueCalls) {
          const qName = call.callee_name || 'Unknown';
          if (!queueMap[qName]) queueMap[qName] = { name: qName, totalCalls: 0, answered: 0, abandoned: 0, waitTimes: [], answerTimes: [], slMet: 0 };
          const q = queueMap[qName];
          q.totalCalls++;
          const start = new Date(call.start_time).getTime();
          const answer = call.answer_time ? new Date(call.answer_time).getTime() : null;
          const end = new Date(call.end_time).getTime();
          const waitSecs = answer ? (answer - start) / 1000 : (end - start) / 1000;
          if (waitSecs >= 0 && waitSecs < 3600) q.waitTimes.push(waitSecs);
          if (call.call_result === 'answered' || call.call_result === 'connected') {
            q.answered++;
            if (answer) {
              const asa = (answer - start) / 1000;
              if (asa >= 0 && asa < 3600) q.answerTimes.push(asa);
              if (asa <= SLA_THRESHOLD) q.slMet++;
            }
          } else if (call.call_result === 'abandoned' || call.call_result === 'missed') {
            q.abandoned++;
          }
        }

        queueDetails = Object.values(queueMap).map(q => ({
          id: q.name, name: q.name,
          totalCalls: q.totalCalls, answered: q.answered, abandoned: q.abandoned,
          avgWait: q.waitTimes.length > 0 ? Math.round(q.waitTimes.reduce((a, b) => a + b, 0) / q.waitTimes.length) : 0,
          avgAnswer: q.answerTimes.length > 0 ? Math.round(q.answerTimes.reduce((a, b) => a + b, 0) / q.answerTimes.length) : 0,
          sl: q.totalCalls > 0 ? Math.round((q.slMet / q.totalCalls) * 100) : 0,
        })).sort((a, b) => b.totalCalls - a.totalCalls);

        console.log(`[CallHistory] ${allCalls.length} calls today, ${inbound.length} inbound, ${queueCalls.length} queue calls — ASA=${avgSpeedToAnswer}s, abandon=${abandonmentRate}%, SL=${serviceLevel}%`);
      }
    } catch (me) {
      console.log('[CallHistory] metrics error:', me.message);
    }

    // Merge waiting counts from queue list into queue details
    const mergedQueues = queueDetails.length > 0 ? queueDetails.map(q => {
      const liveQ = active.find(a => a.name === q.name || q.name?.includes(a.name));
      return { ...q, waiting: liveQ ? (liveQ.overflowed_calls || 0) : 0 };
    }) : active.map(q => ({
      id: q.id, name: q.name, waiting: q.overflowed_calls || 0,
      totalCalls: 0, answered: 0, abandoned: 0, avgWait: 0, avgAnswer: 0, sl: 0,
    }));

    state.zoomQueues = {
      totalWaiting, avgWaitTime, avgSpeedToAnswer, abandonmentRate,
      serviceLevel, maxWaitTime, longestCurrentWait: 0,
      totalAnswered, totalAbandoned, totalOverflowed, totalVoicemail,
      callQuality,
      queues: mergedQueues,
    };

    broadcast({ type: 'STATE_UPDATE', payload: getPublicState() });
    console.log(`[Queues] Poll complete: ${active.length} active queues, ${totalWaiting} waiting`);
  } catch (e) {
    console.log('[Queues] Poll error:', e.message);
  }
}

// Live queue snapshot — runs every 15s for real-time waiting data
async function pollLiveQueues() {
  if (!ZOOM_ACCOUNT_ID || !ZOOM_CLIENT_ID || !ZOOM_CLIENT_SECRET) return;
  const token = await getZoomToken();
  if (!token) return;

  try {
    const url = 'https://api.zoom.us/v2/phone/call_queues?page_size=100';
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) return;
    const data = await r.json();
    const active = (data.call_queues || []).filter(q => q.status === 'active');
    const totalWaiting = active.reduce((sum, q) => sum + (q.overflowed_calls || 0), 0);

    state.zoomQueues.totalWaiting = totalWaiting;

    // Update per-queue waiting counts
    for (const aq of active) {
      const existing = state.zoomQueues.queues.find(q => q.id === aq.id || q.id === aq.call_queue_id);
      if (existing) existing.waiting = aq.overflowed_calls || 0;
    }

    broadcast({ type: 'STATE_UPDATE', payload: getPublicState() });
  } catch (e) {
    console.log('[LiveQueues] error:', e.message);
  }
}

setTimeout(pollCallQueues, 15000);
setInterval(pollCallQueues, 60 * 1000);
setInterval(pollLiveQueues, 15 * 1000);
console.log('[Queues] Full poll every 60s, live poll every 15s');

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
      a.longestCallToday = 0;
    });
    state.stats.callsToday = 0;
    state.stats.greatCallsToday = 0;
    state.hourlyVolume = new Array(24).fill(0);
    state.callDurations = [];
  state.longestCallAgent = null;
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
