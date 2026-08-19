import { create } from 'zustand';
import type { Message, FloatWindow, ContextMenuState, FileItem, Session, ModelConfig, FollowUpSettings, HarnessSessionDetail } from '../types';
import type { ExplainMode } from '../types';
import { sseService } from '../services/sseService';
import { DEFAULT_FOLLOW_UP_SETTINGS, MODEL_BASE_URLS, temperatureValue } from '../types';
import { API_BASE } from '../config';
import {
  restoreFloatWindows,
  toThreadPatchRequest,
  toThreadRegisterRequest,
} from '../utils/harnessRestore';

const THREAD_PATCH_DELAY_MS = 500;
const patchTimers: Record<string, ReturnType<typeof setTimeout>> = {};

function getToken(): string {
  return localStorage.getItem('june_api_token') || '';
}

function apiHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

async function registerThreadOnServer(sessionId: string, win: FloatWindow): Promise<void> {
  try {
    await fetch(`${API_BASE}/sessions/${sessionId}/threads`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify(toThreadRegisterRequest(win)),
    });
  } catch (error) {
    console.warn('[June] 追问线程注册失败，保留本地状态', error);
  }
}

async function patchThreadOnServer(
  sessionId: string,
  threadId: string,
  patch: import('../types').ThreadPatchRequest,
): Promise<void> {
  try {
    await fetch(`${API_BASE}/sessions/${sessionId}/threads/${threadId}`, {
      method: 'PATCH',
      headers: apiHeaders(),
      body: JSON.stringify(patch),
    });
  } catch (error) {
    console.warn('[June] 追问窗口状态保存失败', error);
  }
}

function clearThreadPatchTimer(threadId: string): void {
  const timer = patchTimers[threadId];
  if (timer) {
    clearTimeout(timer);
    delete patchTimers[threadId];
  }
}

function scheduleThreadPatch(threadId: string): void {
  clearThreadPatchTimer(threadId);
  patchTimers[threadId] = setTimeout(() => {
    delete patchTimers[threadId];
    const state = useJuneStore.getState();
    const sessionId = state.currentSessionId;
    const win = state.floatWindows.find(item => item.threadId === threadId);
    if (!sessionId || !win) return;
    void patchThreadOnServer(sessionId, threadId, toThreadPatchRequest(win));
  }, THREAD_PATCH_DELAY_MS);
}

function flushThreadPatchTimers(): void {
  const state = useJuneStore.getState();
  const sessionId = state.currentSessionId;
  Object.keys(patchTimers).forEach(threadId => {
    clearThreadPatchTimer(threadId);
    const win = state.floatWindows.find(item => item.threadId === threadId);
    if (sessionId && win) {
      void patchThreadOnServer(sessionId, threadId, toThreadPatchRequest(win));
    }
  });
}

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

interface JuneStore {
  tokenValid: boolean;
  setTokenValid: (valid: boolean) => void;

  sessions: Session[];
  currentSessionId: string | null;
  createSession: () => Promise<void>;
  loadSessions: () => Promise<void>;
  loadSessionMessages: (id: string) => Promise<void>;
  switchSession: (id: string) => void;
  deleteSession: (id: string) => Promise<void>;

  modelConfig: ModelConfig;
  setModel: (name: string) => void;
  setBaseUrl: (url: string) => void;
  setApiKey: (key: string) => void;
  applyModelConfig: () => Promise<boolean>;

  mainMessages: Message[];
  isStreaming: boolean;
  sendMessage: (content: string) => Promise<void>;
  reasoningMessageId: string | null;

  files: FileItem[];
  isFilePanelOpen: boolean;
  toggleFilePanel: () => void;
  uploadFile: (file: File) => Promise<void>;
  deleteFile: (fileId: string) => Promise<void>;

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
  updateFloatWindowSettings: (threadId: string, settings: Partial<FollowUpSettings>) => void;

  contextMenu: ContextMenuState | null;
  showContextMenu: (menu: ContextMenuState) => void;
  hideContextMenu: () => void;

