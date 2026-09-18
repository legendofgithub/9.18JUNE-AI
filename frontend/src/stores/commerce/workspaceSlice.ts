import type {
  CoachStatus,
  FollowUpThreadMeta,
  InstalledSkill,
  Message,
  MvpRunDetail,
  MvpRunSummary,
} from '../../types';
import { API_BASE } from '../../config';
import { request, streamRequest } from '../../services/apiClient';
import type { CommerceSliceCreator } from './storeShape';

function localMessage(role: 'user' | 'assistant', content: string, threadId = 'main'): Message {
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    role,
    content,
    timestamp: Date.now(),
    threadId,
  };
}

function restoreFollowUps(detail: MvpRunDetail): {
  messages: Record<string, Message[]>;
  meta: Record<string, FollowUpThreadMeta>;
} {
  const messages: Record<string, Message[]> = {};
  const meta: Record<string, FollowUpThreadMeta> = {};
  for (const thread of detail.threads) {
    const threadId = thread.threadId;
    if (threadId === 'main') continue;
    const items = detail.threadMessages[threadId] || [];
    if (!items.length) continue;
    messages[threadId] = items;
    meta[threadId] = {
      parentThreadId: thread.parentThreadId,
      level: thread.level,
      sourceMessageId: thread.source.sourceMessageId,
    };
  }
  return { messages, meta };
}

/** 训练路径 + 主对话 + 无限追问链域 */
export interface WorkspaceSlice {
  skill: InstalledSkill | null;
  runs: MvpRunSummary[];
  currentRun: MvpRunDetail | null;
  followUpMessages: Record<string, Message[]>;
  followUpMeta: Record<string, FollowUpThreadMeta>;
  isStreaming: boolean;
  followUpStreaming: string | null;

  loadWorkspace: () => Promise<void>;
  selectRun: (runId: string) => Promise<void>;
  createRun: (title: string, vertical: string) => Promise<void>;
  patchStep: (stepId: string, artifactTitle: string, artifactContent: string, completed: boolean) => Promise<void>;
  sendChat: (
    content: string,
    temperature?: number,
    fileContext?: string,
    permission?: 'read-only' | 'workspace-write' | 'full-access',
  ) => Promise<void>;
  sendFollowUp: (params: {
    threadId: string;
    parentThreadId: string;
    level: number;
    sourceMessageId: string;
    selectedText: string;
    query: string;
  }) => Promise<void>;
  adoptFollowUp: (threadId: string, title?: string) => Promise<void>;
}

