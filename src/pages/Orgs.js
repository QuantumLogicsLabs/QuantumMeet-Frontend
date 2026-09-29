import React, { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import styles from "./Orgs.module.css";
import { API } from "../lib/api";


export default function OrgsPage() {
  const { user, authFetch, logout } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [orgs, setOrgs] = useState([]);
  const [name, setName] = useState("");
  const [inviteUserId, setInviteUserId] = useState("");
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [seatLimit, setSeatLimit] = useState(50);
  const [exportJson, setExportJson] = useState(null);

  const load = useCallback(async () => {
    try {
      const fr = await fetch(`${API}/api/growth/features`);
      const feats = await fr.json();
      setEnabled(!!feats.orgsEnabled);
      if (!feats.orgsEnabled) return;
      const r = await authFetch(`${API}/api/growth/orgs`);
      const d = await r.json();
      setOrgs(Array.isArray(d) ? d : []);
    } catch {
      setError("Failed to load orgs");
    }
  }, [authFetch]);

  useEffect(() => {
    load();
  }, [load]);

  const createOrg = async () => {
    setError("");
    setMsg("");
    const r = await authFetch(`${API}/api/growth/orgs`, {
      method: "POST",
      body: JSON.stringify({ name: name || "My workspace", seatLimit }),
    });
    const d = await r.json();
    if (!r.ok) {
      setError(d.error || "Create failed");
      return;
    }
    setName("");
    setMsg("Workspace created");
    await load();
    setSelected(d);
  };

  const invite = async () => {
    if (!selected || !inviteUserId.trim()) return;
    setError("");
    const r = await authFetch(
      `${API}/api/growth/orgs/${selected.orgId}/invite`,
      {
        method: "POST",
        body: JSON.stringify({ userId: inviteUserId.trim(), role: "member" }),
      },
    );
    const d = await r.json();
    if (!r.ok) {
      setError(d.error || "Invite failed");
      return;
    }
    setInviteUserId("");
    setMsg("Member invited");
    setSelected(d);
    await load();
  };

  const saveSeats = async () => {
    if (!selected) return;
    const r = await authFetch(`${API}/api/growth/orgs/${selected.orgId}`, {
      method: "PATCH",
      body: JSON.stringify({ seatLimit: Number(seatLimit) }),
    });
    const d = await r.json();
    if (!r.ok) {
      setError(d.error || "Update failed");
      return;
    }
    setSelected(d);
    setMsg("Seat limit updated");
    await load();
  };

  const exportMe = async () => {
    const r = await authFetch(`${API}/api/auth/me/export`);
    const d = await r.json();
    if (!r.ok) {
      setError(d.error || "Export failed");
      return;
    }
    setExportJson(d);
    const blob = new Blob([JSON.stringify(d, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `quantummeet-export-${user?.id || "me"}.json`;
    a.click();
  };

  const deleteMe = async () => {
    if (
      !window.confirm(
        "Delete your account and leave all orgs? This cannot be undone.",
      )
    )
      return;
    const r = await authFetch(`${API}/api/auth/me`, { method: "DELETE" });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setError(d.error || "Delete failed");
      return;
    }
    logout();
    window.location.href = "/";
  };

  if (!enabled) {
    return (
      <div className={styles.page}>
        <header className={styles.top}>
          <Link to="/">← Home</Link>
          <h1>Workspaces</h1>
        </header>
        <p className={styles.muted}>
          Orgs are disabled. Set <code>FEATURE_ORGS=1</code> on the API.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <Link to="/">← Home</Link>
        <h1>Workspaces</h1>
        <Link to="/admin">Admin</Link>
      </header>

      {error && <div className={styles.err}>{error}</div>}
      {msg && <div className={styles.ok}>{msg}</div>}

      <section className={styles.card}>
        <h2>Create workspace</h2>
        <div className={styles.row}>
          <input
            placeholder="Workspace name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="org-name"
          />
          <input
            type="number"
            min={1}
            value={seatLimit}
            onChange={(e) => setSeatLimit(e.target.value)}
            title="Seat limit"
            style={{ width: 88 }}
          />
          <button type="button" onClick={createOrg} data-testid="org-create">
            Create
          </button>
        </div>
      </section>

      <section className={styles.card}>
        <h2>Your workspaces</h2>
        {orgs.length === 0 && (
          <p className={styles.muted}>No workspaces yet.</p>
        )}
        <ul className={styles.list}>
          {orgs.map((o) => (
            <li key={o.orgId}>
              <button
                type="button"
                className={
                  selected?.orgId === o.orgId ? styles.active : styles.item
                }
                onClick={() => {
                  setSelected(o);
                  setSeatLimit(o.seatLimit || 50);
                }}
              >
                <strong>{o.name}</strong>
                <span>
                  {o.members?.length || 0}/{o.seatLimit || 50} seats
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {selected && (
        <section className={styles.card}>
          <h2>{selected.name}</h2>
          <p className={styles.muted}>
            Role:{" "}
            {selected.members?.find((m) => m.userId === user?.id)?.role || "—"}
          </p>
          <h3>Members</h3>
          <ul className={styles.members}>
            {(selected.members || []).map((m) => (
              <li key={m.userId}>
                <code>{m.userId}</code> · {m.role}
              </li>
            ))}
          </ul>
          <div className={styles.row}>
            <input
              placeholder="Invite by user id"
              value={inviteUserId}
              onChange={(e) => setInviteUserId(e.target.value)}
              data-testid="org-invite-id"
            />
            <button type="button" onClick={invite}>
              Invite
            </button>
          </div>
          <div className={styles.row}>
            <label>
              Seat limit{" "}
              <input
                type="number"
                min={1}
                value={seatLimit}
                onChange={(e) => setSeatLimit(e.target.value)}
              />
            </label>
            <button type="button" onClick={saveSeats}>
              Save seats
            </button>
          </div>
        </section>
      )}

      <section className={styles.card}>
        <h2>Your data</h2>
        <div className={styles.row}>
          <button type="button" onClick={exportMe}>
            Export my data
          </button>
          <button type="button" className={styles.danger} onClick={deleteMe}>
            Delete account
          </button>
        </div>
        {exportJson && (
          <pre className={styles.pre}>{JSON.stringify(exportJson, null, 2)}</pre>
        )}
      </section>
    </div>
  );
}
