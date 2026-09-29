/* eslint-disable react-hooks/exhaustive-deps */
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { createRealtimeClient } from '../lib/realtimeClient';
import styles from './Home.module.css';
import { API } from '../lib/api';


function getUserId() {
  let id = localStorage.getItem('qm_userId');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('qm_userId', id); }
  return id;
}

export default function Home() {
  const navigate  = useNavigate();
  const [tab, setTab] = useState('home');
  const [joinCode, setJoinCode]       = useState('');
  const [userName, setUserName]       = useState(() => localStorage.getItem('qm_userName') || '');
  const [meetingTitle, setMeetingTitle] = useState('');
  const [roomType, setRoomType]       = useState('public');
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');
  const [createdData, setCreatedData] = useState(null);
  const [copied, setCopied]           = useState(false);
  const [liveRooms, setLiveRooms]     = useState([]);
  const [liveLoading, setLiveLoading] = useState(false);

  // SecretMeet
  const [secretState, setSecretState] = useState('idle'); // idle | waiting | matched
  const [secretPartner, setSecretPartner] = useState('');
  const secretSocketRef = useRef(null);

  const userId = getUserId();

  const fetchLive = async () => {
    setLiveLoading(true);
    try {
      const res = await fetch(`${API}/api/rooms`);
      const data = await res.json();
      setLiveRooms(Array.isArray(data) ? data : []);
    } catch { setLiveRooms([]); }
    finally { setLiveLoading(false); }
  };

  useEffect(() => { if (tab === 'live') fetchLive(); }, [tab]);

  // Cleanup SecretMeet socket on tab change
  useEffect(() => {
    if (tab !== 'secret') {
      if (secretSocketRef.current) {
        secretSocketRef.current.emit('secret-leave-queue');
        secretSocketRef.current.disconnect();
        secretSocketRef.current = null;
      }
      setSecretState('idle');
    }
  }, [tab]);

  const handleCreate = async () => {
    if (!userName.trim()) { setError('Please enter your name first'); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch(`${API}/api/rooms`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, hostName: userName, isPublic: roomType === 'public', title: meetingTitle || `${userName}'s Meeting` }),
      });
      const data = await res.json();
      setCreatedData(data);
      localStorage.setItem('qm_userName', userName);
      localStorage.setItem(`qm_host_${data.roomId}`, '1');
      if (data.hostToken) {
        localStorage.setItem(`qm_room_token_${data.roomId}`, data.hostToken);
      }
    } catch { setError('Failed to create room. Is the server running?'); }
    finally { setLoading(false); }
  };

  const handleJoin = () => {
    if (!userName.trim()) { setError('Please enter your name'); return; }
    if (!joinCode.trim()) { setError('Enter a meeting code or link'); return; }
    localStorage.setItem('qm_userName', userName);
    const match = joinCode.match(/\/room\/([^/?#]+)/);
    navigate(`/room/${match ? match[1] : joinCode.trim()}`);
  };

  const handleGoToRoom = () => {
    if (!createdData) return;
    localStorage.setItem('qm_userName', userName);
    navigate(`/room/${createdData.roomId}`);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(createdData.link);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  // ── SecretMeet ──────────────────────────────────────────────────────────────
  const joinSecretQueue = () => {
    if (!userName.trim()) { setError('Enter your name first'); setTab('home'); return; }
    localStorage.setItem('qm_userName', userName);
    const s = createRealtimeClient({ userId, userName });
    secretSocketRef.current = s;

    s.on('secret-waiting', () => setSecretState('waiting'));
    s.on('secret-matched', ({ roomId, partnerName }) => {
      setSecretPartner(partnerName);
      setSecretState('matched');
      setTimeout(() => {
        s.disconnect();
        secretSocketRef.current = null;
        navigate(`/room/${roomId}`);
      }, 2000);
    });
    s.on('secret-cancelled', () => setSecretState('idle'));

    s.emit('secret-join-queue', { userId, userName });
  };

  const leaveSecretQueue = () => {
    secretSocketRef.current?.emit('secret-leave-queue');
    secretSocketRef.current?.disconnect();
    secretSocketRef.current = null;
    setSecretState('idle');
  };

  const reportSecretPartner = async () => {
    if (!secretPartner) return;
    try {
      await fetch(`${API}/api/secret/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          targetUserId: secretPartner,
          reason: 'user-report',
        }),
      });
    } catch { /* ignore */ }
  };

  const blockSecretPartner = async () => {
    if (!secretPartner) return;
    try {
      await fetch(`${API}/api/secret/block`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          targetUserId: secretPartner,
          reason: 'user-block',
        }),
      });
    } catch { /* ignore */ }
  };

  return (
    <div className={styles.page}>
      <div className={styles.bg} aria-hidden="true">
        <div className={styles.aurora} />
        <div className={styles.orb1} />
        <div className={styles.orb2} />
        <div className={styles.grid} />
        <div className={styles.vignette} />
      </div>

      <nav className={styles.nav}>
        <div className={styles.logo}>
          <img src="/logo.png" alt="" className={styles.logoImage} />
          <span>
            Quantum<strong>Meet</strong>
          </span>
        </div>
        <div className={styles.navTabs}>
          {[
            ["home", "Home"],
            ["live", "Live"],
            ["secret", "SecretMeet"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`${styles.navTab} ${tab === id ? styles.navTabActive : ""}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className={styles.navRight}>
          <button
            type="button"
            className={styles.navLink}
            onClick={() => navigate("/classrooms")}
            data-testid="nav-classrooms"
          >
            Classes
          </button>
          <button
            type="button"
            className={styles.navLink}
            onClick={() => navigate("/orgs")}
            data-testid="nav-orgs"
          >
            Orgs
          </button>
          {userName && (
            <div className={styles.userChip}>
              <div className={styles.userAvatar}>{userName[0].toUpperCase()}</div>
              <span>{userName}</span>
            </div>
          )}
        </div>
      </nav>

      {tab === "home" && (
        <main className={styles.main}>
          <section className={styles.hero}>
            <p className={styles.brandMark}>QuantumMeet</p>
            <h1 className={styles.title}>
              Meet at the
              <br />
              <span className={styles.gradient}>speed of light</span>
            </h1>
            <p className={styles.subtitle}>
              HD WebRTC calls in the browser — share a link and you&apos;re in.
            </p>
            <div className={styles.heroCtas}>
              <a className={styles.ctaGhost} href="#start">
                Start a call
              </a>
            </div>
          </section>

          <section id="start" className={styles.card} aria-label="Start or join a meeting">
            <div className={styles.inputGroup}>
              <label className={styles.inputLabel} htmlFor="home-name">
                Your name
              </label>
              <input
                id="home-name"
                className={styles.input}
                type="text"
                placeholder="e.g. Alex Johnson"
                data-testid="home-name"
                value={userName}
                onChange={(e) => {
                  setUserName(e.target.value);
                  setError("");
                }}
              />
            </div>

            {error && (
              <div className={styles.errorBox} data-testid="home-error" role="alert">
                {error}
              </div>
            )}

            {!createdData ? (
              <>
                <div className={styles.inputGroup}>
                  <label className={styles.inputLabel} htmlFor="home-title">
                    Meeting title <span className={styles.optional}>(optional)</span>
                  </label>
                  <input
                    id="home-title"
                    className={styles.input}
                    type="text"
                    placeholder="e.g. Weekly Standup"
                    data-testid="home-title"
                    value={meetingTitle}
                    onChange={(e) => setMeetingTitle(e.target.value)}
                  />
                </div>

                <div className={styles.typeToggle} role="group" aria-label="Room visibility">
                  {[
                    ["public", "Public", "Listed · anyone can join"],
                    ["private", "Private", "Invite only · host admits"],
                  ].map(([v, label, desc]) => (
                    <button
                      key={v}
                      type="button"
                      className={`${styles.typeBtn} ${
                        roomType === v
                          ? v === "public"
                            ? styles.typeBtnActive
                            : styles.typeBtnPrivate
                          : ""
                      }`}
                      onClick={() => setRoomType(v)}
                    >
                      <div className={styles.typeMeta}>
                        <strong>{label}</strong>
                        <span>{desc}</span>
                      </div>
                      {roomType === v && <span className={styles.typeCheck} aria-hidden="true" />}
                    </button>
                  ))}
                </div>

                <button
                  className={styles.btnPrimary}
                  onClick={handleCreate}
                  disabled={loading}
                  data-testid="home-create"
                  type="button"
                >
                  {loading ? <span className={styles.spinner} /> : "New meeting"}
                </button>

                <div className={styles.divider}>
                  <span>or join</span>
                </div>

                <div className={styles.joinRow}>
                  <input
                    className={styles.input}
                    type="text"
                    placeholder="Code or invite link"
                    data-testid="home-join-code"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                    style={{ flex: 1 }}
                    aria-label="Meeting code or invite link"
                  />
                  <button
                    className={styles.btnJoin}
                    onClick={handleJoin}
                    data-testid="home-join"
                    type="button"
                  >
                    Join
                  </button>
                </div>
              </>
            ) : (
              <div className={styles.linkBox} data-testid="home-created">
                <div className={styles.successIcon} aria-hidden="true">
                  ✓
                </div>
                <p className={styles.linkLabel}>Your meeting is ready</p>
                <div className={styles.linkCard}>
                  <code className={styles.linkText}>{createdData.link}</code>
                  <button className={styles.copyBtn} onClick={handleCopy} type="button" aria-label="Copy link">
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                {!createdData.isPublic && (
                  <div className={styles.privateNote}>Private — guests wait for your admit</div>
                )}
                <button
                  className={styles.btnPrimary}
                  onClick={handleGoToRoom}
                  data-testid="home-enter-room"
                  type="button"
                >
                  Enter room
                </button>
                <button className={styles.btnGhost} onClick={() => setCreatedData(null)} type="button">
                  Create another
                </button>
              </div>
            )}
          </section>
        </main>
      )}

      {tab === "live" && (
        <main className={styles.main}>
          <div className={styles.tabHeader}>
            <div>
              <h2 className={styles.tabTitle}>Live meetings</h2>
              <p className={styles.tabSubtitle}>Public rooms you can join right now</p>
            </div>
            <button
              className={styles.refreshBtn}
              onClick={fetchLive}
              disabled={liveLoading}
              type="button"
            >
              {liveLoading ? <span className={styles.spinnerSm} /> : null}
              Refresh
            </button>
          </div>

          {!userName.trim() && (
            <div className={styles.namePrompt}>
              <input
                className={styles.input}
                type="text"
                placeholder="Enter your name to join"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                aria-label="Your name"
              />
            </div>
          )}

          {liveLoading ? (
            <div className={styles.centerState}>
              <span className={styles.spinnerLg} />
              <span>Looking for live meetings…</span>
            </div>
          ) : liveRooms.length === 0 ? (
            <div className={styles.centerState}>
              <strong>No live meetings</strong>
              <span>Create a public meeting to show up here.</span>
            </div>
          ) : (
            <div className={styles.liveGrid}>
              {liveRooms.map((room) => (
                <div key={room.roomId} className={styles.liveCard}>
                  <div className={styles.liveCardTop}>
                    <div className={styles.liveDot} />
                    <span className={styles.liveLabel}>LIVE</span>
                    <span className={styles.liveCount}>{room.participantCount}</span>
                  </div>
                  <h3 className={styles.liveCardTitle}>
                    {room.title || `${room.hostName}'s Meeting`}
                  </h3>
                  <p className={styles.liveCardHost}>Hosted by {room.hostName}</p>
                  <code className={styles.liveCardId}>{room.roomId}</code>
                  <button
                    className={styles.joinLiveBtn}
                    type="button"
                    onClick={() => {
                      localStorage.setItem("qm_userName", userName);
                      navigate(`/room/${room.roomId}`);
                    }}
                  >
                    Join meeting
                  </button>
                </div>
              ))}
            </div>
          )}
        </main>
      )}

      {tab === "secret" && (
        <main className={styles.main}>
          <div className={styles.secretWrap}>
            <div className={styles.secretGlow} aria-hidden="true" />
            <div className={styles.secretCard}>
              <p className={styles.secretEyebrow}>Spontaneous</p>
              <h2 className={styles.secretTitle}>SecretMeet</h2>
              <p className={styles.secretDesc}>
                Pair with someone new for a one-to-one call. No profiles. No history. Just the moment.
              </p>

              {secretState === "idle" && (
                <>
                  {!userName.trim() && (
                    <input
                      className={styles.input}
                      type="text"
                      placeholder="Enter your name first"
                      value={userName}
                      onChange={(e) => setUserName(e.target.value)}
                      style={{ marginBottom: 12 }}
                      aria-label="Your name"
                    />
                  )}
                  <ul className={styles.secretRules}>
                    <li className={styles.secretRule}>Anonymous pairing</li>
                    <li className={styles.secretRule}>Instant P2P connect</li>
                    <li className={styles.secretRule}>Report or block anytime</li>
                  </ul>
                  <button
                    className={styles.secretBtn}
                    onClick={joinSecretQueue}
                    disabled={!userName.trim()}
                    type="button"
                  >
                    Find a match
                  </button>
                </>
              )}

              {secretState === "waiting" && (
                <div className={styles.secretWaiting}>
                  <div className={styles.secretPulse}>
                    <div className={styles.secretPulseRing} />
                    <div className={styles.secretPulseRing} style={{ animationDelay: "0.5s" }} />
                    <div className={styles.secretPulseRing} style={{ animationDelay: "1s" }} />
                    <span className={styles.secretPulseIcon} aria-hidden="true" />
                  </div>
                  <p className={styles.secretWaitText}>Finding your match…</p>
                  <p className={styles.secretWaitSub}>Hang tight — this usually takes seconds</p>
                  <button className={styles.secretCancelBtn} onClick={leaveSecretQueue} type="button">
                    Cancel
                  </button>
                </div>
              )}

              {secretState === "matched" && (
                <div className={styles.secretMatched}>
                  <h3>Match found</h3>
                  <p>
                    Connecting with <strong>{secretPartner}</strong>
                  </p>
                  <div className={styles.secretModRow}>
                    <button type="button" className={styles.secretCancelBtn} onClick={reportSecretPartner}>
                      Report
                    </button>
                    <button type="button" className={styles.secretCancelBtn} onClick={blockSecretPartner}>
                      Block
                    </button>
                  </div>
                  <div className={styles.matchedBar}>
                    <div className={styles.matchedBarFill} />
                  </div>
                  <p className={styles.matchedSub}>Joining room…</p>
                </div>
              )}
            </div>
          </div>
        </main>
      )}
    </div>
  );
}

