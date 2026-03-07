import { useState, useEffect, useRef, useCallback } from "react";

// ─── Constants & Config ───────────────────────────────────────────────────────

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:3001";

const STATUS_CONFIG = {
  on_call:   { label: "On Call",   color: "#FF3B5C", bg: "rgba(255,59,92,0.15)",   dot: "#FF3B5C", pulse: true  },
  ringing:   { label: "Ringing",  color: "#FFB800", bg: "rgba(255,184,0,0.15)",   dot: "#FFB800", pulse: true  },
  available: { label: "Available",color: "#00E676", bg: "rgba(0,230,118,0.12)",   dot: "#00E676", pulse: false },
  away:      { label: "Away",     color: "#FF8C00", bg: "rgba(255,140,0,0.12)",   dot: "#FF8C00", pulse: false },
  break:     { label: "Break",    color: "#7B8FA6", bg: "rgba(123,143,166,0.12)", dot: "#7B8FA6", pulse: false },
  dnd:       { label: "DND",      color: "#FF3B5C", bg: "rgba(255,59,92,0.12)",   dot: "#FF3B5C", pulse: false },
  meeting:   { label: "Meeting",  color: "#A855F7", bg: "rgba(168,85,247,0.12)",  dot: "#A855F7", pulse: false },
  offline:   { label: "Offline",  color: "#3D4B5C", bg: "rgba(61,75,92,0.12)",   dot: "#3D4B5C", pulse: false },
};

const TEAM_COLORS = {
  Admissions:    "#00C8FF",
  Certification: "#FF6B35",
  Support:       "#00E676",
};

function fmt(secs) {
  if (!secs || secs < 0) return null;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fmtDuration(ms) {
  if (!ms) return null;
  return fmt((Date.now() - ms) / 1000);
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useWebSocket(url) {
  const [data, setData] = useState(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectRef = useRef(null);

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        if (reconnectRef.current) clearTimeout(reconnectRef.current);
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "STATE_UPDATE") setData(msg.payload);
        } catch {}
      };
      ws.onclose = () => {
        setConnected(false);
        reconnectRef.current = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
    } catch {}
  }, [url]);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
    };
  }, [connect]);

  return { data, connected };
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function PulsingDot({ color, active }) {
  return (
    <span style={{ position: "relative", display: "inline-block", width: 10, height: 10, flexShrink: 0 }}>
      <span style={{
        position: "absolute", inset: 0, borderRadius: "50%",
        background: color, opacity: active ? 0.4 : 0,
        animation: active ? "ping 1.5s ease-in-out infinite" : "none",
      }} />
      <span style={{
        position: "absolute", inset: 1, borderRadius: "50%",
        background: color, boxShadow: `0 0 6px ${color}`,
      }} />
    </span>
  );
}

