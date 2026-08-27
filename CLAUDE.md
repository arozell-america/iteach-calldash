# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Real-time call floor monitoring dashboard for iTeach's support center. Shows live agent status, call timers, call direction, floor map, and great call scoreboard.

## Development Commands

### Client (React + Vite)
```bash
cd client && npm install    # install deps
cd client && npm run dev    # local dev server (port 5173, hot reload)
cd client && npm run build  # production build -> client/dist/
```

### Server (Node.js + Express + WebSocket)
```bash
cd server && npm install    # install deps
cd server && npm run dev    # local dev with nodemon (auto-restart, port 3001)
cd server && npm start      # production start
```

### Local dev workflow
Run both server and client simultaneously. Vite proxies `/api` requests to `http://localhost:3001`, so the client talks to the local server automatically. The client connects to WebSocket via `VITE_WS_URL` env var (defaults to `ws://localhost:3001`).

No test suite or linter is configured.

## Environment Variables

The server requires these env vars (set in `server/.env` locally, in Render dashboard for production):

| Variable | Purpose |
|----------|---------|
| `PORT` | Server port (default 3001, Render uses 10000) |
| `ZOOM_WEBHOOK_SECRET_TOKEN` | Verifies incoming Zoom webhook signatures |
| `ZOOM_ACCOUNT_ID` | Zoom Server-to-Server OAuth — for presence polling |
| `ZOOM_CLIENT_ID` | Zoom Server-to-Server OAuth |
| `ZOOM_CLIENT_SECRET` | Zoom Server-to-Server OAuth |
| `SF_INSTANCE_URL` | Salesforce instance URL (e.g. `https://yourorg.my.salesforce.com`) |
| `SF_CLIENT_ID` | Salesforce Connected App client ID |
| `SF_CLIENT_SECRET` | Salesforce Connected App client secret |
| `SF_REFRESH_TOKEN` | Salesforce OAuth refresh token |
| `AWS_ACCESS_KEY_ID` | DynamoDB access for agent persistence |
| `AWS_SECRET_ACCESS_KEY` | DynamoDB secret key |

Client env var (set in Netlify):
- `VITE_WS_URL` — WebSocket URL (e.g. `wss://iteach-calldash.onrender.com`)

## Architecture

```
Zoom Phone Webhooks   --> Node.js Server (Render) --> WebSocket --> React Dashboard (Netlify)
Zoom Presence Poll (60s)      --> agent status correction
Zoom Call Queue Poll (60s/15s)--> queue depth + wait times
Salesforce Great Calls (60s)  --> great call counts per agent
Salesforce Pipeline (5min)    --> applied/enrolled today, conversion, days-to-enroll
Calls-before-enrollment (24h) --> matches Zoom call history to SF enrolled contacts
DynamoDB (us-east-1, calldash-agents table) --> Persistent manual agent roster
```

**Two-file codebase:** Nearly all logic lives in two files:
- `client/src/App.jsx` — entire frontend: all React components (KpiTile, QueueHealthBanner, AgentCard, StatusChips, LiveTab, HourlyChart, InsightsPanel, AgentPerfRow, PerformanceTab), WebSocket connection, state management, light/dark theming, styling (inline CSS-in-JS)
- `server/server.js` — entire backend: Express routes, Zoom webhook handler, Zoom presence/call-queue polling, Salesforce great-call and pipeline polling, DynamoDB persistence, WebSocket broadcast, midnight reset, keep-alive ping

`client/src/Admin.jsx` holds the agent registration/admin UI.

## Key Concepts

**Agent registration:** Agents are either manually registered (persisted to DynamoDB, shown in UI) or auto-registered from Zoom webhooks (in-memory only, filtered OUT of UI via `autoRegistered: true`). Auto-registration only accepts `@iteach.net` email addresses.

