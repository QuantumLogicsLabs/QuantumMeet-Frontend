/* eslint-disable react-hooks/exhaustive-deps */
import React, { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { createRealtimeClient } from "../lib/realtimeClient";
import { useWebRTC } from "../hooks/useWebRTC";
import { useMeetingRecorder } from "../hooks/useMeetingRecorder";
import { useSounds } from "../hooks/useSounds";
import VideoTile from "../components/VideoTile";
import ChatPanel from "../components/ChatPanel";
import Controls from "../components/Controls";
import Whiteboard from "../components/Whiteboard";
import PipWindow from "../components/PipWindow";
import DocumentPipPortal from "../components/DocumentPipPortal";
import SettingsPanel from "../components/SettingsPanel";
import FloatingVideos from "../components/FloatingVideos";
import TranscribePanel from "../components/TranscribePanel";
import BreakoutPanel from "../components/BreakoutPanel";
import PollPanel from "../components/PollPanel";
import QnAPanel from "../components/QnAPanel";
import styles from "./Room.module.css";
import { API } from "../lib/api";


export default function Room() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const classroomId = new URLSearchParams(location.search).get("classroom");

  // ── Identity ─────────────────────────────────────────────────────────────────
  const [userName, setUserName] = useState(
    () => localStorage.getItem("qm_userName") || "",
  );
  const [userId] = useState(() => {
    let id = localStorage.getItem("qm_userId");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("qm_userId", id);
    }
    return id;
  });
  const [meshCapDismissed, setMeshCapDismissed] = useState(false);
  const [isHost, setIsHost] = useState(
    () => !!localStorage.getItem(`qm_host_${roomId}`),
  );
  const isHostRef = useRef(isHost);
  useEffect(() => {
    isHostRef.current = isHost;
  }, [isHost]);

  // ── Username gate ────────────────────────────────────────────────────────────
  const [nameConfirmed, setNameConfirmed] = useState(
    () => !!localStorage.getItem("qm_userName"),
  );
  const [nameInput, setNameInput] = useState("");
  const [nameError, setNameError] = useState("");
  const confirmName = () => {
    if (!nameInput.trim()) {
      setNameError("Please enter your name");
      return;
    }
    localStorage.setItem("qm_userName", nameInput.trim());
    setUserName(nameInput.trim());
    setNameConfirmed(true);
  };

  // ── Core UI state ────────────────────────────────────────────────────────────
  const socketRef = useRef(null);
  const [socket, setSocket] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [whiteboardOpen, setWhiteboardOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reactionOpen, setReactionOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [unread, setUnread] = useState(0);
  const [chatOpenUnreadCount, setChatOpenUnreadCount] = useState(0);
  const [chatScrollTop, setChatScrollTop] = useState(null);
  const [copied, setCopied] = useState(false);
  const [pinnedId, setPinnedId] = useState(null);
  const [kicked, setKicked] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [layout, setLayout] = useState("grid");
  const [reactions, setReactions] = useState([]);

  // ── Feature panels ───────────────────────────────────────────────────────────
  const [transcribeOpen, setTranscribeOpen] = useState(false);
  const [breakoutOpen, setBreakoutOpen] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [qnaOpen, setQnaOpen] = useState(false);

  // ── Permissions ───────────────────────────────────────────────────────────────
  const [transcribePermitted, setTranscribePermitted] = useState(false);
  const [pollBadge, setPollBadge] = useState(0);
  const [qnaBadge, setQnaBadge] = useState(0);

  // ── Peer meta ─────────────────────────────────────────────────────────────────
  const [peerMeta, setPeerMeta] = useState({});
  const [wbPermissions, setWbPermissions] = useState({});
  const [wbAllowed, setWbAllowed] = useState(true);
  const [wbActive, setWbActive] = useState(false);
  const wbActiveTimerRef = useRef(null);

  // ── Private room ──────────────────────────────────────────────────────────────
  const [roomInfo, setRoomInfo] = useState(null);
  const [knockStatus, setKnockStatus] = useState(null);
  const [knockRequests, setKnockRequests] = useState([]);
  const hasJoined = useRef(false);
  const knockStatusRef = useRef(null);
  useEffect(() => {
    knockStatusRef.current = knockStatus;
  }, [knockStatus]);

  // ── PiP ───────────────────────────────────────────────────────────────────────
  const [pipVisible, setPipVisible] = useState(false);
  const [docPipWindow, setDocPipWindow] = useState(null);
  const pipDismissedRef = useRef(false);

  // ── Classroom session ─────────────────────────────────────────────────────────
  const sessionIdRef = useRef(null);

  // ── Feature 8: Reconnection failure ──────────────────────────────────────────
  const [connectionFailed, setConnectionFailed] = useState(false);

  // ── Refs for panel open state (prevent stale badge increments) ────────────────
  const pollOpenRef = useRef(pollOpen);
  useEffect(() => {
    pollOpenRef.current = pollOpen;
  }, [pollOpen]);
  const qnaOpenRef = useRef(qnaOpen);
  useEffect(() => {
    qnaOpenRef.current = qnaOpen;
  }, [qnaOpen]);

  // ── Refs for audio/video state (force controls run once, not on every toggle) ─
  const audioEnabledRef = useRef(true);
  const videoEnabledRef = useRef(true);

  // ── Ref for unread count (prevents stale closure in handleToggleChat) ─────────
  const unreadRef = useRef(0);
  useEffect(() => {
    unreadRef.current = unread;
  }, [unread]);

  // ── Visibility → PiP ─────────────────────────────────────────────────────────
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        if (!pipDismissedRef.current && !docPipWindow) setPipVisible(true);
      } else {
        setPipVisible(false);
        pipDismissedRef.current = false;
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [docPipWindow]);

  useEffect(() => {
    const onKicked = () => setKicked(true);
    window.addEventListener("qm-kicked", onKicked);
    return () => window.removeEventListener("qm-kicked", onKicked);
  }, []);

  // ── Classroom session lookup ──────────────────────────────────────────────────
  useEffect(() => {
    if (!classroomId || !isHost || !nameConfirmed) return;
    fetch(`${API}/api/classrooms/${classroomId}/sessions`)
      .then((r) => r.json())
      .then((sessions) => {
        if (!Array.isArray(sessions)) return;
        const active = sessions.find((s) => s.roomId === roomId && !s.endedAt);
        if (active) sessionIdRef.current = active._id;
      })
      .catch(() => {});
  }, [classroomId, isHost, nameConfirmed]);

  const saveSessionData = useCallback(async () => {
    if (!classroomId || !sessionIdRef.current) return;
    const chatPayload = messages.map((m) => ({
      userName: m.userName,
      message: m.message,
      timestamp: m.timestamp,
    }));
    await fetch(
      `${API}/api/classrooms/${classroomId}/sessions/${sessionIdRef.current}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endedAt: new Date().toISOString(),
          chatLog: chatPayload,
        }),
      },
    ).catch(() => {});
  }, [classroomId, messages]);

  // ── Sounds ────────────────────────────────────────────────────────────────────
  const { playJoin, playLeave, playMessage, playKnock } = useSounds();

  // ── Socket init ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!nameConfirmed) return;
    const s = createRealtimeClient({
      roomId,
      userId,
      userName,
      roomToken: localStorage.getItem(`qm_room_token_${roomId}`) || undefined,
    });
    socketRef.current = s;
    setSocket(s);

    s.on("chat-message", (msg) => {
      setMessages((p) => [...p, msg]);
      setChatOpen((prev) => {
        if (!prev) setUnread((u) => u + 1);
        return prev;
      });
      playMessage();
    });

    // Feature 6: receive chat history on join/rejoin
    s.on("chat-history", (history) => {
      if (Array.isArray(history) && history.length > 0) {
        setMessages(history);
      }
    });

    s.on("knock-request", ({ socketId, userName: kName, userId: kUserId }) => {
      setKnockRequests((prev) => {
        const filtered = prev.filter(
          (k) => k.userId !== kUserId && k.socketId !== socketId,
        );
        return [...filtered, { socketId, userName: kName, userId: kUserId }];
      });
      playKnock();
    });
    s.on("knock-accepted", () => {
      setKnockStatus("accepted");
      playJoin();
    });
    s.on("knock-rejected", () => {
      setKnockStatus("rejected");
      playKnock();
    });
    s.on("knock-cancelled", ({ socketId, userId: uid }) => {
      const id = socketId || uid;
      setKnockRequests((prev) =>
        prev.filter((k) => k.socketId !== id && k.userId !== id),
      );
    });

    s.on("force-mute", () => window.dispatchEvent(new Event("qm-force-mute")));
    s.on("force-unmute", () =>
      window.dispatchEvent(new Event("qm-force-unmute")),
    );
    s.on("force-stop-video", () =>
      window.dispatchEvent(new Event("qm-force-stop-video")),
    );
    s.on("wb-permission", ({ allowed }) => setWbAllowed(allowed));
    s.on("lower-hand", () => setHandRaised(false));

    s.on("peer-reaction", ({ emoji, x, y }) => spawnReaction(emoji, x, y));

    s.on("peer-audio-toggle", ({ socketId, enabled }) =>
      setPeerMeta((m) => ({
        ...m,
        [socketId]: { ...m[socketId], audioMuted: !enabled },
      })),
    );
    s.on("peer-video-toggle", ({ socketId, enabled }) =>
      setPeerMeta((m) => ({
        ...m,
        [socketId]: { ...m[socketId], videoStopped: !enabled },
      })),
    );
    s.on("peer-hand-raise", ({ socketId, userName: n }) =>
      setPeerMeta((m) => ({
        ...m,
        [socketId]: { ...m[socketId], handRaised: true, userName: n },
      })),
    );
    s.on("peer-hand-lower", ({ socketId }) =>
      setPeerMeta((m) => ({
        ...m,
        [socketId]: { ...m[socketId], handRaised: false },
      })),
    );
    s.on("user-joined", () => playJoin());
    s.on("user-left", ({ socketId }) => {
      playLeave();
      setPeerMeta((m) => {
        const n = { ...m };
        delete n[socketId];
        return n;
      });
    });
    s.on("user-rejoined", ({ socketId }) => {
      playJoin();
      setPeerMeta((m) => {
        const n = { ...m };
        delete n[socketId];
        return n;
      });
    });

    s.on("transcribe-permission", ({ allowed }) =>
      setTranscribePermitted(allowed),
    );

    // Badge only increments when panel is closed
    s.on("poll-new", () => {
      if (!pollOpenRef.current) setPollBadge((b) => b + 1);
    });
    s.on("qna-new", () => {
      if (!qnaOpenRef.current) setQnaBadge((b) => b + 1);
    });

    s.on("wb-drawing-start", () => {
      setWbActive(true);
      clearTimeout(wbActiveTimerRef.current);
      wbActiveTimerRef.current = setTimeout(() => setWbActive(false), 3000);
    });
    s.on("wb-drawing-stop", () => {
      clearTimeout(wbActiveTimerRef.current);
      setWbActive(false);
    });

    s.on("host-status-confirmed", ({ isHost: confirmed }) => {
      if (confirmed) {
        setIsHost(true);
        localStorage.setItem(`qm_host_${roomId}`, "1");
      }
    });

    // Feature 8: reconnection failure
    s.on("reconnect_failed", () => setConnectionFailed(true));

    s.on("connect", () => {
      if (hasJoined.current) {
        console.log("[Room] socket reconnected — rejoining room");
        clearAllPeersRef.current?.();
        const currentUserName =
          localStorage.getItem("qm_userName") || "Reconnected User";
        const currentUserId = localStorage.getItem("qm_userId") || userId;
        s.emit("rejoin-room", {
          roomId,
          userId: currentUserId,
          userName: currentUserName,
        });
      } else if (knockStatusRef.current === "knocking") {
        console.log("[Room] socket reconnected while knocking — re-knocking");
        const currentUserName = localStorage.getItem("qm_userName") || userName;
        const currentUserId = localStorage.getItem("qm_userId") || userId;
        s.emit("knock", {
          roomId,
          userId: currentUserId,
          userName: currentUserName,
        });
      }
    });

    return () => {
      clearTimeout(wbActiveTimerRef.current);
      s.disconnect();
    };
  }, [nameConfirmed, playJoin, playLeave, playMessage, playKnock]);

  // ── Room info ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!nameConfirmed) return;
    fetch(`${API}/api/rooms/${roomId}`)
      .then((r) => r.json())
      .then(setRoomInfo)
      .catch(() => setRoomInfo({ isPublic: true }));
  }, [roomId, nameConfirmed]);

  // ── WebRTC ────────────────────────────────────────────────────────────────────
  const {
    localStream,
    screenStream,
    peers,
    peerQuality, // Feature 9
    meshCapExceeded,
    meshSoftCap,
    audioEnabled,
    videoEnabled,
    screenSharing,
    isReconnecting,
    initLocalStream,
    toggleAudio,
    toggleVideo,
    toggleScreenShare,
    cleanup,
    clearAllPeers,
  } = useWebRTC({ socket, roomId, userId, userName });

  // Keep audioEnabled/videoEnabled refs in sync for force-mute handler
  useEffect(() => {
    audioEnabledRef.current = audioEnabled;
  }, [audioEnabled]);
  useEffect(() => {
    videoEnabledRef.current = videoEnabled;
  }, [videoEnabled]);

  const clearAllPeersRef = useRef(clearAllPeers);
  useEffect(() => {
    clearAllPeersRef.current = clearAllPeers;
  }, [clearAllPeers]);

  // ── Meeting recorder ──────────────────────────────────────────────────────────
  const { recording, duration, startRecording, stopRecording } =
    useMeetingRecorder({
      localStream,
      peers,
      roomId,
      classroomId,
      userId,
    });
  const handleRecord = useCallback(() => {
    if (recording) stopRecording();
    else startRecording();
  }, [recording, startRecording, stopRecording]);

  // ── Force controls (run once — reads state from refs) ─────────────────────────
  useEffect(() => {
    const onFM = () => {
      if (audioEnabledRef.current) toggleAudio();
    };
    const onFU = () => {
      if (!audioEnabledRef.current) toggleAudio();
    };
    const onFSV = () => {
      if (videoEnabledRef.current) toggleVideo();
    };
    window.addEventListener("qm-force-mute", onFM);
    window.addEventListener("qm-force-unmute", onFU);
    window.addEventListener("qm-force-stop-video", onFSV);
    return () => {
      window.removeEventListener("qm-force-mute", onFM);
      window.removeEventListener("qm-force-unmute", onFU);
      window.removeEventListener("qm-force-stop-video", onFSV);
    };
  }, [toggleAudio, toggleVideo]);

  // ── Join ──────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket || !roomInfo || hasJoined.current || !nameConfirmed) return;
    const doJoin = async () => {
      await initLocalStream();
      if (isHost || roomInfo.isPublic) {
        socket.emit("join-room", { roomId, userId, userName, isHost });
        hasJoined.current = true;
      } else {
        setKnockStatus("knocking");
        socket.emit("knock", { roomId, userId, userName });
      }
    };
    doJoin();
  }, [socket, roomInfo, nameConfirmed]);

  useEffect(() => {
    if (knockStatus !== "accepted" || hasJoined.current || !socket) return;
    socket.emit("join-room", { roomId, userId, userName, isHost: false });
    hasJoined.current = true;
    setKnockStatus(null);
  }, [knockStatus, socket]);

  // ── Auto-unpin departed peer ──────────────────────────────────────────────────
  useEffect(() => {
    if (
      pinnedId &&
      pinnedId !== "local" &&
      !peers.some((p) => p.socketId === pinnedId) &&
      pinnedId !== "screen-local" &&
      !peers.some((p) => `screen-${p.socketId}` === pinnedId)
    )
      setPinnedId(null);
  }, [peers, pinnedId]);

  // ── Reactions ─────────────────────────────────────────────────────────────────
  const spawnReaction = useCallback((emoji, x, y) => {
    const id = crypto.randomUUID();
    setReactions((r) => [
      ...r,
      {
        id,
        emoji,
        x: x ?? Math.random() * 80 + 10,
        y: y ?? Math.random() * 60 + 20,
      },
    ]);
    setTimeout(() => setReactions((r) => r.filter((rx) => rx.id !== id)), 3000);
  }, []);

  const sendReaction = useCallback(
    (emoji) => {
      const x = Math.random() * 80 + 10;
      const y = Math.random() * 60 + 20;
      spawnReaction(emoji, x, y);
      socketRef.current?.emit("room-reaction", { roomId, emoji, x, y });
      setReactionOpen(false);
    },
    [roomId, spawnReaction],
  );

  // ── Leave ─────────────────────────────────────────────────────────────────────
  const handleLeave = useCallback(async () => {
    await saveSessionData();
    cleanup();
    socketRef.current?.disconnect();
    navigate(classroomId ? `/classroom/${classroomId}` : "/");
  }, [saveSessionData, cleanup, navigate, classroomId]);

  const handlePin = useCallback(
    (sid) => setPinnedId((p) => (p === sid ? null : sid)),
    [],
  );
  const handleKickUser = useCallback(
    (sid) =>
      socketRef.current?.emit("kick-user", { roomId, targetSocketId: sid }),
    [roomId],
  );

  const admitUser = (sid) => {
    socketRef.current?.emit("admit-user", { roomId, socketId: sid });
    setKnockRequests((p) => p.filter((k) => k.socketId !== sid));
  };
  const rejectUser = (sid) => {
    socketRef.current?.emit("reject-user", { roomId, socketId: sid });
    setKnockRequests((p) => p.filter((k) => k.socketId !== sid));
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const sendMessage = useCallback(
    (text) => {
      if (!socket || !text.trim()) return;
      socket.emit("chat-message", { roomId, message: text, userName, userId });
    },
    [socket, roomId, userName, userId],
  );

  const handleToggleDocPip = async () => {
    if (docPipWindow) {
      docPipWindow.close();
      return;
    }
    if (!("documentPictureInPicture" in window)) {
      console.warn(
        "Document Picture-in-Picture API is not supported in this browser.",
      );
      return;
    }
    try {
      const pipWin = await window.documentPictureInPicture.requestWindow({
        width: 400,
        height: 500,
      });
      [...document.styleSheets].forEach((ss) => {
        try {
          const cssRules = [...ss.cssRules].map((r) => r.cssText).join("");
          const style = document.createElement("style");
          style.textContent = cssRules;
          pipWin.document.head.appendChild(style);
        } catch {
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.type = ss.type;
          link.media = ss.media;
          link.href = ss.href;
          pipWin.document.head.appendChild(link);
        }
      });
      Object.assign(pipWin.document.body.style, {
        margin: "0",
        padding: "0",
        backgroundColor: "#1e1e1e",
        color: "#ffffff",
        fontFamily: "system-ui, sans-serif",
        overflow: "hidden",
      });
      pipWin.addEventListener("pagehide", () => setDocPipWindow(null));
      setDocPipWindow(pipWin);
    } catch (err) {
      console.error("Failed to open Document PiP:", err);
    }
  };

  // handleToggleChat reads unread from ref to avoid stale closure
  const handleToggleChat = useCallback(() => {
    setChatOpen((prev) => {
      if (!prev) {
        setChatOpenUnreadCount(unreadRef.current);
        setUnread(0);
      }
      return !prev;
    });
  }, []);

  const handleRaiseHand = useCallback(() => {
    setHandRaised((prev) => {
      const next = !prev;
      if (next) socketRef.current?.emit("raise-hand", { roomId, userName });
      else socketRef.current?.emit("lower-hand", { roomId });
      return next;
    });
  }, [roomId, userName]);

  // ── Enriched peers — includes quality from useWebRTC ─────────────────────────
  const enrichedPeers = peers.map((p) => ({
    ...p,
    audioMuted: peerMeta[p.socketId]?.audioMuted || false,
    videoStopped: peerMeta[p.socketId]?.videoStopped || false,
    handRaised: peerMeta[p.socketId]?.handRaised || false,
    quality: peerQuality[p.socketId] || null, // Feature 9
  }));

  // ── Wait screens ──────────────────────────────────────────────────────────────
  if (!nameConfirmed)
    return (
      <div className={styles.waitScreen}>
        <div className={styles.waitCard}>
          <div className={styles.waitLogo}>
            <img
              src="/logo.png"
              alt="QuantumMeet"
              className={styles.waitLogoImage}
            />{" "}
            QuantumMeet
          </div>
          <h2>What's your name?</h2>
          <p>Enter your display name to join this meeting.</p>
          <input
            className={styles.waitInput}
            type="text"
            placeholder="Your name"
            value={nameInput}
            autoFocus
            onChange={(e) => {
              setNameInput(e.target.value);
              setNameError("");
            }}
            onKeyDown={(e) => e.key === "Enter" && confirmName()}
          />
          {nameError && <p className={styles.waitError}>{nameError}</p>}
          <button className={styles.waitJoinBtn} onClick={confirmName}>
            Join Meeting →
          </button>
          <button className={styles.waitLeave} onClick={() => navigate("/")}>
            ← Back
          </button>
        </div>
      </div>
    );

  if (kicked)
    return (
      <div className={styles.waitScreen}>
        <div className={styles.waitCard}>
          <span style={{ fontSize: 48 }}>🚫</span>
          <h2>You were removed</h2>
          <p>The host removed you from this meeting.</p>
          <button className={styles.waitJoinBtn} onClick={() => navigate("/")}>
            Go home
          </button>
        </div>
      </div>
    );

  if (knockStatus === "knocking")
    return (
      <div className={styles.waitScreen}>
        <div className={styles.waitCard} data-testid="knock-waiting">
          <div className={styles.waitSpinner} />
          <h2>Waiting to be admitted</h2>
          <p>The host will let you in shortly.</p>
          <code className={styles.waitRoom}>{roomId}</code>
          <button
            className={styles.waitLeave}
            onClick={() => {
              socketRef.current?.emit("cancel-knock", { roomId, userId });
              setKnockStatus(null);
              navigate("/");
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );

  if (knockStatus === "rejected")
    return (
      <div className={styles.waitScreen}>
        <div className={styles.waitCard}>
          <span style={{ fontSize: 48 }}>🚫</span>
          <h2>Entry denied</h2>
          <p>The host declined your request.</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button
              className={styles.waitJoinBtn}
              onClick={() => {
                setKnockStatus("knocking");
                socketRef.current?.emit("knock", { roomId, userId, userName });
              }}
            >
              Knock again
            </button>
            <button className={styles.waitLeave} onClick={() => navigate("/")}>
              Go back
            </button>
          </div>
        </div>
      </div>
    );

  // ── Layout helpers ────────────────────────────────────────────────────────────
  const allParticipants = [
    {
      socketId: "local",
      userName,
      stream: localStream,
      isLocal: true,
      isScreen: false,
    },
    ...(screenSharing && screenStream
      ? [
          {
            socketId: "screen-local",
            userName: userName + "'s screen",
            stream: screenStream,
            isLocal: false,
            isScreen: true,
          },
        ]
      : []),
    ...peers.flatMap((p) => [
      { ...p, isLocal: false, isScreen: false },
      ...(p.screenStream
        ? [
            {
              socketId: `screen-${p.socketId}`,
              userName: p.userName + "'s screen",
              stream: p.screenStream,
              isLocal: false,
              isScreen: true,
            },
          ]
        : []),
    ]),
  ];
  const pinnedP = pinnedId
    ? allParticipants.find((p) => p.socketId === pinnedId)
    : null;
  const others = pinnedP
    ? allParticipants.filter((p) => p.socketId !== pinnedId)
    : allParticipants;
  const n = allParticipants.length;
  const gridClass =
    n === 1
      ? styles.grid1
      : n === 2
        ? styles.grid2
        : n === 3
          ? styles.grid3
          : n === 4
            ? styles.grid4
            : n <= 6
              ? styles.grid6
              : styles.gridMany;
  const raisedHands = enrichedPeers.filter((p) => p.handRaised);

  const tileAudio = (p) => {
    if (p.isLocal) return audioEnabled;
    if (p.isScreen) return true;
    return peerMeta[p.socketId] ? !peerMeta[p.socketId].audioMuted : true;
  };
  const tileVideo = (p) => {
    if (p.isLocal) return videoEnabled;
    if (p.isScreen) return true;
    return peerMeta[p.socketId] ? !peerMeta[p.socketId].videoStopped : true;
  };
  // Feature 9: helper to get quality for a tile (only remote non-screen tiles)
  const tileQuality = (p) =>
    p.isLocal || p.isScreen ? null : peerQuality[p.socketId] || null;

  const VideoTileEl = (p, extraProps = {}) => (
    <VideoTile
      key={p.socketId}
      stream={p.stream}
      userName={p.userName}
      isLocal={p.isLocal}
      isScreen={p.isScreen || false}
      audioEnabled={tileAudio(p)}
      videoEnabled={tileVideo(p)}
      isPinned={pinnedId === p.socketId}
      onPin={() => handlePin(p.socketId)}
      isHost={isHost}
      onKick={p.isLocal ? null : () => handleKickUser(p.socketId)}
      quality={tileQuality(p)}
      {...extraProps}
    />
  );

  return (
    <div className={styles.room}>
      {/* Floating emoji reactions */}
      {reactions.map((r) => (
        <div
          key={r.id}
          className={styles.reaction}
          style={{ left: `${r.x}%`, top: `${r.y}%` }}
        >
          {r.emoji}
        </div>
      ))}

      {/* Feature 8: Connection lost overlay */}
      {connectionFailed && (
        <div className={styles.reconnectOverlay}>
          <div className={styles.reconnectCard}>
            <span style={{ fontSize: 44 }}>📡</span>
            <p style={{ fontWeight: 700, fontSize: 16, margin: 0 }}>
              Connection lost
            </p>
            <p
              style={{
                color: "var(--text-2)",
                fontSize: 13,
                margin: "4px 0 0",
              }}
            >
              Could not reconnect to the meeting.
            </p>
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <button
                onClick={() => window.location.reload()}
                style={{
                  padding: "10px 22px",
                  background: "rgba(0,229,255,0.12)",
                  border: "1px solid rgba(0,229,255,0.3)",
                  color: "#00e5ff",
                  borderRadius: 9,
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                🔄 Try Again
              </button>
              <button
                onClick={() => navigate("/")}
                style={{
                  padding: "10px 22px",
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "#94a3b8",
                  borderRadius: 9,
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                Leave
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reconnecting overlay */}
      {isReconnecting && !connectionFailed && (
        <div className={styles.reconnectOverlay}>
          <div className={styles.reconnectCard}>
            <div className={styles.reconnectSpinner} />
            <p>Reconnecting to meeting…</p>
          </div>
        </div>
      )}

      {meshCapExceeded && !meshCapDismissed && (
        <div
          style={{
            position: "absolute",
            top: 56,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 40,
            display: "flex",
            alignItems: "center",
            gap: 10,
            maxWidth: "min(520px, 92vw)",
            padding: "8px 12px",
            borderRadius: 10,
            background: "rgba(15,23,42,.92)",
            border: "1px solid rgba(251,191,36,.35)",
            color: "var(--amber-text, #ffd27a)",
            fontSize: 13,
            boxShadow: "0 8px 24px rgba(0,0,0,.35)",
          }}
          role="status"
        >
          <span style={{ flex: 1 }}>
            {isHost
              ? `Mesh soft-cap (~${meshSoftCap} peers) reached — ask fewer people to enable video for better quality. Validated host guidance: prefer ≤${Math.max(2, meshSoftCap - 2)} cameras.`
              : `Room is near mesh capacity (~${meshSoftCap}). Video may degrade — turn off camera if quality drops.`}
          </span>
          <button
            type="button"
            onClick={() => setMeshCapDismissed(true)}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--amber-text, #ffd27a)",
              cursor: "pointer",
              fontSize: 16,
              lineHeight: 1,
            }}
            aria-label="Dismiss mesh capacity warning"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Topbar ── */}
      <div className={styles.topbar}>
        <div className={styles.logo}>
          <img
            src="/logo.png"
            alt="QuantumMeet"
            className={styles.logoIconImage}
          />
          <span>
            Quantum<strong>Meet</strong>
          </span>
          {classroomId && (
            <span className={styles.classroomPill}>🎓 Class</span>
          )}
        </div>
        <div className={styles.roomInfo}>
          {roomInfo?.isPublic ? (
            <span className={styles.publicPill}>🌐 Public</span>
          ) : (
            roomInfo && <span className={styles.privatePill}>🔒 Private</span>
          )}
          <span className={styles.roomId}>{roomId}</span>
          <button
            className={styles.copyBtn}
            onClick={handleCopyLink}
            aria-label={copied ? "Room link copied" : "Copy room link"}
          >
            {copied ? "✓ Copied" : "⎘ Copy"}
          </button>
          {isHost && <span className={styles.hostPill}>👑 Host</span>}
        </div>
        <div className={styles.topRight}>
          <div className={styles.layoutSwitch}>
            {[
              ["grid", "⊞", "Grid layout"],
              ["spotlight", "◉", "Spotlight layout"],
              ["sidebar", "⊡", "Sidebar layout"],
            ].map(([l, icon, label]) => (
              <button
                key={l}
                className={`${styles.layoutBtn} ${layout === l ? styles.layoutBtnActive : ""}`}
                onClick={() => {
                  setLayout(l);
                  setPinnedId(null);
                }}
                title={label}
                aria-label={label}
                aria-pressed={layout === l}
              >
                {icon}
              </button>
            ))}
          </div>
          {recording && (
            <span className={styles.recBadge}>
              <span className={styles.recDot} />
              {String(Math.floor(duration / 60)).padStart(2, "0")}:
              {String(duration % 60).padStart(2, "0")}
            </span>
          )}
          <div className={styles.liveDot} />
          <span className={styles.participantCount}>{n} in call</span>
          {pinnedId && (
            <button
              className={styles.unpinAllBtn}
              onClick={() => setPinnedId(null)}
              aria-label="Unpin pinned participant"
            >
              📌 Unpin
            </button>
          )}
          {handRaised && <span className={styles.handBadge}>✋</span>}
        </div>
      </div>

      {/* Raised hand toasts */}
      {raisedHands.length > 0 && (
        <div className={styles.handNotifications}>
          {raisedHands.map((p) => (
            <div key={p.socketId} className={styles.handNote}>
              ✋ <strong>{p.userName}</strong> raised their hand
            </div>
          ))}
        </div>
      )}

      {/* Knock requests (host) */}
      {isHost && knockRequests.length > 0 && (
        <div className={styles.knockPanel}>
          <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>
            {knockRequests.length} waiting
          </div>
          {knockRequests.map((k) => (
            <div key={k.socketId} className={styles.knockItem}>
              <span>
                🔔 <strong>{k.userName}</strong> wants to join
              </span>
              <div className={styles.knockBtns}>
                <button
                  className={styles.admitBtn}
                  onClick={() => admitUser(k.socketId)}
                >
                  Admit
                </button>
                <button
                  className={styles.rejectBtn}
                  onClick={() => rejectUser(k.socketId)}
                >
                  Deny
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Video area ── */}
      {layout === "spotlight" && allParticipants.length > 0 ? (
        <div className={styles.spotlightLayout}>
          <div className={styles.spotlightMain}>
            {(() => {
              const sp = pinnedP || allParticipants[0];
              return VideoTileEl(sp, {
                isPinned: !!pinnedP,
                onPin: () => handlePin(sp.socketId),
              });
            })()}
          </div>
          <div className={styles.spotlightStrip}>
            {allParticipants
              .slice(pinnedP ? 0 : 1)
              .filter((p) => p.socketId !== pinnedP?.socketId)
              .map((p) => (
                <div key={p.socketId} className={styles.stripTile}>
                  {VideoTileEl(p)}
                </div>
              ))}
          </div>
        </div>
      ) : layout === "sidebar" ? (
        <div className={styles.pinnedLayout}>
          <div className={styles.pinnedMain}>
            {(() => {
              const sp = pinnedP || allParticipants[0];
              return VideoTileEl(sp, {
                isPinned: !!pinnedP,
                onPin: () => handlePin(sp.socketId),
              });
            })()}
          </div>
          <div className={styles.pinnedSidebar}>
            {allParticipants
              .filter(
                (p) =>
                  p.socketId !==
                  (pinnedP?.socketId || allParticipants[0]?.socketId),
              )
              .map((p) => VideoTileEl(p))}
          </div>
        </div>
      ) : pinnedP ? (
        <div className={styles.pinnedLayout}>
          <div className={styles.pinnedMain}>
            {VideoTileEl(pinnedP, { isPinned: true })}
          </div>
          {others.length > 0 && (
            <div className={styles.pinnedSidebar}>
              {others.map((p) => VideoTileEl(p, { isPinned: false }))}
            </div>
          )}
        </div>
      ) : (
        <div className={`${styles.videoGrid} ${gridClass}`}>
          {allParticipants.map((p) => VideoTileEl(p))}
        </div>
      )}

      {/* Controls */}
      <Controls
        audioEnabled={audioEnabled}
        videoEnabled={videoEnabled}
        screenSharing={screenSharing}
        chatOpen={chatOpen}
        whiteboardOpen={whiteboardOpen}
        unread={unread}
        handRaised={handRaised}
        isHost={isHost}
        recording={recording}
        transcribeOpen={transcribeOpen}
        breakoutOpen={breakoutOpen}
        pollOpen={pollOpen}
        qnaOpen={qnaOpen}
        pollBadge={pollOpen ? 0 : pollBadge}
        qnaBadge={qnaOpen ? 0 : qnaBadge}
        wbActive={wbActive}
        onToggleAudio={toggleAudio}
        onToggleVideo={toggleVideo}
        onToggleScreen={toggleScreenShare}
        onToggleChat={handleToggleChat}
        onToggleWhiteboard={() => setWhiteboardOpen((o) => !o)}
        onRaiseHand={handleRaiseHand}
        onOpenSettings={() => setSettingsOpen(true)}
        onReaction={() => setReactionOpen((o) => !o)}
        onRecord={isHost ? handleRecord : null}
        onLeave={handleLeave}
        onToggleTranscribe={() => setTranscribeOpen((o) => !o)}
        onToggleBreakout={() => setBreakoutOpen((o) => !o)}
        onTogglePoll={() => {
          setPollOpen((o) => !o);
          setPollBadge(0);
        }}
        onToggleQnA={() => {
          setQnaOpen((o) => !o);
          setQnaBadge(0);
        }}
        docPipOpen={!!docPipWindow}
        onToggleDocPip={handleToggleDocPip}
      />

      {/* Emoji reaction picker */}
      {reactionOpen && (
        <div className={styles.reactionPicker}>
          {["👍", "❤️", "😂", "😮", "👏", "🔥", "🎉", "😢", "💯", "🤔"].map(
            (e) => (
              <button
                key={e}
                className={styles.reactionBtn}
                onClick={() => sendReaction(e)}
              >
                {e}
              </button>
            ),
          )}
        </div>
      )}

      {chatOpen && (
        <ChatPanel
          messages={messages}
          userId={userId}
          onSend={sendMessage}
          unreadCount={chatOpenUnreadCount}
          initialScrollTop={chatScrollTop}
          onScrollPositionChange={setChatScrollTop}
          onClose={() => setChatOpen(false)}
        />
      )}

      {whiteboardOpen && socket && (
        <Whiteboard
          socket={socket}
          roomId={roomId}
          userId={userId}
          userName={userName}
          wbAllowed={wbAllowed || isHost}
          onClose={() => setWhiteboardOpen(false)}
        />
      )}
      {whiteboardOpen && (
        <FloatingVideos
          localStream={localStream}
          peers={peers}
          localUserName={userName}
          audioEnabled={audioEnabled}
          videoEnabled={videoEnabled}
        />
      )}

      {settingsOpen && (
        <SettingsPanel
          peers={enrichedPeers}
          socket={socket}
          roomId={roomId}
          userId={userId}
          isHost={isHost}
          wbPermissions={wbPermissions}
          onWbPermChange={(sid, allowed) =>
            setWbPermissions((p) => ({ ...p, [sid]: allowed }))
          }
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {docPipWindow ? (
        <DocumentPipPortal pipWindow={docPipWindow}>
          <PipWindow
            visible={true}
            isDocPip={true}
            localStream={localStream}
            peers={peers}
            messages={messages}
            pinnedId={pinnedId}
            localUserName={userName}
            audioEnabled={audioEnabled}
            videoEnabled={videoEnabled}
            onPin={handlePin}
            onUnpin={() => setPinnedId(null)}
            onDismiss={() => docPipWindow.close()}
            onReturnToMeet={() => window.focus()}
            onToggleAudio={toggleAudio}
            onToggleVideo={toggleVideo}
            onLeave={handleLeave}
          />
        </DocumentPipPortal>
      ) : (
        <PipWindow
          visible={pipVisible}
          isDocPip={false}
          localStream={localStream}
          peers={peers}
          messages={messages}
          pinnedId={pinnedId}
          localUserName={userName}
          audioEnabled={audioEnabled}
          videoEnabled={videoEnabled}
          onPin={handlePin}
          onUnpin={() => setPinnedId(null)}
          onDismiss={() => {
            pipDismissedRef.current = true;
            setPipVisible(false);
          }}
          onReturnToMeet={() => window.focus()}
          onToggleAudio={toggleAudio}
          onToggleVideo={toggleVideo}
          onLeave={handleLeave}
        />
      )}

      {transcribeOpen && (
        <TranscribePanel
          isHost={isHost}
          socket={socket}
          roomId={roomId}
          userId={userId}
          userName={userName}
          permitted={transcribePermitted}
          onClose={() => setTranscribeOpen(false)}
        />
      )}
      {breakoutOpen && (
        <BreakoutPanel
          isHost={isHost}
          socket={socket}
          roomId={roomId}
          userId={userId}
          userName={userName}
          peers={enrichedPeers}
          onClose={() => setBreakoutOpen(false)}
        />
      )}
      {pollOpen && (
        <PollPanel
          isHost={isHost}
          socket={socket}
          roomId={roomId}
          userId={userId}
          onClose={() => setPollOpen(false)}
        />
      )}
      {qnaOpen && (
        <QnAPanel
          isHost={isHost}
          socket={socket}
          roomId={roomId}
          userId={userId}
          userName={userName}
          onClose={() => setQnaOpen(false)}
        />
      )}
    </div>
  );
}
