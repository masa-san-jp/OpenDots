// Slow local models need longer turns; keep the 90 second default otherwise.
const seconds = Number(process.env.OPENDOTS_TURN_TIME_LIMIT_SECONDS);
export const TURN_TIME_LIMIT_MS =
  Number.isFinite(seconds) && seconds >= 30 ? seconds * 1000 : 90_000;
// A task lease must outlive the turn it covers.
export const TASK_LEASE_MS = Math.max(180_000, TURN_TIME_LIMIT_MS + 60_000);
