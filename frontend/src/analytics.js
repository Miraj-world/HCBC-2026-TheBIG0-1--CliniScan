const SESSION_KEY = "cliniscan_analytics_session";

function sessionId() {
  let value = sessionStorage.getItem(SESSION_KEY);
  if (!value) {
    value = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, value);
  }
  return value;
}

export function durationBucket(milliseconds) {
  if (milliseconds < 10_000) return "under_10s";
  if (milliseconds < 30_000) return "10_to_30s";
  if (milliseconds < 90_000) return "30_to_90s";
  return "over_90s";
}

export function trackEvent(apiUrl, event, properties = {}) {
  const baseUrl = (apiUrl || "http://localhost:8000").replace(/\/$/, "");
  const body = JSON.stringify({
    event,
    session_id: sessionId(),
    ...properties,
  });

  fetch(`${baseUrl}/analytics/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {
    // Product analytics is intentionally best-effort and never blocks care flows.
  });
}
