/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useRef, useState, useCallback } from "react";
import {
  buildRtcConfiguration,
  loadRtcConfiguration,
} from "../lib/iceConfig";
import {
  probeMediaPermissions,
  mediaModeFromPermissions,
} from "../lib/mediaPermissions";
import { addSimulcastVideoTrack, setSenderBandwidthTier } from "../lib/simulcast";
import { API } from "../lib/api";

export let MESH_SOFT_CAP = Number(process.env.REACT_APP_MESH_SOFT_CAP || 10);

function reportCallQuality(event) {
  fetch(`${API}/api/metrics/call-quality`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event }),
  }).catch(() => {});
}

/** Prefer server `/api/growth/features` meshSoftCap when available. */
export async function refreshMeshSoftCap() {
  try {
    const res = await fetch(`${API}/api/growth/features`);
    if (!res.ok) return { meshSoftCap: MESH_SOFT_CAP };
    const data = await res.json();
    if (Number.isFinite(Number(data.meshSoftCap))) {
      MESH_SOFT_CAP = Number(data.meshSoftCap);
    }
    return { meshSoftCap: MESH_SOFT_CAP };
  } catch {
    return { meshSoftCap: MESH_SOFT_CAP };
  }
}

// ── Audio enhancement pipeline ───────────────────────────────────────────────
async function buildEnhancedAudioStream(rawStream) {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 48000,
    });
    const source = audioCtx.createMediaStreamSource(rawStream);
    const hp = audioCtx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 80;
    hp.Q.value = 0.7;
    const lp = audioCtx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 8000;
    lp.Q.value = 0.7;
    const presence = audioCtx.createBiquadFilter();
    presence.type = "peaking";
    presence.frequency.value = 3000;
    presence.gain.value = 3;
    presence.Q.value = 1.0;
    const compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-24, audioCtx.currentTime);
    compressor.knee.setValueAtTime(10, audioCtx.currentTime);
    compressor.ratio.setValueAtTime(4, audioCtx.currentTime);
    compressor.attack.setValueAtTime(0.003, audioCtx.currentTime);
    compressor.release.setValueAtTime(0.25, audioCtx.currentTime);
    const gainNode = audioCtx.createGain();
    gainNode.gain.value = 0.85;
    const dest = audioCtx.createMediaStreamDestination();
    source.connect(hp);
    hp.connect(lp);
    lp.connect(presence);
    presence.connect(compressor);
    compressor.connect(gainNode);
    gainNode.connect(dest);
    const enhancedStream = new MediaStream();
    dest.stream.getAudioTracks().forEach((t) => enhancedStream.addTrack(t));
    rawStream.getVideoTracks().forEach((t) => enhancedStream.addTrack(t));
    enhancedStream._audioCtx = audioCtx;
    // The raw mic track isn't part of enhancedStream — keep it so cleanup can
    // stop it (otherwise the browser's mic indicator stays on after leaving).
    enhancedStream._rawStream = rawStream;
    // A context created without a user gesture starts suspended and outputs
    // silence, so peers would hear nothing. Resume now and on first interaction.
    if (audioCtx.state === "suspended") {
      const resume = () => {
        if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
      };
      resume();
      ["pointerdown", "keydown", "touchstart"].forEach((ev) =>
        window.addEventListener(ev, resume, { once: true, capture: true }),
      );
    }
    return enhancedStream;
  } catch (err) {
    console.warn("Audio enhancement failed, falling back to raw stream:", err);
    return rawStream;
  }
}

