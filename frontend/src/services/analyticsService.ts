import { API_BASE } from '../config';

const SESSION_KEY = 'june_analytics_session';

function sessionId(): string {
  const existing = localStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(SESSION_KEY, created);
  return created;
}

export function trackEvent(
  eventName: string,
  route: string = window.location.hash || '#/',
  properties: Record<string, string | number | boolean | null> = {},
): void {
  const payload = JSON.stringify({
    event_name: eventName,
    route: route.slice(0, 120),
    session_id: sessionId(),
    properties,
  });

  fetch(`${API_BASE}/analytics/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
  }).catch(() => {
    // Product telemetry must never break the user workflow.
  });
}
