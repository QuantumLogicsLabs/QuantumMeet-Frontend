/* eslint-disable react-hooks/exhaustive-deps */
import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import styles from "./ClassroomDashboard.module.css";
import { API } from "../../lib/api";


const THEMES = {
  cyan: { accent: "#00e5ff", bg: "linear-gradient(135deg,#071828,#0a2a3a)" },
  violet: { accent: "#b197fc", bg: "linear-gradient(135deg,#0f0821,#1e1040)" },
  green: { accent: "#10e88a", bg: "linear-gradient(135deg,#041410,#0a2a1e)" },
  amber: { accent: "#ffbe3c", bg: "linear-gradient(135deg,#140f02,#2a1f0a)" },
  rose: { accent: "#ff7eb3", bg: "linear-gradient(135deg,#150508,#2a0a14)" },
};

export default function ClassroomDashboard() {
  const navigate = useNavigate();
  const { user, authFetch, logout } = useAuth();

  const [classrooms, setClassrooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    subject: "",
    section: "",
    theme: "cyan",
  });
  const [inviteCode, setInviteCode] = useState("");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchClassrooms = useCallback(async () => {
    setLoading(true);
    try {
      const r = await authFetch(`${API}/api/classrooms/mine`);
      const d = await r.json();
      setClassrooms(Array.isArray(d) ? d : []);
    } catch {
      setClassrooms([]);
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    fetchClassrooms();
  }, []);

  const handleCreate = async () => {
    if (!form.name.trim()) {
      setFormError("Classroom name is required");
      return;
    }
    setSubmitting(true);
    setFormError("");
    try {
      const r = await authFetch(`${API}/api/classrooms`, {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description,
          subject: form.subject,
          section: form.section,
          theme: form.theme,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setFormError(d.error || "Failed to create classroom");
        return;
      }
      setModal(null);
      setForm({
        name: "",
        description: "",
        subject: "",
        section: "",
        theme: "cyan",
      });
      navigate(`/classroom/${d.classroomId}`);
    } catch {
      setFormError("Server error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleJoin = async () => {
    if (!inviteCode.trim()) {
      setFormError("Enter an invite code");
      return;
    }
    setSubmitting(true);
    setFormError("");
    try {
      const r = await authFetch(`${API}/api/classrooms/join`, {
        method: "POST",
        body: JSON.stringify({ inviteCode: inviteCode.trim() }),
      });
      const d = await r.json();
      if (!r.ok) {
        setFormError(d.error || "Failed to join classroom");
        return;
      }
      setModal(null);
      setInviteCode("");
      navigate(`/classroom/${d.classroomId}`);
    } catch {
      setFormError("Server error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate("/login");
  };
  const currentName = user?.name || "";

  return (
    <div className={styles.page}>
      <nav className={styles.nav}>
        <div className={styles.navLogo}>
          <img
            src="/logo.png"
            alt="QuantumMeet"
            className={styles.logoIconImage}
          />
          <span>
            Quantum<strong>Meet</strong>
          </span>
        </div>
        <div className={styles.navRight}>
          {currentName && (
            <div className={styles.userChip}>
              <div className={styles.userAvatar}>
                {currentName[0].toUpperCase()}
              </div>
              <span>{currentName}</span>
            </div>
          )}
          <button className={styles.btnJoin} onClick={() => navigate("/")}>
            ← Meet
          </button>
          <button className={styles.btnJoin} onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </nav>

      <div className={styles.main}>
        <div className={styles.topBar}>
          <div className={styles.greeting}>
            <h1>
              {currentName
                ? `Hey, ${currentName.split(" ")[0]} 👋`
                : "Your Classrooms"}
            </h1>
            <p>
              {!loading &&
                `${classrooms.length} classroom${classrooms.length !== 1 ? "s" : ""} · `}
              {new Date().toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </p>
          </div>
          <div className={styles.topActions}>
            <button
              className={styles.btnJoin}
              onClick={() => {
                setModal("join");
                setFormError("");
              }}
            >
              🔗 Join Class
            </button>
            <button
              className={styles.btnCreate}
              onClick={() => {
                setModal("create");
                setFormError("");
              }}
            >
              + Create Class
            </button>
          </div>
        </div>

        {/* Feature 10: Skeleton screens replace spinner while loading */}
        {loading && (
          <div className={styles.grid}>
            {Array(6)
              .fill(0)
              .map((_, i) => (
                <div key={i} className={styles.skeletonCard} aria-hidden="true">
                  <div className={styles.skeletonBanner} />
                  <div className={styles.skeletonBody}>
                    <div
                      className={styles.skeletonLine}
                      style={{ width: "60%" }}
                    />
                    <div
                      className={styles.skeletonLine}
                      style={{ width: "40%" }}
                    />
                  </div>
                </div>
              ))}
          </div>
        )}

        {!loading && classrooms.length === 0 && (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>🎓</div>
            <h2>No classrooms yet</h2>
            <p>
              Create a new classroom or join one with an invite code from your
              teacher.
            </p>
            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <button
                className={styles.btnJoin}
                onClick={() => {
                  setModal("join");
                  setFormError("");
                }}
              >
                🔗 Join with Code
              </button>
              <button
                className={styles.btnCreate}
                onClick={() => {
                  setModal("create");
                  setFormError("");
                }}
              >
                + Create Classroom
              </button>
            </div>
          </div>
        )}

        {!loading && classrooms.length > 0 && (
          <div className={styles.grid}>
            {classrooms.map((c) => {
              const th = THEMES[c.theme || "cyan"];
              const isOwner = c.creatorId === user?.id;
              const students = (c.members || []).filter(
                (m) => m.role === "student",
              );
              return (
                <div
                  key={c.classroomId}
                  className={styles.classCard}
                  onClick={() => navigate(`/classroom/${c.classroomId}`)}
                >
                  {c.archived && (
                    <div className={styles.archivedBadge}>Archived</div>
                  )}
                  <div
                    className={styles.cardBanner}
                    style={{ background: th.bg }}
                  >
                    <div
                      className={styles.cardBannerGlow}
                      style={{
                        background: `radial-gradient(ellipse at 20% 50%, ${th.accent}25, transparent 70%)`,
                      }}
                    />
                    <div className={styles.cardBannerNoise} />
                    <div className={styles.cardBannerText}>{c.name[0]}</div>
                    {isOwner && (
                      <div
                        className={styles.cardTeacherBadge}
                        style={{ color: th.accent }}
                      >
                        👑 Teacher
                      </div>
                    )}
                  </div>
                  <div className={styles.cardBody}>
                    <div className={styles.cardTitle}>{c.name}</div>
                    <div className={styles.cardMeta}>
                      {[c.subject, c.section].filter(Boolean).join(" · ") ||
                        "General"}
                    </div>
                    <div className={styles.cardStats}>
                      <span className={styles.cardStat}>
                        👥 {students.length}
                      </span>
                      {c.inviteCode && (
                        <span
                          className={styles.cardStat}
                          style={{
                            color: th.accent,
                            borderColor: `${th.accent}30`,
                          }}
                        >
                          {c.inviteCode}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Modal */}
      {modal === "create" && (
        <div className={styles.modalOverlay} onClick={() => setModal(null)}>
          <div
            className={styles.modal}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <div className={styles.modalHeader}>
              <span className={styles.modalTitle} id="modal-title">
                Create Classroom
              </span>
              <button
                className={styles.modalClose}
                onClick={() => setModal(null)}
                aria-label="Close dialog"
              >
                ✕
              </button>
            </div>
            {formError && <div className={styles.formError}>{formError}</div>}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Class Name *</label>
              <input
                className={styles.formInput}
                placeholder="e.g. Advanced Mathematics"
                autoFocus
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
              />
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
              }}
            >
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Subject</label>
                <input
                  className={styles.formInput}
                  placeholder="e.g. Math"
                  value={form.subject}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, subject: e.target.value }))
                  }
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Section</label>
                <input
                  className={styles.formInput}
                  placeholder="e.g. Period 3"
                  value={form.section}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, section: e.target.value }))
                  }
                />
              </div>
            </div>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Description</label>
              <textarea
                className={styles.formTextarea}
                rows={2}
                placeholder="What is this class about?"
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Theme Color</label>
              <div className={styles.themeRow}>
                {Object.entries(THEMES).map(([t, v]) => (
                  <button
                    key={t}
                    className={`${styles.themeChip} ${form.theme === t ? styles.themeChipActive : ""}`}
                    style={{
                      borderColor: v.accent,
                      color: v.accent,
                      background: form.theme === t ? `${v.accent}15` : "",
                    }}
                    onClick={() => setForm((f) => ({ ...f, theme: t }))}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.modalActions}>
              <button
                className={styles.btnCancel}
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button
                className={styles.btnSubmit}
                onClick={handleCreate}
                disabled={submitting || !form.name.trim()}
              >
                {submitting ? "Creating…" : "Create Classroom"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Join Modal */}
      {modal === "join" && (
        <div className={styles.modalOverlay} onClick={() => setModal(null)}>
          <div
            className={styles.modal}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <div className={styles.modalHeader}>
              <span className={styles.modalTitle} id="modal-title">
                Join Classroom
              </span>
              <button
                className={styles.modalClose}
                onClick={() => setModal(null)}
                aria-label="Close dialog"
              >
                ✕
              </button>
            </div>
            {formError && <div className={styles.formError}>{formError}</div>}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Invite Code</label>
              <input
                className={styles.formInput}
                placeholder="Enter the code from your teacher"
                autoFocus
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleJoin()}
              />
            </div>
            <div className={styles.modalActions}>
              <button
                className={styles.btnCancel}
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button
                className={styles.btnSubmit}
                onClick={handleJoin}
                disabled={submitting || !inviteCode.trim()}
              >
                {submitting ? "Joining…" : "Join Classroom"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
