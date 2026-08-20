// ===== 基础消息类型 =====
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  threadId: string;
  references?: KnowledgeRef[];
}

// ===== 会话 =====
export interface Session {
  id: string;
  title: string;
  createdAt: number;
  model: string;
}

export interface HarnessThreadState {
  threadId: string;
  parentThreadId: string;
  level: number;
  type: 'text';
  source: {
    selectedText?: string;
    sourceMessageId: string;
    sourceMessageRole: 'user' | 'assistant';
  };
  position: { x: number; y: number };
  size: { width: number; height: number };
  isMinimized: boolean;
  zIndex: number;
  settings?: FollowUpSettings;
  summary?: string;
  isClosed: boolean;
  updatedAt?: number;
}

export interface HarnessSessionDetail extends Session {
  messages: Message[];
  threads: HarnessThreadState[];
  threadMessages: Record<string, Message[]>;
}

// ===== 追问设置 =====
export interface FollowUpSettings {
  /** 回复长度：detailed 详细 / concise 简略 */
  verbosity: 'detailed' | 'concise';
  /** 模型温度：low 0.2 / medium 0.7 / high 1.2 */
  temperature: 'low' | 'medium' | 'high';
}

export const DEFAULT_FOLLOW_UP_SETTINGS: FollowUpSettings = {
  verbosity: 'detailed',
  temperature: 'medium',
};

/** 将前端温度档位转为实际数值 */
export function temperatureValue(t: 'low' | 'medium' | 'high'): number {
  return t === 'low' ? 0.2 : t === 'medium' ? 0.7 : 1.2;
}

// ===== 悬浮窗追问 =====
export interface FloatWindow {
  threadId: string;
  parentThreadId: string;
  level: number;
  type: 'text';
  source: {
    selectedText?: string;
    sourceMessageId: string;
  };
  messages: Message[];
  position: { x: number; y: number };
  size: { width: number; height: number };
  isMinimized: boolean;
  zIndex: number;
  /** 追问设置（可选，每个追问窗独立） */
  settings?: FollowUpSettings;
  /** 该追问窗是否正在流式接收回复 */
  isStreaming?: boolean;
}

