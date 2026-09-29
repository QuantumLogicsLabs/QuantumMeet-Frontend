import { v4 as uuidv4 } from "uuid";
import { API } from "./api";

// Vercel can't host Socket.io. Signaling + room fan-out use a Mongo-backed
// event bus polled over REST. Media stays WebRTC P2P. This factory keeps the
// socket-shaped API (`emit` / `on` / `off` / `id` / `disconnect`) so Room and
// useWebRTC don't need to change. Peer addressing uses userId as socketId.

const POLL_MS_IDLE = 3000;
const POLL_MS_ACTIVE = 600;
const POLL_MS_NEGOTIATING = 300;
const HEARTBEAT_MS = 15_000;
// Server caps waits at 7s so requests fit Vercel's 10s function timeout.
const LONG_POLL_WAIT_MS = 7000;
const MAX_BACKOFF_MS = 15_000;
const CURSOR_COALESCE_MS = 150;
const ICE_COALESCE_MS = 100;
const DRAW_COALESCE_MS = 50;
const DRAW_BATCH_MAX = 40;
// Server rejects event payloads over 120 KB (413).
const MAX_EVENT_PAYLOAD_CHARS = 110_000;

const SIGNALING_EVENTS = new Set([
  "offer",
  "answer",
  "ice-candidate",
]);

const RELAY_RENAME = {
  "toggle-audio": (d, selfId) => [
    "peer-audio-toggle",
    { userId: d.userId, socketId: selfId, enabled: d.enabled },
  ],
  "toggle-video": (d, selfId) => [
    "peer-video-toggle",
    { userId: d.userId, socketId: selfId, enabled: d.enabled },
  ],
  "room-reaction": (d) => ["peer-reaction", { emoji: d.emoji, x: d.x, y: d.y }],
  "raise-hand": (d, selfId) => [
    "peer-hand-raise",
    { socketId: selfId, userName: d.userName },
  ],
  "lower-hand": (_d, selfId) => ["peer-hand-lower", { socketId: selfId }],
  "screen-share-stopped": (_d, selfId) => [
    "peer-screen-stopped",
    { socketId: selfId },
  ],
  "wb-join": (_d, selfId) => ["wb-request-canvas", { from: selfId }],
  "transcript-share": (d) => [
    "transcript-line",
    { text: d.text, speakerName: d.speakerName, timestamp: d.timestamp },
  ],
};

const DIRECT_BROADCAST = new Set([
  "offer",
  "answer",
  "ice-candidate",
  "wb-draw",
  "wb-clear",
  "wb-cursor",
  "wb-canvas-state",
  "wb-image-drop",
  "wb-image-move",
  "wb-image-resize",
  "wb-image-delete",
  "wb-drawing-start",
  "wb-drawing-stop",
]);

