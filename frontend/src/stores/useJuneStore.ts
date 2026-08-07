import { create } from 'zustand';
import type { Message, FloatWindow, ContextMenuState, FileItem, Session, ModelConfig, FollowUpSettings } from '../types';
import { sseService } from '../services/sseService';
import { DEFAULT_FOLLOW_UP_SETTINGS, temperatureValue } from '../types';

const API_BASE = 'http://localhost:8000/api';

/** 从 localStorage 获取 API Token */
function getToken(): string {
  return localStorage.getItem('june_api_token') || '';
}

/** 统一的 API 请求头 */
function apiHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

interface JuneStore {
  // === 连接状态 ===
  tokenValid: boolean;
  setTokenValid: (valid: boolean) => void;

  // === 会话 ===
  sessions: Session[];
  currentSessionId: string | null;
  createSession: () => void;
  switchSession: (id: string) => void;
  deleteSession: (id: string) => void;

  // === 模型配置 ===
  modelConfig: ModelConfig;
  setModel: (name: string) => void;
  setApiKey: (key: string) => void;

  // === 主对话 ===
  mainMessages: Message[];
  isStreaming: boolean;
  sendMessage: (content: string) => Promise<void>;

  // === 资料库 ===
  files: FileItem[];
  isFilePanelOpen: boolean;
  toggleFilePanel: () => void;
  uploadFile: (file: File) => Promise<void>;
  deleteFile: (fileId: string) => void;

  // === 悬浮窗追问系统 ===
  floatWindows: FloatWindow[];
  openTextFollowUp: (params: {
    selectedText: string;
    sourceMessageId: string;
    parentThreadId: string;
    level: number;
    position: { x: number; y: number };
  }) => string;
  closeFloatWindow: (threadId: string, closeChildren?: boolean) => void;
  updateFloatWindowPosition: (threadId: string, position: { x: number; y: number }) => void;
  updateFloatWindowSize: (threadId: string, size: { width: number; height: number }) => void;
  minimizeFloatWindow: (threadId: string) => void;
  restoreFloatWindow: (threadId: string) => void;
  bringToFront: (threadId: string) => void;
  sendFollowUp: (threadId: string, query: string) => Promise<void>;
  /** 更新追问窗设置 */
  updateFloatWindowSettings: (threadId: string, settings: Partial<FollowUpSettings>) => void;

  // === 右键菜单 ===
  contextMenu: ContextMenuState | null;
  showContextMenu: (menu: ContextMenuState) => void;
  hideContextMenu: () => void;
}

const DEFAULT_MODEL: ModelConfig = {
  name: 'deepseek-v4-pro',
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
};