// ===== 上下文菜单 =====
export interface MenuItem {
  label: string;
  icon: string;
  action: () => void;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

// ===== 资料库 =====
export interface FileItem {
  id: string;
  name: string;
  type: 'pdf' | 'docx' | 'pptx' | 'txt' | 'md' | 'image';
  size: number;
  uploadedAt: number;
  previewUrl?: string;
}

// ===== 知识引用 =====
export interface KnowledgeRef {
  fileName: string;
  page?: number;
  snippet: string;
}

// ===== API 类型 =====
export interface FollowUpRequest {
  session_id: string;
  parent_thread_id: string;
  thread_id: string;
  level: number;
  source: {
    type: 'text';
    selected_text?: string;
    source_message_id: string;
    source_message_role: 'user' | 'assistant';
  };
  query: string;
  context: {
    main_thread_messages: Message[];
    parent_thread_messages: Message[];
    knowledge_refs?: KnowledgeRef[];
  };
  /** 模型温度数值 */
  temperature?: number;
  /** 回复详细程度 */
  verbosity?: 'detailed' | 'concise';
  user_message_id?: string;
  assistant_message_id?: string;
}

export interface ThreadRegisterRequest {
  parent_thread_id: string;
  thread_id: string;
  level: number;
  source: {
    type: 'text';
    selected_text?: string;
    source_message_id: string;
    source_message_role: 'user' | 'assistant';
  };
  position: { x: number; y: number };
  size: { width: number; height: number };
  zIndex: number;
}

export interface ThreadPatchRequest {
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  is_minimized?: boolean;
  z_index?: number;
  settings?: FollowUpSettings;
  is_closed?: boolean;
}

export interface ChatRequest {
  session_id: string;
  message: string;
  context?: {
    knowledge_refs?: KnowledgeRef[];
  };
}

export interface SSEEvent {
  type: 'message' | 'references' | 'done';
  delta?: string;
  files?: KnowledgeRef[];
  thread_id?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

// ===== 模型配置 =====
export interface ModelConfig {
  name: string;
  apiKey: string;
  baseUrl: string;
}

export const MODEL_BASE_URLS: Record<string, string> = {
  'glm-5.2': 'https://open.bigmodel.cn/api/paas/v4',
  'glm-4-flash': 'https://open.bigmodel.cn/api/paas/v4',
  'deepseek-chat': 'https://api.deepseek.com/v1',
  'gpt-4o': 'https://api.openai.com/v1',
  'moonshot-v1-128k': 'https://api.moonshot.cn/v1',
  'qwen-plus': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
};

export const AI_TOOL_OPTIONS = [
  { model: 'glm-5.2', label: '智谱清言 GLM' },
  { model: 'deepseek-chat', label: 'DeepSeek' },
  { model: 'gpt-4o', label: 'OpenAI' },
  { model: 'moonshot-v1-128k', label: 'Kimi' },
  { model: 'qwen-plus', label: '通义千问' },
];

// ===== 讲解模式 =====
export type ExplainMode = 'simple' | 'standard' | 'advanced';

// ===== 引导状态 =====
export interface OnboardingState {
  hasSeenWelcome: boolean;
  hasSeenFollowUpHint: boolean;
}

// ===== Vibe Coding 超级个体训练师商业类型 =====
export interface CommerceUser {
  id: string;
  email: string;
  account: string;
  displayName: string;
  isAdmin: boolean;
  token: string;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  priceYuan: number;
  pathCount: number;
}

export interface Order {
  id: string;
  productId: string;
  productName: string;
  amountCents: number;
  pathCount: number;
  status: 'pending' | 'paid' | 'cancelled';
  provider: string;
  providerOrderId: string;
  paymentUrl?: string | null;
  providerTransactionId?: string | null;
  createdAt: number;
  paidAt?: number | null;
  sandbox?: boolean;
}

export interface AdminOverview {
  totalUsers: number;
  paidUsers: number;
  disabledUsers: number;
  activeRuns: number;
  pendingOrders: number;
  revenueCents: number;
  analyticsEvents: number;
}

export interface AdminUser {
  id: string;
  email: string;
  account: string;
  displayName: string;
  isAdmin: boolean;
  isDisabled: boolean;
  disabledReason: string;
  createdAt: number;
  orderCount: number;
  paidCount: number;
}

export interface AdminOrder {
  id: string;
  ownerAccount: string;
  productName: string;
  amountCents: number;
  status: string;
  provider: string;
  providerOrderId: string;
  createdAt: number;
  paidAt?: number | null;
}

export interface AdminAuditLog {
  id: string;
  actorId: string;
  actorAccount: string;
  action: string;
  targetType: string;
  targetId: string;
  ip: string;
  userAgent: string;
  detail: Record<string, unknown>;
  createdAt: number;
}

export interface CoachStatus {
  paid: boolean;
  skillInstalled: boolean;
  apiKeyReady: boolean;
  modelName: string;
  activeRunId: string | null;
}

export interface InstalledSkill {
  id: string;
  skillKey: string;
  name: string;
  version: string;
  modelName: string;
  baseUrl: string;
  apiKeyReady: boolean;
  installedAt: number;
}

export interface MvpRunSummary {
  id: string;
  title: string;
  vertical: string;
  status: 'active' | 'completed';
  currentStepOrder: number;
  totalSteps: number;
  createdAt: number;
  completedAt?: number | null;
}

export interface MvpRunStep {
  id: string;
  key: string;
  order: number;
  title: string;
  objective?: string;
  requiredArtifact: string;
  isCompleted: boolean;
  artifactTitle?: string;
}

export interface CurrentMvpStep extends MvpRunStep {
  objective: string;
  tool: string;
  instructions: string;
  template: string;
  artifactContent: string;
}

export interface MvpRunDetail extends MvpRunSummary {
  blocker: string;
  nextAction: string;
  steps: MvpRunStep[];
  currentStep: CurrentMvpStep;
  messages: Message[];
  threads: HarnessThreadState[];
  threadMessages: Record<string, Message[]>;
}

export interface InstallResult {
  skill: InstalledSkill;
  run: MvpRunSummary | null;
}

export interface CoachStartResult {
  status: CoachStatus;
  skill: InstalledSkill;
  run: MvpRunSummary | null;
}

export interface ModelEntryConfig {
  id: string;
  modelId: string;
  displayName: string;
  contextTokens: number;
  maxOutputTokens: number;
  reasoning: 'low' | 'medium' | 'high';
}

export interface ModelServiceConfig {
  id: string;
  displayName: string;
  vendor: string;
  baseUrl: string;
  protocol: 'openai-compatible' | 'native' | 'custom';
  apiKeyReady: boolean;
  version: number;
  models: ModelEntryConfig[];
}

export interface FollowUpThreadMeta {
  parentThreadId: string;
  level: number;
  sourceMessageId: string;
}
