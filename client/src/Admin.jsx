import { useState, useEffect, useCallback } from "react";

const API_URL = import.meta.env.VITE_WS_URL?.replace("wss://", "https://").replace("ws://", "http://") || "http://localhost:3001";

const TEAMS = [
  "Admissions", "Texas Support", "National Support", "Lead Team",
  "Educational", "Relational", "Engagement", "Certification", "Curriculum",
];

const s = {
  page: { fontFamily: "'Poppins', sans-serif", color: "#fff", minHeight: "100vh", background: "linear-gradient(160deg, #110045 0%, #0D1E6B 45%, #043C96 100%)", padding: "20px 24px" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  title: { fontSize: 18, fontWeight: 700, letterSpacing: 2 },
  subtitle: { fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: 2 },
  card: { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 16, marginBottom: 16 },
  input: { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, padding: "8px 12px", color: "#fff", fontSize: 13, fontFamily: "'Poppins', sans-serif", width: "100%", outline: "none" },
  select: { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, padding: "8px 12px", color: "#fff", fontSize: 13, fontFamily: "'Poppins', sans-serif", width: "100%", outline: "none" },
  btn: { border: "none", borderRadius: 6, padding: "8px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'Poppins', sans-serif", transition: "all 0.2s" },
  btnPrimary: { background: "linear-gradient(135deg, #043C96, #038CF1)", color: "#fff" },
  btnDanger: { background: "rgba(255,59,92,0.15)", color: "#FF3B5C", border: "1px solid rgba(255,59,92,0.3)" },
  btnSave: { background: "rgba(0,190,168,0.15)", color: "#00BEA8", border: "1px solid rgba(0,190,168,0.3)" },
  btnCancel: { background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.5)" },
  label: { fontSize: 9, letterSpacing: 2, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", marginBottom: 4, display: "block" },
  row: { display: "grid", gridTemplateColumns: "1.5fr 1fr 0.8fr 0.8fr 80px", gap: 10, alignItems: "center", padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: 12 },
  rowHeader: { fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", background: "rgba(255,255,255,0.04)" },
  badge: (color) => ({ fontSize: 9, fontWeight: 700, color, background: color + "18", borderRadius: 10, padding: "2px 8px", display: "inline-block" }),
  toast: { position: "fixed", bottom: 20, right: 20, background: "#00BEA8", color: "#fff", padding: "10px 18px", borderRadius: 8, fontSize: 12, fontWeight: 600, zIndex: 1000, boxShadow: "0 4px 20px rgba(0,0,0,0.3)" },
};

const TEAM_COLORS = {
  "Admissions": "#038CF1", "Texas Support": "#00BEA8", "National Support": "#C1FD34",
  "Lead Team": "#038CF1", "Educational": "#00BEA8", "Relational": "#C1FD34",
  "Engagement": "#6B5CE7", "Certification": "#FF9F0A", "Curriculum": "#FF4466",
};

export default function Admin() {
  const [agents, setAgents] = useState([]);
  const [search, setSearch] = useState("");
  const [filterTeam, setFilterTeam] = useState("All");
  const [toast, setToast] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ id: "", name: "", team: "Admissions", extension: "", email: "" });

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/state`);
      const data = await res.json();
      const list = Object.values(data.agents || {}).filter(a => !a.autoRegistered).sort((a, b) => a.name.localeCompare(b.name));
      setAgents(list);
    } catch (e) { console.error("Fetch error:", e); }
  }, []);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  const handleAdd = async () => {
    if (!addForm.id || !addForm.name) return showToast("ID and Name are required");
    try {
      const res = await fetch(`${API_URL}/api/agents`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addForm),
      });
      if (res.ok) {
        showToast(`Added ${addForm.name}`);
        setAddForm({ id: "", name: "", team: "Admissions", extension: "", email: "" });
        setShowAdd(false);
        fetchAgents();
      } else {
        const err = await res.json();
        showToast(`Error: ${err.error}`);
      }
    } catch (e) { showToast("Network error"); }
  };

  const handleEdit = (agent) => {
    setEditingId(agent.id);
    setEditForm({ name: agent.name, team: agent.team, extension: agent.extension || "", email: agent.email || "" });
  };

  const handleSave = async () => {
    try {
      const res = await fetch(`${API_URL}/api/agents/${editingId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      if (res.ok) {
        showToast(`Updated ${editForm.name}`);
        setEditingId(null);
        fetchAgents();
      } else {
        const err = await res.json();
        showToast(`Error: ${err.error}`);
      }
    } catch (e) { showToast("Network error"); }
  };

  const handleDelete = async (agent) => {
    if (!confirm(`Remove ${agent.name}? This cannot be undone.`)) return;
    try {
      const res = await fetch(`${API_URL}/api/agents/${agent.id}`, { method: "DELETE" });
      if (res.ok) {
        showToast(`Removed ${agent.name}`);
        fetchAgents();
      }
    } catch (e) { showToast("Network error"); }
  };

  const filtered = agents.filter(a => {
    if (filterTeam !== "All" && a.team !== filterTeam) return false;
    if (search && !a.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div style={s.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        select option { background: #1a1a3e; color: #fff; }
      `}</style>

      {/* Header */}
      <div style={s.header}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img src="/iteach-logo.png" alt="iTeach" style={{ height: 28 }} />
            <span style={s.title}>Agent Manager</span>
          </div>
          <div style={{ ...s.subtitle, marginTop: 2 }}>{agents.length} agents registered</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={{ ...s.btn, ...s.btnPrimary }} onClick={() => setShowAdd(!showAdd)}>
            {showAdd ? "Cancel" : "+ Add Agent"}
          </button>
          <a href="/" style={{ ...s.btn, ...s.btnCancel, textDecoration: "none", display: "flex", alignItems: "center" }}>Dashboard</a>
        </div>
      </div>

      {/* Add Agent Form */}
      {showAdd && (
        <div style={s.card}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: "#038CF1", textTransform: "uppercase", marginBottom: 12 }}>Add New Agent</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={s.label}>Zoom User ID *</label>
              <input style={s.input} value={addForm.id} onChange={e => setAddForm({ ...addForm, id: e.target.value })} placeholder="e.g. d7F3hdgBR6u..." />
            </div>
            <div>
              <label style={s.label}>Full Name *</label>
              <input style={s.input} value={addForm.name} onChange={e => setAddForm({ ...addForm, name: e.target.value })} placeholder="First Last" />
            </div>
            <div>
              <label style={s.label}>Team</label>
              <select style={s.select} value={addForm.team} onChange={e => setAddForm({ ...addForm, team: e.target.value })}>
                {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={s.label}>Extension</label>
              <input style={s.input} value={addForm.extension} onChange={e => setAddForm({ ...addForm, extension: e.target.value })} placeholder="Optional" />
            </div>
            <div>
              <label style={s.label}>Email</label>
              <input style={s.input} value={addForm.email} onChange={e => setAddForm({ ...addForm, email: e.target.value })} placeholder="user@iteach.net" />
            </div>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button style={{ ...s.btn, ...s.btnPrimary, width: "100%" }} onClick={handleAdd}>Add Agent</button>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
        <input style={{ ...s.input, width: 220 }} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name..." />
        <select style={{ ...s.select, width: 160 }} value={filterTeam} onChange={e => setFilterTeam(e.target.value)}>
          <option value="All">All Teams</option>
          {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginLeft: 8 }}>{filtered.length} shown</span>
      </div>

      {/* Agent Table */}
      <div style={{ ...s.card, padding: 0, overflow: "hidden" }}>
        <div style={{ ...s.row, ...s.rowHeader }}>
          <span>Name</span><span>Team</span><span>Extension</span><span>Status</span><span></span>
        </div>
        {filtered.map(agent => (
          editingId === agent.id ? (
            <div key={agent.id} style={{ ...s.row, background: "rgba(3,140,241,0.08)" }}>
              <input style={{ ...s.input, fontSize: 12 }} value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
              <select style={{ ...s.select, fontSize: 12 }} value={editForm.team} onChange={e => setEditForm({ ...editForm, team: e.target.value })}>
                {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <input style={{ ...s.input, fontSize: 12 }} value={editForm.extension} onChange={e => setEditForm({ ...editForm, extension: e.target.value })} />
              <div />
              <div style={{ display: "flex", gap: 4 }}>
                <button style={{ ...s.btn, ...s.btnSave, padding: "4px 8px", fontSize: 10 }} onClick={handleSave}>Save</button>
                <button style={{ ...s.btn, ...s.btnCancel, padding: "4px 8px", fontSize: 10 }} onClick={() => setEditingId(null)}>X</button>
              </div>
            </div>
          ) : (
            <div key={agent.id} style={s.row}>
              <div>
                <span style={{ fontWeight: 600, color: "#fff" }}>{agent.name}</span>
                {agent.email && <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginLeft: 6 }}>{agent.email}</span>}
              </div>
              <span style={s.badge(TEAM_COLORS[agent.team] || "#666")}>{agent.team}</span>
              <span style={{ color: "rgba(255,255,255,0.5)", fontFamily: "'DM Mono', monospace", fontSize: 11 }}>{agent.extension || "—"}</span>
              <span style={{ fontSize: 9, fontWeight: 600, color: agent.status === "offline" ? "#4A5568" : agent.status === "on_call" ? "#FF8C00" : "#C1FD34", textTransform: "uppercase" }}>{agent.status}</span>
              <div style={{ display: "flex", gap: 4 }}>
                <button style={{ ...s.btn, ...s.btnSave, padding: "4px 8px", fontSize: 10 }} onClick={() => handleEdit(agent)}>Edit</button>
                <button style={{ ...s.btn, ...s.btnDanger, padding: "4px 8px", fontSize: 10 }} onClick={() => handleDelete(agent)}>Del</button>
              </div>
            </div>
          )
        ))}
        {filtered.length === 0 && (
          <div style={{ padding: 20, textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: 12 }}>No agents found</div>
        )}
      </div>

      {toast && <div style={s.toast}>{toast}</div>}
    </div>
  );
}
