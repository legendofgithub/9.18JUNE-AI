// ===== 消息与追问线程（commerce 工作台使用）=====
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  threadId: string;
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
  summary?: string;
  isClosed: boolean;
  updatedAt?: number;
}

// ===== BYOK 工具选项 =====
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

// ===== Vibe Coding 超级个体训练师商业类型 =====
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
