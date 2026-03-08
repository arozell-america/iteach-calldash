import { useState, useEffect, useRef, useCallback } from "react";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:3001";

const STATUS_CONFIG = {
  on_call:   { label: "On Call",   color: "#FF3B5C", bg: "rgba(255,59,92,0.22)",   dot: "#FF3B5C", pulse: true  },
  ringing:   { label: "Ringing",  color: "#FFB800", bg: "rgba(255,184,0,0.22)",   dot: "#FFB800", pulse: true  },
  available: { label: "Available",color: "#C1FD34", bg: "rgba(193,253,52,0.10)",  dot: "#C1FD34", pulse: false },
  away:      { label: "Away",     color: "#FF8C00", bg: "rgba(255,140,0,0.12)",   dot: "#FF8C00", pulse: false },
  break:     { label: "Break",    color: "#7B8FA6", bg: "rgba(123,143,166,0.12)", dot: "#7B8FA6", pulse: false },
  dnd:       { label: "DND",      color: "#FF3B5C", bg: "rgba(255,59,92,0.12)",   dot: "#FF3B5C", pulse: false },
  offline:   { label: "Offline",  color: "#4A5568", bg: "rgba(74,85,104,0.10)",   dot: "#4A5568", pulse: false },
};

const TEAM_COLORS = {
  "Admissions":       "#038CF1",
  "Texas Support":    "#00BEA8",
  "National Support": "#C1FD34",
  "Lead Team":        "#038CF1",
  "Educational":      "#00BEA8",
  "Relational":       "#C1FD34",
  "Engagement":       "#6B5CE7",
  "Certification":    "#FF9F0A",
  "Curriculum":       "#FF4466",
};

