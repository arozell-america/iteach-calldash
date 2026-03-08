const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json());

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

function broadcast(message) {
  const data = JSON.stringify(message);
  wss.clients.forEach(client => { if (client.readyState === 1) client.send(data); });
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'STATE_UPDATE', payload: getPublicState() }));
  ws.on('close', () => {});
});

function getPublicState() {
  return { agents: state.agents, queues: state.queues, stats: state.stats, timestamp: Date.now() };
}

function findAgentKey(userId) {
  if (!userId) return null;
  return Object.keys(state.agents).find(k => k.toLowerCase() === userId.toLowerCase()) || null;
}

function verifyZoomWebhook(req) {
  const secret = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;
  if (!secret) return true;
  const message = `v0:${req.headers['x-zm-request-timestamp']}:${JSON.stringify(req.body)}`;
  const hash = crypto.createHmac('sha256', secret).update(message).digest('hex');
  return req.headers['x-zm-signature'] === `v0=${hash}`;
}

app.get('/webhook/zoom', (req, res) => res.json({ status: 'ok' }));

app.post('/webhook/zoom', (req, res) => {
  if (req.body?.event === 'endpoint.url_validation') {
    const hash = crypto.createHmac('sha256', process.env.ZOOM_WEBHOOK_SECRET_TOKEN || '')
      .update(req.body.payload.plainToken).digest('hex');
    return res.json({ plainToken: req.body.payload.plainToken, encryptedToken: hash });
  }
  if (!verifyZoomWebhook(req)) return res.status(401).json({ error: 'Invalid signature' });
  const { event, payload } = req.body;
  console.log('Zoom event:', event, JSON.stringify(payload));
  handleZoomEvent(event, payload);
  res.json({ received: true });
});

function autoRegister(userId, userObj) {
  if (!userId || findAgentKey(userId)) return;
  const email = userObj?.email || '';
  if (!email || !email.toLowerCase().includes('iteach.net')) {
    console.log('Skipping non-iTeach user:', email || userId);
    return;
  }
  const existingByEmail = Object.values(state.agents).find(a => a.email && a.email.toLowerCase() === email.toLowerCase());
  if (existingByEmail) return;
  const name = userObj?.display_name || userObj?.name ||
    [userObj?.first_name, userObj?.last_name].filter(Boolean).join(' ') ||
    userObj?.email?.split('@')[0] || 'Unknown';
  let team = 'Lead Team';
  const hint = (name + ' ' + email).toLowerCase();
  if (hint.includes('cert')) team = 'Certification';
  else if (hint.includes('curr')) team = 'Curriculum';
  state.agents[userId] = {
    id: userId, name, team, extension: '', email,
    status: 'available', callStartTime: null, callerId: null,
    enrollmentsToday: 0, callsToday: 0, autoRegistered: true,
  };
  saveState();
}

function handleZoomEvent(event, payload) {
  if (event === 'phone.callee_ringing' || event === 'phone.ringing') {
    const userId = payload?.callee?.user_id || payload?.object?.callee?.user_id;
    autoRegister(userId, payload?.callee || payload?.object?.callee);
    const key = findAgentKey(userId);
    if (key) { state.agents[key].status = 'ringing'; state.agents[key].callerId = payload?.caller?.phone_number || 'Unknown'; }
  } else if (event === 'phone.callee_answered' || event === 'phone.answered') {
    const userId = payload?.callee?.user_id || payload?.object?.callee?.user_id;
    autoRegister(userId, payload?.callee);
    const key = findAgentKey(userId);
    if (key) { state.agents[key].status = 'on_call'; state.agents[key].callStartTime = Date.now(); state.stats.callsToday++; }
  } else if (event === 'phone.callee_ended' || event === 'phone.ended') {
    const userId = payload?.callee?.user_id || payload?.object?.callee?.user_id;
    const key = findAgentKey(userId);
    if (key) { state.agents[key].status = 'available'; state.agents[key].callStartTime = null; state.agents[key].callerId = null; state.agents[key].callsToday++; }
  } else if (event === 'phone.caller_connected') {
    const userId = payload?.object?.caller?.user_id || payload?.caller?.user_id;
    const key = findAgentKey(userId);
    if (key) { state.agents[key].status = 'on_call'; state.agents[key].callStartTime = Date.now(); state.stats.callsToday++; }
  } else if (event === 'phone.caller_ringing') {
    const userId = payload?.caller?.user_id || payload?.object?.caller?.user_id;
    autoRegister(userId, payload?.caller);
    const key = findAgentKey(userId);
    if (key) { state.agents[key].status = 'ringing'; state.agents[key].callerId = 'Outbound'; }
  } else if (event === 'phone.caller_answered') {
    const userId = payload?.caller?.user_id || payload?.object?.caller?.user_id;
    const key = findAgentKey(userId);
    if (key) { state.agents[key].status = 'on_call'; state.agents[key].callStartTime = Date.now(); state.stats.callsToday++; }
  } else if (event === 'phone.caller_ended') {
    const userId = payload?.caller?.user_id || payload?.object?.caller?.user_id;
    const key = findAgentKey(userId);
    if (key) { state.agents[key].status = 'available'; state.agents[key].callStartTime = null; state.agents[key].callerId = null; state.agents[key].callsToday++; }
  } else if (event === 'user.presence_status_updated') {
    const userId = payload?.id || payload?.object?.id;
    autoRegister(userId, payload?.object || payload);
    const key = findAgentKey(userId);
    const presenceMap = { 'Available':'available','Away':'away','Do_Not_Disturb':'dnd','On_Phone_Call':'on_call','Offline':'offline' };
    if (key) {
      const mapped = presenceMap[payload?.presence_status || payload?.object?.presence_status] || 'available';
      if (state.agents[key].status !== 'on_call') state.agents[key].status = mapped;
    }
  } else {
    console.log('Unhandled event:', event);
  }
  broadcast({ type: 'STATE_UPDATE', payload: getPublicState() });
  saveState();
}

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
  const key = findAgentKey(req.params.id);
  if (!key) return res.status(404).json({ error: 'Agent not found' });
  delete state.agents[key];
  broadcast({ type: 'STATE_UPDATE', payload: getPublicState() });
  saveState();
  res.json({ ok: true });
});

app.post('/api/nuke-agents', (req, res) => {
  state.agents = {};
  try { saveState(); } catch(e) {}
  broadcast({ type: 'STATE_UPDATE', payload: getPublicState() });
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
  Object.values(state.agents).forEach(a => { a.callsToday = 0; a.enrollmentsToday = 0; a.status = 'available'; a.callStartTime = null; });
  Object.values(state.queues).forEach(q => { q.callsHandled = 0; q.waiting = 0; });
  state.stats.callsToday = 0; state.stats.applicationsToday = 0;
  broadcast({ type: 'STATE_UPDATE', payload: getPublicState() });
  saveState();
  res.json({ ok: true });
});

app.get('/health', (req, res) => res.json({ ok: true, agents: Object.keys(state.agents).length }));

setInterval(() => {
  require('https').get('https://iteach-calldash.onrender.com/health', () => {}).on('error', () => {});
}, 10 * 60 * 1000);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`iTeach Call Floor Server on port ${PORT}, agents: ${Object.keys(state.agents).length}`));
