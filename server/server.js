/**
 * Zoom Phone Call Floor Dashboard - Backend Server
 * 
 * Receives Zoom webhooks → broadcasts to dashboard via WebSocket
 * Also exposes REST endpoints to seed/query state
 * 
 * Run: node server.js
 * Env vars: ZOOM_WEBHOOK_SECRET_TOKEN, PORT (default 3001)
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const STATE_FILE = path.join(__dirname, 'state.json');
const http = require('http');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());

// ─── In-memory State ──────────────────────────────────────────────────────────

const state = {
  agents: {},        // userId → AgentRecord
  queues: {},        // queueId → QueueRecord
  callLog: [],       // last 500 call events
  stats: {
    callsToday: 0,
    applicationsToday: 0,   // wire to your Salesforce/DB
    avgSpeedToCall: null,
  },
};

// Seed mock agents so the dashboard works immediately before Zoom is wired
function seedMockData() {
  const mockAgents = [
    { id: 'u1', name: 'Sarah K.',    team: 'Admissions',    extension: '1001' },
    { id: 'u2', name: 'Mike T.',     team: 'Admissions',    extension: '1002' },
    { id: 'u3', name: 'Carlos R.',   team: 'Admissions',    extension: '1003' },
    { id: 'u4', name: 'Amanda L.',   team: 'Admissions',    extension: '1004' },
    { id: 'u5', name: 'Chris B.',    team: 'Admissions',    extension: '1005' },
    { id: 'u6', name: 'Emily D.',    team: 'Admissions',    extension: '1006' },
    { id: 'u7', name: 'James W.',    team: 'Certification', extension: '2001' },
    { id: 'u8', name: 'Priya N.',    team: 'Certification', extension: '2002' },
    { id: 'u9', name: 'Derek F.',    team: 'Certification', extension: '2003' },
    { id: 'u10', name: 'Layla M.',   team: 'Support',       extension: '3001' },
    { id: 'u11', name: 'Kevin S.',   team: 'Support',       extension: '3002' },
    { id: 'u12', name: 'Nina P.',    team: 'Support',       extension: '3003' },
  ];

  const statuses = ['available', 'on_call', 'on_call', 'ringing', 'available', 'on_call',
                    'available', 'on_call', 'break', 'available', 'on_call', 'ringing'];
  const enrollments = [6, 5, 4, 3, 3, 2, 4, 2, 1, 3, 2, 1];

  mockAgents.forEach((a, i) => {
    state.agents[a.id] = {
      ...a,
      status: statuses[i],
      callStartTime: statuses[i] === 'on_call' ? Date.now() - Math.random() * 600000 : null,
      callerId: statuses[i] === 'on_call' ? '+1-555-' + Math.floor(1000 + Math.random() * 9000) : null,
      enrollmentsToday: enrollments[i],
      callsToday: enrollments[i] + Math.floor(Math.random() * 8),
    };
  });

  state.queues = {
    'q1': { id: 'q1', name: 'Admissions',    waiting: 3, avgWait: 142, callsHandled: 47 },
    'q2': { id: 'q2', name: 'Certification', waiting: 1, avgWait: 65,  callsHandled: 22 },
    'q3': { id: 'q3', name: 'Support',        waiting: 0, avgWait: 30,  callsHandled: 11 },
  };

  state.stats.callsToday = 124;
  state.stats.applicationsToday = 36;
  state.stats.avgSpeedToCall = 192; // seconds
}

// seedMockData(); // disabled - agents auto-register from Zoom webhooks

// ─── Simulate live updates (remove once Zoom webhooks are connected) ──────────
// DISABLED - Zoom webhooks handle real status
// let simulationInterval = setInterval(() => {
//   const ids = Object.keys(state.agents);
//   // Randomly flip 1–2 agents' statuses
//   const count = Math.floor(Math.random() * 2) + 1;
//   for (let i = 0; i < count; i++) {
//     const id = ids[Math.floor(Math.random() * ids.length)];
//     const agent = state.agents[id];
//     const transitions = {
//       available: 'on_call',
//       on_call:   'available',
//       ringing:   'on_call',
//       break:     'available',
//     };
//     if (!agent) return;
//   const newStatus = transitions[agent.status] || 'available';
//     state.agents[id] = {
//       ...agent,
//       status: newStatus,
//       callStartTime: newStatus === 'on_call' ? Date.now() : null,
//       callerId: newStatus === 'on_call' ? '+1-555-' + Math.floor(1000 + Math.random() * 9000) : null,
//     };
//     if (newStatus === 'on_call') state.stats.callsToday++;
//   }
// 
//   // Fluctuate queue waiting
//   Object.values(state.queues).forEach(q => {
//     q.waiting = Math.max(0, q.waiting + Math.floor(Math.random() * 3) - 1);
//     q.avgWait = Math.max(10, q.avgWait + Math.floor(Math.random() * 20) - 10);
//   });
// 
//   broadcast({ type: 'STATE_UPDATE', payload: getPublicState() });
  saveState();
// }, 3000);

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
  return {
    agents: state.agents,
    queues: state.queues,
    stats: state.stats,
    timestamp: Date.now(),
  };
}

// ─── Zoom Webhook Handler ─────────────────────────────────────────────────────

/**
 * Verify Zoom webhook signature
 * https://developers.zoom.us/docs/api/rest/webhook-reference/#verify-webhook-events
 */