const FLOOR_LAYOUT = {
  admissions: {
    label: "Admissions", color: "#038CF1",
    rows: [
      ["Rachel Wilson", "Clarissa", "Charlotte"],
      [null, "Tricia", "Serena"],
    ],
  },
  texas: {
    label: "Texas Support", color: "#00BEA8",
    rows: [
      ["Mary", "Monica"],
      ["Brooke", "Emily Swann"],
    ],
  },
  national: {
    label: "National Support", color: "#C1FD34",
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
  if (!secs || secs < 0) return "0:00";
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
      ws.onclose = () => { setConnected(false); reconnectRef.current = setTimeout(connect, 3000); };
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

function useTick() {
  const [t, setT] = useState(0);
  useEffect(() => { const i = setInterval(() => setT(x => x + 1), 1000); return () => clearInterval(i); }, []);
  return t;
}

function findAgentByName(agents, name) {
  if (!name || !agents) return null;
  const needle = name.toLowerCase();
  return Object.values(agents).find(a =>
    (a.name?.toLowerCase().includes(needle) || needle.includes(a.name?.toLowerCase().split(" ")[0]))
  ) || null;
}

function AgentCard({ agent }) {
  const tick = useTick();
  const cfg = STATUS_CONFIG[agent.status] || STATUS_CONFIG.available;
  const elapsed = agent.callStartTime ? fmt((Date.now() - agent.callStartTime) / 1000) : null;
  const teamColor = TEAM_COLORS[agent.team] || "#666";
  const isActive = agent.status === "on_call" || agent.status === "ringing";
  const nameParts = (agent.name || "").trim().split(" ");
  const firstName = nameParts[0] || "";
  const lastName = nameParts.slice(1).join(" ") || "";

  return (
    <div style={{
      padding: "14px 11px 12px", borderRadius: 10,
      background: isActive ? cfg.bg : "rgba(255,255,255,0.07)",
      border: `1px solid ${isActive ? cfg.color + "55" : "rgba(255,255,255,0.12)"}`,
      boxShadow: isActive ? `0 0 16px ${cfg.color}22` : "none",
      display: "flex", flexDirection: "column", gap: 4,
      transition: "all 0.3s ease", position: "relative",
      minHeight: 90,
    }}>
      {/* Status dot */}
      <div style={{ position: "absolute", top: 10, left: 10, width: 7, height: 7, borderRadius: "50%", background: cfg.dot, boxShadow: cfg.pulse ? `0 0 6px ${cfg.dot}` : "none" }} />
      {/* Team top-right */}
      <div style={{ position: "absolute", top: 8, right: 9, fontSize: 9, color: teamColor, fontWeight: 700, letterSpacing: 0.3 }}>{agent.team}</div>
      {/* Name stacked */}
      <div style={{ paddingLeft: 16, paddingTop: 1, paddingRight: 60 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "#fff", lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{firstName}</div>
        {lastName && <div style={{ fontSize: 11, fontWeight: 400, color: "rgba(255,255,255,0.55)", lineHeight: 1.2 }}>{lastName}</div>}
      </div>
      {/* Status + timer */}
      <div style={{ paddingLeft: 16, display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: cfg.color, textTransform: "uppercase", letterSpacing: 0.8 }}>{cfg.label}</span>
        </div>
        {elapsed && <span style={{ fontSize: 13, fontWeight: 700, color: cfg.color, fontFamily: "'DM Mono', monospace" }}>{elapsed}</span>}
      </div>
    </div>
  );
}

function DeskCell({ seatName, agents, teamColor }) {
  const tick = useTick();
  const agent = seatName ? findAgentByName(agents, seatName) : null;
  const status = agent?.status || "offline";
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.offline;
  const elapsed = agent?.callStartTime ? fmt((Date.now() - agent.callStartTime) / 1000) : null;
  const initials = seatName ? seatName.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() : "";

  if (!seatName) return (
    <div style={{ width: 56, height: 56, borderRadius: 7, background: "rgba(255,255,255,0.03)", border: "1px dashed rgba(255,255,255,0.08)" }} />
  );

  return (
    <div style={{
      width: 56, height: 56, borderRadius: 7,
      background: agent ? cfg.bg : "rgba(255,255,255,0.05)",
      border: `2px solid ${agent ? cfg.color : "rgba(255,255,255,0.12)"}`,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: 1, position: "relative", transition: "all 0.3s ease",
      boxShadow: agent && cfg.pulse ? `0 0 10px ${cfg.color}44` : "none",
    }}>
      <div style={{ position: "absolute", top: 4, right: 4, width: 6, height: 6, borderRadius: "50%", background: agent ? cfg.dot : "#2D3748" }} />
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3, borderRadius: "0 0 5px 5px", background: agent ? (TEAM_COLORS[agent.team] || teamColor) : "rgba(255,255,255,0.06)" }} />
      <div style={{ fontSize: 14, fontWeight: 700, color: agent ? cfg.color : "rgba(255,255,255,0.25)", fontFamily: "'DM Mono', monospace" }}>{initials}</div>
      {elapsed
        ? <div style={{ fontSize: 8, color: cfg.color, fontFamily: "'DM Mono', monospace" }}>{elapsed}</div>
        : <div style={{ fontSize: 7, color: agent ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.18)", maxWidth: 50, textAlign: "center", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{seatName.split(" ")[0]}</div>
      }
    </div>
  );
}

function Pod({ pod, agents }) {
  const podAgents = pod.rows.flat().filter(Boolean).map(n => findAgentByName(agents, n)).filter(Boolean);
  const onCall = podAgents.filter(a => a.status === "on_call").length;
  const ringing = podAgents.filter(a => a.status === "ringing").length;
  const available = podAgents.filter(a => a.status === "available").length;

  return (
    <div style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${pod.color}44`, borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 7, height: 7, borderRadius: 2, background: pod.color }} />
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 2, color: pod.color, textTransform: "uppercase" }}>{pod.label}</span>
        </div>
        <div style={{ display: "flex", gap: 7, fontSize: 9 }}>
          {onCall > 0 && <span style={{ color: "#FF3B5C" }}>●{onCall}</span>}
          {ringing > 0 && <span style={{ color: "#FFB800" }}>●{ringing}</span>}
          {available > 0 && <span style={{ color: "#C1FD34" }}>●{available}</span>}
          {onCall === 0 && ringing === 0 && available === 0 && <span style={{ color: "rgba(255,255,255,0.25)" }}>offline</span>}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {pod.rows.map((row, ri) => (
          <div key={ri} style={{ display: "flex", gap: 5 }}>
            {row.map((seat, si) => <DeskCell key={si} seatName={seat} agents={agents} teamColor={pod.color} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCard({ label, value, color, sub }) {
  return (
    <div style={{ flex: 1, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 10, padding: "13px 16px" }}>
      <div style={{ fontSize: 9, letterSpacing: 2, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color, fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function QueueBar({ name, color, agents }) {
  const teamAgents = Object.values(agents).filter(a => !a.autoRegistered && a.team === name);
  const onCall = teamAgents.filter(a => a.status === "on_call").length;
  const total = teamAgents.length || 1;
  const pct = Math.round((onCall / total) * 100);
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 10, color, fontWeight: 600 }}>{name}</span>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontFamily: "'DM Mono', monospace" }}>{onCall}/{teamAgents.length}</span>
      </div>
      <div style={{ height: 5, background: "rgba(255,255,255,0.1)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3, transition: "width 0.5s ease" }} />
      </div>
    </div>
  );
}

export default function App() {
  const { data, connected } = useWebSocket(WS_URL);
  const now = useClock();

  const agents = data?.agents || {};
  const stats = data?.stats || {};

  const manualAgents = Object.values(agents)
    .filter(a => !a.autoRegistered)
    .sort((a, b) => {
      const order = { on_call: 0, ringing: 1, available: 2, away: 3, break: 3, dnd: 3, offline: 4 };
      return (order[a.status] ?? 5) - (order[b.status] ?? 5);
    });

  const onCallCount = manualAgents.filter(a => a.status === "on_call").length;
  const ringingCount = manualAgents.filter(a => a.status === "ringing").length;
  const availableCount = manualAgents.filter(a => a.status === "available").length;

  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
  const dateStr = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800&family=DM+Mono:wght@400;500;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html { min-height: 100%; }
        body {
          font-family: 'Poppins', sans-serif;
          color: #fff;
          min-height: 100vh;
          background: linear-gradient(160deg, #110045 0%, #0D1E6B 45%, #043C96 100%);
          background-attachment: fixed;
        }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
      `}</style>

      <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ background: "linear-gradient(135deg, #043C96 0%, #038CF1 60%, #00BEA8 100%)", borderRadius: 8, padding: "5px 12px", fontWeight: 800, fontSize: 15, letterSpacing: 1 }}>iTeach</div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase" }}>Call Floor Command</div>
              <div style={{ fontSize: 9, letterSpacing: 3, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" }}>Live Operations Dashboard</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
            {[
              { label: "On Call",   val: onCallCount,    color: "#FF3B5C" },
              { label: "Ringing",   val: ringingCount,   color: "#FFB800" },
              { label: "Available", val: availableCount, color: "#C1FD34" },
            ].map(({ label, val, color }) => (
              <div key={label} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>{val}</div>
                <div style={{ fontSize: 8, letterSpacing: 1.5, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" }}>{label}</div>
              </div>
            ))}
            <div style={{ width: 1, height: 30, background: "rgba(255,255,255,0.15)" }} />
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: "#00BEA8", fontFamily: "'DM Mono', monospace" }}>{timeStr}</div>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", letterSpacing: 1 }}>{dateStr}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5, background: connected ? "rgba(193,253,52,0.12)" : "rgba(255,59,92,0.12)", border: `1px solid ${connected ? "#C1FD34" : "#FF3B5C"}55`, borderRadius: 20, padding: "4px 10px" }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: connected ? "#C1FD34" : "#FF3B5C", animation: connected ? "pulse 2s infinite" : "none" }} />
              <span style={{ fontSize: 9, fontWeight: 600, color: connected ? "#C1FD34" : "#FF3B5C", letterSpacing: 1 }}>{connected ? "LIVE" : "CONNECTING"}</span>
            </div>
          </div>
        </div>

        {/* Stats Row */}
        <div style={{ display: "flex", gap: 10 }}>
          <StatCard label="Calls Today" value={stats.callsToday || 0} color="#038CF1" />
          <StatCard label="Great Calls ⭐" value={stats.greatCallsToday || 0} color="#FFD700" sub="Flagged by agents" />
          <StatCard label="On Call Now" value={onCallCount} color="#FF3B5C" sub={`${ringingCount} ringing`} />
          <StatCard label="Available" value={availableCount} color="#C1FD34" sub={`of ${manualAgents.length} agents`} />
        </div>

        {/* Main layout */}
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>

          {/* Left: Agents */}
          <div style={{ flex: 1.7, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: "14px", display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div style={{ fontSize: 10, letterSpacing: 2.5, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" }}>Agent Status</div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontFamily: "'DM Mono', monospace" }}>{manualAgents.length} agents</div>
            </div>
            {manualAgents.length === 0 ? (
              <div style={{ padding: "40px 0", textAlign: "center" }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>👥</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>No agents registered</div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                {manualAgents.map(agent => <AgentCard key={agent.id} agent={agent} />)}
              </div>
            )}
          </div>

          {/* Center: Floor Map */}
          <div style={{ width: 235, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: "14px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 9, letterSpacing: 3, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" }}>Floor Map</div>
            <Pod pod={FLOOR_LAYOUT.admissions} agents={agents} />
            <Pod pod={FLOOR_LAYOUT.texas} agents={agents} />
            <Pod pod={FLOOR_LAYOUT.national} agents={agents} />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, paddingTop: 4 }}>
              {[["on_call","On Call"],["ringing","Ringing"],["available","Available"],["offline","Offline"]].map(([k,l]) => (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: STATUS_CONFIG[k].dot }} />
                  <span style={{ fontSize: 8, color: "rgba(255,255,255,0.35)" }}>{l}</span>
                </div>
              ))}
                {manualAgents.filter(a => (a.greatCallsToday || 0) > 0).length === 0 && (
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", textAlign: "center", padding: "8px 0" }}>No great calls yet today</div>
                )}
            </div>
          </div>

          {/* Right: Queue + Breakdown */}
          <div style={{ width: 210, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: "14px" }}>
              <div style={{ fontSize: 9, letterSpacing: 2.5, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", marginBottom: 14 }}>Queue Pressure</div>
              <QueueBar name="Admissions" color="#038CF1" agents={agents} />
              <QueueBar name="Texas Support" color="#00BEA8" agents={agents} />
              <QueueBar name="National Support" color="#C1FD34" agents={agents} />
            </div>
            <div style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: "14px" }}>
              <div style={{ fontSize: 9, letterSpacing: 2.5, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", marginBottom: 12 }}>Status Breakdown</div>
              {[
                { label: "On Call",   val: onCallCount,   color: "#FF3B5C" },
                { label: "Ringing",   val: ringingCount,  color: "#FFB800" },
                { label: "Available", val: availableCount, color: "#C1FD34" },
                { label: "Away/DND",  val: manualAgents.filter(a => ["away","dnd","break"].includes(a.status)).length, color: "#FF8C00" },
                { label: "Offline",   val: manualAgents.filter(a => a.status === "offline").length, color: "#4A5568" },
              ].map(({ label, val, color }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>{label}</span>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, color, fontFamily: "'DM Mono', monospace" }}>{val}</span>
                </div>
              ))}
            </div>
            {/* Great Call Scoreboard */}
            {(
              <div style={{ background: "rgba(255,215,0,0.08)", border: "1px solid rgba(255,215,0,0.25)", borderRadius: 12, padding: "14px" }}>
                <div style={{ fontSize: 9, letterSpacing: 2.5, color: "#FFD700", textTransform: "uppercase", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
                  <span>⭐</span><span>Great Calls</span>
                </div>
                {manualAgents
                  .filter(a => (a.greatCallsToday || 0) > 0)
                  .sort((a, b) => (b.greatCallsToday || 0) - (a.greatCallsToday || 0))
                  .map(a => {
                    const nameParts = (a.name || "").trim().split(" ");
                    const displayName = nameParts[0] + (nameParts[1] ? " " + nameParts[1][0] + "." : "");
                    return (
                      <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 11 }}>⭐</span>
                          <span style={{ fontSize: 11, color: "#fff", fontWeight: 600 }}>{displayName}</span>
                        </div>
                        <span style={{ fontSize: 14, fontWeight: 700, color: "#FFD700", fontFamily: "'DM Mono', monospace" }}>{a.greatCallsToday}</span>
                      </div>
                    );
                  })
                }
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
