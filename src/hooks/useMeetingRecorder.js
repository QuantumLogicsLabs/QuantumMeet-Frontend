/* eslint-disable react-hooks/exhaustive-deps */
/**
 * useMeetingRecorder — composites local+peer A/V into a WebM.
 * Downloads locally; when classroomId is set, also uploads to Blob + logs metadata.
 */
import { useRef, useState, useCallback } from "react";
import { upload as blobUpload } from "@vercel/blob/client";
import { API } from "../lib/api";


export function useMeetingRecorder({
  localStream,
  peers,
  roomId,
  classroomId,
  userId,
}) {
  const [recording, setRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const recRef = useRef(null);
  const chunks = useRef([]);
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const audioCtxRef = useRef(null);
  const destRef = useRef(null);
  const animRef = useRef(null);
  const timerRef = useRef(null);
  const startedAt = useRef(0);

  const stopRecording = useCallback(() => {
    if (recRef.current && recRef.current.state !== "inactive") {
      recRef.current.stop();
    }
    cancelAnimationFrame(animRef.current);
    clearInterval(timerRef.current);
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setRecording(false);
  }, []);

  const startRecording = useCallback(async () => {
    if (recording) return stopRecording();

    const W = 1280,
      H = 720;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    canvasRef.current = canvas;
    const ctx = canvas.getContext("2d");
    ctxRef.current = ctx;

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioCtxRef.current = audioCtx;
    const dest = audioCtx.createMediaStreamDestination();
    destRef.current = dest;

    const allStreams = [localStream, ...peers.map((p) => p.stream)].filter(
      Boolean,
    );
    allStreams.forEach((stream) => {
      try {
        const src = audioCtx.createMediaStreamSource(stream);
        src.connect(dest);
      } catch {
        /* ignore */
      }
    });

    const allParticipants = [
      { stream: localStream, label: "You", mirror: true },
      ...peers.map((p) => ({
        stream: p.stream,
        label: p.userName,
        mirror: false,
      })),
    ].filter((p) => p.stream);

    const videos = allParticipants.map(({ stream, label, mirror }) => {
      const v = document.createElement("video");
      v.srcObject = stream;
      v.autoplay = true;
      v.muted = true;
      v.playsInline = true;
      v.play().catch(() => {});
      return { el: v, label, mirror };
    });

    const drawGrid = () => {
      const n = videos.length || 1;
      const cols = Math.ceil(Math.sqrt(n));
      const rows = Math.ceil(n / cols);
      const tw = W / cols;
      const th = H / rows;
      ctx.fillStyle = "#0c1220";
      ctx.fillRect(0, 0, W, H);
      videos.forEach(({ el, label, mirror }, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = col * tw;
        const y = row * th;
        ctx.save();
        if (mirror) {
          ctx.translate(x + tw, y);
          ctx.scale(-1, 1);
          try {
            ctx.drawImage(el, 0, 0, tw, th);
          } catch {
            /* ignore */
          }
        } else {
          try {
            ctx.drawImage(el, x, y, tw, th);
          } catch {
            /* ignore */
          }
        }
        ctx.restore();
        ctx.fillStyle = "rgba(0,0,0,.55)";
        ctx.fillRect(x, y + th - 28, tw, 28);
        ctx.fillStyle = "#fff";
        ctx.font = "14px sans-serif";
        ctx.fillText(label || "Peer", x + 8, y + th - 10);
      });
      animRef.current = requestAnimationFrame(drawGrid);
    };

    const canvasStream = canvas.captureStream(30);
    dest.stream.getAudioTracks().forEach((t) => canvasStream.addTrack(t));

    const mimeType = MediaRecorder.isTypeSupported(
      "video/webm;codecs=vp9,opus",
    )
      ? "video/webm;codecs=vp9,opus"
      : "video/webm";

    let rec;
    try {
      rec = new MediaRecorder(canvasStream, {
        mimeType,
        videoBitsPerSecond: 4_000_000,
      });
    } catch {
      rec = new MediaRecorder(canvasStream);
    }

    chunks.current = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.current.push(e.data);
    };
    rec.onstop = async () => {
      const blob = new Blob(chunks.current, { type: "video/webm" });
      const filename = `QuantumMeet-Recording-${new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/:/g, "-")}.webm`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      const durationSec = Math.floor(
        (Date.now() - startedAt.current) / 1000,
      );
      if (classroomId && roomId) {
        try {
          const file = new File([blob], filename, { type: "video/webm" });
          const uploaded = await blobUpload(filename, file, {
            access: "public",
            handleUploadUrl: `${API}/api/classrooms/${classroomId}/blob-upload`,
          });
          await fetch(`${API}/api/rooms/${roomId}/recordings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              userId,
              blobUrl: uploaded.url,
              durationSec,
              classroomId,
            }),
          });
        } catch (err) {
          console.warn("[recorder] upload failed", err);
        }
      }

      videos.forEach(({ el }) => {
        el.srcObject = null;
      });
    };

    rec.start(1000);
    recRef.current = rec;
    startedAt.current = Date.now();

    timerRef.current = setInterval(() => {
      setDuration(Math.floor((Date.now() - startedAt.current) / 1000));
    }, 1000);

    drawGrid();
    setRecording(true);
    setDuration(0);
  }, [
    recording,
    localStream,
    peers,
    stopRecording,
    classroomId,
    roomId,
    userId,
  ]);

  return { recording, duration, startRecording, stopRecording };
}