export const useWebRTC = ({ socket, roomId, userId, userName }) => {
  const localStreamRef = useRef(null);
  const camStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const peersRef = useRef({});
  const peerScreenSendersRef = useRef({});
  const pendingIceRef = useRef({});
  const disconnectTimersRef = useRef({});
  // Feature 9: quality polling intervals — socketId → interval id
  const qualityIntervalsRef = useRef({});

  const [peers, setPeers] = useState([]);
  const [localStream, setLocalStream] = useState(null);
  const [screenStream, setScreenStream] = useState(null);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  // Feature 9: per-peer connection quality — socketId → 'good'|'fair'|'poor'
  const [peerQuality, setPeerQuality] = useState({});
  const [meshSoftCap, setMeshSoftCap] = useState(MESH_SOFT_CAP);
  const iceConfigRef = useRef(buildRtcConfiguration());

  const socketRef = useRef(socket);
  const userNameRef = useRef(userName);
  useEffect(() => {
    socketRef.current = socket;
  }, [socket]);
  useEffect(() => {
    userNameRef.current = userName;
  }, [userName]);
  useEffect(() => {
    let cancelled = false;
    loadRtcConfiguration().then((cfg) => {
      if (!cancelled) iceConfigRef.current = cfg;
    });
    refreshMeshSoftCap().then((feats) => {
      if (!cancelled) setMeshSoftCap(feats.meshSoftCap);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Feature 9: Quality polling ───────────────────────────────────────────────
  const startQualityPolling = useCallback((pc, socketId) => {
    if (qualityIntervalsRef.current[socketId]) {
      clearInterval(qualityIntervalsRef.current[socketId]);
    }
    const interval = setInterval(async () => {
      if (
        !pc ||
        pc.connectionState === "closed" ||
        pc.connectionState === "failed"
      ) {
        clearInterval(interval);
        delete qualityIntervalsRef.current[socketId];
        return;
      }
      try {
        const stats = await pc.getStats();
        let packetsLost = 0,
          packetsReceived = 0,
          bytesReceived = 0;
        stats.forEach((report) => {
          if (report.type === "inbound-rtp" && report.kind === "video") {
            packetsLost += report.packetsLost || 0;
            packetsReceived += report.packetsReceived || 0;
            bytesReceived += report.bytesReceived || 0;
          }
        });
        const lossRate =
          packetsReceived > 0
            ? packetsLost / (packetsLost + packetsReceived)
            : 0;
        const quality =
          lossRate < 0.02 ? "good" : lossRate < 0.08 ? "fair" : "poor";
        const prev = qualityIntervalsRef.current[`_bytes_${socketId}`] || {
          bytes: bytesReceived,
          t: Date.now(),
        };
        const dt = Math.max(1, Date.now() - prev.t) / 1000;
        const kbps = Math.max(
          0,
          Math.round(((bytesReceived - prev.bytes) * 8) / 1000 / dt),
        );
        qualityIntervalsRef.current[`_bytes_${socketId}`] = {
          bytes: bytesReceived,
          t: Date.now(),
        };
        setPeerQuality((q) => ({
          ...q,
          [socketId]: {
            level: quality,
            lossPct: Math.round(lossRate * 1000) / 10,
            kbps,
          },
        }));
      } catch {
        // Connection may have closed between ticks
      }
    }, 3000);
    qualityIntervalsRef.current[socketId] = interval;
  }, []);

  const stopQualityPolling = useCallback((socketId) => {
    clearInterval(qualityIntervalsRef.current[socketId]);
    delete qualityIntervalsRef.current[socketId];
    delete qualityIntervalsRef.current[`_bytes_${socketId}`];
    setPeerQuality((q) => {
      const next = { ...q };
      delete next[socketId];
      return next;
    });
  }, []);

  // ── Renegotiate ──────────────────────────────────────────────────────────────
  const renegotiate = useCallback(async (sid, offerOptions) => {
    const pc = peersRef.current[sid];
    const s = socketRef.current;
    if (!pc || !s || pc.signalingState === "closed") return;
    try {
      const offer = await pc.createOffer(offerOptions);
      await pc.setLocalDescription(offer);
      s.emit("offer", {
        to: sid,
        from: s.id,
        offer,
        userName: userNameRef.current,
      });
    } catch (e) {
      console.warn("renegotiate error", sid, e);
    }
  }, []);

  // ── Init local stream ────────────────────────────────────────────────────────
  const initLocalStream = useCallback(async () => {
    const perms = await probeMediaPermissions();
    const mode = mediaModeFromPermissions(perms);
    const wantVideo = mode !== "audio-only" && mode !== "view-only";
    const wantAudio = mode !== "view-only";

    if (!wantVideo && !wantAudio) {
      console.info("[webrtc] view-only mode — no getUserMedia");
      return null;
    }

    try {
      const rawStream = await navigator.mediaDevices.getUserMedia({
        video: wantVideo,
        audio: wantAudio
          ? {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              sampleRate: 48000,
              channelCount: 1,
            }
          : false,
      });
      const s = await buildEnhancedAudioStream(rawStream);
      localStreamRef.current = s;
      camStreamRef.current = s;
      setLocalStream(s);
      return s;
    } catch {
      try {
        const rawStream = await navigator.mediaDevices.getUserMedia({
          video: false,
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        const s = await buildEnhancedAudioStream(rawStream);
        localStreamRef.current = s;
        camStreamRef.current = s;
        setLocalStream(s);
        return s;
      } catch {
        return null;
      }
    }
  }, []);

  // ── Remove a peer ────────────────────────────────────────────────────────────
  const removePeer = useCallback(
    (sid) => {
      if (disconnectTimersRef.current[sid]) {
        clearTimeout(disconnectTimersRef.current[sid]);
        delete disconnectTimersRef.current[sid];
      }
      if (peersRef.current[sid]) {
        peersRef.current[sid].close();
        delete peersRef.current[sid];
      }
      // Feature 9: stop quality polling for this peer
      stopQualityPolling(sid);

      delete peerScreenSendersRef.current[sid];
      delete pendingIceRef.current[sid];
      setPeers((p) => p.filter((x) => x.socketId !== sid));
    },
    [stopQualityPolling],
  );

  // ── Clear all peers ──────────────────────────────────────────────────────────
  const clearAllPeers = useCallback(() => {
    Object.entries(disconnectTimersRef.current).forEach(([, t]) =>
      clearTimeout(t),
    );
    disconnectTimersRef.current = {};
    Object.values(peersRef.current).forEach((pc) => {
      try {
        pc.close();
      } catch {}
    });
    peersRef.current = {};
    peerScreenSendersRef.current = {};
    pendingIceRef.current = {};
    // Feature 9: stop all quality intervals
    Object.keys(qualityIntervalsRef.current).forEach((sid) => {
      clearInterval(qualityIntervalsRef.current[sid]);
    });
    qualityIntervalsRef.current = {};
    setPeerQuality({});
    setPeers([]);
  }, []);

  // ── Create RTCPeerConnection ─────────────────────────────────────────────────
  const createPeerConnection = useCallback(
    (sid, remoteUserName) => {
      if (peersRef.current[sid]) {
        peersRef.current[sid].close();
        delete peersRef.current[sid];
      }

      const pc = new RTCPeerConnection(iceConfigRef.current);

      if (localStreamRef.current) {
        for (const t of localStreamRef.current.getTracks()) {
          if (t.kind === "video") {
            addSimulcastVideoTrack(pc, t);
          } else {
            pc.addTrack(t, localStreamRef.current);
          }
        }
        // Soft bandwidth adapt when many peers (E-503)
        const tier =
          peersRef.current && Object.keys(peersRef.current).length >= 6
            ? "medium"
            : "high";
        pc.getSenders().forEach((s) => {
          if (s.track?.kind === "video") setSenderBandwidthTier(s, tier);
        });
      }
      if (screenStreamRef.current) {
        const screenTrack = screenStreamRef.current.getVideoTracks()[0];
        if (screenTrack) {
          const sender = pc.addTrack(screenTrack, screenStreamRef.current);
          peerScreenSendersRef.current[sid] = sender;
        }
      }

      pc.onicecandidate = ({ candidate }) => {
        if (candidate && socketRef.current) {
          socketRef.current.emit("ice-candidate", {
            to: sid,
            from: socketRef.current.id,
            candidate,
          });
        }
      };

      const remoteStream = new MediaStream();
      const remoteScreenStream = new MediaStream();
      let newVideoTrackCount = 0;

      pc.ontrack = ({ track }) => {
        const allKnown = [
          ...remoteStream.getTracks(),
          ...remoteScreenStream.getTracks(),
        ];
        if (allKnown.some((t) => t.id === track.id)) {
          const hasScreen = remoteScreenStream
            .getVideoTracks()
            .some((t) => t.readyState !== "ended");
          setPeers((prev) => {
            const updated = {
              socketId: sid,
              userName: remoteUserName,
              stream: remoteStream,
              screenStream: hasScreen ? remoteScreenStream : null,
            };
            const ex = prev.find((p) => p.socketId === sid);
            if (ex) return prev.map((p) => (p.socketId === sid ? updated : p));
            return [...prev, updated];
          });
          return;
        }
        if (track.kind === "audio") {
          remoteStream.addTrack(track);
        } else {
          newVideoTrackCount += 1;
          if (newVideoTrackCount === 1) remoteStream.addTrack(track);
          else remoteScreenStream.addTrack(track);
        }
        const hasScreen = remoteScreenStream
          .getVideoTracks()
          .some((t) => t.readyState !== "ended");
        setPeers((prev) => {
          const updated = {
            socketId: sid,
            userName: remoteUserName,
            stream: remoteStream,
            screenStream: hasScreen ? remoteScreenStream : null,
          };
          const ex = prev.find((p) => p.socketId === sid);
          if (ex) return prev.map((p) => (p.socketId === sid ? updated : p));
          return [...prev, updated];
        });
      };

      pc.onconnectionstatechange = () => {
        console.log(`[WebRTC] peer ${sid} state: ${pc.connectionState}`);

        if (pc.connectionState === "connected") {
          if (disconnectTimersRef.current[sid]) {
            clearTimeout(disconnectTimersRef.current[sid]);
            delete disconnectTimersRef.current[sid];
          }
          setIsReconnecting(false);
          reportCallQuality("reconnect_ok");
          // Feature 9: start quality polling when connection is established
          startQualityPolling(pc, sid);
          return;
        }

        // pc.restartIce() alone only flags the need — nothing here listens for
        // `negotiationneeded`, so send the ICE-restart offer explicitly.
        // Simultaneous restarts from both ends are resolved in handleOffer.
        if (pc.connectionState === "disconnected") {
          setIsReconnecting(true);
          if (disconnectTimersRef.current[sid]) return;
          renegotiate(sid, { iceRestart: true });
          disconnectTimersRef.current[sid] = setTimeout(() => {
            delete disconnectTimersRef.current[sid];
            const current = peersRef.current[sid];
            if (!current || current.connectionState !== "disconnected") return;
            console.warn(`[WebRTC] peer ${sid} did not recover, removing.`);
            removePeer(sid);
            setIsReconnecting(false);
            reportCallQuality("reconnect_fail");
          }, 8000);
          return;
        }

        if (pc.connectionState === "failed") {
          setIsReconnecting(true);
          renegotiate(sid, { iceRestart: true });
          if (!disconnectTimersRef.current[`fail_${sid}`]) {
            disconnectTimersRef.current[`fail_${sid}`] = setTimeout(() => {
              delete disconnectTimersRef.current[`fail_${sid}`];
              const current = peersRef.current[sid];
              if (current && current.connectionState === "failed") {
                removePeer(sid);
                setIsReconnecting(false);
                reportCallQuality("reconnect_fail");
              }
            }, 8000);
          }
          return;
        }

        if (pc.connectionState === "closed") {
          // Feature 9: stop polling when connection closes
          stopQualityPolling(sid);
          removePeer(sid);
        }
      };

      peersRef.current[sid] = pc;
      return pc;
    },
    [removePeer, startQualityPolling, stopQualityPolling, renegotiate],
  );

  // ── Flush pending ICE ────────────────────────────────────────────────────────
  const flushPendingIce = useCallback(async (sid) => {
    const pc = peersRef.current[sid];
    const queued = pendingIceRef.current[sid];
    if (!pc || !queued?.length || !pc.remoteDescription) return;
    const candidates = [...queued];
    pendingIceRef.current[sid] = [];
    for (const candidate of candidates) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {}
    }
  }, []);

  // ── Socket events ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const handleExistingPeers = async (existingPeers) => {
      if (!localStreamRef.current) {
        console.warn(
          "[WebRTC] localStream missing on existing-peers — re-initializing",
        );
        await initLocalStream();
      }
      setIsReconnecting(false);
      for (const peer of existingPeers) {
        const pc = createPeerConnection(peer.socketId, peer.userName);
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit("offer", {
            to: peer.socketId,
            from: socket.id,
            offer,
            userName,
          });
        } catch (e) {
          console.warn("offer error", e);
        }
      }
    };

    const handleUserJoined = ({ socketId, userName: rName }) => {
      setPeers((prev) => {
        if (prev.find((p) => p.socketId === socketId)) return prev;
        return [
          ...prev,
          { socketId, userName: rName, stream: null, screenStream: null },
        ];
      });
    };

    const handleOffer = async ({ from, offer, userName: rName }) => {
      let pc = peersRef.current[from];
      if (!pc || pc.signalingState === "closed")
        pc = createPeerConnection(from, rName);
      try {
        if (pc.signalingState === "have-local-offer") {
          // Offer collision (rejoin, simultaneous ICE restart). If *both* ends
          // roll back, each applies the other's discarded offer and the call
          // never connects — so only the "polite" peer (lower id) yields; the
          // other keeps its offer and waits for the answer.
          const polite = String(socket.id) < String(from);
          if (!polite) return;
          await pc.setLocalDescription({ type: "rollback" });
        }
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        await flushPendingIce(from);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("answer", { to: from, from: socket.id, answer });
      } catch (e) {
        console.warn("answer error", e);
      }
    };

    const handleAnswer = async ({ from, answer }) => {
      const pc = peersRef.current[from];
      if (!pc || pc.signalingState !== "have-local-offer") return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        await flushPendingIce(from);
      } catch (e) {
        console.warn("setRemoteDescription error", e);
      }
    };

    const handleIce = async ({ from, candidate }) => {
      const pc = peersRef.current[from];
      if (!candidate) return;
      if (!pc || !pc.remoteDescription) {
        if (!pendingIceRef.current[from]) pendingIceRef.current[from] = [];
        pendingIceRef.current[from].push(candidate);
        return;
      }
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {}
    };

    const handleUserLeft = ({ socketId }) => removePeer(socketId);
    const handleKicked = () => window.dispatchEvent(new Event("qm-kicked"));

    const handleUserRejoined = async ({ socketId, userName: rName }) => {
      console.log(`[WebRTC] peer rejoined: ${rName} (${socketId})`);
      if (peersRef.current[socketId]) {
        peersRef.current[socketId].close();
        delete peersRef.current[socketId];
      }
      setPeers((prev) => {
        if (prev.find((p) => p.socketId === socketId)) return prev;
        return [
          ...prev,
          { socketId, userName: rName, stream: null, screenStream: null },
        ];
      });
      if (!localStreamRef.current) await initLocalStream();
      const pc = createPeerConnection(socketId, rName);
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit("offer", {
          to: socketId,
          from: socket.id,
          offer,
          userName,
        });
      } catch (e) {
        console.warn("rejoin offer error", e);
      }
    };

    const handlePeerScreenStopped = ({ socketId }) => {
      setPeers((prev) =>
        prev.map((p) =>
          p.socketId === socketId ? { ...p, screenStream: null } : p,
        ),
      );
    };

    socket.on("existing-peers", handleExistingPeers);
    socket.on("user-joined", handleUserJoined);
    socket.on("user-rejoined", handleUserRejoined);
    socket.on("offer", handleOffer);
    socket.on("answer", handleAnswer);
    socket.on("ice-candidate", handleIce);
    socket.on("user-left", handleUserLeft);
    socket.on("kicked", handleKicked);
    socket.on("peer-screen-stopped", handlePeerScreenStopped);

    return () => {
      socket.off("existing-peers", handleExistingPeers);
      socket.off("user-joined", handleUserJoined);
      socket.off("user-rejoined", handleUserRejoined);
      socket.off("offer", handleOffer);
      socket.off("answer", handleAnswer);
      socket.off("ice-candidate", handleIce);
      socket.off("user-left", handleUserLeft);
      socket.off("kicked", handleKicked);
      socket.off("peer-screen-stopped", handlePeerScreenStopped);
    };
  }, [socket, createPeerConnection, removePeer, initLocalStream, userName]);

  // ── Audio toggle ─────────────────────────────────────────────────────────────
  const toggleAudio = useCallback(() => {
    if (!localStreamRef.current) return;
    const enabled = !audioEnabled;
    localStreamRef.current.getAudioTracks().forEach((t) => {
      t.enabled = enabled;
    });
    setAudioEnabled(enabled);
    if (socket) socket.emit("toggle-audio", { roomId, userId, enabled });
  }, [audioEnabled, socket, roomId, userId]);

  // ── Video toggle ─────────────────────────────────────────────────────────────
  const toggleVideo = useCallback(() => {
    if (!localStreamRef.current) return;
    const enabled = !videoEnabled;
    localStreamRef.current.getVideoTracks().forEach((t) => {
      t.enabled = enabled;
    });
    setVideoEnabled(enabled);
    if (socket) socket.emit("toggle-video", { roomId, userId, enabled });
  }, [videoEnabled, socket, roomId, userId]);

  // ── Screen share toggle ──────────────────────────────────────────────────────
  const toggleScreenShare = useCallback(async () => {
    if (screenSharing) {
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      setScreenStream(null);
      setScreenSharing(false);
      for (const sid of Object.keys(peersRef.current)) {
        const pc = peersRef.current[sid];
        const sender = peerScreenSendersRef.current[sid];
        if (sender && pc) {
          try {
            pc.removeTrack(sender);
          } catch {}
          delete peerScreenSendersRef.current[sid];
          await renegotiate(sid);
        }
      }
      if (socketRef.current)
        socketRef.current.emit("screen-share-stopped", { roomId });
    } else {
      try {
        const ss = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 30 } },
          audio: false,
        });
        screenStreamRef.current = ss;
        const screenTrack = ss.getVideoTracks()[0];
        for (const sid of Object.keys(peersRef.current)) {
          const pc = peersRef.current[sid];
          const sender = pc.addTrack(screenTrack, ss);
          peerScreenSendersRef.current[sid] = sender;
          await renegotiate(sid);
        }
        setScreenStream(ss);
        setScreenSharing(true);
        screenTrack.onended = async () => {
          screenStreamRef.current?.getTracks().forEach((t) => t.stop());
          screenStreamRef.current = null;
          setScreenStream(null);
          setScreenSharing(false);
          for (const sid of Object.keys(peersRef.current)) {
            const pc = peersRef.current[sid];
            const sender = peerScreenSendersRef.current[sid];
            if (sender && pc) {
              try {
                pc.removeTrack(sender);
              } catch {}
              delete peerScreenSendersRef.current[sid];
              await renegotiate(sid);
            }
          }
          if (socketRef.current)
            socketRef.current.emit("screen-share-stopped", { roomId });
        };
      } catch (e) {
        console.error("Screen share failed:", e);
      }
    }
  }, [screenSharing, roomId, renegotiate]);

  // ── Cleanup ──────────────────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    Object.values(disconnectTimersRef.current).forEach((t) => clearTimeout(t));
    disconnectTimersRef.current = {};
    Object.values(peersRef.current).forEach((pc) => pc.close());
    peersRef.current = {};
    peerScreenSendersRef.current = {};
    pendingIceRef.current = {};
    // Feature 9: clear all quality intervals on full cleanup
    Object.keys(qualityIntervalsRef.current).forEach((sid) => {
      clearInterval(qualityIntervalsRef.current[sid]);
    });
    qualityIntervalsRef.current = {};
    if (localStreamRef.current?._audioCtx) {
      localStreamRef.current._audioCtx.close().catch(() => {});
    }
    localStreamRef.current?._rawStream?.getTracks().forEach((t) => t.stop());
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    camStreamRef.current = null;
    setPeers([]);
    setPeerQuality({});
    setLocalStream(null);
    setScreenStream(null);
  }, []);

  return {
    localStream,
    screenStream,
    peers,
    peerQuality, // Feature 9: exposed so Room.js can pass quality to VideoTile
    meshCapExceeded: peers.length >= meshSoftCap,
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
  };
};
