import { useState, useEffect, useRef, useCallback, useMemo } from "react";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:3001";

// ─── Config ──────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  on_call:   { label: "On Call",    color: "#FF8C00", bg: "rgba(255,140,0,0.18)",   dot: "#FF8C00", pulse: true  },
  ringing:   { label: "Ringing",    color: "#FFB800", bg: "rgba(255,184,0,0.18)",   dot: "#FFB800", pulse: true  },
  available: { label: "At Desk",    color: "#C1FD34", bg: "rgba(193,253,52,0.10)",  dot: "#C1FD34", pulse: false },
  away:      { label: "Away",       color: "#FF8C00", bg: "rgba(255,140,0,0.10)",   dot: "#FF8C00", pulse: false },
  break:     { label: "Break",      color: "#7B8FA6", bg: "rgba(123,143,166,0.10)", dot: "#7B8FA6", pulse: false },
  dnd:       { label: "DND",        color: "#FF3B5C", bg: "rgba(255,59,92,0.10)",   dot: "#FF3B5C", pulse: false },
  offline:   { label: "Offline",    color: "#4A5568", bg: "rgba(74,85,104,0.08)",   dot: "#4A5568", pulse: false },
  meeting:   { label: "In Meeting", color: "#A78BFA", bg: "rgba(167,139,250,0.25)", dot: "#A78BFA", pulse: true  },
};

const TEAM_COLORS = {
  "Admissions": "#038CF1", "Texas Support": "#00BEA8", "National Support": "#C1FD34",
  "Lead Team": "#038CF1", "Educational": "#00BEA8", "Relational": "#C1FD34",
  "Engagement": "#6B5CE7", "Certification": "#FF9F0A", "Curriculum": "#FF4466",
};

const TEAM_LEADS = {
  "All": Object.keys(TEAM_COLORS),
  "Educational Team": ["Admissions", "National Support", "Texas Support", "Engagement"],
  "Certification Team": ["Certification"],
  "Relational Team": ["Relational"],
};

// ─── Hooks ───────────────────────────────────────────────────────────────────

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

function useTick() {
  const [t, setT] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setT(Date.now()), 1000); return () => clearInterval(i); }, []);
  return t;
}

