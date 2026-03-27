import { useState, useEffect, useRef, useCallback, useMemo } from "react";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:3001";

// ─── Config ──────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  on_call:   { label: "On Call",    color: "#FF8C00", dot: "#FFB800", pulse: true  },
  ringing:   { label: "Ringing",    color: "#FFB800", dot: "#FFB800", pulse: true  },
  available: { label: "Available",  color: "#22C55E", dot: "#22C55E", pulse: false },
  away:      { label: "Away",       color: "#FF8C00", dot: "#FF8C00", pulse: false },
  break:     { label: "Break",      color: "#7B8FA6", dot: "#7B8FA6", pulse: false },
  dnd:       { label: "DND",        color: "#FF3B5C", dot: "#FF3B5C", pulse: false },
  offline:   { label: "Offline",    color: "#94A3B8", dot: "#94A3B8", pulse: false },
  meeting:   { label: "In Meeting", color: "#A78BFA", dot: "#A78BFA", pulse: true  },
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

// ─── Themes ──────────────────────────────────────────────────────────────────

const THEMES = {
  dark: {
    bg: "linear-gradient(160deg, #110045 0%, #0D1E6B 45%, #043C96 100%)",
    headerBg: "linear-gradient(160deg, #110045 0%, #0D1E6B 45%, #043C96 100%)",
    text: "#fff",
    textMuted: "rgba(255,255,255,0.5)",
    textFaint: "rgba(255,255,255,0.3)",
    cardBg: "rgba(255,255,255,0.05)",
    cardBorder: "rgba(255,255,255,0.10)",
    cardActiveBg: "rgba(255,140,0,0.12)",
    cardActiveBorder: "rgba(255,140,0,0.30)",
    tileBg: "rgba(255,255,255,0.06)",
    tileBorder: "33",
    chipBg: "rgba(255,255,255,0.06)",
    chipActiveBg: "linear-gradient(135deg, #043C96, #038CF1)",
    chipText: "rgba(255,255,255,0.5)",
    chipActiveText: "#fff",
    statusBarBg: "rgba(255,255,255,0.06)",
    statusBarBorder: "rgba(255,255,255,0.12)",
    divider: "rgba(255,255,255,0.10)",
    tabInactive: "rgba(255,255,255,0.4)",
    scrollThumb: "rgba(255,255,255,0.15)",
    alertBg: "rgba(220,38,38,0.15)",
    alertBorderColor: "#DC262666",
    warnBg: "rgba(255,59,92,0.12)",
    warnBorderColor: "#FF3B5C66",
  },
  light: {
    bg: "linear-gradient(160deg, #F0F4F8 0%, #E2E8F0 45%, #CBD5E1 100%)",
    headerBg: "#ffffff",
    text: "#1E293B",
    textMuted: "#64748B",
    textFaint: "#94A3B8",
    cardBg: "#ffffff",
    cardBorder: "#E2E8F0",
    cardActiveBg: "rgba(255,140,0,0.08)",
    cardActiveBorder: "rgba(255,140,0,0.25)",
    tileBg: "#ffffff",
    tileBorder: "22",
    chipBg: "#F1F5F9",
    chipActiveBg: "linear-gradient(135deg, #043C96, #038CF1)",
    chipText: "#64748B",
    chipActiveText: "#fff",
    statusBarBg: "#ffffff",
    statusBarBorder: "#E2E8F0",
    divider: "#E2E8F0",
    tabInactive: "#94A3B8",
    scrollThumb: "rgba(0,0,0,0.15)",
    alertBg: "rgba(220,38,38,0.08)",
    alertBorderColor: "#DC262633",
    warnBg: "rgba(255,59,92,0.08)",
    warnBorderColor: "#FF3B5C33",
  },
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
  if (val <= green) return "#22C55E";
  if (val <= yellow) return "#FFB800";
  return "#FF3B5C";
}

// ─── Shared Components ──────────────────────────────────────────────────────