export const createWorkspaceSlice: CommerceSliceCreator<WorkspaceSlice> = (set, get) => ({
  skill: null,
  runs: [],
  currentRun: null,
  followUpMessages: {},
  followUpMeta: {},
  isStreaming: false,
  followUpStreaming: null,

  loadWorkspace: async () => {
    try {
      const [runs, skill, coachStatus] = await Promise.all([
        request<MvpRunSummary[]>('/mvp-runs'),
        request<InstalledSkill | null>('/skills/current'),
        request<CoachStatus>('/coach/status'),
      ]);
      set({ runs, skill, coachStatus });
      if (skill?.modelName) set({ selectedModel: skill.modelName });
      const current = get().currentRun;
      const preferred = current?.id || runs.find(run => run.status === 'active')?.id || runs[0]?.id;
      if (preferred) {
        await get().selectRun(preferred);
      } else {
        set({ currentRun: null, followUpMessages: {}, followUpMeta: {} });
      }
    } catch (error: any) {
      set({ error: error?.message || '工作区加载失败' });
    }
  },

  selectRun: async runId => {
    set({ isBusy: true, error: null });
    try {
      const detail = await request<MvpRunDetail>(`/mvp-runs/${runId}`);
      const restored = restoreFollowUps(detail);
      set({
        currentRun: detail,
        followUpMessages: restored.messages,
        followUpMeta: restored.meta,
      });
    } catch (error: any) {
      set({ error: error?.message || '路径加载失败' });
    } finally {
      set({ isBusy: false });
    }
  },

  createRun: async (title, vertical) => {
    set({ isBusy: true, error: null });
    try {
      const created = await request<MvpRunSummary>('/mvp-runs', {
        method: 'POST',
        body: JSON.stringify({ title, vertical }),
      });
      await get().loadWorkspace();
      await get().selectRun(created.id);
    } catch (error: any) {
      set({ error: error?.message || '路径创建失败' });
    } finally {
      set({ isBusy: false });
    }
  },

  patchStep: async (stepId, artifactTitle, artifactContent, completed) => {
    const run = get().currentRun;
    if (!run) return;
    set({ isBusy: true, error: null });
    try {
      const detail = await request<MvpRunDetail>(`/mvp-runs/${run.id}/steps/${stepId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          artifact_title: artifactTitle,
          artifact_content: artifactContent,
          completed,
        }),
      });
      const restored = restoreFollowUps(detail);
      set({
        currentRun: detail,
        followUpMessages: restored.messages,
        followUpMeta: restored.meta,
      });
      const runs = get().runs.map(item => item.id === detail.id ? detail : item);
      set({ runs });
    } catch (error: any) {
      set({ error: error?.message || '交付物保存失败' });
    } finally {
      set({ isBusy: false });
    }
  },

  sendChat: async (content, temperature, fileContext, permission) => {
    const state = get();
    const run = state.currentRun;
    if (!run || state.isStreaming || !content.trim()) return;
    if (run.status === 'completed') {
      set({ error: '该路径已完成归档，不能继续提问' });
      return;
    }

    const userMessage = localMessage('user', content.trim());
    const assistantMessage = localMessage('assistant', '');
    set({
      isStreaming: true,
      error: null,
      currentRun: {
        ...run,
        messages: [...run.messages, userMessage, assistantMessage],
      },
    });

    try {
      await streamRequest(`${API_BASE}/mvp-runs/${run.id}/chat`, {
        message: content.trim(),
        temperature,
        file_context: fileContext,
        permission: permission ?? 'read-only',
      }, delta => {
        const current = get().currentRun;
        if (!current) return;
        const messages = [...current.messages];
        const last = messages[messages.length - 1];
        if (last?.role === 'assistant') {
          messages[messages.length - 1] = { ...last, content: last.content + delta };
        }
        set({ currentRun: { ...current, messages } });
      });
      await get().selectRun(run.id);
      set({ isBusy: false });
    } catch (error: any) {
      const current = get().currentRun;
      if (current) {
        const messages = [...current.messages];
        const last = messages[messages.length - 1];
        if (last?.role === 'assistant') {
          messages[messages.length - 1] = { ...last, content: `[请求失败] ${error?.message || String(error)}` };
        }
        set({ currentRun: { ...current, messages } });
      }
      set({ error: error?.message || 'AI 请求失败' });
    } finally {
      set({ isStreaming: false });
    }
  },

  sendFollowUp: async params => {
    const run = get().currentRun;
    if (!run || run.status === 'completed' || !params.query.trim()) return;

    const userMessage = localMessage('user', params.query.trim(), params.threadId);
    const assistantMessage = localMessage('assistant', '', params.threadId);
    set({
      followUpStreaming: params.threadId,
      error: null,
      followUpMessages: {
        ...get().followUpMessages,
        [params.threadId]: [
          ...(get().followUpMessages[params.threadId] || []),
          userMessage,
          assistantMessage,
        ],
      },
      followUpMeta: {
        ...get().followUpMeta,
        [params.threadId]: {
          parentThreadId: params.parentThreadId,
          level: params.level,
          sourceMessageId: params.sourceMessageId,
        },
      },
    });

    try {
      await streamRequest(`${API_BASE}/mvp-runs/${run.id}/follow-up`, {
        session_id: run.id,
        parent_thread_id: params.parentThreadId,
        thread_id: params.threadId,
        level: params.level,
        source: {
          type: 'text',
          selected_text: params.selectedText,
          source_message_id: params.sourceMessageId,
          source_message_role: 'assistant',
        },
        query: params.query.trim(),
        user_message_id: userMessage.id,
        assistant_message_id: assistantMessage.id,
      }, delta => {
        const threads = { ...get().followUpMessages };
        const messages = [...(threads[params.threadId] || [])];
        const last = messages[messages.length - 1];
        if (last?.role === 'assistant') {
          messages[messages.length - 1] = { ...last, content: last.content + delta };
        }
        threads[params.threadId] = messages;
        set({ followUpMessages: threads });
      });
    } catch (error: any) {
      const threads = { ...get().followUpMessages };
      const messages = [...(threads[params.threadId] || [])];
      const last = messages[messages.length - 1];
      if (last?.role === 'assistant') {
        messages[messages.length - 1] = { ...last, content: `[请求失败] ${error?.message || String(error)}` };
      }
      threads[params.threadId] = messages;
      set({ followUpMessages: threads, error: error?.message || '追问失败' });
    } finally {
      set({ followUpStreaming: null });
    }
  },

  adoptFollowUp: async (threadId, title) => {
    const run = get().currentRun;
    if (!run) return;
    set({ isBusy: true, error: null });
    try {
      await request(`/mvp-runs/${run.id}/follow-up/adopt`, {
        method: 'POST',
        body: JSON.stringify({ thread_id: threadId, title: title || null }),
      });
      await get().selectRun(run.id);
    } catch (error: any) {
      set({ error: error?.message || '追问采纳失败' });
    } finally {
      set({ isBusy: false });
    }
  },
});
