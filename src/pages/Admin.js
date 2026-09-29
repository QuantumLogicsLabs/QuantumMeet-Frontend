import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import styles from "./Orgs.module.css";
import { API } from "../lib/api";


/** Lightweight admin console (E-406): owner-facing org overview. */
export default function AdminPage() {
  const { authFetch } = useAuth();
  const [orgs, setOrgs] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const fr = await fetch(`${API}/api/growth/features`);
        const feats = await fr.json();
        if (!feats.orgsEnabled) {
          setError("FEATURE_ORGS disabled");
          return;
        }
        const r = await authFetch(`${API}/api/growth/orgs`);
        const d = await r.json();
        setOrgs(Array.isArray(d) ? d : []);
      } catch {
        setError("Failed to load");
      }
    })();
  }, [authFetch]);

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <Link to="/orgs">← Workspaces</Link>
        <h1>Admin</h1>
      </header>
      {error && <div className={styles.err}>{error}</div>}
      <section className={styles.card}>
        <h2>Org overview</h2>
        <p className={styles.muted}>
          Owner/admin console stub — seats and members for workspaces you
          belong to.
        </p>
        <ul className={styles.list}>
          {orgs.map((o) => (
            <li key={o.orgId} className={styles.item} style={{ cursor: "default" }}>
              <strong>{o.name}</strong>
              <span>
                {o.members?.length || 0}/{o.seatLimit || 50} · owner{" "}
                <code>{o.ownerId?.slice(0, 8)}</code>
              </span>
            </li>
          ))}
        </ul>
        {!orgs.length && !error && (
          <p className={styles.muted}>No orgs to administer.</p>
        )}
      </section>
    </div>
  );
}
