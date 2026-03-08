import { useState, useEffect, useRef, useCallback } from "react";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:3001";

const STATUS_CONFIG = {
  on_call:   { label: "On Call",   color: "#FF3B5C", bg: "rgba(255,59,92,0.18)",   dot: "#FF3B5C", pulse: true  },
  ringing:   { label: "Ringing",  color: "#FFB800", bg: "rgba(255,184,0,0.18)",   dot: "#FFB800", pulse: true  },
  available: { label: "Available",color: "#00E676", bg: "rgba(0,230,118,0.12)",   dot: "#00E676", pulse: false },
  away:      { label: "Away",     color: "#FF8C00", bg: "rgba(255,140,0,0.12)",   dot: "#FF8C00", pulse: false },
  break:     { label: "Break",    color: "#7B8FA6", bg: "rgba(123,143,166,0.12)", dot: "#7B8FA6", pulse: false },
  dnd:       { label: "DND",      color: "#FF3B5C", bg: "rgba(255,59,92,0.12)",   dot: "#FF3B5C", pulse: false },
  offline:   { label: "Offline",  color: "#2A3A4A", bg: "rgba(42,58,74,0.12)",   dot: "#2A3A4A", pulse: false },
};

const TEAM_COLORS = {
  "Admissions":      "#038CF1",
  "Texas Support":   "#00BEA8",
  "National Support":"#C1FD34",
  "Lead Team":       "#038CF1",
  "Educational":     "#00BEA8",
  "Relational":      "#C1FD34",
  "Engagement":      "#6B5CE7",
  "Certification":   "#FF9F0A",
  "Curriculum":      "#FF4466",
};

// Office floor layout — seats mapped to agent names
// name must match agent name in state (case-insensitive partial match)
const FLOOR_LAYOUT = {
  admissions: {
    label: "Admissions",
    color: "#038CF1",
    rows: [
      ["Rachel Wilson", "Clarissa", "Charlotte"],
      [null, "Tricia", "Serena"],
    ],
  },
  texas: {
    label: "Texas Support",
    color: "#00BEA8",
    rows: [
      ["Mary", "Monica"],
      ["Brooke", "Emily Swann"],
    ],
  },
  national: {
    label: "National Support",
    color: "#C1FD34",
    rows: [
      ["Scott", null],
      ["Devon", "Shyla"],
      ["Grizelle", "Joanna"],
      ["Bryanna", "Grant"],
      [null, "Michelle"],
    ],
  },
};

function fmt(secs) {
  if (!secs || secs < 0) return null;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function useWebSocket(url) {
  const [data, setData] = useState(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectRef = useRef(null);

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => { setConnected(true); clearTimeout(reconnectRef.current); };
      ws.onmessage = (e) => {
        try { const msg = JSON.parse(e.data); if (msg.type === "STATE_UPDATE") setData(msg.payload); } catch {}
      };
      ws.onclose = () => {
        setConnected(false);
        reconnectRef.current = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
    } catch { reconnectRef.current = setTimeout(connect, 3000); }
  }, [url]);

  useEffect(() => { connect(); return () => { clearTimeout(reconnectRef.current); wsRef.current?.close(); }; }, [connect]);
  return { data, connected };
}

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return now;
}

// Find agent in state by name (partial, case-insensitive)
function findAgentByName(agents, name) {
  if (!name || !agents) return null;
  const needle = name.toLowerCase();
  return Object.values(agents).find(a =>
    a.name?.toLowerCase().includes(needle) ||
    needle.includes(a.name?.toLowerCase())
  ) || null;
}

