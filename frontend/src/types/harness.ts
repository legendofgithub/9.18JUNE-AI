// ===== Harness 工作区 =====
export type HarnessPermission = 'read-only' | 'workspace-write' | 'full-access';

export interface HarnessMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tokens: number;
  meta: Record<string, unknown>;
  timestamp: number;
}

export interface HarnessSession {
  id: string;
  projectId: string;
  title: string;
  permission: HarnessPermission;
  summary: string;
  createdAt: number;
  updatedAt: number;
  messages: HarnessMessage[];
  agentRun?: AgentRun | null;
}

export interface HarnessProject {
  id: string;
  title: string;
  mvpRunId: string;
  metadata: Record<string, string>;
  createdAt: number;
  updatedAt: number;
  sessions: HarnessSession[];
}

export interface HarnessFile {
  id: string;
  path: string;
  name: string;
  mimeType: string;
  size: number;
  updatedAt: number;
}

export interface HarnessMemory {
  id: string;
  memoryType: string;
  content: string;
  createdAt: number;
}

export interface HarnessDocument {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface HarnessContextComponent {
  name: string;
  tokens: number;
  truncated: boolean;
}

export interface HarnessContext {
  model: string;
  maxContextTokens: number;
  maxOutputTokens: number;
  totalTokens: number;
  budgetTokens: number;
  components: HarnessContextComponent[];
  historyMessageCount: number;
  totalMessageCount: number;
  messages?: Array<Record<string, unknown>>;
}

export interface AgentToolCall {
  id: string;
  agentRunId: string;
  name: string;
  arguments: Record<string, any>;
  result: Record<string, any>;
  status: string;
  error: string;
  startedAt: number;
  endedAt?: number | null;
}

export interface AgentRunEvent {
  id: string;
  type: string;
  payload: Record<string, any>;
  createdAt: number;
}

export interface AgentRun {
  id: string;
  projectId: string;
  sessionId: string;
  status: string;
  permission: HarnessPermission;
  iterations: number;
  startedAt: number;
  finishedAt?: number | null;
  input?: string;
  error?: string;
  context?: HarnessContext;
  events?: AgentRunEvent[];
  toolCalls?: AgentToolCall[];
}