  // === 讲解模式 ===
  explainMode: ExplainMode;
  setExplainMode: (mode: ExplainMode) => void;
  explainLoading: boolean;
  requestExplain: (messageId: string, originalContent: string, mode: ExplainMode) => Promise<void>;

  // === 引导 ===
  hasSeenWelcome: boolean;
  dismissWelcome: () => void;
}

function readInitialModelName(): string {
  try {
    return localStorage.getItem('june_model') || 'glm-5.2';
  } catch {
    return 'glm-5.2';
  }
}

const DEFAULT_MODEL: ModelConfig = {
  name: readInitialModelName(),
  apiKey: '',
  baseUrl: MODEL_BASE_URLS[readInitialModelName()] ?? 'https://open.bigmodel.cn/api/paas/v4',
};

const useJuneStore = create<JuneStore>((set, get) => ({
  tokenValid: !!localStorage.getItem('june_api_token'),
  setTokenValid: (valid: boolean) => set({ tokenValid: valid }),

  sessions: [],
  currentSessionId: null,

  loadSessions: async () => {
    try {
      const resp = await fetch(`${API_BASE}/sessions`, { headers: apiHeaders() });
      if (resp.ok) {
        const json = await resp.json();
        const sessions: Session[] = json.data || [];
       if (sessions.length > 0) {
          set({
            sessions,
            currentSessionId: sessions[0].id,
          });
          // 加载第一个会话的消息
          get().loadSessionMessages(sessions[0].id);
        }
      }
    } catch (e) {
      console.warn('[June] 加载会话列表失败', e);
    }
  },

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
          sessions: [session, ...state.sessions],
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
    const session: Session = {
      id: generateId(),
      title: `新对话 ${new Date().toLocaleTimeString('zh-CN')}`,
      createdAt: Date.now(),
      model: get().modelConfig.name,
    };
    set(state => ({
      sessions: [session, ...state.sessions],
      currentSessionId: session.id,
      mainMessages: [],
      floatWindows: [],
      files: [],
      isFilePanelOpen: false,
    }));
  },

  switchSession: (id: string) => {
    flushThreadPatchTimers();
    // 加载目标会话的消息历史
    get().loadSessionMessages(id);
    set({ currentSessionId: id });
  },

  loadSessionMessages: async (id: string) => {
    try {
      const resp = await fetch(`${API_BASE}/sessions/${id}`, { headers: apiHeaders() });
      if (resp.ok) {
        const json = await resp.json();
        const data = json.data as HarnessSessionDetail;
        if (data && data.messages) {
          set({
            mainMessages: data.messages,
            floatWindows: restoreFloatWindows(data, {
              viewportWidth: window.innerWidth,
              viewportHeight: window.innerHeight,
            }),
          });
        }
      }
    } catch (e) {
      console.warn('[June] 加载会话消息失败', e);
    }
  },

  deleteSession: async (id: string) => {
    try {
      await fetch(`${API_BASE}/sessions/${id}`, {
        method: 'DELETE',
        headers: apiHeaders(),
      });
    } catch { /* 忽略 */ }
    set(state => {
      const remaining = state.sessions.filter(s => s.id !== id);
      return {
        sessions: remaining,
        currentSessionId: state.currentSessionId === id
          ? (remaining[0]?.id ?? null)
          : state.currentSessionId,
      };
    });
  },

  modelConfig: DEFAULT_MODEL,
  setModel: (name: string) => {
    set(state => ({
      modelConfig: {
        ...state.modelConfig,
        name,
        baseUrl: MODEL_BASE_URLS[name] ?? state.modelConfig.baseUrl,
      },
    }));
  },
  setApiKey: (key: string) => {
    set(state => ({ modelConfig: { ...state.modelConfig, apiKey: key } }));
  },

  setBaseUrl: (url: string) => {
    set(state => ({ modelConfig: { ...state.modelConfig, baseUrl: url } }));
  },

  applyModelConfig: async () => {
    const config = get().modelConfig;
    try {
      const resp = await fetch(`${API_BASE}/config/model`, {
        method: 'PUT',
        headers: apiHeaders(),
        body: JSON.stringify({
          name: config.name,
          api_key: config.apiKey || undefined,
          base_url: config.baseUrl,
        }),
      });
      if (!resp.ok) return false;
      localStorage.setItem('june_model', config.name);
      return true;
    } catch (e) {
      console.warn('[June] 模型配置应用失败', e);
      return false;
    }
  },

  mainMessages: [],
  isStreaming: false,
  reasoningMessageId: null,

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
            return { mainMessages: msgs, reasoningMessageId: null };
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
        },
         () => {
           set({ reasoningMessageId: aiMsg.id });
         },
         {
           userMessageId: userMsg.id,
           assistantMessageId: aiMsg.id,
         },
       );
    } catch (e: any) {
      console.error('SSE send failed:', e);
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

    set({ isStreaming: false, reasoningMessageId: null });
  },

  files: [],
  isFilePanelOpen: false,

  toggleFilePanel: () => set(state => ({ isFilePanelOpen: !state.isFilePanelOpen })),

  uploadFile: async (file: File) => {
    const sessionId = get().currentSessionId;
    if (!sessionId) return;

    try {
      const formData = new FormData();
      formData.append('file', file);
      const token = getToken();
      const resp = await fetch(`${API_BASE}/sessions/${sessionId}/files`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (resp.ok) {
        const json = await resp.json();
        const fileItem = json.data as FileItem;
        set(state => ({
          files: [...state.files, fileItem],
          isFilePanelOpen: true,
        }));
        return;
      }
    } catch (e) {
      console.warn('[June] 文件上传失败，使用本地记录', e);
    }
    // 降级：本地记录
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

  deleteFile: async (fileId: string) => {
    const sessionId = get().currentSessionId;
    if (sessionId) {
      try {
        await fetch(`${API_BASE}/sessions/${sessionId}/files/${fileId}`, {
          method: 'DELETE',
          headers: apiHeaders(),
        });
      } catch { /* 忽略 */ }
    }
    set(state => ({
      files: state.files.filter(f => f.id !== fileId),
    }));
  },

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

    if (state.currentSessionId) {
      void registerThreadOnServer(state.currentSessionId, win);
    }

    return threadId;
  },

  closeFloatWindow: (threadId: string, closeChildren = true) => {
    const stateBeforeClose = get();
    const closedByThisAction: string[] = [threadId];
    if (closeChildren) {
      const collectChildren = (parentId: string): string[] => {
        const children = stateBeforeClose.floatWindows.filter(w => w.parentThreadId === parentId);
        return children.flatMap(child => [child.threadId, ...collectChildren(child.threadId)]);
      };
      closedByThisAction.push(...collectChildren(threadId));
    }

    set(state => {
      let windows = state.floatWindows.filter(w => w.threadId !== threadId);
      if (closeChildren) {
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

    const sessionId = stateBeforeClose.currentSessionId;
    closedByThisAction.forEach(id => {
      clearThreadPatchTimer(id);
      const win = stateBeforeClose.floatWindows.find(item => item.threadId === id);
      if (sessionId && win) {
        void patchThreadOnServer(sessionId, id, toThreadPatchRequest(win, { isClosed: true }));
      }
    });
  },

  updateFloatWindowPosition: (threadId, position) => {
    set(state => ({
      floatWindows: state.floatWindows.map(w =>
        w.threadId === threadId ? { ...w, position } : w
      ),
    }));
    scheduleThreadPatch(threadId);
  },

  updateFloatWindowSize: (threadId, size) => {
    set(state => ({
      floatWindows: state.floatWindows.map(w =>
        w.threadId === threadId ? { ...w, size } : w
      ),
    }));
    scheduleThreadPatch(threadId);
  },

  minimizeFloatWindow: (threadId) => {
    set(state => ({
      floatWindows: state.floatWindows.map(w =>
        w.threadId === threadId ? { ...w, isMinimized: true } : w
      ),
    }));
    scheduleThreadPatch(threadId);
  },

  restoreFloatWindow: (threadId) => {
    set(state => ({
      floatWindows: state.floatWindows.map(w =>
        w.threadId === threadId ? { ...w, isMinimized: false } : w
      ),
    }));
    scheduleThreadPatch(threadId);
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
    scheduleThreadPatch(threadId);
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

    set(state => ({
      floatWindows: state.floatWindows.map(w =>
        w.threadId === threadId
          ? { ...w, messages: [...w.messages, userMsg, aiMsg], isStreaming: true }
          : w
      ),
    }));

    let parentMsgs: Message[] = [];
    if (win.level === 1 && win.parentThreadId === 'main') {
      parentMsgs = state.mainMessages.slice(-10);
    } else {
      const parentWin = state.floatWindows.find(w => w.threadId === win.parentThreadId);
      if (parentWin) {
        parentMsgs = parentWin.messages.slice(-10);
      }
    }

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
            user_message_id: userMsg.id,
            assistant_message_id: aiMsg.id,
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
              reasoningMessageId: null,
            }));
          },
          undefined,
          () => {
            set({ reasoningMessageId: aiMsg.id });
          },
        );
      } catch (e: any) {
        console.error('Follow-up SSE failed:', e?.message ?? e, 'level:', win.level, 'threadId:', threadId);
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

      set(state => ({
        floatWindows: state.floatWindows.map(w =>
          w.threadId === threadId ? { ...w, isStreaming: false } : w
        ),
      }));
    },

  contextMenu: null,
  showContextMenu: (menu) => set({ contextMenu: menu }),
  hideContextMenu: () => set({ contextMenu: null }),

  updateFloatWindowSettings: (threadId, settings) => {
    set(state => ({
     floatWindows: state.floatWindows.map(w =>
       w.threadId === threadId
         ? { ...w, settings: { ...(w.settings ?? DEFAULT_FOLLOW_UP_SETTINGS), ...settings } }
         : w
     ),
   }));
 scheduleThreadPatch(threadId);
 },

  // === 讲解模式 ===
  explainMode: 'standard',
  explainLoading: false,
  setExplainMode: (mode: ExplainMode) => set({ explainMode: mode }),

  requestExplain: async (messageId: string, originalContent: string, mode: ExplainMode) => {
    const state = get();
    const sessionId = state.currentSessionId;
    if (!sessionId || state.explainLoading) return;

    set({ explainLoading: true });

    // 替换目标消息内容为空，准备接收新解释
    set(s => ({
      mainMessages: s.mainMessages.map(m =>
        m.id === messageId ? { ...m, content: '' } : m
      ),
    }));

    try {
      await sseService.sendExplainMode(
        sessionId,
        { message_id: messageId, original_content: originalContent, mode },
        (delta: string) => {
         set(s => ({
           mainMessages: s.mainMessages.map(m =>
             m.id === messageId
               ? { ...m, content: m.content + delta }
               : m
           ),
            reasoningMessageId: null,
          }));
         },
         () => {
          set({ reasoningMessageId: messageId });
        },
      );
   } catch (e: any) {
     set(s => ({
       mainMessages: s.mainMessages.map(m =>
         m.id === messageId
            ? { ...m, content: originalContent }
           : m
       ),
     }));
   } finally {
      set({ explainLoading: false, reasoningMessageId: null });
   }
  },

  // === 引导 ===
  hasSeenWelcome: (() => {
    try { return localStorage.getItem('june_onboarding_done') === '1'; } catch { return true; }
  })(),
  dismissWelcome: () => {
    try { localStorage.setItem('june_onboarding_done', '1'); } catch { /* ignore */ }
    set({ hasSeenWelcome: true });
  },
}));

export { useJuneStore };
export default useJuneStore;