// ─── Desk Cell ────────────────────────────────────────────────────────────────
function DeskCell({ seatName, agents, teamColor }) {
  const agent = seatName ? findAgentByName(agents, seatName) : null;
  const [elapsed, setElapsed] = useState(null);

  useEffect(() => {
    if (!agent?.callStartTime) { setElapsed(null); return; }
    const t = setInterval(() => setElapsed(fmt((Date.now() - agent.callStartTime) / 1000)), 1000);
    return () => clearInterval(t);
  }, [agent?.callStartTime]);

  if (!seatName) {
    return (
      <div style={{
        width: 72, height: 72, borderRadius: 8,
        background: "rgba(255,255,255,0.02)",
        border: "1px dashed rgba(255,255,255,0.06)",
      }} />
    );
  }

  const status = agent?.status || "offline";
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.offline;
  const initials = seatName.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div style={{
      width: 72, height: 72, borderRadius: 8,
      background: agent ? cfg.bg : "rgba(255,255,255,0.03)",
      border: `2px solid ${agent ? cfg.color : "rgba(255,255,255,0.08)"}`,
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      gap: 3, cursor: "default", position: "relative",
      transition: "all 0.3s ease",
      boxShadow: agent && cfg.pulse ? `0 0 12px ${cfg.color}55` : "none",
    }}>
      {/* Status dot */}
      <div style={{
        position: "absolute", top: 5, right: 5,
        width: 8, height: 8, borderRadius: "50%",
        background: agent ? cfg.dot : "#2A3A4A",
        boxShadow: cfg.pulse && agent ? `0 0 6px ${cfg.dot}` : "none",
      }} />
      {/* Team color bar */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        height: 3, borderRadius: "0 0 6px 6px",
        background: agent ? (TEAM_COLORS[agent.team] || teamColor) : "rgba(255,255,255,0.05)",
      }} />
      {/* Initials */}
      <div style={{
        fontSize: 18, fontWeight: 700, letterSpacing: 1,
        color: agent ? cfg.color : "rgba(255,255,255,0.2)",
        fontFamily: "'DM Mono', monospace",
      }}>{initials}</div>
      {/* Timer or name hint */}
      {elapsed ? (
        <div style={{ fontSize: 10, color: cfg.color, fontFamily: "'DM Mono', monospace" }}>{elapsed}</div>
      ) : (
        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", maxWidth: 60, textAlign: "center", lineHeight: 1.2, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
          {seatName.split(" ")[0]}
        </div>
      )}
    </div>
  );
}