function KpiTile({ label, value, sub, color, size = "normal", theme }) {
  const t = THEMES[theme];
  const isLarge = size === "large";
  return (
    <div style={{
      flex: 1, minWidth: isLarge ? 150 : 110,
      background: t.tileBg, border: `1px solid ${color}${t.tileBorder}`,
      borderRadius: 12, padding: isLarge ? "14px 16px" : "10px 12px",
      borderLeft: `3px solid ${color}`,
    }}>
      <div style={{ fontSize: 9, letterSpacing: 2, color: t.textMuted, textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: isLarge ? 30 : 22, fontWeight: 700, color, fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: t.textFaint, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function PlaceholderKpi({ label, sub, theme }) {
  const t = THEMES[theme];
  return (
    <div style={{
      flex: 1, minWidth: 110,
      background: theme === "dark" ? "rgba(255,255,255,0.03)" : "#F8FAFC",
      border: `1px dashed ${t.cardBorder}`,
      borderRadius: 12, padding: "10px 12px", opacity: 0.6,
    }}>
      <div style={{ fontSize: 9, letterSpacing: 2, color: t.textFaint, textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: t.textFaint, fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>—</div>
      <div style={{ fontSize: 9, color: t.textFaint, marginTop: 3 }}>{sub || "Coming soon"}</div>
    </div>
  );
}

function SectionHeader({ color, label, theme }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
      <div style={{ width: 10, height: 10, borderRadius: 3, background: color }} />
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2.5, color, textTransform: "uppercase" }}>{label}</span>
    </div>
  );
}

// ─── Queue Health Banner ────────────────────────────────────────────────────

function QueueHealthBanner({ zoomQueues, onCallCount, availableCount, theme, timeStr }) {
  const t = THEMES[theme];
  const waiting = zoomQueues.totalWaiting || 0;

  let level, label, dotColor;
  if (waiting > 5 || (availableCount === 0 && onCallCount > 0 && waiting > 0)) {
    level = "red"; label = "QUEUE BACKING UP"; dotColor = "#EF4444";
  } else if (waiting > 2 || (onCallCount > 0 && availableCount <= 1 && waiting > 0)) {
    level = "yellow"; label = "HIGH CALL VOLUME"; dotColor = "#F59E0B";
  } else {
    level = "green"; label = "OPERATING NORMALLY"; dotColor = "#22C55E";
  }

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "8px 16px", borderRadius: 10,
      background: t.statusBarBg, border: `1px solid ${t.statusBarBorder}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: dotColor, boxShadow: `0 0 8px ${dotColor}88` }} />
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: t.text, textTransform: "uppercase" }}>{label}</span>
      </div>
      <span style={{ fontSize: 14, fontWeight: 700, color: "#00BEA8", fontFamily: "'DM Mono', monospace" }}>{timeStr}</span>
    </div>
  );
}

// ─── Live Tab Components ─────────────────────────────────────────────────────

function AgentCard({ agent, tick, expanded, theme }) {
  const t = THEMES[theme];
  const cfg = STATUS_CONFIG[agent.status] || STATUS_CONFIG.available;
  const elapsedSecs = agent.callStartTime ? (tick - agent.callStartTime) / 1000 : 0;
  const elapsed = elapsedSecs > 0 ? fmt(elapsedSecs) : null;
  const isActive = agent.status === "on_call" || agent.status === "ringing" || agent.status === "meeting";
  const nameParts = (agent.name || "").trim().split(" ");
  const firstName = nameParts[0] || "";
  const lastName = nameParts.slice(1).join(" ") || "";

  const isLong = elapsedSecs > 8 * 60;
  const isCritical = elapsedSecs > 15 * 60;
  const alertDotColor = isCritical ? "#DC2626" : isLong ? "#EF4444" : null;
  const dotColor = alertDotColor || cfg.dot;

  const direction = agent.callDirection;
  const dirColor = direction === "inbound" ? "#00BEA8" : "#038CF1";

  let cardBg, cardBorder;
  if (isCritical) {
    cardBg = t.alertBg; cardBorder = t.alertBorderColor;
  } else if (isLong) {
    cardBg = t.warnBg; cardBorder = t.warnBorderColor;
  } else if (isActive) {
    cardBg = t.cardActiveBg; cardBorder = t.cardActiveBorder;
  } else {
    cardBg = t.cardBg; cardBorder = t.cardBorder;
  }

  return (
    <div style={{
      padding: "12px 14px", borderRadius: 12,
      background: cardBg, border: `1px solid ${cardBorder}`,
      display: "flex", flexDirection: "column", gap: expanded ? 8 : 0,
      transition: "all 0.3s ease",
    }}>
      {/* Main row */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {/* Status dot */}
        <div style={{
          width: 14, height: 14, borderRadius: "50%", flexShrink: 0,
          background: dotColor, boxShadow: isActive ? `0 0 10px ${dotColor}88` : "none",
          animation: cfg.pulse ? "pulse 2s infinite" : "none",
        }} />

        {/* Name + team + status */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: t.text, lineHeight: 1.2 }}>{firstName}</span>
            {lastName && <span style={{ fontSize: 11, fontWeight: 400, color: t.textMuted }}>{lastName}</span>}
          </div>
          <div style={{ fontSize: 10, color: t.textMuted, marginTop: 1 }}>{agent.team}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: alertDotColor || cfg.color }}>{cfg.label}</span>
            {direction && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 8, fontWeight: 700, color: dirColor, background: dirColor + "20", borderRadius: 4, padding: "2px 5px" }}>
                <svg width="8" height="8" viewBox="0 0 8 8" style={{ transform: direction === "inbound" ? "rotate(135deg)" : "rotate(-45deg)" }}>
                  <path d="M1 4L4 1L7 4M4 1V7" stroke={dirColor} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {direction === "inbound" ? "IN" : "OUT"}
              </span>
            )}
          </div>
        </div>

        {/* Right side: elapsed or status label */}
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          {elapsed ? (
            <span style={{ fontSize: 16, fontWeight: 700, color: alertDotColor || cfg.color, fontFamily: "'DM Mono', monospace" }}>{elapsed}</span>
          ) : (
            <span style={{ fontSize: 11, fontWeight: 600, color: cfg.color }}>{cfg.label}</span>
          )}
        </div>
      </div>

      {/* Expanded metrics row */}
      {expanded && (
        <div style={{ display: "flex", gap: 12, borderTop: `1px solid ${t.divider}`, paddingTop: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 9, color: t.textFaint, textTransform: "uppercase", letterSpacing: 0.5 }}>Calls</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#038CF1", fontFamily: "'DM Mono', monospace" }}>{agent.callsToday || 0}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 9, color: t.textFaint, textTransform: "uppercase", letterSpacing: 0.5 }}>Longest</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#00BEA8", fontFamily: "'DM Mono', monospace" }}>{agent.longestCallToday ? fmtMins(agent.longestCallToday) : "—"}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusChips({ manualAgents, statusFilter, setStatusFilter, theme }) {
  const t = THEMES[theme];
  const chips = [
    { key: "on_call", label: "On Call", dot: "#FFB800", icon: null },
    { key: "ringing", label: "Ringing", dot: "#FFB800", icon: null },
    { key: "available", label: "At Desk", dot: "#22C55E", icon: null },
    { key: "meeting", label: "Meeting", dot: "#A78BFA", icon: null },
    { key: "offline", label: "Offline", dot: "#94A3B8", icon: null },
  ];

  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {chips.map(chip => {
        const count = manualAgents.filter(a => chip.key === "offline" ? a.status === "offline" : a.status === chip.key).length;
        const active = statusFilter === chip.key;
        return (
          <button key={chip.key} onClick={() => setStatusFilter(active ? null : chip.key)} style={{
            display: "flex", alignItems: "center", gap: 5, padding: "5px 12px",
            borderRadius: 20, border: `1px solid ${active ? chip.dot + "55" : t.cardBorder}`,
            background: active ? chip.dot + "18" : t.chipBg,
            cursor: "pointer", fontFamily: "'Poppins', sans-serif", transition: "all 0.2s ease",
          }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: chip.dot }} />
            <span style={{ fontSize: 11, fontWeight: active ? 700 : 500, color: active ? chip.dot : t.chipText }}>{chip.label}</span>
            {count > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: chip.dot, fontFamily: "'DM Mono', monospace" }}>{count}</span>}
          </button>
        );
      })}
    </div>
  );
}

function LiveTab({ manualAgents, tick, stats, zoomQueues, expanded, theme, statusFilter, setStatusFilter }) {
  const t = THEMES[theme];
  const onCallCount = manualAgents.filter(a => a.status === "on_call").length;
  const ringingCount = manualAgents.filter(a => a.status === "ringing").length;
  const availableCount = manualAgents.filter(a => a.status === "available").length;
  const offlineCount = manualAgents.filter(a => a.status === "offline").length;
  const totalActive = manualAgents.length - offlineCount;

  const filtered = statusFilter ? manualAgents.filter(a => a.status === statusFilter) : manualAgents;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Live KPIs — simplified to 3 */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <KpiTile label="On Call" value={onCallCount} color="#FF8C00" sub={ringingCount > 0 ? `${ringingCount} ringing` : "ongoing"} size="large" theme={theme} />
        <KpiTile label="Available" value={availableCount} color="#22C55E" sub={`of ${totalActive} online`} size="large" theme={theme} />
        <KpiTile label="Queue Waiting" value={zoomQueues.totalWaiting || 0} color={zoomQueues.totalWaiting > 3 ? "#FF3B5C" : zoomQueues.totalWaiting > 0 ? "#FFB800" : "#22C55E"} sub={`across all queues`} size="large" theme={theme} />
      </div>

      {/* Status chips */}
      <StatusChips manualAgents={manualAgents} statusFilter={statusFilter} setStatusFilter={setStatusFilter} theme={theme} />

      {/* Agent list */}
      {filtered.length === 0 ? (
        <div style={{ padding: "40px 0", textAlign: "center" }}>
          <div style={{ fontSize: 12, color: t.textFaint }}>{statusFilter ? "No agents with this status" : "No agents registered"}</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
          {filtered.map(agent => <AgentCard key={agent.id} agent={agent} tick={tick} expanded={expanded} theme={theme} />)}
        </div>
      )}
    </div>
  );
}

// ─── Performance Tab Components ──────────────────────────────────────────────

function HourlyChart({ hourlyVolume, theme }) {
  const t = THEMES[theme];
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
  const currentHour = now.getHours();
  const max = Math.max(...hourlyVolume, 1);
  const hours = [];
  for (let h = 7; h <= 20; h++) hours.push(h);

  return (
    <div style={{ background: t.tileBg, borderRadius: 8, padding: "12px 10px 6px", border: `1px solid ${t.cardBorder}` }}>
      <div style={{ fontSize: 9, letterSpacing: 2, color: t.textFaint, textTransform: "uppercase", marginBottom: 10 }}>Calls by Hour (CT)</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 120 }}>
        {hours.map(h => {
          const val = hourlyVolume[h] || 0;
          const barHeight = max > 0 ? Math.max((val / max) * 100, val > 0 ? 6 : 2) : 2;
          const isCurrent = h === currentHour;
          const isPast = h < currentHour;
          return (
            <div key={h} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, height: "100%", justifyContent: "flex-end" }}>
              {val > 0 && <span style={{ fontSize: 8, color: t.textMuted, fontFamily: "'DM Mono', monospace" }}>{val}</span>}
              <div style={{
                width: "100%", height: barHeight,
                background: isCurrent ? "#038CF1" : isPast ? "rgba(3,140,241,0.5)" : (theme === "dark" ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)"),
                borderRadius: 2, transition: "height 0.3s ease",
              }} />
              <span style={{ fontSize: 7, color: isCurrent ? "#038CF1" : t.textFaint, fontFamily: "'DM Mono', monospace" }}>
                {h > 12 ? h - 12 : h}{h >= 12 ? "p" : "a"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InsightsPanel({ manualAgents, stats, hourlyVolume, theme }) {
  const t = THEMES[theme];
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
  const colors = { warning: "#FFB800", good: "#22C55E", info: "#038CF1" };

  return (
    <div style={{ background: t.tileBg, border: `1px solid ${t.cardBorder}`, borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ fontSize: 9, letterSpacing: 2, color: t.textFaint, textTransform: "uppercase", marginBottom: 8 }}>Insights</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {insights.map((ins, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <div style={{
              width: 16, height: 16, borderRadius: "50%", flexShrink: 0, marginTop: 1,
              background: colors[ins.type] + "22", border: `1px solid ${colors[ins.type]}55`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 8, fontWeight: 800, color: colors[ins.type],
            }}>{icons[ins.type]}</div>
            <span style={{ fontSize: 11, color: t.textMuted, lineHeight: 1.4 }}>{ins.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AgentPerfRow({ agent, theme }) {
  const t = THEMES[theme];
  const cfg = STATUS_CONFIG[agent.status] || STATUS_CONFIG.available;
  const teamColor = TEAM_COLORS[agent.team] || "#666";
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1.4fr 80px 60px 60px 60px",
      gap: 8, alignItems: "center", padding: "7px 12px",
      background: theme === "dark" ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
      borderBottom: `1px solid ${t.cardBorder}`,
      fontSize: 11,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: cfg.dot }} />
        <span style={{ fontWeight: 600, color: t.text }}>{agent.name}</span>
        <span style={{ fontSize: 8, color: teamColor, fontWeight: 600 }}>{agent.team}</span>
      </div>
      <span style={{ fontSize: 9, fontWeight: 600, color: cfg.color, textTransform: "uppercase" }}>{cfg.label}</span>
      <span style={{ fontFamily: "'DM Mono', monospace", color: "#038CF1", textAlign: "center" }}>{agent.callsToday || 0}</span>
      <span style={{ fontFamily: "'DM Mono', monospace", color: "#00BEA8", textAlign: "center" }}>{agent.enrollmentsToday || 0}</span>
      <span style={{ fontFamily: "'DM Mono', monospace", color: "#FFD700", textAlign: "center" }}>{agent.greatCallsToday || 0}</span>
    </div>
  );
}

function PerformanceTab({ manualAgents, stats, hourlyVolume, theme }) {
  const t = THEMES[theme];
  const totalEnrollments = manualAgents.reduce((sum, a) => sum + (a.enrollmentsToday || 0), 0);
  const totalGreatCalls = manualAgents.reduce((sum, a) => sum + (a.greatCallsToday || 0), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

      {/* ── Today's Performance ─────────────────────────────── */}
      <div>
        <SectionHeader color="#FFB800" label="Today's Performance" theme={theme} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 10 }}>
              <KpiTile label="Calls Handled" value={stats.callsToday || 0} color="#038CF1" theme={theme} />
              <KpiTile
                label="Avg Handle Time"
                value={stats.avgHandleTime ? fmtMins(stats.avgHandleTime) : "—"}
                color={stats.avgHandleTime ? thresholdColor(stats.avgHandleTime, 480, 600) : t.textFaint}
                sub="Target: < 8 min" theme={theme}
              />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <KpiTile label="Longest Call" value={stats.longestCall ? fmtMins(stats.longestCall) : "—"} color={stats.longestCall > 900 ? "#FF3B5C" : "#038CF1"} sub={stats.longestCallAgent || (stats.longestCall ? "Agent pending" : "")} theme={theme} />
              <KpiTile label="Enrollments" value={totalEnrollments} color="#00BEA8" sub={`${stats.applicationsToday || 0} applications`} theme={theme} />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <PlaceholderKpi label="Abandonment Rate" sub="Needs Zoom Power Pack" theme={theme} />
              <PlaceholderKpi label="Avg Speed to Answer" sub="Needs Zoom Power Pack" theme={theme} />
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <HourlyChart hourlyVolume={hourlyVolume} theme={theme} />
            <InsightsPanel manualAgents={manualAgents} stats={stats} hourlyVolume={hourlyVolume} theme={theme} />
          </div>
        </div>
      </div>

      {/* ── Quality & Outcomes ──────────────────────────────── */}
      <div>
        <SectionHeader color="#038CF1" label="Quality & Outcomes" theme={theme} />
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <KpiTile label="Great Calls" value={totalGreatCalls} color="#FFD700" sub="Flagged in Salesforce" theme={theme} />
          <KpiTile
            label="Great Call Rate"
            value={stats.callsToday > 0 ? `${Math.round((totalGreatCalls / stats.callsToday) * 100)}%` : "—"}
            color="#FFD700" sub="Great calls / total calls" theme={theme}
          />
          <PlaceholderKpi label="First Call Resolution" sub="Needs CRM integration" theme={theme} />
          <PlaceholderKpi label="Transfers / Escalations" sub="Needs call routing data" theme={theme} />
          <PlaceholderKpi label="Repeat Callers (7d)" sub="Needs call history" theme={theme} />
        </div>
        {totalGreatCalls > 0 && (
          <div style={{ marginTop: 10, background: "rgba(255,215,0,0.06)", border: "1px solid rgba(255,215,0,0.20)", borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ fontSize: 9, letterSpacing: 2, color: "#FFD700", textTransform: "uppercase", marginBottom: 10 }}>Great Call Leaderboard</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {manualAgents.filter(a => (a.greatCallsToday || 0) > 0).sort((a, b) => b.greatCallsToday - a.greatCallsToday).map(a => (
                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,215,0,0.08)", borderRadius: 8, padding: "5px 10px" }}>
                  <span style={{ fontSize: 11, color: t.text, fontWeight: 600 }}>{a.name.split(" ")[0]} {a.name.split(" ")[1]?.[0]}.</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#FFD700", fontFamily: "'DM Mono', monospace" }}>{a.greatCallsToday}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Pipeline Impact ─────────────────────────────────── */}
      <div>
        <SectionHeader color="#A78BFA" label="Pipeline Impact" theme={theme} />
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <KpiTile label="Enrollments Today" value={totalEnrollments} color="#00BEA8" sub="From Salesforce" theme={theme} />
          <KpiTile
            label="Calls per Enrollment"
            value={totalEnrollments > 0 ? ((stats.callsToday || 0) / totalEnrollments).toFixed(1) : "—"}
            color="#038CF1"
            sub={totalEnrollments > 0 ? `${stats.callsToday} calls / ${totalEnrollments} enrolled` : "No enrollments yet"}
            theme={theme}
          />
          <PlaceholderKpi label="Avg Time: Applied to First Call" sub="Needs Salesforce integration" theme={theme} />
          <PlaceholderKpi label="Contact Rate" sub="% applicants reached" theme={theme} />
          <PlaceholderKpi label="Conversion: Contacted vs Not" sub="Needs Salesforce pipeline" theme={theme} />
        </div>
        {totalEnrollments > 0 && (
          <div style={{ marginTop: 10, background: "rgba(0,190,168,0.06)", border: "1px solid rgba(0,190,168,0.20)", borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ fontSize: 9, letterSpacing: 2, color: "#00BEA8", textTransform: "uppercase", marginBottom: 10 }}>Enrollment Leaderboard</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {manualAgents.filter(a => (a.enrollmentsToday || 0) > 0).sort((a, b) => b.enrollmentsToday - a.enrollmentsToday).map(a => (
                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(0,190,168,0.08)", borderRadius: 8, padding: "5px 10px" }}>
                  <span style={{ fontSize: 11, color: t.text, fontWeight: 600 }}>{a.name.split(" ")[0]} {a.name.split(" ")[1]?.[0]}.</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#00BEA8", fontFamily: "'DM Mono', monospace" }}>{a.enrollmentsToday}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Agent Performance Table ─────────────────────────── */}
      <div>
        <SectionHeader color="#6B5CE7" label="Agent Breakdown" theme={theme} />
        <div style={{ background: t.tileBg, border: `1px solid ${t.cardBorder}`, borderRadius: 10, overflow: "hidden" }}>
          <div style={{
            display: "grid", gridTemplateColumns: "1.4fr 80px 60px 60px 60px",
            gap: 8, padding: "8px 12px",
            background: theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)", fontSize: 8, fontWeight: 700,
            letterSpacing: 1.5, color: t.textFaint, textTransform: "uppercase",
          }}>
            <span>Agent</span><span>Status</span>
            <span style={{ textAlign: "center" }}>Calls</span>
            <span style={{ textAlign: "center" }}>Enroll</span>
            <span style={{ textAlign: "center" }}>Great</span>
          </div>
          {[...manualAgents].sort((a, b) => (b.callsToday || 0) - (a.callsToday || 0)).map(a => <AgentPerfRow key={a.id} agent={a} theme={theme} />)}
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
  const [expanded, setExpanded] = useState(false);
  const [theme, setTheme] = useState("dark");
  const [statusFilter, setStatusFilter] = useState(null);

  const t = THEMES[theme];

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
          color: ${t.text};
          min-height: 100vh;
          background: ${t.bg};
          background-attachment: fixed;
          transition: background 0.3s ease, color 0.3s ease;
        }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${t.scrollThumb}; border-radius: 3px; }
      `}</style>

      <div style={{ padding: "12px 20px 20px", display: "flex", flexDirection: "column", gap: 14, maxWidth: 1440, margin: "0 auto" }}>

        {/* ── Header ─────────────────────────────────────────── */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          position: "sticky", top: 0, zIndex: 100, padding: "8px 0 6px",
          background: t.headerBg,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src="/iteach-logo.png" alt="iTeach" style={{ height: 32 }} />
            <div style={{ borderLeft: `1px solid ${t.divider}`, paddingLeft: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: t.text }}>Support Center Command</div>
              <div style={{ fontSize: 8, letterSpacing: 3, color: t.textFaint, textTransform: "uppercase" }}>Live Operations Dashboard</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {/* Theme toggle */}
            <button onClick={() => setTheme(th => th === "dark" ? "light" : "dark")} style={{
              padding: "4px 10px", borderRadius: 14, border: `1px solid ${t.divider}`, cursor: "pointer",
              background: t.chipBg, color: t.textMuted,
              fontSize: 10, fontWeight: 600, fontFamily: "'Poppins', sans-serif", transition: "all 0.2s ease",
            }}>{theme === "dark" ? "Light" : "Dark"}</button>
            <div style={{ width: 1, height: 28, background: t.divider }} />
            <div style={{ display: "flex", alignItems: "center", gap: 4, background: connected ? "rgba(34,197,94,0.10)" : "rgba(255,59,92,0.10)", border: `1px solid ${connected ? "#22C55E" : "#FF3B5C"}44`, borderRadius: 16, padding: "3px 8px" }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: connected ? "#22C55E" : "#FF3B5C", animation: connected ? "pulse 2s infinite" : "none" }} />
              <span style={{ fontSize: 8, fontWeight: 600, color: connected ? "#22C55E" : "#FF3B5C", letterSpacing: 1 }}>{connected ? "LIVE" : "..."}</span>
            </div>
          </div>
        </div>

        {/* ── Queue Health Banner ──────────────────────────────── */}
        <QueueHealthBanner zoomQueues={zoomQueues} onCallCount={onCallCount} availableCount={availableCount} theme={theme} timeStr={timeStr} />

        {/* ── Tab Bar + Filters ───────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {/* Main tabs */}
          {[
            { key: "live", label: "Live", color: "#FF8C00" },
            { key: "performance", label: "Performance", color: "#038CF1" },
          ].map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
              padding: "6px 18px", borderRadius: 8, border: "none", cursor: "pointer",
              background: activeTab === tab.key ? `${tab.color}22` : "transparent",
              color: activeTab === tab.key ? tab.color : t.tabInactive,
              fontSize: 12, fontWeight: activeTab === tab.key ? 700 : 500,
              fontFamily: "'Poppins', sans-serif",
              borderBottom: activeTab === tab.key ? `2px solid ${tab.color}` : "2px solid transparent",
              transition: "all 0.2s ease",
            }}>{tab.label}</button>
          ))}

          <div style={{ width: 1, height: 20, background: t.divider, margin: "0 4px" }} />

          {/* Team filters */}
          {Object.keys(TEAM_LEADS).map(lead => (
            <button key={lead} onClick={() => setSelectedLead(lead)} style={{
              padding: "4px 10px", borderRadius: 14, border: "none", cursor: "pointer",
              background: selectedLead === lead ? t.chipActiveBg : "transparent",
              color: selectedLead === lead ? t.chipActiveText : t.tabInactive,
              fontSize: 10, fontWeight: selectedLead === lead ? 700 : 400,
              fontFamily: "'Poppins', sans-serif", transition: "all 0.2s ease",
            }}>{lead}</button>
          ))}

          {activeTab === "live" && (<>
            <div style={{ width: 1, height: 20, background: t.divider, margin: "0 4px" }} />
            <button onClick={() => setExpanded(e => !e)} style={{
              padding: "4px 10px", borderRadius: 14, border: `1px solid ${t.divider}`, cursor: "pointer",
              background: expanded ? "rgba(0,190,168,0.18)" : "transparent",
              color: expanded ? "#00BEA8" : t.tabInactive,
              fontSize: 10, fontWeight: expanded ? 700 : 400,
              fontFamily: "'Poppins', sans-serif", transition: "all 0.2s ease",
            }}>{expanded ? "Compact" : "Expanded"}</button>
          </>)}
        </div>

        {/* ── Tab Content ─────────────────────────────────────── */}
        {activeTab === "live" ? (
          <LiveTab manualAgents={manualAgents} tick={tick} stats={stats} zoomQueues={zoomQueues} expanded={expanded} theme={theme} statusFilter={statusFilter} setStatusFilter={setStatusFilter} />
        ) : (
          <PerformanceTab manualAgents={manualAgents} stats={stats} hourlyVolume={hourlyVolume} theme={theme} />
        )}

        {/* ── Footer ──────────────────────────────────────────── */}
        <div style={{ fontSize: 8, color: t.textFaint, textAlign: "center", padding: "4px 0" }}>
          iTeach Support Center  —  {manualAgents.length} agents  —  {dateStr}
        </div>
      </div>
    </>
  );
}
