# iTeach Call Floor Command — Deployment & Zoom Setup Guide

---

## Architecture

```
Zoom Phone
    │  webhooks (call events, presence)
    ▼
Render Server (Node.js)          ← server/server.js
    │  WebSocket (wss://)
    ▼
Netlify Dashboard (React)        ← client/
    │
    ▼
Wall Monitor / Supervisor Screen
```

---

## Part 1 — Deploy the Backend to Render

### Step 1 — Push to GitHub

```bash
cd iteach-calldash
git init
git add .
git commit -m "initial commit"
# Create a new repo on github.com, then:
git remote add origin https://github.com/YOUR_ORG/iteach-calldash.git
git push -u origin main
```

### Step 2 — Create Render service

1. Go to [render.com](https://render.com) → **New → Web Service**
2. Connect your GitHub repo
3. Settings:
   - **Root Directory:** `server`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. Under **Environment Variables**, add:
   - `PORT` = `10000`
   - `ZOOM_WEBHOOK_SECRET_TOKEN` = *(leave blank for now — you'll fill this in after Zoom setup)*
5. Click **Deploy**

Your server URL will be something like:
```
https://iteach-calldash-server.onrender.com
```

> ⚠️ Free Render services spin down after 15 min of inactivity and take ~30s to wake.
> For a wall monitor that needs to be always-on, upgrade to the $7/mo Starter plan.

---

## Part 2 — Deploy the Dashboard to Netlify

### Step 1 — Connect repo to Netlify

1. Go to [app.netlify.com](https://app.netlify.com) → **Add new site → Import from Git**
2. Select your GitHub repo
3. Netlify will auto-detect the `netlify.toml` — build settings are already configured

### Step 2 — Set environment variable

In Netlify: **Site Settings → Environment Variables → Add variable**

```
Key:   VITE_WS_URL
Value: wss://iteach-calldash-server.onrender.com
```

(Use `wss://` not `ws://` — secure WebSocket for production)

### Step 3 — Deploy

Trigger a deploy (or just push to `main`). Your dashboard will be live at:
```
https://iteach-calldash.netlify.app
```

---

## Part 3 — Connect Zoom Phone

### First: Check your Zoom admin access

Go to [zoom.us/signin](https://zoom.us/signin) → look at the left sidebar.
If you see **Admin** section, you have admin access.
If not, you'll need to ask your Zoom account owner (usually IT or whoever manages your Zoom licenses).

**What to ask your admin:**
> "I need to create a Webhook-Only app in the Zoom App Marketplace for our call floor dashboard.
> Can you go to marketplace.zoom.us and create one, or give me admin access?"

---

### Zoom Setup (do this with admin access)

#### Step 1 — Create a Webhook-Only App

1. Go to [marketplace.zoom.us](https://marketplace.zoom.us)
2. Click **Develop → Build App** (top right)
3. Choose **Webhook Only** → click **Create**
4. Fill in:
   - App Name: `iTeach Call Floor`
   - Company Name: `iTeach`
   - Developer Email: your email

#### Step 2 — Configure the webhook endpoint

Under **Feature → Event Subscriptions**:

1. Click **Add Event Subscription**
2. **Subscription name:** `Call Floor Dashboard`
3. **Event notification endpoint URL:**
   ```
   https://iteach-calldash-server.onrender.com/webhook/zoom
   ```
4. Click **Add Events** and subscribe to ALL of these:

   | Category | Event |
   |---|---|
   | Phone | `phone_call.callee_ringing` |
   | Phone | `phone_call.callee_answered` |
   | Phone | `phone_call.callee_ended` |
   | Phone | `phone_call.caller_ringing` |
   | Phone | `phone_call.caller_ended` |
   | User Activity | `user.presence_status_updated` |

5. Click **Done → Save**

#### Step 3 — Copy the Secret Token

After saving, Zoom shows a **Secret Token**. Copy it.

Go to your Render dashboard → **Environment Variables** → set:
```
ZOOM_WEBHOOK_SECRET_TOKEN = paste_the_token_here
```

Render will auto-redeploy. The server will now verify all incoming Zoom events.

#### Step 4 — Validate the endpoint

Back in Zoom App Marketplace, click **Validate** next to your endpoint URL.
Zoom sends a challenge request — your server handles it automatically.
You should see ✅ **Validated**.

#### Step 5 — Activate the app

Click **Activate your app**. Zoom will now start sending real call events to your server.

---

## Part 4 — Seed Your Real Agents

The dashboard currently shows mock agents. Replace them with your real team.

You need each person's **Zoom User ID**. Get them via the Zoom API:

```bash
# Get a list of all Zoom Phone users (requires OAuth — ask your admin)
curl "https://api.zoom.us/v2/phone/users" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

Or your Zoom admin can export the user list from **Admin → User Management → Users**.

Then register each agent:

```bash
curl -X POST https://iteach-calldash-server.onrender.com/api/agents \
  -H "Content-Type: application/json" \
  -d '{
    "id": "ZOOM_USER_ID_HERE",
    "name": "Sarah K.",
    "team": "Admissions",
    "extension": "1001"
  }'
```

Repeat for each agent. Teams must exactly match one of: `Admissions`, `Certification`, `Support`
(or add new teams in `App.jsx` → `TEAM_COLORS`).

---

## Part 5 — Wire Enrollment Data (Optional but powerful)

When a student enrolls in Salesforce, call this endpoint to update the leaderboard in real time:

```bash
POST https://iteach-calldash-server.onrender.com/api/agents/ZOOM_USER_ID/enrollment
```

### From a Netlify Function (same pattern as your enrollment dashboard):

```javascript
// netlify/functions/enrollment-hook.js
export async function handler(event) {
  const { agentZoomId } = JSON.parse(event.body);

  await fetch(
    `https://iteach-calldash-server.onrender.com/api/agents/${agentZoomId}/enrollment`,
    { method: 'POST' }
  );

  return { statusCode: 200 };
}
```

### Daily Reset (midnight cron):

Set up a Netlify scheduled function or a cron job to call:
```
POST https://iteach-calldash-server.onrender.com/api/reset-daily
```

---

## Part 6 — Wall Monitor Setup

1. Plug a **mini PC or Raspberry Pi** into the TV via HDMI
2. Open Chrome in kiosk mode (no browser chrome, full screen):

```bash
# Mac
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --kiosk --noerrdialogs --disable-infobars \
  https://iteach-calldash.netlify.app

# Windows
chrome.exe --kiosk --noerrdialogs https://iteach-calldash.netlify.app

# Raspberry Pi
chromium-browser --kiosk --noerrdialogs \
  https://iteach-calldash.netlify.app
```

The dashboard auto-reconnects if the server restarts, so it's self-healing on the wall.

---

## Checklist

### Before Zoom is connected
- [ ] Repo pushed to GitHub
- [ ] Server live on Render (`/health` returns `{"ok":true}`)
- [ ] Dashboard live on Netlify
- [ ] `VITE_WS_URL` set in Netlify env vars

### Zoom connection
- [ ] Confirm who has Zoom admin access
- [ ] Webhook-Only app created in Zoom Marketplace
- [ ] 6 phone/presence events subscribed
- [ ] Endpoint validated ✅
- [ ] `ZOOM_WEBHOOK_SECRET_TOKEN` set in Render

### Go live
- [ ] Real agents seeded via `/api/agents`
- [ ] Test call made — agent flips to 🔴 On Call on dashboard
- [ ] Enrollment hook wired (optional)
- [ ] Wall monitor in kiosk mode

---

## Troubleshooting

**Dashboard shows "Reconnecting"**
→ Check that your Render server is running. Free tier spins down — hit `/health` to wake it.

**Zoom events not arriving**
→ Check Render logs (`render.com → your service → Logs`). Make sure the endpoint is validated in Zoom Marketplace.

**Agent doesn't flip to On Call**
→ The Zoom User ID in your `/api/agents` registration must exactly match the ID Zoom sends in webhook payloads. Double-check with `GET /api/state`.

**Wrong team colors**
→ Team name in `/api/agents` registration must exactly match keys in `TEAM_COLORS` in `App.jsx`.
