import type { FollowUpRequest } from '../types';
import { API_BASE } from '../config';


export interface SSEServiceConfig {
  timeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
}

const DEFAULT_CONFIG: SSEServiceConfig = {
  timeoutMs: 600_000,
  maxRetries: 3,
  retryBaseDelayMs: 1000,
  retryMaxDelayMs: 30_000,
};

function getToken(): string {
  return localStorage.getItem('june_api_token') || '';
}

export function setApiToken(token: string): void {
  localStorage.setItem('june_api_token', token);
}

type DeltaCallback = (delta: string) => void;
type ReferencesCallback = (files: any[]) => void;
type ReasoningCallback = () => void;

class SSEService {
  private apiBase: string;
  private config: SSEServiceConfig;

  constructor(baseUrl?: string, config?: Partial<SSEServiceConfig>) {
    this.apiBase = baseUrl ?? API_BASE;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  setBaseUrl(url: string) {
    this.apiBase = url;
  }

  async sendChatMessage(
    sessionId: string,
    message: string,
    onDelta: DeltaCallback,
    onReferences?: ReferencesCallback,
    onReasoning?: ReasoningCallback,
    messageIds?: { userMessageId?: string; assistantMessageId?: string },
  ): Promise<void> {
    return this.streamRequestWithRetry(
      `${this.apiBase}/sessions/${sessionId}/chat`,
      {
        message,
        user_message_id: messageIds?.userMessageId,
        assistant_message_id: messageIds?.assistantMessageId,
      },
      onDelta,
      onReferences,
      onReasoning,
    );
  }

  async sendFollowUp(
    request: FollowUpRequest,
    onDelta: DeltaCallback,
    onReferences?: ReferencesCallback,
    onReasoning?: ReasoningCallback,
  ): Promise<void> {
    return this.streamRequestWithRetry(
      `${this.apiBase}/sessions/${request.session_id}/follow-up`,
      request,
      onDelta,
      onReferences,
      onReasoning,
    );
  }

  async sendExplainMode(
    sessionId: string,
    body: { message_id: string; original_content: string; mode: string },
    onDelta: DeltaCallback,
    onReasoning?: ReasoningCallback,
  ): Promise<void> {
    return this.streamRequestWithRetry(
      `${this.apiBase}/sessions/${sessionId}/explain`,
      body,
      onDelta,
      undefined,
      onReasoning,
    );
  }

  async verifyToken(token: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiBase}/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async streamRequestWithRetry(
    url: string,
    body: any,
    onDelta: DeltaCallback,
    onReferences?: ReferencesCallback,
    onReasoning?: ReasoningCallback,
  ): Promise<void> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      let receivedStreamOutput = false;
      try {
        await this.streamRequest(
          url,
          body,
          delta => {
            receivedStreamOutput = true;
            onDelta(delta);
          },
          onReferences,
          () => {
            receivedStreamOutput = true;
            onReasoning?.();
          },
        );
        return;
      } catch (e: any) {
        lastError = e;
        // Retrying after partial output would append two provider responses.
        if (receivedStreamOutput) throw e;
        if (e.name === 'AbortError') return;
        if (attempt < this.config.maxRetries) {
          const delay = Math.min(
            this.config.retryBaseDelayMs * Math.pow(2, attempt),
            this.config.retryMaxDelayMs,
          );
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    throw lastError || new Error('SSE request failed');
  }

  private async streamRequest(
    url: string,
    body: any,
    onDelta: DeltaCallback,
    onReferences?: ReferencesCallback,
    onReasoning?: ReasoningCallback,
  ): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    const token = getToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (response.status === 401) throw new Error('Authentication failed');
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
      reader = response.body?.getReader() ?? null;
      if (!reader) throw new Error('No response body');
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line === 'data: : heartbeat' || line.trim() === ': heartbeat') continue;
          if (line.startsWith('data: ')) {
            let data: any;
            try {
              data = JSON.parse(line.slice(6));
            } catch {
              continue;
            }
            if (data.type === 'reasoning') {
              onReasoning?.();
            }
            if (data.delta) {
              onDelta(data.delta);
            }
            if (data.error) {
              throw new Error(data.error);
            }
            if (data.files && onReferences) {
              onReferences(data.files);
            }
          }
        }
      }
    } finally {
      void reader?.cancel().catch(() => undefined);
      clearTimeout(timeoutId);
    }
  }
}

export const sseService = new SSEService();
export default sseService;