function verifyZoomWebhook(req) {
  const secret = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;
  if (!secret) return true; // Skip verification in dev

  const message = `v0:${req.headers['x-zm-request-timestamp']}:${JSON.stringify(req.body)}`;
  const hash = crypto.createHmac('sha256', secret).update(message).digest('hex');
  const expected = `v0=${hash}`;
  return req.headers['x-zm-signature'] === expected;
}

app.get('/webhook/zoom', (req, res) => {
  res.json({ status: 'ok', message: 'iTeach Call Floor webhook endpoint' });
});


// Case-insensitive agent lookup (Zoom sends IDs in lowercase)
function findAgent(userId) {
  if (!userId) return null;
  const key = Object.keys(state.agents).find(k => k.toLowerCase() === userId.toLowerCase());
  return key ? state.agents[key] : null;
}
function findAgentKey(userId) {
  if (!userId) return null;
  return Object.keys(state.agents).find(k => k.toLowerCase() === userId.toLowerCase()) || null;
}

app.post('/webhook/zoom', (req, res) => {
  // Zoom endpoint validation handshake
  console.log('Zoom event name:', req.body?.event);
  if (req.body?.event === 'endpoint.url_validation') {
    const hash = crypto
      .createHmac('sha256', process.env.ZOOM_WEBHOOK_SECRET_TOKEN || '')
      .update(req.body.payload.plainToken)
      .digest('hex');
    return res.json({ plainToken: req.body.payload.plainToken, encryptedToken: hash });
  }

  if (!verifyZoomWebhook(req)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const { event, payload } = req.body;
  console.log(`Zoom event: ${event}`, JSON.stringify(payload, null, 2));

  handleZoomEvent(event, payload);
  res.json({ received: true });
});

function handleZoomEvent(event, payload) {
  switch (event) {

    case 'phone_call.started': {
      const userId = payload?.operator?.id || payload?.callee?.user_id;
      const __key = findAgentKey(userId);
      if (userId && __key) {
        state.agents[__key].status = 'on_call';
        state.agents[__key].callStartTime = Date.now();
        state.agents[__key].callerId = payload?.caller?.phone_number || 'Unknown';
        state.agents[__key].currentCallId = payload?.call_id;
        state.stats.callsToday++;
      }
      break;
    }

    case 'phone_call.ringing': {
      const userId = payload?.callee?.user_id;
      const __key = findAgentKey(userId);
      if (userId && __key) {
        state.agents[__key].status = 'ringing';
        state.agents[__key].callerId = payload?.caller?.phone_number || 'Unknown';
      }
      break;
    }

    case 'phone_call.answered': {
      const userId = payload?.callee?.user_id;
      const __key = findAgentKey(userId);
      if (userId && __key) {
        state.agents[__key].status = 'on_call';
        state.agents[__key].callStartTime = Date.now();
      }
      break;
    }

    case 'phone_call.ended': {
      const userId = payload?.operator?.id || payload?.callee?.user_id;
      const __key = findAgentKey(userId);
      if (userId && __key) {
        state.agents[__key].status = 'available';
        state.agents[__key].callStartTime = null;
        state.agents[__key].callerId = null;
        state.agents[__key].currentCallId = null;
        state.agents[__key].callsToday = (state.agents[__key].callsToday || 0) + 1;
      }
      break;
    }

    case 'user.presence_status_updated': {
      const userId = payload?.user_id;
      const presenceMap = {
        'Available':     'available',
        'Away':          'away',
        'Do_Not_Disturb': 'dnd',
        'In_A_Zoom_Meeting': 'meeting',
        'On_Phone_Call': 'on_call',
      };
      const __key = findAgentKey(userId);
      if (userId && __key) {
        const mapped = presenceMap[payload?.presence_status] || 'available';
        // Don't override on_call set by phone events
        if (state.agents[__key].status !== 'on_call') {
          state.agents[__key].status = mapped;
        }
      }
      break;
    }

    default:
      console.log('Unhandled Zoom event:', event);
  }

  broadcast({ type: 'STATE_UPDATE', payload: getPublicState() });
  saveState();

  // Log event
  state.callLog.unshift({ event, payload, timestamp: Date.now() });
  if (state.callLog.length > 500) state.callLog.pop();
}

// ─── REST API ─────────────────────────────────────────────────────────────────

// Get full state (for initial dashboard load or polling fallback)
app.get('/api/state', (req, res) => res.json(getPublicState()));

// Register a new agent (call from your onboarding flow)
app.post('/api/agents', (req, res) => {
  const { id, name, team, extension } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id and name required' });
  state.agents[id] = { id, name, team, extension, status: 'available', callsToday: 0, enrollmentsToday: 0 };
  broadcast({ type: 'STATE_UPDATE', payload: getPublicState() });
  saveState();
  res.json(state.agents[id]);
});

// Remove agent
app.delete("/api/agents/:id", (req, res) => {
  const id = req.params.id;
  if (!state.agents[id]) return res.status(404).json({ error: "Agent not found" });
  delete state.agents[id];
  broadcast({ type: "STATE_UPDATE", payload: getPublicState() });
  res.json({ ok: true });
});

// Remove agent
app.delete('/api/agents/:id', (req, res) => {
  const id = req.params.id;
  if (!state.agents[id]) return res.status(404).json({ error: 'Agent not found' });
  delete state.agents[id];
  broadcast({ type: 'STATE_UPDATE', payload: getPublicState() });
  saveState();
  res.json({ ok: true });
});

// Update enrollment count (call from your Salesforce webhook)
app.post('/api/agents/:id/enrollment', (req, res) => {
  const agent = state.agents[req.params.id];
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  agent.enrollmentsToday = (agent.enrollmentsToday || 0) + 1;
  state.stats.applicationsToday++;
  broadcast({ type: 'STATE_UPDATE', payload: getPublicState() });
  saveState();
  res.json({ ok: true });
});

// Daily reset (cron at midnight)
app.post('/api/reset-daily', (req, res) => {
  Object.values(state.agents).forEach(a => {
    a.callsToday = 0;
    a.enrollmentsToday = 0;
  });
  Object.values(state.queues).forEach(q => {
    q.callsHandled = 0;
    q.waiting = 0;
  });
  state.stats.callsToday = 0;
  state.stats.applicationsToday = 0;
  broadcast({ type: 'STATE_UPDATE', payload: getPublicState() });
  saveState();
  res.json({ ok: true });
});

// Health check
app.get('/health', (req, res) => res.json({ ok: true, agents: Object.keys(state.agents).length }));

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;

// Keep-alive: ping self every 10 minutes to prevent Render free tier sleep
const SELF_URL = process.env.RENDER_EXTERNAL_URL || 'https://iteach-calldash.onrender.com';
setInterval(() => {
  require('https').get(SELF_URL + '/health', (res) => {
    console.log('Keep-alive ping:', res.statusCode);
  }).on('error', (e) => {
    console.log('Keep-alive failed:', e.message);
  });
}, 10 * 60 * 1000);

server.listen(PORT, () => {
  console.log(`\n🚀 Zoom Dashboard Server running on port ${PORT}`);
  console.log(`   WebSocket:  ws://localhost:${PORT}`);
  console.log(`   Webhook:    POST http://localhost:${PORT}/webhook/zoom`);
  console.log(`   State API:  GET  http://localhost:${PORT}/api/state\n`);
  console.log('   ⚡ Simulation mode active (replace with real Zoom webhooks)\n');
});