**Status source of truth:** Zoom phone webhooks are unreliable. The 60-second presence poll is the primary mechanism for correcting agent statuses. When status comes from presence (not webhook), `callDirection` defaults to `"inbound"` since the API doesn't distinguish. Presence will not override an active `on_call` or `ringing` status unless the new status is also `on_call`.

**Daily counters:** `callsToday`, `enrollmentsToday`, `greatCallsToday` are in-memory only — they reset on server redeploy and at midnight CT (scheduled via `setTimeout` chain, not cron).

**State persistence:** `server/state.json` persists agent data and stats to disk via `saveState()`. This survives server restarts but not Render redeploys (ephemeral filesystem). DynamoDB is the durable store for the agent roster; daily counters are not persisted to DynamoDB.

**Team filtering:** `TEAM_LEADS` in App.jsx defines filter groups. Team names in agent registration must exactly match keys in `TEAM_COLORS`.

**UI structure:** Two tabs — `LiveTab` (KPI tiles, `QueueHealthBanner`, `StatusChips`, agent card grid) and `PerformanceTab` (`HourlyChart`, `InsightsPanel`, `AgentPerfRow` table). Header carries a light/dark theme toggle (`theme` state) and the tab bar carries a Compact/Expanded toggle that controls agent card density.

**Queue health banner:** `QueueHealthBanner` derives a green/amber/red level from queue depth and wait time — green renders "OPERATING NORMALLY" alongside the live clock.

**WebSocket protocol:** Server broadcasts `{ type: "STATE_UPDATE", payload: { agents, queues, stats, hourlyVolume, zoomQueues, sfPipeline, timestamp } }` (see `getPublicState()` in server.js) to all connected clients on every state change. Clients auto-reconnect on disconnect (3s delay).

**Keep-alive:** Server pings its own `/health` endpoint every 10 minutes to prevent Render free tier from sleeping.

## Polling Timelines

| What | Interval | Initial Delay |
|------|----------|---------------|
| Zoom presence poll | 60s | 5s after boot |
| Salesforce great calls poll | 60s | 10s after boot |
| Zoom call queue full poll | 60s | 15s after boot |
| Zoom live queue poll | 15s | — |
| Salesforce pipeline poll | 5min | 20s after boot |
| Calls-before-enrollment compute | 24h | with first pipeline poll |
| Keep-alive self-ping | 10min | immediate |
| Zoom token refresh | on-demand (cached until ~1min before expiry) | — |

## Deployment

Both auto-deploy from `main` branch on push to GitHub:
- **Frontend:** Netlify. Config in `netlify.toml` (base: `client/`, Node 20). SPA redirect configured.
- **Backend:** Render (free tier, spins down after 15min idle). Config in `render.yaml` (root: `server/`, region: Oregon).

## Live URLs
- Dashboard: https://iteachsupportcenter.netlify.app/
- Server: https://iteach-calldash.onrender.com
- GitHub: https://github.com/arozell-america/iteach-calldash

## Server API

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/state` | Full state snapshot |
| POST | `/api/agents` | Register agent (persists to DynamoDB) |
| DELETE | `/api/agents/:id` | Remove agent |
| POST | `/api/agents/:id/enrollment` | Increment enrollment count |
| POST | `/api/reset-daily` | Reset all daily counters |
| GET | `/api/debug-sf` | Debug Salesforce queries and field shapes |
| GET | `/api/debug-queues` | Debug Zoom call queue responses |
| GET | `/api/debug-powerpack` | Debug Zoom Power Pack API responses |
| POST | `/webhook/zoom` | Zoom webhook receiver (also handles URL validation challenge) |
| GET | `/health` | Health check (returns agent count) |

Agent lookup is case-insensitive (Zoom sometimes sends lowercase IDs).

## Brand

- Background: `linear-gradient(160deg, #110045 0%, #0D1E6B 45%, #043C96 100%)`
- Accent gradient: `#043C96 -> #038CF1 -> #00BEA8 -> #C1FD34`
- Fonts: Poppins (UI), DM Mono (timers/numbers)