const useJuneStore = create<JuneStore>((set, get) => ({
  // === 连接状态 ===
  // 如果有已保存的 Token 就乐观认为连接有效（实际通信时 SSE 服务直接读 localStorage）
  tokenValid: !!localStorage.getItem('june_api_token'),
  setTokenValid: (valid: boolean) => set({ tokenValid: valid }),

  // === 会话 ===
  sessions: [],
  currentSessionId: null,

  createSession: async () => {
    try {
      const resp = await fetch(`${API_BASE}/sessions`, {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ title: `新对话 ${new Date().toLocaleTimeString('zh-CN')}` }),
      });
      if (resp.ok) {
        const json = await resp.json();
        const session = json.data as Session;
        set(state => ({
          sessions: [...state.sessions, session],
          currentSessionId: session.id,
          mainMessages: [],
          floatWindows: [],
          files: [],
          isFilePanelOpen: false,
        }));
        return;
      }
    } catch (e) {
      console.warn('[June] 后端不可用，使用本地会话', e);
    }
    // 降级：本地创建会话
    const session: Session = {
      id: generateId(),
      title: `新对话 ${new Date().toLocaleTimeString('zh-CN')}`,
      createdAt: Date.now(),
      model: get().modelConfig.name,
    };
    set(state => ({
      sessions: [...state.sessions, session],
      currentSessionId: session.id,
      mainMessages: [],
      floatWindows: [],
      files: [],
      isFilePanelOpen: false,
    }));
  },

  switchSession: (id: string) => {
    set({ currentSessionId: id });
  },

  deleteSession: async (id: string) => {
    // 尝试后端删除
    try {
      await fetch(`${API_BASE}/sessions/${id}`, {
        method: 'DELETE',
        headers: apiHeaders(),
      });
    } catch { /* 忽略 */ }
    set(state => ({
      sessions: state.sessions.filter(s => s.id !== id),
      currentSessionId: state.currentSessionId === id
        ? (state.sessions.filter(s => s.id !== id)[0]?.id ?? null)
        : state.currentSessionId,
    }));
  },

  // === 模型配置 ===
  modelConfig: DEFAULT_MODEL,
  setModel: (name: string) => {
    set(state => ({ modelConfig: { ...state.modelConfig, name } }));
  },
  setApiKey: (key: string) => {
    set(state => ({ modelConfig: { ...state.modelConfig, apiKey: key } }));
  },

  // === 主对话 ===
  mainMessages: [],
  isStreaming: false,

  sendMessage: async (content: string) => {
    const state = get();
    if (!content.trim() || state.isStreaming) return;

    const userMsg: Message = {
      id: generateId(),
      role: 'user',
      content: content.trim(),
      timestamp: Date.now(),
      threadId: 'main',
    };

    const aiMsg: Message = {
      id: generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      threadId: 'main',
    };

    set(state => ({
      mainMessages: [...state.mainMessages, userMsg, aiMsg],
      isStreaming: true,
    }));

    try {
      await sseService.sendChatMessage(
        state.currentSessionId ?? 'default',
        content.trim(),
        (delta: string) => {
          set(state => {
            const msgs = [...state.mainMessages];
            const last = msgs[msgs.length - 1];
            if (last && last.role === 'assistant') {
              msgs[msgs.length - 1] = { ...last, content: last.content + delta };
            }
            return { mainMessages: msgs };
          });
        },
        (references: any[]) => {
          set(state => {
            const msgs = [...state.mainMessages];
            const last = msgs[msgs.length - 1];
            if (last && last.role === 'assistant') {
              msgs[msgs.length - 1] = { ...last, references };
            }
            return { mainMessages: msgs };
          });
        }
      );
    } catch (e: any) {
      console.error('SSE send failed:', e);
      // 将错误写入 AI 消息
      set(state => {
        const msgs = [...state.mainMessages];
        const last = msgs[msgs.length - 1];
        if (last && last.role === 'assistant') {
          msgs[msgs.length - 1] = { ...last, content: `[请求失败] ${e?.message || String(e)}` };
        }
        return { mainMessages: msgs, isStreaming: false };
      });
      return;
    }

    set({ isStreaming: false });
  },

  // === 资料库 ===
  files: [],
  isFilePanelOpen: false,

  toggleFilePanel: () => set(state => ({ isFilePanelOpen: !state.isFilePanelOpen })),

  uploadFile: async (file: File) => {
    const fileItem: FileItem = {
      id: generateId(),
      name: file.name,
      type: getFileType(file.name),
      size: file.size,
      uploadedAt: Date.now(),
    };
    set(state => ({
      files: [...state.files, fileItem],
      isFilePanelOpen: true,
    }));
  },

  deleteFile: (fileId: string) => {
    set(state => ({
      files: state.files.filter(f => f.id !== fileId),
    }));
  },

  // === 悬浮窗追问系统 ===
  floatWindows: [],
  _zIndexCounter: 1000,

  openTextFollowUp: (params) => {
    const state = get();
    const threadId = `followup_${params.parentThreadId}_L${params.level}_${generateId()}`;
    const zIndex = (state as any)._zIndexCounter || 1000;
    (state as any)._zIndexCounter = zIndex + 1;

    const win: FloatWindow = {
      threadId,
      parentThreadId: params.parentThreadId,
      level: params.level,
      type: 'text',
      source: {
        selectedText: params.selectedText,
        sourceMessageId: params.sourceMessageId,
      },
      messages: [],
      position: params.position,
      size: { width: 420, height: 360 },
      isMinimized: false,
      zIndex,
      settings: { ...DEFAULT_FOLLOW_UP_SETTINGS },
    };

    set(state => ({
      floatWindows: [...state.floatWindows, win],
    }));

    return threadId;
  },

  closeFloatWindow: (threadId: string, closeChildren = true) => {
    set(state => {
      let windows = state.floatWindows.filter(w => w.threadId !== threadId);
      if (closeChildren) {
        // 递归关闭子窗口
        const collectChildren = (parentId: string): string[] => {
          const children = windows.filter(w => w.parentThreadId === parentId);
          const ids = children.map(c => c.threadId);
          for (const c of children) {
            ids.push(...collectChildren(c.threadId));
          }
          return ids;
        };
        const childIds = collectChildren(threadId);
        windows = windows.filter(w => !childIds.includes(w.threadId));
      }
      return { floatWindows: windows };
    });
  },

  updateFloatWindowPosition: (threadId, position) => {
    set(state => ({
      floatWindows: state.floatWindows.map(w =>
        w.threadId === threadId ? { ...w, position } : w
      ),
    }));
  },

  updateFloatWindowSize: (threadId, size) => {
    set(state => ({
      floatWindows: state.floatWindows.map(w =>
        w.threadId === threadId ? { ...w, size } : w
      ),
    }));
  },

  minimizeFloatWindow: (threadId) => {
    set(state => ({
      floatWindows: state.floatWindows.map(w =>
        w.threadId === threadId ? { ...w, isMinimized: true } : w
      ),
    }));
  },

  restoreFloatWindow: (threadId) => {
    set(state => ({
      floatWindows: state.floatWindows.map(w =>
        w.threadId === threadId ? { ...w, isMinimized: false } : w
      ),
    }));
  },

  bringToFront: (threadId) => {
    const state = get();
    const zIndex = (state as any)._zIndexCounter || 1000;
    (state as any)._zIndexCounter = zIndex + 1;
    set(state => ({
      floatWindows: state.floatWindows.map(w =>
        w.threadId === threadId ? { ...w, zIndex } : w
      ),
    }));
  },

  sendFollowUp: async (threadId: string, query: string) => {
    const state = get();
    const win = state.floatWindows.find(w => w.threadId === threadId);
    if (!win || !query.trim()) return;

    const userMsg: Message = {
      id: generateId(),
      role: 'user',
      content: query.trim(),
      timestamp: Date.now(),
      threadId,
    };

    const aiMsg: Message = {
      id: generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      threadId,
    };

    // 设置 isStreaming: true，供 FloatWindow 判断是否流式渲染中
    set(state => ({
      floatWindows: state.floatWindows.map(w =>
        w.threadId === threadId
          ? { ...w, messages: [...w.messages, userMsg, aiMsg], isStreaming: true }
          : w
      ),
    }));

    // 构建 parent_thread_messages
    let parentMsgs: Message[] = [];
    if (win.level === 1 && win.parentThreadId === 'main') {
      parentMsgs = state.mainMessages.slice(-10);
    } else {
      const parentWin = state.floatWindows.find(w => w.threadId === win.parentThreadId);
      if (parentWin) {
        parentMsgs = parentWin.messages.slice(-10);
      }
    }

    // SSE 追问
    try {
      const settings = win.settings ?? DEFAULT_FOLLOW_UP_SETTINGS;
      await sseService.sendFollowUp(
          {
            session_id: state.currentSessionId ?? 'default',
            parent_thread_id: win.parentThreadId,
            thread_id: threadId,
            level: win.level,
            source: {
              type: win.type,
              selected_text: win.source.selectedText,
              source_message_id: win.source.sourceMessageId,
              source_message_role: 'assistant' as const,
            },
            query: query.trim(),
            context: {
              main_thread_messages: state.mainMessages.slice(-20),
              parent_thread_messages: parentMsgs,
            },
            temperature: temperatureValue(settings.temperature),
            verbosity: settings.verbosity,
          },
          (delta: string) => {
            set(state => ({
              floatWindows: state.floatWindows.map(w => {
                if (w.threadId !== threadId) return w;
                const msgs = [...w.messages];
                const last = msgs[msgs.length - 1];
                if (last && last.role === 'assistant') {
                  msgs[msgs.length - 1] = { ...last, content: last.content + delta };
                }
                return { ...w, messages: msgs, isStreaming: true };
              }),
            }));
          }
        );
      } catch (e: any) {
        console.error('[L2 Debug] Follow-up SSE failed:', e?.message ?? e, 'level:', win.level, 'threadId:', threadId);
        set(state => ({
          floatWindows: state.floatWindows.map(w => {
            if (w.threadId !== threadId) return w;
            const msgs = [...w.messages];
            const last = msgs[msgs.length - 1];
            if (last && last.role === 'assistant') {
              msgs[msgs.length - 1] = { ...last, content: `[请求失败] ${e?.message ?? String(e)}` };
            }
            return { ...w, messages: msgs, isStreaming: false };
          }),
        }));
        return;
      }

      // 流式结束，关闭 streaming 状态
      set(state => ({
        floatWindows: state.floatWindows.map(w =>
          w.threadId === threadId ? { ...w, isStreaming: false } : w
        ),
      }));
    },

  // === 右键菜单 ===
  contextMenu: null,
  showContextMenu: (menu) => set({ contextMenu: menu }),
  hideContextMenu: () => set({ contextMenu: null }),

  /** 更新追问窗设置（温度/详细程度） */
  updateFloatWindowSettings: (threadId, settings) => {
    set(state => ({
      floatWindows: state.floatWindows.map(w =>
        w.threadId === threadId
          ? { ...w, settings: { ...(w.settings ?? DEFAULT_FOLLOW_UP_SETTINGS), ...settings } }
          : w
      ),
    }));
  },
}));

// 辅助函数
function getFileType(name: string): FileItem['type'] {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['pdf'].includes(ext)) return 'pdf';
  if (['docx', 'doc'].includes(ext)) return 'docx';
  if (['pptx', 'ppt'].includes(ext)) return 'pptx';
  if (['txt'].includes(ext)) return 'txt';
  if (['md'].includes(ext)) return 'md';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return 'image';
  return 'txt';
}

export { useJuneStore };
export default useJuneStore;