function CallTimer({ startTime }) {
  const [elapsed, setElapsed] = useState(() => startTime ? (Date.now() - startTime) / 1000 : 0);

  useEffect(() => {
    if (!startTime) return;
    setElapsed((Date.now() - startTime) / 1000);
    const interval = setInterval(() => setElapsed((Date.now() - startTime) / 1000), 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  if (!startTime) return null;
  return <span style={{ fontVariantNumeric: "tabular-nums", color: "#FF8C00", fontWeight: 700, fontSize: "0.85em" }}>{fmt(elapsed)}</span>;
}

function AgentCard({ agent }) {
  const cfg = STATUS_CONFIG[agent.status] || STATUS_CONFIG.offline;
  const teamColor = TEAM_COLORS[agent.team] || "#888";

  return (
    <div style={{
      background: cfg.bg,
      border: `1px solid ${cfg.color}33`,
      borderLeft: `3px solid ${cfg.color}`,
      borderRadius: 8,
      padding: "10px 14px",
      display: "flex",
      alignItems: "center",
      gap: 10,
      minWidth: 0,
      transition: "all 0.4s ease",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Team color accent */}
      <span style={{
        position: "absolute", top: 0, right: 0,
        width: 3, height: "100%", background: teamColor, opacity: 0.6,
      }} />

      <PulsingDot color={cfg.dot} active={cfg.pulse} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "#fff", lineHeight: 1.2,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {agent.name}
        </div>
        <div style={{ fontSize: "0.7rem", color: teamColor, fontWeight: 600, letterSpacing: "0.05em" }}>
          {agent.team}
        </div>
      </div>

      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontSize: "0.72rem", color: cfg.color, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          {cfg.label}
        </div>
        {agent.status === "on_call" && agent.callStartTime && (
          <CallTimer startTime={agent.callStartTime} />
        )}
        {agent.status === "ringing" && (
          <span style={{ fontSize: "0.72rem", color: "#FFB800", animation: "blink 1s infinite" }}>Incoming…</span>
        )}
      </div>
    </div>
  );
}

function FloorMapCell({ agent }) {
  if (!agent) return (
    <div style={{
      width: 52, height: 52, borderRadius: 6,
      background: "rgba(255,255,255,0.03)",
      border: "1px dashed rgba(255,255,255,0.08)",
    }} />
  );

  const cfg = STATUS_CONFIG[agent.status] || STATUS_CONFIG.offline;
  const initials = agent.name.split(" ").map(n => n[0]).join("").slice(0,2);

  return (
    <div title={`${agent.name} — ${cfg.label}`} style={{
      width: 52, height: 52, borderRadius: 6,
      background: cfg.bg,
      border: `2px solid ${cfg.color}`,
      boxShadow: cfg.pulse ? `0 0 12px ${cfg.color}88` : "none",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      cursor: "default", position: "relative",
      transition: "all 0.4s ease",
    }}>
      <span style={{ fontSize: "0.75rem", fontWeight: 800, color: "#fff", lineHeight: 1 }}>{initials}</span>
      <span style={{
        position: "absolute", bottom: 3, right: 3,
        width: 8, height: 8, borderRadius: "50%",
        background: cfg.dot,
        boxShadow: cfg.pulse ? `0 0 4px ${cfg.dot}` : "none",
        animation: cfg.pulse ? "ping 1.5s ease-in-out infinite" : "none",
      }} />
    </div>
  );
}

function QueueBar({ queue }) {
  const alertLevel = queue.waiting >= 5 ? "critical" : queue.waiting >= 3 ? "warn" : "ok";
  const colors = { ok: "#00E676", warn: "#FFB800", critical: "#FF3B5C" };
  const color = colors[alertLevel];
  const maxWait = 300;
  const pct = Math.min(100, (queue.avgWait / maxWait) * 100);

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
        <span style={{ fontWeight: 700, color: TEAM_COLORS[queue.name] || "#aaa", fontSize: "0.85rem", letterSpacing: "0.05em" }}>
          {queue.name.toUpperCase()}
        </span>
        <div style={{ display: "flex", gap: 12, fontSize: "0.75rem" }}>
          {queue.waiting > 0 && (
            <span style={{ color, fontWeight: 800 }}>
              {alertLevel === "critical" && "⚠ "}
              {queue.waiting} waiting
            </span>
          )}
          <span style={{ color: "#7B8FA6" }}>{queue.callsHandled} handled</span>
          <span style={{ color: "#7B8FA6" }}>{fmt(queue.avgWait)} avg</span>
        </div>
      </div>
      <div style={{ height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${pct}%`, borderRadius: 3,
          background: `linear-gradient(90deg, ${color}88, ${color})`,
          transition: "width 0.6s ease",
          boxShadow: `0 0 8px ${color}66`,
        }} />
      </div>
    </div>
  );
}

function StatBox({ label, value, sub, color = "#00C8FF", big = false }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.04)",
      border: `1px solid ${color}33`,
      borderRadius: 10, padding: "14px 18px",
      flex: 1,
    }}>
      <div style={{ color: "#7B8FA6", fontSize: "0.65rem", fontWeight: 700,
        letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ color, fontSize: big ? "2.2rem" : "1.6rem", fontWeight: 900,
        lineHeight: 1, letterSpacing: "-0.02em" }}>
        {value}
      </div>
      {sub && <div style={{ color: "#7B8FA6", fontSize: "0.72rem", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function LeaderboardRow({ rank, agent, color }) {
  const medals = ["🥇", "🥈", "🥉"];
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, padding: "7px 10px",
      background: rank <= 3 ? "rgba(255,255,255,0.04)" : "transparent",
      borderRadius: 6, marginBottom: 3,
    }}>
      <span style={{ fontSize: rank <= 3 ? "1.1rem" : "0.8rem", minWidth: 24, textAlign: "center" }}>
        {rank <= 3 ? medals[rank - 1] : `${rank}`}
      </span>
      <span style={{ flex: 1, fontWeight: rank === 1 ? 800 : 600, color: rank === 1 ? "#fff" : "#CBD5E1",
        fontSize: "0.85rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {agent.name}
      </span>
      <div style={{ textAlign: "right" }}>
        <span style={{ color, fontWeight: 800, fontSize: "1rem" }}>{agent.enrollmentsToday || 0}</span>
        <span style={{ color: "#7B8FA6", fontSize: "0.65rem", marginLeft: 3 }}>enroll</span>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { data, connected } = useWebSocket(WS_URL);
  const [tick, setTick] = useState(0);
  const [now, setNow] = useState(new Date());

  // Re-render every second for call timers and clock
  useEffect(() => {
    const t = setInterval(() => { setTick(x => x + 1); setNow(new Date()); }, 1000);
    return () => clearInterval(t);
  }, []);

  if (!data) return (
    <div style={{ minHeight: "100vh", background: "#080E1A", display: "flex",
      alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ textAlign: "center", color: "#fff" }}>
        <div style={{ fontSize: "2rem", marginBottom: 12, animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</div>
        <div style={{ color: "#7B8FA6", fontSize: "0.9rem" }}>Connecting to dashboard server…</div>
      </div>
    </div>
  );

  const agents = Object.values(data.agents);
  const queues = Object.values(data.queues);

  // Status counts
  const counts = agents.reduce((acc, a) => {
    acc[a.status] = (acc[a.status] || 0) + 1;
    return acc;
  }, {});

  // Longest active call
  const onCallAgents = agents.filter(a => a.status === "on_call" && a.callStartTime);
  const longestCall = onCallAgents.length > 0
    ? Math.max(...onCallAgents.map(a => Date.now() - a.callStartTime)) / 1000
    : null;

  // Leaderboard
  const leaderboard = [...agents]
    .sort((a, b) => (b.enrollmentsToday || 0) - (a.enrollmentsToday || 0))
    .slice(0, 8);

  // Floor map — arrange agents in a 4-column grid
  const COLS = 4;
  const floorSlots = [...agents];
  while (floorSlots.length % COLS !== 0) floorSlots.push(null);

  // Heatmap by team
  const teamCalls = agents.reduce((acc, a) => {
    const team = a.team || "Other";
    acc[team] = (acc[team] || 0) + (a.callsToday || 0);
    return acc;
  }, {});
  const maxTeamCalls = Math.max(...Object.values(teamCalls), 1);

  const conversion = data.stats.callsToday > 0
    ? Math.round((data.stats.applicationsToday / data.stats.callsToday) * 100)
    : 0;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;800;900&family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #080E1A; }
        @keyframes ping {
          0%, 100% { transform: scale(1); opacity: 0.4; }
          50% { transform: scale(1.8); opacity: 0; }
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
      `}</style>

      <div style={{
        minHeight: "100vh",
        background: "#080E1A",
        fontFamily: "'DM Sans', sans-serif",
        color: "#fff",
        padding: "16px 20px",
        display: "grid",
        gridTemplateRows: "auto 1fr",
        gap: 16,
      }}>

        {/* ── Header ── */}
        <header style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: 12,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              background: "linear-gradient(135deg, #00C8FF, #7B5EA7)",
              borderRadius: 10, padding: "8px 14px",
              fontWeight: 900, fontSize: "1rem", letterSpacing: "-0.02em",
            }}>
              iTeach
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: "1.2rem", letterSpacing: "-0.02em", lineHeight: 1 }}>
                CALL FLOOR COMMAND
              </div>
              <div style={{ color: "#7B8FA6", fontSize: "0.7rem", letterSpacing: "0.1em", fontWeight: 600 }}>
                LIVE OPERATIONS DASHBOARD
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            {/* Status summary chips */}
            {[
              { status: "on_call",   icon: "🔴", key: "on_call"   },
              { status: "ringing",  icon: "🟡", key: "ringing"  },
              { status: "available",icon: "🟢", key: "available" },
              { status: "break",    icon: "⚫", key: "break"    },
            ].map(({ status, icon, key }) => (
              <div key={key} style={{ textAlign: "center" }}>
                <div style={{ fontSize: "1.1rem", lineHeight: 1 }}>{icon}</div>
                <div style={{ color: STATUS_CONFIG[status].color, fontWeight: 900, fontSize: "1.1rem", lineHeight: 1.1 }}>
                  {counts[key] || 0}
                </div>
                <div style={{ color: "#7B8FA6", fontSize: "0.6rem", letterSpacing: "0.06em", fontWeight: 600 }}>
                  {STATUS_CONFIG[status].label.toUpperCase()}
                </div>
              </div>
            ))}

            <div style={{ width: 1, height: 40, background: "rgba(255,255,255,0.08)" }} />

            {/* Clock */}
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "1.4rem", fontWeight: 700,
                color: "#00C8FF", letterSpacing: "0.05em", lineHeight: 1 }}>
                {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </div>
              <div style={{ color: "#7B8FA6", fontSize: "0.65rem", letterSpacing: "0.08em" }}>
                {now.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
              </div>
            </div>

            {/* WS connection */}
            <div style={{
              display: "flex", alignItems: "center", gap: 5,
              background: connected ? "rgba(0,230,118,0.12)" : "rgba(255,59,92,0.12)",
              border: `1px solid ${connected ? "#00E676" : "#FF3B5C"}44`,
              borderRadius: 20, padding: "4px 10px", fontSize: "0.65rem",
              color: connected ? "#00E676" : "#FF3B5C", fontWeight: 700, letterSpacing: "0.06em",
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: "50%",
                background: connected ? "#00E676" : "#FF3B5C",
                boxShadow: connected ? "0 0 6px #00E676" : "none",
              }} />
              {connected ? "LIVE" : "RECONNECTING"}
            </div>
          </div>
        </header>

        {/* ── Main Grid ── */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 320px",
          gridTemplateRows: "auto auto 1fr",
          gap: 14,
        }}>

          {/* ── Stats Row ── */}
          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 12 }}>
            <StatBox label="Calls Today" value={data.stats.callsToday} color="#00C8FF" />
            <StatBox label="Applications" value={data.stats.applicationsToday} color="#00E676" />
            <StatBox label="Conversion" value={`${conversion}%`} color="#FFB800"
              sub={`${data.stats.applicationsToday} apps / ${data.stats.callsToday} calls`} />
            <StatBox label="Longest Call" value={longestCall ? fmt(longestCall) : "—"}
              color={longestCall > 600 ? "#FF3B5C" : "#FF6B35"}
              sub={longestCall > 600 ? "⚠ Over 10 minutes" : "Active call duration"} />
            {data.stats.avgSpeedToCall && (
              <StatBox label="Speed to Call" value={fmt(data.stats.avgSpeedToCall)}
                color="#A855F7" sub="Apply → First call avg" />
            )}
          </div>

          {/* ── Agent Grid ── */}
          <div style={{ gridColumn: 1, gridRow: "2 / 4" }}>
            <div style={{ fontWeight: 800, fontSize: "0.7rem", letterSpacing: "0.12em",
              color: "#7B8FA6", marginBottom: 10, textTransform: "uppercase" }}>
              Agent Status Grid
            </div>
            <div style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 6,
              maxHeight: "calc(100vh - 280px)",
              overflowY: "auto",
              paddingRight: 4,
            }}>
              {agents
                .sort((a, b) => {
                  const order = { on_call: 0, ringing: 1, available: 2, break: 3, away: 4, offline: 5 };
                  return (order[a.status] ?? 9) - (order[b.status] ?? 9);
                })
                .map(agent => <AgentCard key={agent.id} agent={agent} />)
              }
            </div>
          </div>

          {/* ── Floor Map ── */}
          <div style={{ gridColumn: 2, gridRow: 2 }}>
            <div style={{ fontWeight: 800, fontSize: "0.7rem", letterSpacing: "0.12em",
              color: "#7B8FA6", marginBottom: 10, textTransform: "uppercase" }}>
              Floor Map
            </div>
            <div style={{
              display: "grid",
              gridTemplateColumns: `repeat(${COLS}, 52px)`,
              gap: 8,
              justifyContent: "start",
            }}>
              {floorSlots.map((agent, i) => (
                <FloorMapCell key={i} agent={agent} />
              ))}
            </div>
            {/* Legend */}
            <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
              {["on_call", "ringing", "available", "break"].map(s => (
                <div key={s} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%",
                    background: STATUS_CONFIG[s].dot, display: "inline-block" }} />
                  <span style={{ color: "#7B8FA6", fontSize: "0.65rem", letterSpacing: "0.05em" }}>
                    {STATUS_CONFIG[s].label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Queue Heatmap ── */}
          <div style={{ gridColumn: 2, gridRow: 3 }}>
            <div style={{ fontWeight: 800, fontSize: "0.7rem", letterSpacing: "0.12em",
              color: "#7B8FA6", marginBottom: 10, textTransform: "uppercase" }}>
              Queue Pressure
            </div>
            {queues.map(q => <QueueBar key={q.id} queue={q} />)}

            <div style={{ marginTop: 16 }}>
              <div style={{ fontWeight: 800, fontSize: "0.7rem", letterSpacing: "0.12em",
                color: "#7B8FA6", marginBottom: 10, textTransform: "uppercase" }}>
                Call Volume by Team
              </div>
              {Object.entries(teamCalls)
                .sort((a, b) => b[1] - a[1])
                .map(([team, calls]) => {
                  const pct = (calls / maxTeamCalls) * 100;
                  const color = TEAM_COLORS[team] || "#888";
                  return (
                    <div key={team} style={{ marginBottom: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3,
                        fontSize: "0.75rem" }}>
                        <span style={{ color, fontWeight: 700 }}>{team}</span>
                        <span style={{ color: "#7B8FA6" }}>{calls} calls</span>
                      </div>
                      <div style={{ height: 8, background: "rgba(255,255,255,0.06)", borderRadius: 4, overflow: "hidden" }}>
                        <div style={{
                          height: "100%", width: `${pct}%`, borderRadius: 4,
                          background: color, opacity: 0.8,
                          transition: "width 0.6s ease",
                        }} />
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* ── Leaderboard ── */}
          <div style={{ gridColumn: 3, gridRow: "2 / 4" }}>
            <div style={{ fontWeight: 800, fontSize: "0.7rem", letterSpacing: "0.12em",
              color: "#7B8FA6", marginBottom: 10, textTransform: "uppercase" }}>
              Enrollments Today
            </div>
            <div style={{
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 10,
              padding: "10px 8px",
            }}>
              {leaderboard.map((agent, i) => (
                <LeaderboardRow key={agent.id} rank={i + 1} agent={agent} color="#00E676" />
              ))}
            </div>

            {/* Team breakdown */}
            <div style={{ fontWeight: 800, fontSize: "0.7rem", letterSpacing: "0.12em",
              color: "#7B8FA6", marginTop: 20, marginBottom: 10, textTransform: "uppercase" }}>
              Team Enrollments
            </div>
            {Object.entries(TEAM_COLORS).map(([team, color]) => {
              const teamAgents = agents.filter(a => a.team === team);
              const total = teamAgents.reduce((s, a) => s + (a.enrollmentsToday || 0), 0);
              return (
                <div key={team} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "8px 10px", marginBottom: 6,
                  background: "rgba(255,255,255,0.03)",
                  border: `1px solid ${color}22`,
                  borderLeft: `3px solid ${color}`,
                  borderRadius: 6,
                }}>
                  <span style={{ color, fontWeight: 700, fontSize: "0.82rem" }}>{team}</span>
                  <span style={{ color: "#fff", fontWeight: 900, fontSize: "1.1rem" }}>{total}</span>
                </div>
              );
            })}

            {/* Alert zone */}
            {queues.some(q => q.waiting >= 5) && (
              <div style={{
                marginTop: 16, padding: "12px 14px",
                background: "rgba(255,59,92,0.12)",
                border: "1px solid rgba(255,59,92,0.4)",
                borderRadius: 8,
                animation: "blink 2s ease-in-out infinite",
              }}>
                <div style={{ color: "#FF3B5C", fontWeight: 800, fontSize: "0.8rem", marginBottom: 4 }}>
                  ⚠ QUEUE ALERT
                </div>
                {queues.filter(q => q.waiting >= 5).map(q => (
                  <div key={q.id} style={{ color: "#FFB8C6", fontSize: "0.75rem" }}>
                    {q.name}: {q.waiting} callers waiting
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </>
  );
}