function fmt(secs) {
  if (!secs || secs < 0) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fmtMins(secs) {
  if (!secs) return "0m";
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${Math.round(secs % 60)}s`;
}

// ─── Threshold helpers ───────────────────────────────────────────────────────

function thresholdColor(val, green, yellow) {
  if (val <= green) return "#C1FD34";
  if (val <= yellow) return "#FFB800";
  return "#FF3B5C";
}

// ─── Shared Components ──────────────────────────────────────────────────────

function KpiTile({ label, value, sub, color, size = "normal" }) {
  const isLarge = size === "large";
  return (
    <div style={{
      flex: 1, minWidth: isLarge ? 150 : 110,
      background: "rgba(255,255,255,0.06)", border: `1px solid ${color}33`,
      borderRadius: 12, padding: isLarge ? "14px 16px" : "10px 12px",
      borderLeft: `3px solid ${color}`,
    }}>
      <div style={{ fontSize: 9, letterSpacing: 2, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: isLarge ? 30 : 22, fontWeight: 700, color, fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function PlaceholderKpi({ label, sub }) {
  return (
    <div style={{
      flex: 1, minWidth: 110,
      background: "rgba(255,255,255,0.03)", border: "1px dashed rgba(255,255,255,0.12)",
      borderRadius: 12, padding: "10px 12px", opacity: 0.6,
    }}>
      <div style={{ fontSize: 9, letterSpacing: 2, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: "rgba(255,255,255,0.2)", fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>—</div>
      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", marginTop: 3 }}>{sub || "Coming soon"}</div>
    </div>
  );
}

function SectionHeader({ color, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
      <div style={{ width: 10, height: 10, borderRadius: 3, background: color }} />
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2.5, color, textTransform: "uppercase" }}>{label}</span>
    </div>
  );
}

// ─── Live Tab Components ─────────────────────────────────────────────────────

function AgentCard({ agent, tick }) {
  const cfg = STATUS_CONFIG[agent.status] || STATUS_CONFIG.available;
  const elapsedSecs = agent.callStartTime ? (tick - agent.callStartTime) / 1000 : 0;
  const elapsed = elapsedSecs > 0 ? fmt(elapsedSecs) : null;
  const teamColor = TEAM_COLORS[agent.team] || "#666";
  const isActive = agent.status === "on_call" || agent.status === "ringing" || agent.status === "meeting";
  const nameParts = (agent.name || "").trim().split(" ");
  const firstName = nameParts[0] || "";
  const lastName = nameParts.slice(1).join(" ") || "";

  const isLong = elapsedSecs > 8 * 60;
  const isCritical = elapsedSecs > 15 * 60;
  const alertColor = isCritical ? "#DC2626" : isLong ? "#FF3B5C" : null;

  const direction = agent.callDirection;
  const dirLabel = direction === "inbound" ? "IN" : direction === "outbound" ? "OUT" : null;

  const dirColor = direction === "inbound" ? "#00BEA8" : "#038CF1";

  return (
    <div style={{
      padding: "12px 12px 10px", borderRadius: 10,
      background: alertColor ? (isCritical ? "rgba(220,38,38,0.15)" : "rgba(255,59,92,0.12)") : isActive ? cfg.bg : "rgba(255,255,255,0.05)",
      border: `1px solid ${alertColor ? alertColor + "66" : isActive ? cfg.color + "44" : "rgba(255,255,255,0.10)"}`,
      boxShadow: isActive ? `0 0 12px ${alertColor || cfg.color}22` : "none",
      display: "flex", flexDirection: "column", gap: 5,
      transition: "all 0.3s ease", position: "relative",
      minHeight: 82,
    }}>
      <div style={{ position: "absolute", top: 10, left: 10, width: 7, height: 7, borderRadius: "50%", background: alertColor || cfg.dot, boxShadow: isActive ? `0 0 6px ${alertColor || cfg.dot}` : "none" }} />
      <div style={{ position: "absolute", top: 8, right: 10, fontSize: 9, color: teamColor, fontWeight: 700, letterSpacing: 0.3 }}>{agent.team}</div>
      <div style={{ paddingLeft: 16, paddingRight: 60 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{firstName}</div>
        {lastName && <div style={{ fontSize: 11, fontWeight: 400, color: "rgba(255,255,255,0.5)", lineHeight: 1.2 }}>{lastName}</div>}
      </div>
      <div style={{ paddingLeft: 16, display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: alertColor || cfg.color, textTransform: "uppercase", letterSpacing: 0.6 }}>{cfg.label}</span>
          {direction && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 8, fontWeight: 700, color: dirColor, background: dirColor + "20", borderRadius: 4, padding: "2px 6px" }}>
              <svg width="8" height="8" viewBox="0 0 8 8" style={{ transform: direction === "inbound" ? "rotate(135deg)" : "rotate(-45deg)" }}>
                <path d="M1 4L4 1L7 4M4 1V7" stroke={dirColor} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {direction === "inbound" ? "IN" : "OUT"}
            </span>
          )}
        </div>
        {elapsed && <span style={{ fontSize: 13, fontWeight: 700, color: alertColor || cfg.color, fontFamily: "'DM Mono', monospace" }}>{elapsed}</span>}
      </div>
    </div>
  );
}

function StatusSummaryBar({ manualAgents }) {
  const counts = [
    { label: "On Call", val: manualAgents.filter(a => a.status === "on_call").length, color: "#FF8C00" },
    { label: "Ringing", val: manualAgents.filter(a => a.status === "ringing").length, color: "#FFB800" },
    { label: "At Desk", val: manualAgents.filter(a => a.status === "available").length, color: "#C1FD34" },
    { label: "Away/DND", val: manualAgents.filter(a => ["away", "dnd", "break"].includes(a.status)).length, color: "#FF8C00" },
    { label: "In Meeting", val: manualAgents.filter(a => a.status === "meeting").length, color: "#A78BFA" },
    { label: "Offline", val: manualAgents.filter(a => a.status === "offline").length, color: "#4A5568" },
  ];
  const total = manualAgents.length || 1;

  return (
    <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "10px 12px" }}>
      <div style={{ display: "flex", gap: 2, height: 6, borderRadius: 3, overflow: "hidden", marginBottom: 8 }}>
        {counts.filter(c => c.val > 0).map(c => (
          <div key={c.label} style={{ flex: c.val, background: c.color, transition: "flex 0.5s ease" }} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {counts.map(c => (
          <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: c.color }} />
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)" }}>{c.label}</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: c.color, fontFamily: "'DM Mono', monospace" }}>{c.val}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LiveTab({ manualAgents, tick, stats, zoomQueues }) {
  const onCallCount = manualAgents.filter(a => a.status === "on_call").length;
  const ringingCount = manualAgents.filter(a => a.status === "ringing").length;
  const availableCount = manualAgents.filter(a => a.status === "available").length;
  const offlineCount = manualAgents.filter(a => a.status === "offline").length;
  const totalActive = manualAgents.length - offlineCount;
  const utilization = totalActive > 0 ? Math.round((onCallCount / totalActive) * 100) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Live KPIs */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <KpiTile label="On Call" value={onCallCount} color="#FF8C00" sub={`${ringingCount} ringing`} size="large" />
        <KpiTile label="Available" value={availableCount} color="#C1FD34" sub={`of ${totalActive} active`} size="large" />
        <KpiTile label="Utilization" value={`${utilization}%`} color={thresholdColor(utilization, 60, 80)} sub={`${onCallCount} of ${totalActive}`} size="large" />
        <KpiTile label="Calls Today" value={stats.callsToday || 0} color="#038CF1" />
        <KpiTile label="Queue Waiting" value={zoomQueues.totalWaiting} color={zoomQueues.totalWaiting > 3 ? "#FF3B5C" : zoomQueues.totalWaiting > 0 ? "#FFB800" : "#C1FD34"} sub={`${zoomQueues.queues?.length || 0} active queues`} />
        <KpiTile label="Avg Wait Time" value={zoomQueues.avgWaitTime ? fmtMins(zoomQueues.avgWaitTime) : "0s"} color={zoomQueues.avgWaitTime > 120 ? "#FF3B5C" : "#C1FD34"} sub="Across all queues" />
      </div>

      {/* Status bar */}
      <StatusSummaryBar manualAgents={manualAgents} />

      {/* Agent grid */}
      {manualAgents.length === 0 ? (
        <div style={{ padding: "40px 0", textAlign: "center" }}>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>No agents registered</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 10 }}>
          {manualAgents.map(agent => <AgentCard key={agent.id} agent={agent} tick={tick} />)}
        </div>
      )}
    </div>
  );
}

// ─── Performance Tab Components ──────────────────────────────────────────────

function HourlyChart({ hourlyVolume }) {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
  const currentHour = now.getHours();
  const max = Math.max(...hourlyVolume, 1);
  const hours = [];
  for (let h = 7; h <= 20; h++) hours.push(h);

  return (
    <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "12px 10px 6px" }}>
      <div style={{ fontSize: 9, letterSpacing: 2, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", marginBottom: 10 }}>Calls by Hour (CT)</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 80 }}>
        {hours.map(h => {
          const val = hourlyVolume[h] || 0;
          const pct = (val / max) * 100;
          const isCurrent = h === currentHour;
          const isPast = h < currentHour;
          return (
            <div key={h} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
              {val > 0 && <span style={{ fontSize: 8, color: "rgba(255,255,255,0.5)", fontFamily: "'DM Mono', monospace" }}>{val}</span>}
              <div style={{
                width: "100%", minHeight: 3, height: `${Math.max(pct, 4)}%`,
                background: isCurrent ? "#038CF1" : isPast ? "rgba(3,140,241,0.5)" : "rgba(255,255,255,0.1)",
                borderRadius: 2, transition: "height 0.3s ease",
              }} />
              <span style={{ fontSize: 7, color: isCurrent ? "#038CF1" : "rgba(255,255,255,0.3)", fontFamily: "'DM Mono', monospace" }}>
                {h > 12 ? h - 12 : h}{h >= 12 ? "p" : "a"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InsightsPanel({ manualAgents, stats, hourlyVolume }) {
  const insights = useMemo(() => {
    const list = [];
    const onCall = manualAgents.filter(a => a.status === "on_call").length;
    const available = manualAgents.filter(a => a.status === "available").length;
    const offline = manualAgents.filter(a => a.status === "offline").length;
    const total = manualAgents.length - offline || 1;
    const utilization = Math.round((onCall / total) * 100);

    if (utilization > 80) list.push({ type: "warning", text: `High utilization at ${utilization}% — most agents are on calls.` });
    else if (available === 0 && onCall > 0) list.push({ type: "warning", text: "No agents available to take new calls." });

    if (stats.avgHandleTime > 600) list.push({ type: "warning", text: `AHT is ${fmtMins(stats.avgHandleTime)} — above 10min target.` });
    else if (stats.avgHandleTime > 0 && stats.avgHandleTime <= 360) list.push({ type: "good", text: `AHT is ${fmtMins(stats.avgHandleTime)} — within target.` });

    const peakHour = hourlyVolume.indexOf(Math.max(...hourlyVolume));
    const peakVal = hourlyVolume[peakHour] || 0;
    if (peakVal > 0) {
      const label = peakHour > 12 ? `${peakHour - 12}pm` : peakHour === 12 ? "12pm" : `${peakHour}am`;
      list.push({ type: "info", text: `Peak hour: ${label} with ${peakVal} calls.` });
    }

    if ((stats.callsToday || 0) > 0) list.push({ type: "info", text: `${stats.callsToday} calls handled across ${manualAgents.length} agents.` });
    if (list.length === 0) list.push({ type: "info", text: "Insights will appear as call activity builds." });
    return list.slice(0, 3);
  }, [manualAgents, stats, hourlyVolume]);

  const icons = { warning: "!", good: "+", info: "i" };
  const colors = { warning: "#FFB800", good: "#C1FD34", info: "#038CF1" };

  return (
    <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ fontSize: 9, letterSpacing: 2, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", marginBottom: 8 }}>Insights</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {insights.map((ins, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <div style={{
              width: 16, height: 16, borderRadius: "50%", flexShrink: 0, marginTop: 1,
              background: colors[ins.type] + "22", border: `1px solid ${colors[ins.type]}55`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 8, fontWeight: 800, color: colors[ins.type],
            }}>{icons[ins.type]}</div>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", lineHeight: 1.4 }}>{ins.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AgentPerfRow({ agent }) {
  const cfg = STATUS_CONFIG[agent.status] || STATUS_CONFIG.available;
  const teamColor = TEAM_COLORS[agent.team] || "#666";
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1.4fr 80px 60px 60px 60px",
      gap: 8, alignItems: "center", padding: "7px 12px",
      background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.05)",
      fontSize: 11,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: cfg.dot }} />
        <span style={{ fontWeight: 600, color: "#fff" }}>{agent.name}</span>
        <span style={{ fontSize: 8, color: teamColor, fontWeight: 600 }}>{agent.team}</span>
      </div>
      <span style={{ fontSize: 9, fontWeight: 600, color: cfg.color, textTransform: "uppercase" }}>{cfg.label}</span>
      <span style={{ fontFamily: "'DM Mono', monospace", color: "#038CF1", textAlign: "center" }}>{agent.callsToday || 0}</span>
      <span style={{ fontFamily: "'DM Mono', monospace", color: "#00BEA8", textAlign: "center" }}>{agent.enrollmentsToday || 0}</span>
      <span style={{ fontFamily: "'DM Mono', monospace", color: "#FFD700", textAlign: "center" }}>{agent.greatCallsToday || 0}</span>
    </div>
  );
}

function PerformanceTab({ manualAgents, stats, hourlyVolume }) {
  const totalEnrollments = manualAgents.reduce((sum, a) => sum + (a.enrollmentsToday || 0), 0);
  const totalGreatCalls = manualAgents.reduce((sum, a) => sum + (a.greatCallsToday || 0), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

      {/* ── Today's Performance ─────────────────────────────── */}
      <div>
        <SectionHeader color="#FFB800" label="Today's Performance" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 10 }}>
              <KpiTile label="Calls Handled" value={stats.callsToday || 0} color="#038CF1" />
              <KpiTile
                label="Avg Handle Time"
                value={stats.avgHandleTime ? fmtMins(stats.avgHandleTime) : "—"}
                color={stats.avgHandleTime ? thresholdColor(stats.avgHandleTime, 480, 600) : "rgba(255,255,255,0.3)"}
                sub="Target: < 8 min"
              />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <KpiTile label="Longest Call" value={stats.longestCall ? fmtMins(stats.longestCall) : "—"} color={stats.longestCall > 900 ? "#FF3B5C" : "#038CF1"} sub={stats.longestCallAgent || (stats.longestCall ? "Agent pending" : "")} />
              <KpiTile label="Enrollments" value={totalEnrollments} color="#00BEA8" sub={`${stats.applicationsToday || 0} applications`} />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <PlaceholderKpi label="Abandonment Rate" sub="Needs Zoom Power Pack" />
              <PlaceholderKpi label="Avg Speed to Answer" sub="Needs Zoom Power Pack" />
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <HourlyChart hourlyVolume={hourlyVolume} />
            <InsightsPanel manualAgents={manualAgents} stats={stats} hourlyVolume={hourlyVolume} />
          </div>
        </div>
      </div>

      {/* ── Quality & Outcomes ──────────────────────────────── */}
      <div>
        <SectionHeader color="#038CF1" label="Quality & Outcomes" />
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <KpiTile label="Great Calls" value={totalGreatCalls} color="#FFD700" sub="Flagged in Salesforce" />
          <KpiTile
            label="Great Call Rate"
            value={stats.callsToday > 0 ? `${Math.round((totalGreatCalls / stats.callsToday) * 100)}%` : "—"}
            color="#FFD700" sub="Great calls / total calls"
          />
          <PlaceholderKpi label="First Call Resolution" sub="Needs CRM integration" />
          <PlaceholderKpi label="Transfers / Escalations" sub="Needs call routing data" />
          <PlaceholderKpi label="Repeat Callers (7d)" sub="Needs call history" />
        </div>
        {/* Great Call Leaderboard */}
        {totalGreatCalls > 0 && (
          <div style={{ marginTop: 10, background: "rgba(255,215,0,0.06)", border: "1px solid rgba(255,215,0,0.20)", borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ fontSize: 9, letterSpacing: 2, color: "#FFD700", textTransform: "uppercase", marginBottom: 10 }}>Great Call Leaderboard</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {manualAgents.filter(a => (a.greatCallsToday || 0) > 0).sort((a, b) => b.greatCallsToday - a.greatCallsToday).map(a => (
                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,215,0,0.08)", borderRadius: 8, padding: "5px 10px" }}>
                  <span style={{ fontSize: 11, color: "#fff", fontWeight: 600 }}>{a.name.split(" ")[0]} {a.name.split(" ")[1]?.[0]}.</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#FFD700", fontFamily: "'DM Mono', monospace" }}>{a.greatCallsToday}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Pipeline Impact ─────────────────────────────────── */}
      <div>
        <SectionHeader color="#A78BFA" label="Pipeline Impact" />
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <KpiTile label="Enrollments Today" value={totalEnrollments} color="#00BEA8" sub="From Salesforce" />
          <KpiTile
            label="Calls per Enrollment"
            value={totalEnrollments > 0 ? ((stats.callsToday || 0) / totalEnrollments).toFixed(1) : "—"}
            color="#038CF1"
            sub={totalEnrollments > 0 ? `${stats.callsToday} calls / ${totalEnrollments} enrolled` : "No enrollments yet"}
          />
          <PlaceholderKpi label="Avg Time: Applied to First Call" sub="Needs Salesforce integration" />
          <PlaceholderKpi label="Contact Rate" sub="% applicants reached" />
          <PlaceholderKpi label="Conversion: Contacted vs Not" sub="Needs Salesforce pipeline" />
        </div>
        {totalEnrollments > 0 && (
          <div style={{ marginTop: 10, background: "rgba(0,190,168,0.06)", border: "1px solid rgba(0,190,168,0.20)", borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ fontSize: 9, letterSpacing: 2, color: "#00BEA8", textTransform: "uppercase", marginBottom: 10 }}>Enrollment Leaderboard</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {manualAgents.filter(a => (a.enrollmentsToday || 0) > 0).sort((a, b) => b.enrollmentsToday - a.enrollmentsToday).map(a => (
                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(0,190,168,0.08)", borderRadius: 8, padding: "5px 10px" }}>
                  <span style={{ fontSize: 11, color: "#fff", fontWeight: 600 }}>{a.name.split(" ")[0]} {a.name.split(" ")[1]?.[0]}.</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#00BEA8", fontFamily: "'DM Mono', monospace" }}>{a.enrollmentsToday}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Agent Performance Table ─────────────────────────── */}
      <div>
        <SectionHeader color="#6B5CE7" label="Agent Breakdown" />
        <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 10, overflow: "hidden" }}>
          <div style={{
            display: "grid", gridTemplateColumns: "1.4fr 80px 60px 60px 60px",
            gap: 8, padding: "8px 12px",
            background: "rgba(255,255,255,0.06)", fontSize: 8, fontWeight: 700,
            letterSpacing: 1.5, color: "rgba(255,255,255,0.4)", textTransform: "uppercase",
          }}>
            <span>Agent</span><span>Status</span>
            <span style={{ textAlign: "center" }}>Calls</span>
            <span style={{ textAlign: "center" }}>Enroll</span>
            <span style={{ textAlign: "center" }}>Great</span>
          </div>
          {[...manualAgents].sort((a, b) => (b.callsToday || 0) - (a.callsToday || 0)).map(a => <AgentPerfRow key={a.id} agent={a} />)}
        </div>
      </div>
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────

export default function App() {
  const { data, connected } = useWebSocket(WS_URL);
  const tick = useTick();
  const now = new Date();

  const [selectedLead, setSelectedLead] = useState("All");
  const [activeTab, setActiveTab] = useState("live");

  const agents = data?.agents || {};
  const stats = data?.stats || {};
  const hourlyVolume = data?.hourlyVolume || new Array(24).fill(0);
  const zoomQueues = data?.zoomQueues || { totalWaiting: 0, avgWaitTime: 0, queues: [] };

  const leadTeams = TEAM_LEADS[selectedLead] || TEAM_LEADS["All"];
  const manualAgents = useMemo(() =>
    Object.values(agents)
      .filter(a => !a.autoRegistered && leadTeams.includes(a.team))
      .sort((a, b) => {
        const order = { on_call: 0, ringing: 1, meeting: 2, available: 3, away: 4, break: 5, dnd: 5, offline: 6 };
        return (order[a.status] ?? 6) - (order[b.status] ?? 6);
      }),
    [agents, leadTeams]
  );

  const onCallCount = manualAgents.filter(a => a.status === "on_call").length;
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
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }
      `}</style>

      <div style={{ padding: "12px 20px 20px", display: "flex", flexDirection: "column", gap: 14, maxWidth: 1440, margin: "0 auto" }}>

        {/* ── Header ─────────────────────────────────────────── */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          position: "sticky", top: 0, zIndex: 100, padding: "8px 0 6px",
          background: "linear-gradient(160deg, #110045 0%, #0D1E6B 45%, #043C96 100%)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src="/iteach-logo.png" alt="iTeach" style={{ height: 32 }} />
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase" }}>Support Center Command</div>
              <div style={{ fontSize: 8, letterSpacing: 3, color: "rgba(255,255,255,0.35)", textTransform: "uppercase" }}>Live Operations Dashboard</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            {[
              { label: "On Call", val: onCallCount, color: "#FF8C00" },
              { label: "Available", val: availableCount, color: "#C1FD34" },
              { label: "Calls", val: stats.callsToday || 0, color: "#038CF1" },
            ].map(({ label, val, color }) => (
              <div key={label} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700, color, fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>{val}</div>
                <div style={{ fontSize: 7, letterSpacing: 1.5, color: "rgba(255,255,255,0.35)", textTransform: "uppercase" }}>{label}</div>
              </div>
            ))}
            <div style={{ width: 1, height: 28, background: "rgba(255,255,255,0.12)" }} />
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#00BEA8", fontFamily: "'DM Mono', monospace" }}>{timeStr}</div>
              <div style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", letterSpacing: 1 }}>{dateStr}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4, background: connected ? "rgba(193,253,52,0.10)" : "rgba(255,59,92,0.10)", border: `1px solid ${connected ? "#C1FD34" : "#FF3B5C"}44`, borderRadius: 16, padding: "3px 8px" }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: connected ? "#C1FD34" : "#FF3B5C", animation: connected ? "pulse 2s infinite" : "none" }} />
              <span style={{ fontSize: 8, fontWeight: 600, color: connected ? "#C1FD34" : "#FF3B5C", letterSpacing: 1 }}>{connected ? "LIVE" : "..."}</span>
            </div>
          </div>
        </div>

        {/* ── Tab Bar + Filters ───────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {/* Main tabs */}
          {[
            { key: "live", label: "Live", color: "#FF8C00" },
            { key: "performance", label: "Performance", color: "#038CF1" },
          ].map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
              padding: "6px 18px", borderRadius: 8, border: "none", cursor: "pointer",
              background: activeTab === tab.key ? `${tab.color}22` : "rgba(255,255,255,0.04)",
              color: activeTab === tab.key ? tab.color : "rgba(255,255,255,0.4)",
              fontSize: 12, fontWeight: activeTab === tab.key ? 700 : 500,
              fontFamily: "'Poppins', sans-serif",
              borderBottom: activeTab === tab.key ? `2px solid ${tab.color}` : "2px solid transparent",
              transition: "all 0.2s ease",
            }}>{tab.label}</button>
          ))}

          <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.10)", margin: "0 8px" }} />

          {/* Team filters */}
          <span style={{ fontSize: 9, letterSpacing: 2, color: "rgba(255,255,255,0.25)", textTransform: "uppercase", marginRight: 2 }}>Team</span>
          {Object.keys(TEAM_LEADS).map(lead => (
            <button key={lead} onClick={() => setSelectedLead(lead)} style={{
              padding: "4px 10px", borderRadius: 14, border: "none", cursor: "pointer",
              background: selectedLead === lead ? "linear-gradient(135deg, #043C96, #038CF1)" : "rgba(255,255,255,0.05)",
              color: selectedLead === lead ? "#fff" : "rgba(255,255,255,0.4)",
              fontSize: 10, fontWeight: selectedLead === lead ? 700 : 400,
              fontFamily: "'Poppins', sans-serif", transition: "all 0.2s ease",
            }}>{lead}</button>
          ))}
        </div>

        {/* ── Tab Content ─────────────────────────────────────── */}
        {activeTab === "live" ? (
          <LiveTab manualAgents={manualAgents} tick={tick} stats={stats} zoomQueues={zoomQueues} />
        ) : (
          <PerformanceTab manualAgents={manualAgents} stats={stats} hourlyVolume={hourlyVolume} />
        )}

        {/* ── Footer ──────────────────────────────────────────── */}
        <div style={{ fontSize: 8, color: "rgba(255,255,255,0.15)", textAlign: "center", padding: "4px 0" }}>
          iTeach Support Center  —  {manualAgents.length} agents  —  Refreshes every 60s
        </div>
      </div>
    </>
  );
}