async function postJSON(url, body) {
  const res = await fetch(`${API}${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return res.ok ? res.json().catch(() => ({})) : Promise.reject(res);
}
async function patchJSON(url, body) {
  const res = await fetch(`${API}${url}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return res.ok ? res.json().catch(() => ({})) : Promise.reject(res);
}
async function delJSON(url, body) {
  const res = await fetch(`${API}${url}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return res.ok ? res.json().catch(() => ({})) : Promise.reject(res);
}
async function getJSON(url) {
  const res = await fetch(`${API}${url}`);
  return res.ok ? res.json().catch(() => null) : null;
}

export function createRealtimeClient({ roomId, userId, userName, roomToken }) {
  const listeners = new Map();
  const connectionId = uuidv4();
  let hasEnteredPresence = false;
  let closed = false;
  // Event cursors are compared against *server* timestamps. Starting them from
  // this device's clock drops every event (offers, knock-accepted…) for as long
  // as the clock runs fast, so they're re-based on server time before polling.
  const createdAtMs = Date.now();
  let clockOffsetMs = 0;
  let clockSynced = false;
  let roomSince = new Date(createdAtMs).toISOString();
  let secretSince = roomSince;
  let roomCursorFromServer = false;
  let secretCursorFromServer = false;
  let pollFailures = 0;
  let pollTimer = null;
  let heartbeatTimer = null;
  let cursorTimer = null;
  let pendingCursor = null;
  let iceTimer = null;
  let pendingIce = [];
  let drawTimer = null;
  let pendingDraws = [];
  let polling = false;
  let negotiatingUntil = 0;
  let lastActivity = Date.now();
  let useLongPoll = true;
  let token = roomToken || (roomId ? localStorage.getItem(`qm_room_token_${roomId}`) : null);
  let tabVisible = typeof document === "undefined" || document.visibilityState !== "hidden";

  const onVisibilityChange = () => {
    tabVisible = document.visibilityState !== "hidden";
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  const setRoomToken = (t) => {
    token = t;
    if (roomId && t) localStorage.setItem(`qm_room_token_${roomId}`, t);
  };

  const withToken = (body) => ({ ...(body || {}), roomToken: token || undefined });

  const markActivity = (event) => {
    lastActivity = Date.now();
    if (SIGNALING_EVENTS.has(event)) {
      negotiatingUntil = Date.now() + 8000;
    }
  };

  const currentPollMs = () => {
    if (!tabVisible) return POLL_MS_IDLE * 2;
    if (Date.now() < negotiatingUntil) return POLL_MS_NEGOTIATING;
    if (Date.now() - lastActivity < 5000) return POLL_MS_ACTIVE;
    return POLL_MS_IDLE;
  };

  const dispatch = (event, data) => {
    markActivity(event);
    listeners.get(event)?.forEach((fn) => {
      try {
        fn(data);
      } catch (e) {
        console.error(`[realtime] listener for ${event} threw`, e);
      }
    });
  };

  const publishEvent = async (event, payload) => {
    if (!roomId || closed) return;
    markActivity(event);
    await postJSON(`/api/rooms/${roomId}/events`, {
      event,
      payload: payload || {},
      from: userId,
      to: payload?.to ?? null,
    });
  };

  const flushIce = () => {
    iceTimer = null;
    const batch = pendingIce;
    pendingIce = [];
    if (!batch.length) return;
    // One bus event per peer carrying *every* candidate gathered in the window.
    // Candidates don't supersede each other (host / srflx / relay are separate
    // routes) — keeping only the last one per peer broke calls across NATs.
    const byTo = new Map();
    for (const p of batch) {
      if (!p?.candidate) continue;
      const key = p.to || "_";
      if (!byTo.has(key)) byTo.set(key, []);
      byTo.get(key).push(p);
    }
    for (const list of byTo.values()) {
      const last = list[list.length - 1];
      publishEvent("ice-candidate", {
        to: last.to,
        from: last.from,
        // `candidate` keeps clients still on an older bundle working.
        candidate: last.candidate,
        candidates: list.map((p) => p.candidate),
      }).catch(() => {});
    }
  };

  const flushDraws = () => {
    drawTimer = null;
    const batch = pendingDraws;
    pendingDraws = [];
    if (!batch.length) return;
    // One bus event for many stroke segments
    const base = batch[0] || {};
    publishEvent("wb-draw", {
      roomId: base.roomId,
      from: base.from,
      segments: batch.map(
        ({ x0, y0, x1, y1, color, size, tool }) => ({
          x0,
          y0,
          x1,
          y1,
          color,
          size,
          tool,
        }),
      ),
    }).catch(() => {});
  };

  const publishRoomEvent = (event, payload) => {
    if (event === "wb-cursor") {
      pendingCursor = payload;
      if (!cursorTimer) {
        cursorTimer = setTimeout(() => {
          cursorTimer = null;
          const p = pendingCursor;
          pendingCursor = null;
          if (p) publishEvent("wb-cursor", p).catch(() => {});
        }, CURSOR_COALESCE_MS);
      }
      return;
    }
    if (event === "ice-candidate") {
      pendingIce.push(payload || {});
      if (!iceTimer) iceTimer = setTimeout(flushIce, ICE_COALESCE_MS);
      return;
    }
    if (event === "wb-draw") {
      pendingDraws.push(payload || {});
      if (pendingDraws.length >= DRAW_BATCH_MAX) {
        if (drawTimer) clearTimeout(drawTimer);
        flushDraws();
        return;
      }
      if (!drawTimer) drawTimer = setTimeout(flushDraws, DRAW_COALESCE_MS);
      return;
    }
    // Skip canvas dumps the API would reject as too large
    if (event === "wb-canvas-state" && payload?.json) {
      try {
        if (JSON.stringify(payload).length > MAX_EVENT_PAYLOAD_CHARS) return;
      } catch {
        return;
      }
    }
    publishEvent(event, payload).catch(() => {});
  };

  const dispatchBusEvent = (ev) => {
    const p = ev.payload;
    // Batched ICE (see flushIce) fans back out to one handler call per candidate
    if (ev.event === "ice-candidate" && Array.isArray(p?.candidates)) {
      for (const candidate of p.candidates) {
        dispatch("ice-candidate", { to: p.to, from: p.from, candidate });
      }
      return;
    }
    dispatch(ev.event, p);
  };

  const pollOnce = async () => {
    if (closed || polling) return;
    polling = true;
    try {
      if (roomId) {
        const q = new URLSearchParams({ userId, since: roomSince });
        // Long-poll only when tab visible — cuts idle serverless load
        const wantLongPoll = useLongPoll && tabVisible;
        if (wantLongPoll) q.set("wait", String(LONG_POLL_WAIT_MS));
        const data = await getJSON(`/api/rooms/${roomId}/events?${q}`);
        if (!data) throw new Error("poll failed");
        // An API that answered without waiting (flag off / older deploy) would
        // otherwise be re-polled every 80ms by every open tab.
        if (wantLongPoll && data.longPoll !== true) useLongPoll = false;
        for (const ev of data.events || []) {
          dispatchBusEvent(ev);
          if (ev.createdAt > roomSince) {
            roomSince = ev.createdAt;
            roomCursorFromServer = true;
          }
        }
      } else {
        const q = new URLSearchParams({ userId, since: secretSince });
        const data = await getJSON(`/api/secret/inbox?${q}`);
        if (!data) throw new Error("poll failed");
        for (const ev of data.events || []) {
          dispatch(ev.event, ev.payload);
          if (ev.createdAt > secretSince) {
            secretSince = ev.createdAt;
            secretCursorFromServer = true;
          }
        }
      }
      pollFailures = 0;
    } catch (e) {
      pollFailures += 1;
      // Repeated long-poll failures: drop to plain interval polling
      if (pollFailures >= 3) useLongPoll = false;
    } finally {
      polling = false;
    }
  };

  const scheduleNextPoll = () => {
    if (closed) return;
    const delay = pollFailures
      ? Math.min(POLL_MS_IDLE * 2 ** (pollFailures - 1), MAX_BACKOFF_MS)
      : useLongPoll && roomId && tabVisible
        ? 80
        : currentPollMs();
    pollTimer = setTimeout(async () => {
      await pollOnce();
      scheduleNextPoll();
    }, delay);
  };

  const startPolling = () => {
    if (pollTimer) return;
    scheduleNextPoll();
  };

  const startHeartbeat = () => {
    if (heartbeatTimer || !roomId) return;
    // Beat in background tabs too: the server drops members after 45s without
    // one, which kicked people out of the call just for switching tabs / PiP.
    const beat = () => {
      postJSON(`/api/rooms/${roomId}/presence`, {
        userId,
        userName,
        connectionId,
        heartbeat: true,
      }).catch(() => {});
    };
    heartbeatTimer = setInterval(beat, HEARTBEAT_MS);
  };

  // Leave presence on tab close / navigate away (multi-tab safe via connectionId)
  const onPageHide = () => {
    if (!hasEnteredPresence || closed) return;
    const body = JSON.stringify({ userId, userName, connectionId });
    try {
      fetch(`${API}/api/rooms/${roomId}/presence`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* ignore */
    }
  };
  if (typeof window !== "undefined" && roomId) {
    window.addEventListener("pagehide", onPageHide);
  }

  const syncClock = async () => {
    try {
      const t0 = Date.now();
      const res = await fetch(`${API}/api/time`);
      if (!res.ok) return;
      const { serverTime } = await res.json();
      const server = Date.parse(serverTime);
      if (Number.isFinite(server)) {
        clockOffsetMs = server - (t0 + Date.now()) / 2;
        clockSynced = true;
      }
    } catch {
      /* older API without /api/time — keep the local clock */
    }
  };

  const enterPresenceAndHydrate = async () => {
    const result = await postJSON(`/api/rooms/${roomId}/presence`, {
      userId,
      userName,
      connectionId,
    });
    hasEnteredPresence = true;
    startHeartbeat();

    // Deliver everything peers publish from the moment we entered (server
    // clock). Moving the cursor *after* the awaits below used to drop answers
    // and ICE that peers sent while this client was still hydrating.
    if (result?.since && (!roomCursorFromServer || result.since > roomSince)) {
      roomSince = result.since;
      roomCursorFromServer = true;
    }

    const members = result?.members || (await getJSON(`/api/rooms/${roomId}/presence`)) || [];
    const peers = members
      .filter((m) => m.userId !== userId)
      .map((m) => ({
        socketId: m.userId,
        userId: m.userId,
        userName: m.userName,
      }));
    dispatch("existing-peers", peers);

    const room = await getJSON(`/api/rooms/${roomId}`);
    let hostConfirmed = false;
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split(".")[1]));
        hostConfirmed =
          payload.role === "host" &&
          payload.roomId === roomId &&
          payload.userId === userId;
      } catch {}
    }
    if (hostConfirmed || room?.host === userId) {
      if (!hostConfirmed && room?.host === userId) {
        // Legacy: creator without token cannot elevate; only confirm UI if token present
      }
      if (hostConfirmed) {
        dispatch("host-status-confirmed", { isHost: true });
        const knocks = await getJSON(
          `/api/rooms/${roomId}/knocks?userId=${encodeURIComponent(userId)}&roomToken=${encodeURIComponent(token)}`,
        );
        (knocks || []).forEach((k) =>
          dispatch("knock-request", {
            socketId: k.userId,
            userId: k.userId,
            userName: k.userName,
          }),
        );
      }
    }

    const history = await getJSON(`/api/rooms/${roomId}/chat`);
    dispatch("chat-history", history || []);
  };

  async function restDispatch(event, data) {
    switch (event) {
      case "join-room":
      case "rejoin-room":
        await enterPresenceAndHydrate();
        return;

      case "knock":
        await postJSON(`/api/rooms/${roomId}/knock`, {
          userId: data.userId,
          userName: data.userName,
        }).catch(() => {});
        return;
      case "cancel-knock":
        await delJSON(`/api/rooms/${roomId}/knock`, {
          userId: data.userId || userId,
        }).catch(() => {});
        return;

      case "admit-user":
        await postJSON(
          `/api/rooms/${roomId}/admit`,
          withToken({ userId, targetUserId: data.socketId }),
        ).catch(() => {});
        return;
      case "reject-user":
        await postJSON(
          `/api/rooms/${roomId}/reject`,
          withToken({ userId, targetUserId: data.socketId }),
        ).catch(() => {});
        return;
      case "kick-user":
        await postJSON(
          `/api/rooms/${roomId}/kick`,
          withToken({ userId, targetUserId: data.targetSocketId }),
        ).catch(() => {});
        return;

      case "host-mute-user":
        return postJSON(
          `/api/rooms/${roomId}/host-action`,
          withToken({
            userId,
            action: "mute-user",
            targetUserId: data.targetSocketId,
          }),
        ).catch(() => {});
      case "host-unmute-user":
        return postJSON(
          `/api/rooms/${roomId}/host-action`,
          withToken({
            userId,
            action: "unmute-user",
            targetUserId: data.targetSocketId,
          }),
        ).catch(() => {});
      case "host-mute-all":
        return postJSON(
          `/api/rooms/${roomId}/host-action`,
          withToken({ userId, action: "mute-all" }),
        ).catch(() => {});
      case "host-stop-video":
        return postJSON(
          `/api/rooms/${roomId}/host-action`,
          withToken({
            userId,
            action: "stop-video",
            targetUserId: data.targetSocketId,
          }),
        ).catch(() => {});
      case "host-wb-permission":
        return postJSON(
          `/api/rooms/${roomId}/host-action`,
          withToken({
            userId,
            action: "wb-permission",
            targetUserId: data.targetSocketId,
            allowed: data.allowed,
          }),
        ).catch(() => {});
      case "host-lower-all-hands":
        return postJSON(
          `/api/rooms/${roomId}/host-action`,
          withToken({ userId, action: "lower-all-hands" }),
        ).catch(() => {});
      case "host-grant-transcribe":
        return postJSON(
          `/api/rooms/${roomId}/host-action`,
          withToken({
            userId,
            action: "grant-transcribe",
            targetUserId: data.targetSocketId,
            allowed: data.allowed,
          }),
        ).catch(() => {});

      case "chat-message":
        return postJSON(`/api/rooms/${roomId}/chat`, {
          message: data.message,
          userName: data.userName,
          userId: data.userId,
        }).catch(() => {});

      case "poll-create":
        return postJSON(
          `/api/rooms/${roomId}/polls`,
          withToken({
            userId,
            question: data.question,
            options: data.options,
            createdBy: userName,
          }),
        ).catch(() => {});
      case "poll-vote":
        return postJSON(`/api/rooms/${roomId}/polls/${data.pollId}/vote`, {
          userId: data.userId,
          optionIndex: data.optionIndex,
        }).catch(() => {});
      case "poll-end":
        return postJSON(
          `/api/rooms/${roomId}/polls/${data.pollId}/end`,
          withToken({ userId }),
        ).catch(() => {});
      case "poll-get-all": {
        const polls = await getJSON(`/api/rooms/${roomId}/polls`);
        dispatch("poll-all", polls || []);
        return;
      }

      case "qna-ask":
        return postJSON(`/api/rooms/${roomId}/qna`, {
          text: data.text,
          askerId: data.askerId,
          askerName: data.askerName,
          anonymous: data.anonymous,
        }).catch(() => {});
      case "qna-upvote":
        return postJSON(`/api/rooms/${roomId}/qna/${data.questionId}/upvote`, {
          userId: data.userId,
        }).catch(() => {});
      case "qna-mark-answered":
        return patchJSON(
          `/api/rooms/${roomId}/qna/${data.questionId}/answered`,
          withToken({ userId }),
        ).catch(() => {});
      case "qna-pin":
        return patchJSON(
          `/api/rooms/${roomId}/qna/${data.questionId}/pin`,
          withToken({ userId }),
        ).catch(() => {});
      case "qna-dismiss":
        return delJSON(
          `/api/rooms/${roomId}/qna/${data.questionId}`,
          withToken({ userId }),
        ).catch(() => {});
      case "qna-get-all": {
        const qs = await getJSON(`/api/rooms/${roomId}/qna`);
        dispatch("qna-all", qs || []);
        return;
      }

      case "breakout-create":
        return postJSON(
          `/api/rooms/${roomId}/breakout`,
          withToken({ userId, breakoutRooms: data.breakoutRooms }),
        ).catch(() => {});
      case "breakout-assign":
        return postJSON(
          `/api/rooms/${roomId}/breakout/assign`,
          withToken({
            userId,
            targetUserId: data.targetSocketId,
            breakoutRoomId: data.breakoutRoomId,
          }),
        ).catch(() => {});
      case "breakout-end":
        return delJSON(
          `/api/rooms/${roomId}/breakout`,
          withToken({ userId }),
        ).catch(() => {});
      case "breakout-broadcast":
        return postJSON(
          `/api/rooms/${roomId}/breakout/broadcast`,
          withToken({ userId, message: data.message }),
        ).catch(() => {});
      case "breakout-call-back":
        return postJSON(
          `/api/rooms/${roomId}/breakout/callback`,
          withToken({ userId }),
        ).catch(() => {});
      case "breakout-get": {
        const state = await getJSON(`/api/rooms/${roomId}/breakout`);
        dispatch("breakout-state", state || null);
        return;
      }

      case "secret-join-queue": {
        // Ensure inbox polling is running for the waiting partner path
        startPolling();
        const result = await postJSON("/api/secret/join", {
          userId: data.userId || userId,
          userName: data.userName || userName,
        }).catch(() => null);
        if (!result) return;
        if (result.status === "matched") {
          dispatch("secret-matched", {
            roomId: result.roomId,
            partnerName: result.partnerName,
          });
        } else {
          dispatch("secret-waiting");
        }
        return;
      }
      case "secret-leave-queue":
        await postJSON("/api/secret/leave", {
          userId: data.userId || userId,
        }).catch(() => {});
        dispatch("secret-cancelled");
        return;

      default:
        return;
    }
  }

  const socketLike = {
    id: userId,
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
    },
    off(event, fn) {
      listeners.get(event)?.delete(fn);
    },
    emit(event, data) {
      if (RELAY_RENAME[event]) {
        const [name, payload] = RELAY_RENAME[event](data || {}, userId);
        publishRoomEvent(name, payload);
        return;
      }
      if (DIRECT_BROADCAST.has(event)) {
        publishRoomEvent(event, data || {});
        return;
      }
      restDispatch(event, data || {}).catch((e) =>
        console.warn(`[realtime] ${event} failed`, e),
      );
    },
    disconnect() {
      closed = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (cursorTimer) clearTimeout(cursorTimer);
      if (iceTimer) clearTimeout(iceTimer);
      if (drawTimer) {
        clearTimeout(drawTimer);
        flushDraws();
      }
      pollTimer = heartbeatTimer = cursorTimer = iceTimer = drawTimer = null;
      pendingDraws = [];
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("pagehide", onPageHide);
      }
      if (hasEnteredPresence && roomId) {
        delJSON(`/api/rooms/${roomId}/presence`, {
          userId,
          userName,
          connectionId,
        }).catch(() => {});
      }
    },
    setRoomToken,
  };

  // Room clients poll immediately; SecretMeet (no roomId) starts on queue join
  // but also poll inbox so a late subscribe still works if emit order varies.
  // Cursors are re-based on the server clock first (see clockOffsetMs).
  syncClock().finally(() => {
    if (closed) return;
    if (clockSynced) {
      // Server-clock estimate of when this client was created
      const start = new Date(createdAtMs + clockOffsetMs).toISOString();
      if (!roomCursorFromServer) {
        roomSince = start;
        roomCursorFromServer = true;
      }
      if (!secretCursorFromServer) secretSince = start;
    }
    dispatch("connect");
    startPolling();
  });

  return socketLike;
}