// ─── Pod ──────────────────────────────────────────────────────────────────────
function Pod({ pod, agents }) {
  const agentsInPod = pod.rows.flat().filter(Boolean).map(name => findAgentByName(agents, name)).filter(Boolean);
  const onCall = agentsInPod.filter(a => a.status === "on_call").length;
  const ringing = agentsInPod.filter(a => a.status === "ringing").length;
  const available = agentsInPod.filter(a => a.status === "available").length;

  return (
    <div style={{
      background: "rgba(255,255,255,0.03)",
      border: `1px solid ${pod.color}33`,
      borderRadius: 12, padding: "14px 16px",
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      {/* Pod header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 10, height: 10, borderRadius: 2, background: pod.color }} />
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: pod.color, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif" }}>
            {pod.label}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
          {onCall > 0 && <span style={{ color: "#FF3B5C" }}>●{onCall} on call</span>}
          {ringing > 0 && <span style={{ color: "#FFB800" }}>●{ringing} ringing</span>}
          {available > 0 && <span style={{ color: "#00E676" }}>●{available} avail</span>}
        </div>
      </div>
      {/* Desk grid */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {pod.rows.map((row, ri) => (
          <div key={ri} style={{ display: "flex", gap: 6 }}>
            {row.map((seat, si) => (
              <DeskCell key={si} seatName={seat} agents={agents} teamColor={pod.color} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, color = "#00C8FF", sub }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.04)", borderRadius: 10,
      border: "1px solid rgba(255,255,255,0.07)", padding: "14px 18px",
      flex: 1, minWidth: 0,
    }}>
      <div style={{ fontSize: 10, letterSpacing: 2, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", marginBottom: 6, fontFamily: "'DM Sans', sans-serif" }}>{label}</div>
      <div style={{ fontSize: 32, fontWeight: 700, color, fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ─── Queue Bar ────────────────────────────────────────────────────────────────
function QueueBar({ name, color, agents }) {
  const teamAgents = Object.values(agents).filter(a => a.team === name || 
    (name === "Admissions" && a.team === "Admissions") ||
    (name === "Texas Support" && a.team === "Texas Support") ||
    (name === "National Support" && a.team === "National Support")
  );
  const onCall = teamAgents.filter(a => a.status === "on_call").length;
  const total = teamAgents.length || 1;
  const pct = Math.round((onCall / total) * 100);

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
        <span style={{ fontSize: 11, color, fontWeight: 600, letterSpacing: 1, fontFamily: "'DM Sans', sans-serif" }}>{name}</span>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: "'DM Mono', monospace" }}>{onCall}/{total} active</span>
      </div>
      <div style={{ height: 6, background: "rgba(255,255,255,0.07)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3, transition: "width 0.5s ease" }} />
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const { data, connected } = useWebSocket(WS_URL);
  const now = useClock();
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick(x => x + 1), 1000); return () => clearInterval(t); }, []);

  const agents = data?.agents || {};
  const stats = data?.stats || {};
  const agentList = Object.values(agents);

  const onCallCount = agentList.filter(a => a.status === "on_call").length;
  const ringingCount = agentList.filter(a => a.status === "ringing").length;
  const availableCount = agentList.filter(a => a.status === "available").length;
  const greatCalls = stats.greatCallsToday || 0;

  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
  const dateStr = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  return (
    <div style={{
      minHeight: "100vh", background: "#0A0E1A",
      fontFamily: "'DM Sans', sans-serif", color: "#fff",
      padding: "16px 20px", boxSizing: "border-box",
      display: "flex", flexDirection: "column", gap: 14,
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&family=DM+Mono:wght@400;500;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0A0E1A; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
      `}</style>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            background: "linear-gradient(135deg, #043C96, #038CF1)",
            borderRadius: 10, padding: "6px 14px",
            fontWeight: 800, fontSize: 16, letterSpacing: 1,
          }}>iTeach</div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase" }}>Call Floor Command</div>
            <div style={{ fontSize: 10, letterSpacing: 3, color: "rgba(255,255,255,0.35)", textTransform: "uppercase" }}>Live Operations Dashboard</div>
          </div>
        </div>

        {/* Status pills */}
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          {[
            { label: "On Call", val: onCallCount, color: "#FF3B5C" },
            { label: "Ringing", val: ringingCount, color: "#FFB800" },
            { label: "Available", val: availableCount, color: "#00E676" },
          ].map(({ label, val, color }) => (
            <div key={label} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 24, fontWeight: 700, color, fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>{val}</div>
              <div style={{ fontSize: 9, letterSpacing: 1.5, color: "rgba(255,255,255,0.35)", textTransform: "uppercase" }}>{label}</div>
            </div>
          ))}
          <div style={{ width: 1, height: 36, background: "rgba(255,255,255,0.1)" }} />
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#00C8FF", fontFamily: "'DM Mono', monospace" }}>{timeStr}</div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", letterSpacing: 1 }}>{dateStr}</div>
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            background: connected ? "rgba(0,230,118,0.1)" : "rgba(255,59,92,0.1)",
            border: `1px solid ${connected ? "#00E676" : "#FF3B5C"}44`,
            borderRadius: 20, padding: "4px 10px",
          }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: connected ? "#00E676" : "#FF3B5C", animation: connected ? "pulse 2s infinite" : "none" }} />
            <span style={{ fontSize: 10, fontWeight: 600, color: connected ? "#00E676" : "#FF3B5C", letterSpacing: 1 }}>{connected ? "LIVE" : "CONNECTING"}</span>
          </div>
        </div>
      </div>

      {/* ── Stats row ── */}
      <div style={{ display: "flex", gap: 12 }}>
        <StatCard label="Calls Today" value={stats.callsToday || 0} color="#00C8FF" />
        <StatCard label="Great Calls ⭐" value={greatCalls} color="#FFD700" sub="Flagged by agents" />
        <StatCard label="Agents Active" value={onCallCount + ringingCount} color="#FF3B5C" sub={`of ${agentList.length} on floor`} />
        <StatCard label="Available Now" value={availableCount} color="#00E676" />
      </div>

      {/* ── Main content: Floor Map + Queue Sidebar ── */}
      <div style={{ display: "flex", gap: 16, flex: 1, minHeight: 0 }}>

        {/* Floor Map — CENTER */}
        <div style={{
          flex: 1, background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 14, padding: 20,
          display: "flex", flexDirection: "column", gap: 12,
        }}>
          <div style={{ fontSize: 10, letterSpacing: 3, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", marginBottom: 4 }}>Office Floor Map</div>

          {/* Layout: left pod + right side (top pod + national pod) */}
          <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flex: 1 }}>

            {/* LEFT: Texas Support */}
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", paddingTop: 60 }}>
              <Pod pod={FLOOR_LAYOUT.texas} agents={agents} />
            </div>

            {/* RIGHT COLUMN: Admissions on top, National below */}
            <div style={{ display: "flex", flexDirection: "column", gap: 20, flex: 1 }}>
              {/* Admissions — top right */}
              <div style={{ alignSelf: "flex-end" }}>
                <Pod pod={FLOOR_LAYOUT.admissions} agents={agents} />
              </div>
              {/* National — below admissions, aligned right */}
              <div style={{ alignSelf: "flex-end" }}>
                <Pod pod={FLOOR_LAYOUT.national} agents={agents} />
              </div>
            </div>
          </div>

          {/* Legend */}
          <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
            {Object.entries(STATUS_CONFIG).filter(([k]) => ["on_call","ringing","available","away","offline"].includes(k)).map(([k, v]) => (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: v.dot }} />
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", letterSpacing: 0.5 }}>{v.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT SIDEBAR: Queue Pressure + Agent List */}
        <div style={{ width: 240, display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Queue Pressure */}
          <div style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: 12, padding: "16px 18px",
          }}>
            <div style={{ fontSize: 10, letterSpacing: 2.5, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", marginBottom: 14 }}>Queue Pressure</div>
            <QueueBar name="Admissions" color="#038CF1" agents={agents} />
            <QueueBar name="Texas Support" color="#00BEA8" agents={agents} />
            <QueueBar name="National Support" color="#C1FD34" agents={agents} />
          </div>

          {/* Agent list */}
          <div style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: 12, padding: "16px 18px", flex: 1, overflow: "hidden",
          }}>
            <div style={{ fontSize: 10, letterSpacing: 2.5, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", marginBottom: 12 }}>Agents On Call</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", maxHeight: 320 }}>
              {agentList.filter(a => a.status === "on_call" || a.status === "ringing").length === 0 ? (
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", textAlign: "center", padding: "20px 0" }}>No active calls</div>
              ) : agentList.filter(a => a.status === "on_call" || a.status === "ringing").map(agent => {
                const cfg = STATUS_CONFIG[agent.status];
                const elapsed = agent.callStartTime ? fmt((Date.now() - agent.callStartTime) / 1000) : null;
                return (
                  <div key={agent.id} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 10px", borderRadius: 8,
                    background: cfg.bg, border: `1px solid ${cfg.color}33`,
                  }}>
                    <div style={{ width: 7, height: 7, borderRadius: "50%", background: cfg.dot, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{agent.name}</div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{TEAM_COLORS[agent.team] ? agent.team : "—"}</div>
                    </div>
                    {elapsed && <div style={{ fontSize: 11, color: cfg.color, fontFamily: "'DM Mono', monospace", flexShrink: 0 }}>{elapsed}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
