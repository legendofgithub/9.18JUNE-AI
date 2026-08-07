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
