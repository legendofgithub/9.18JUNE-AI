import { API_BASE } from '../config';

export function authHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json' };
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...authHeaders(),
      ...(options.headers || {}),
    },
  });
  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok || payload?.code !== 200) {
    throw new Error(payload?.message || `请求失败：HTTP ${response.status}`);
  }
  return payload.data as T;
}

// SSE（主聊天 / 追问链）：按 delta 回调增量，返回 done 帧负载；error 帧抛错
export async function streamRequest(url: string, body: unknown, onDelta: (delta: string) => void): Promise<any> {
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let payload: any = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    throw new Error(payload?.message || `请求失败：HTTP ${response.status}`);
  }
  if (!response.body) throw new Error('后端没有返回流式内容');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let donePayload: any = null;
  let currentEvent = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('event:')) {
        currentEvent = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        const raw = line.slice(5).trim();
        if (!raw || raw === ': heartbeat') continue;
        try {
          const payload = JSON.parse(raw);
          if (currentEvent === 'error' || payload.error) {
            throw new Error(payload.error || 'AI 请求失败');
          }
          if (payload.delta) onDelta(payload.delta);
          if (currentEvent === 'done' || payload.done) donePayload = payload;
        } catch (error) {
          if (error instanceof Error && error.message !== 'Unexpected end of JSON input') {
            if (!(error as any).jsonParseOnly) throw error;
          }
        }
      }
    }
  }
  return donePayload;
}

// SSE（Agent 工作台执行流）：整帧回调，事件名兜底为 type；忽略残帧
export async function streamEvents(path: string, body: unknown, onEvent: (event: any) => void): Promise<void> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let payload: any = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    throw new Error(payload?.message || `请求失败：HTTP ${response.status}`);
  }
  if (!response.body) throw new Error('后端没有返回执行流');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        const raw = line.slice(5).trim();
        if (!raw || raw === ': heartbeat') continue;
        try {
          const payload = JSON.parse(raw);
          onEvent({ ...payload, type: payload.type || eventName });
        } catch {
          // Ignore heartbeat comments and malformed partial frames.
        }
      }
    }
  }
}
