/**
 * Base URL of the QuantumMeet API (a separate Vercel project).
 * Set REACT_APP_SERVER_URL per Vercel environment (Production *and* Preview).
 * If it is missing from a production build we fall back to the production API
 * rather than localhost, which would break every request for real users.
 */
const PRODUCTION_API = "https://quantum-meet-backend.vercel.app";

export const API = (
  process.env.REACT_APP_SERVER_URL ||
  (process.env.NODE_ENV === "production" ? PRODUCTION_API : "http://localhost:5000")
).replace(/\/+$/, "");
