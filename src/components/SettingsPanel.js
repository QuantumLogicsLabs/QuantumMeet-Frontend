import React, { useState } from "react";
import styles from "./SettingsPanel.module.css";
import { API } from "../lib/api";

export default function SettingsPanel({
  peers,
  socket,
  roomId,
  userId,
  isHost,
  onClose,
  wbPermissions,
  onWbPermChange,
}) {
  const [tab, setTab] = useState("participants");
  const [purgeState, setPurgeState] = useState("");
  const emit = (ev, data) => socket?.emit(ev, { roomId, ...data });

  const purgeRoom = async () => {
    if (
      !window.confirm(
        "Purge chat, knocks, presence, and signaling events for this room?",
      )
    )
      return;
    setPurgeState("working");
    try {
      const roomToken = localStorage.getItem(`qm_room_token_${roomId}`);
      const res = await fetch(`${API}/api/rooms/${roomId}/retention`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, roomToken }),
      });
      setPurgeState(res.ok ? "done" : "failed");
    } catch {
      setPurgeState("failed");
    }
  };

  return (
    <div
      className={styles.overlay}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <div className={styles.header}>
          <span className={styles.title} id="settings-title">
            ⚙️ Settings
          </span>
          <button
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        <div
          className={styles.tabs}
          role="tablist"
          aria-label="Settings sections"
        >
          {["participants", "room", "advanced"].map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={`${styles.tab} ${tab === t ? styles.tabActive : ""}`}
              onClick={() => setTab(t)}
            >
              {t === "participants"
                ? "👥 Participants"
                : t === "room"
                  ? "🏠 Room"
                  : "⚡ Advanced"}
            </button>
          ))}
        </div>

        <div className={styles.body}>
          {tab === "participants" && (
            <div
              className={styles.section}
              role="tabpanel"
              aria-label="Participants"
            >
              {isHost && (
                <div className={styles.hostActions}>
                  <span className={styles.sectionLabel}>Host actions</span>
                  <div className={styles.bulkBtns}>
                    <button
                      className={styles.bulkBtn}
                      onClick={() => emit("host-mute-all")}
                      aria-label="Mute all participants"
                    >
                      🔇 Mute everyone
                    </button>
                    <button
                      className={styles.bulkBtn}
                      onClick={() => emit("host-lower-all-hands")}
                      aria-label="Lower all raised hands"
                    >
                      ✋ Lower all hands
                    </button>
                  </div>
                </div>
              )}

              <span className={styles.sectionLabel}>In this call</span>
              {peers.length === 0 && (
                <p className={styles.empty}>No other participants yet.</p>
              )}
              {peers.map((p) => (
                <div key={p.socketId} className={styles.peerRow}>
                  <div className={styles.peerInfo}>
                    <div className={styles.peerAvatar} aria-hidden="true">
                      {p.userName?.[0]?.toUpperCase() || "?"}
                    </div>
                    <div className={styles.peerMeta}>
                      <span className={styles.peerName}>{p.userName}</span>
                      <span className={styles.peerStatus}>
                        {p.handRaised ? "✋ Hand raised · " : ""}
                        {p.audioMuted ? "🔇 Muted" : "🎙️ Live"} ·{" "}
                        {p.videoStopped ? "📵 No video" : "📷 Video on"}
                      </span>
                    </div>
                  </div>
                  {isHost && (
                    <div className={styles.peerControls}>
                      <button
                        className={styles.iconBtn}
                        title="Mute participant"
                        aria-label={`Mute ${p.userName}`}
                        onClick={() =>
                          emit("host-mute-user", { targetSocketId: p.socketId })
                        }
                      >
                        🔇
                      </button>
                      <button
                        className={styles.iconBtn}
                        title="Stop video"
                        aria-label={`Stop ${p.userName}'s video`}
                        onClick={() =>
                          emit("host-stop-video", {
                            targetSocketId: p.socketId,
                          })
                        }
                      >
                        📵
                      </button>
                      <button
                        className={`${styles.wbBtn} ${wbPermissions[p.socketId] === false ? styles.wbOff : styles.wbOn}`}
                        title="Toggle whiteboard access"
                        aria-label={`${wbPermissions[p.socketId] === false ? "Grant" : "Revoke"} whiteboard access for ${p.userName}`}
                        aria-pressed={wbPermissions[p.socketId] !== false}
                        onClick={() => {
                          const allowed = wbPermissions[p.socketId] !== false;
                          onWbPermChange(p.socketId, !allowed);
                          emit("host-wb-permission", {
                            targetSocketId: p.socketId,
                            allowed: !allowed,
                          });
                        }}
                      >
                        {wbPermissions[p.socketId] === false
                          ? "⬜ WB off"
                          : "⬜ WB on"}
                      </button>
                      <button
                        className={styles.wbBtn}
                        title="Grant transcription access"
                        aria-label={`Grant transcription to ${p.userName}`}
                        onClick={() =>
                          emit("host-grant-transcribe", {
                            targetSocketId: p.socketId,
                            allowed: true,
                          })
                        }
                      >
                        🎙 Transcribe
                      </button>
                      <button
                        className={`${styles.iconBtn} ${styles.kickBtn}`}
                        title="Remove participant"
                        aria-label={`Remove ${p.userName} from meeting`}
                        onClick={() =>
                          emit("kick-user", { targetSocketId: p.socketId })
                        }
                      >
                        🚫
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === "room" && (
            <div
              className={styles.section}
              role="tabpanel"
              aria-label="Room info"
            >
              <span className={styles.sectionLabel}>Room info</span>
              <div className={styles.infoRow}>
                <span>Room ID</span>
                <code className={styles.code}>{roomId}</code>
              </div>
              <div className={styles.infoRow}>
                <span>Link</span>
                <button
                  className={styles.copyLinkBtn}
                  aria-label="Copy meeting invite link to clipboard"
                  onClick={() =>
                    navigator.clipboard.writeText(window.location.href)
                  }
                >
                  📋 Copy invite link
                </button>
              </div>
              <div className={styles.infoRow}>
                <span>Participants</span>
                <span className={styles.badge}>{peers.length + 1}</span>
              </div>
              {isHost && (
                <div className={styles.infoRow} style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
                  <span className={styles.sectionLabel}>Retention</span>
                  <button
                    className={styles.bulkBtn}
                    type="button"
                    onClick={purgeRoom}
                    disabled={purgeState === "working"}
                  >
                    {purgeState === "working"
                      ? "Purging…"
                      : purgeState === "done"
                        ? "✓ Room data purged"
                        : purgeState === "failed"
                          ? "Purge failed — retry"
                          : "🗑 Purge room ephemeral data"}
                  </button>
                </div>
              )}
            </div>
          )}

          {tab === "advanced" && (
            <div
              className={styles.section}
              role="tabpanel"
              aria-label="Advanced settings and shortcuts"
            >
              <span className={styles.sectionLabel}>Keyboard shortcuts</span>
              <dl>
                {[
                  ["Ctrl+Z / Cmd+Z", "Undo (whiteboard)"],
                  ["Ctrl+Y / Cmd+Y", "Redo (whiteboard)"],
                  ["P", "Switch to pen"],
                  ["E", "Switch to eraser"],
                  ["Delete / Backspace", "Delete selected image"],
                  ["Ctrl+V", "Paste image into whiteboard"],
                ].map(([key, desc]) => (
                  <div key={key} className={styles.shortcutRow}>
                    <dt>
                      <code className={styles.kbd}>{key}</code>
                    </dt>
                    <dd>{desc}</dd>
                  </div>
                ))}
              </dl>

              <span className={styles.sectionLabel} style={{ marginTop: 16 }}>
                About
              </span>
              <div className={styles.about}>
                <span className={styles.aboutLogo}>
                  <img
                    src="/logo.png"
                    alt="QuantumMeet logo"
                    className={styles.aboutLogoImage}
                  />
                  QuantumMeet
                </span>
                <p>WebRTC · React · Node.js</p>
                <p>End-to-end encrypted peer connections via STUN/TURN.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
