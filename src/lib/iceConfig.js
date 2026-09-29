/**
 * ICE / RTCConfiguration helpers (E-102 / E-101 light).
 * Prefer GET /api/ice (server ICE_SERVERS); fall back to REACT_APP_ICE_SERVERS / STUN.
 */

import { API } from "./api";

const DEFAULT_STUN = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

export function parseIceServers(raw = process.env.REACT_APP_ICE_SERVERS) {
  if (!raw || !String(raw).trim()) return DEFAULT_STUN;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) return DEFAULT_STUN;
    return parsed.filter((s) => s && (s.urls || s.url));
  } catch {
    console.warn("[ice] Invalid REACT_APP_ICE_SERVERS JSON — using STUN only");
    return DEFAULT_STUN;
  }
}

function hasTurn(iceServers) {
  return iceServers.some((s) => {
    const u = s.urls || s.url;
    const list = Array.isArray(u) ? u : [u];
    return list.some(
      (x) => String(x).startsWith("turn:") || String(x).startsWith("turns:"),
    );
  });
}

/**
 * @param {{ iceTransportPolicy?: RTCIceTransportPolicy, iceServers?: RTCIceServer[] }} [opts]
 * @returns {RTCConfiguration}
 */
export function buildRtcConfiguration(opts = {}) {
  const iceServers = opts.iceServers || parseIceServers();
  const turn = hasTurn(iceServers);
  return {
    iceServers,
    iceCandidatePoolSize: turn ? 4 : 2,
    iceTransportPolicy: opts.iceTransportPolicy || "all",
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
  };
}

let cachedConfig = null;
let inflight = null;

/** Fetch server ICE once per page load; cache for peer connections. */
export async function loadRtcConfiguration(opts = {}) {
  if (cachedConfig && !opts.force) {
    return { ...cachedConfig, iceTransportPolicy: opts.iceTransportPolicy || cachedConfig.iceTransportPolicy };
  }
  if (!inflight) {
    inflight = (async () => {
      try {
        const res = await fetch(`${API}/api/ice`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.iceServers) && data.iceServers.length) {
            cachedConfig = buildRtcConfiguration({
              iceServers: data.iceServers,
              iceTransportPolicy: opts.iceTransportPolicy,
            });
            return cachedConfig;
          }
        }
      } catch {
        /* fall through */
      }
      cachedConfig = buildRtcConfiguration(opts);
      return cachedConfig;
    })().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

export { DEFAULT_STUN };
