import { create } from 'zustand';
import type {
  CoachStartResult,
  CoachStatus,
  CommerceUser,
  AdminAuditLog,
  AdminOrder,
  AdminOverview,
  AdminUser,
  ModelServiceConfig,
  FollowUpThreadMeta,
  InstalledSkill,
  Message,
  MvpRunDetail,
  MvpRunSummary,
  Order,
  Product,
} from '../types';
import { API_BASE } from '../config';
import { trackEvent } from '../services/analyticsService';
import { authHeaders, request, streamRequest, USER_TOKEN_KEY } from '../services/apiClient';

let bootstrapPromise: Promise<void> | null = null;

function localMessage(role: 'user' | 'assistant', content: string, threadId = 'main'): Message {
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    role,
    content,
    timestamp: Date.now(),
    threadId,
  };
}

interface CommerceStore {
  user: CommerceUser | null;
  products: Product[];
  coachStatus: CoachStatus | null;
  modelServices: ModelServiceConfig[];
  selectedModel: string;
  skill: InstalledSkill | null;
  runs: MvpRunSummary[];
  currentRun: MvpRunDetail | null;
  followUpMessages: Record<string, Message[]>;
  followUpMeta: Record<string, FollowUpThreadMeta>;
  lastOrder: Order | null;
  orders: Order[];
  isBootstrapping: boolean;
  isBusy: boolean;
  isStreaming: boolean;
  followUpStreaming: string | null;
  error: string | null;
  adminOverview: AdminOverview | null;
  adminUsers: AdminUser[];
  adminOrders: AdminOrder[];
  adminAuditLogs: AdminAuditLog[];
  adminError: string | null;
  isAdminBusy: boolean;

  bootstrap: () => Promise<void>;
  login: (account: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => void;
  createOrder: (productId: string) => Promise<void>;
  confirmOrder: (transactionId: string) => Promise<void>;
  refreshOrderStatus: () => Promise<boolean>;
  dismissOrder: () => void;
  loadOrders: () => Promise<void>;
  startCoach: (modelName: string, baseUrl: string, apiKey?: string) => Promise<boolean>;
  loadModelServices: () => Promise<void>;
  saveModelService: (payload: any, serviceId?: string) => Promise<ModelServiceConfig | null>;
  deleteModelService: (serviceId: string) => Promise<boolean>;
  discoverModels: (serviceId: string, baseUrl: string, apiKey?: string) => Promise<any[] | null>;
  activateModel: (serviceId: string, modelId: string) => Promise<boolean>;
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
  clearError: () => void;
  loadAdminData: () => Promise<void>;
  setAdminUserDisabled: (userId: string, disabled: boolean, reason: string) => Promise<boolean>;
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

export const useCommerceStore = create<CommerceStore>((set, get) => ({
  user: null,
  products: [],
  coachStatus: null,
  modelServices: [],
  selectedModel: '',
  skill: null,
  runs: [],
  currentRun: null,
  followUpMessages: {},
  followUpMeta: {},
  lastOrder: null,
  orders: [],
  isBootstrapping: true,
  isBusy: false,
  isStreaming: false,
  followUpStreaming: null,
  error: null,
  adminOverview: null,
  adminUsers: [],
  adminOrders: [],
  adminAuditLogs: [],
  adminError: null,
  isAdminBusy: false,

  bootstrap: async () => {
    if (bootstrapPromise) return bootstrapPromise;
    bootstrapPromise = (async () => {
      set({ isBootstrapping: true, error: null });
      try {
        const token = localStorage.getItem(USER_TOKEN_KEY);
        if (!token) {
          const products = await request<Product[]>('/products');
          set({ products });
          return;
        }

        const user = await request<CommerceUser>('/auth/me');
        const [products, orders, coachStatus] = await Promise.all([
          request<Product[]>('/products'),
          request<Order[]>('/orders'),
          request<CoachStatus>('/coach/status'),
        ]);
      set({ user, products, orders, coachStatus });
      await get().loadModelServices();
      await get().loadWorkspace();
      } catch (error: any) {
        localStorage.removeItem(USER_TOKEN_KEY);
        set({ user: null, coachStatus: null, skill: null, runs: [], currentRun: null });
      } finally {
        set({ isBootstrapping: false });
      }
    })();

    try {
      return await bootstrapPromise;
    } finally {
      bootstrapPromise = null;
    }
  },

  login: async (account, password) => {
    set({ isBusy: true, error: null });
    try {
      const user = await request<CommerceUser>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ account, password }),
      });
      trackEvent('auth.login_success');
      localStorage.setItem(USER_TOKEN_KEY, user.token);
      const [products, orders, coachStatus] = await Promise.all([
        request<Product[]>('/products'),
        request<Order[]>('/orders'),
        request<CoachStatus>('/coach/status'),
      ]);
      set({ user, products, orders, coachStatus, skill: null, runs: [], currentRun: null });
      await get().loadModelServices();
      await get().loadWorkspace();
    } catch (error: any) {
      localStorage.removeItem(USER_TOKEN_KEY);
        set({ user: null, products: [], coachStatus: null, skill: null, runs: [], currentRun: null });
      set({ error: error?.message || '登录失败' });
    } finally {
      set({ isBusy: false });
    }
  },

  register: async (email, password, displayName) => {
    set({ isBusy: true, error: null });
    try {
      const user = await request<CommerceUser>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, display_name: displayName }),
      });
      localStorage.setItem(USER_TOKEN_KEY, user.token);
      const [products, orders, coachStatus] = await Promise.all([
        request<Product[]>('/products'),
        request<Order[]>('/orders'),
        request<CoachStatus>('/coach/status'),
      ]);
      set({ user, products, orders, coachStatus, skill: null, runs: [], currentRun: null });
    } catch (error: any) {
      set({ error: error?.message || '注册失败' });
    } finally {
      set({ isBusy: false });
    }
  },

  logout: () => {
    localStorage.removeItem(USER_TOKEN_KEY);
    set({
      user: null,
      coachStatus: null,
      modelServices: [],
      selectedModel: '',
      skill: null,
      runs: [],
      currentRun: null,
      followUpMessages: {},
      followUpMeta: {},
      lastOrder: null,
      orders: [],
      error: null,
    });
  },

  createOrder: async productId => {
    set({ isBusy: true, error: null });
    try {
      const order = await request<Order>('/orders', {
        method: 'POST',
        body: JSON.stringify({ product_id: productId }),
      });
      trackEvent('commerce.checkout_start', '#/payment', {
        product_id: productId,
        provider: order.provider,
      });
      const [orders, coachStatus] = await Promise.all([
        request<Order[]>('/orders'),
        request<CoachStatus>('/coach/status'),
      ]);
      set({ lastOrder: order, coachStatus });
    } catch (error: any) {
      set({ error: error?.message || '订单创建失败' });
    } finally {
      set({ isBusy: false });
    }
  },

  confirmOrder: async transactionId => {
    const order = get().lastOrder;
    if (!order) return;
    set({ isBusy: true, error: null });
    try {
      const paid = await request<Order>(`/orders/${order.id}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ provider_transaction_id: transactionId }),
      });
      trackEvent('commerce.payment_confirmed', '#/payment', {
        provider: paid.provider,
      });
      const [orders, coachStatus] = await Promise.all([
        request<Order[]>('/orders'),
        request<CoachStatus>('/coach/status'),
      ]);
      set({ lastOrder: paid, coachStatus });
    } catch (error: any) {
      set({ error: error?.message || '支付确认失败' });
    } finally {
      set({ isBusy: false });
    }
  },

  refreshOrderStatus: async () => {
    const order = get().lastOrder;
    if (!order) return false;
    set({ isBusy: true, error: null });
    try {
      const [orders, coachStatus] = await Promise.all([
        request<Order[]>('/orders'),
        request<CoachStatus>('/coach/status'),
      ]);
      const updated = orders.find(item => item.id === order.id) || order;
      set({ orders, coachStatus, lastOrder: updated });
      if (updated.status === 'paid') {
        trackEvent('commerce.payment_detected', '#/payment', { provider: updated.provider });
        return true;
      }
      return false;
    } catch (error: any) {
      set({ error: error?.message || '支付状态刷新失败' });
      return false;
    } finally {
      set({ isBusy: false });
    }
  },

  dismissOrder: () => set({ lastOrder: null }),

  loadOrders: async () => {
    try {
      const orders = await request<Order[]>('/orders');
      set({ orders });
    } catch (error: any) {
      set({ error: error?.message || '购买历史加载失败' });
    }
  },

  startCoach: async (modelName, baseUrl, apiKey = '') => {
    set({ isBusy: true, error: null });
    try {
      const result = await request<CoachStartResult>(
        '/coach/start',
        {
          method: 'POST',
          body: JSON.stringify({
            model_name: modelName,
            base_url: baseUrl,
            api_key: apiKey,
          }),
        },
      );
      set({
        skill: result.skill,
        coachStatus: result.status,
      });
      await get().loadWorkspace();
      return true;
    } catch (error: any) {
      set({ error: error?.message || '启动超级个体训练师失败，请检查访问密钥' });
      return false;
    } finally {
      set({ isBusy: false });
    }
  },

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

  clearError: () => set({ error: null }),

  loadAdminData: async () => {
    set({ isAdminBusy: true, adminError: null });
    try {
      const [overview, users, orders, auditLogs] = await Promise.all([
        request<AdminOverview>('/admin/overview'),
        request<AdminUser[]>('/admin/users'),
        request<AdminOrder[]>('/admin/orders'),
        request<AdminAuditLog[]>('/admin/audit-logs'),
      ]);
      set({ adminOverview: overview, adminUsers: users, adminOrders: orders, adminAuditLogs: auditLogs });
    } catch (error: any) {
      set({ adminError: error?.message || '管理数据加载失败' });
    } finally {
      set({ isAdminBusy: false });
    }
  },

  setAdminUserDisabled: async (userId, disabled, reason) => {
    set({ isAdminBusy: true, adminError: null });
    try {
      await request<AdminUser>(`/admin/users/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ disabled, reason }),
      });
      await get().loadAdminData();
      return true;
    } catch (error: any) {
      set({ adminError: error?.message || '用户状态更新失败' });
      return false;
    } finally {
      set({ isAdminBusy: false });
    }
  },

  loadModelServices: async () => {
    try {
      const modelServices = await request<ModelServiceConfig[]>('/model-services');
      set({ modelServices });
    } catch (error: any) {
      set({ error: error?.message || '模型服务加载失败' });
    }
  },

  saveModelService: async (payload, serviceId) => {
    set({ isBusy: true, error: null });
    try {
      const saved = await request<ModelServiceConfig>(
        serviceId ? `/model-services/${serviceId}` : '/model-services',
        {
          method: serviceId ? 'PUT' : 'POST',
          body: JSON.stringify(payload),
        },
      );
      await get().loadModelServices();
      return saved;
    } catch (error: any) {
      set({ error: error?.message || '模型服务保存失败' });
      return null;
    } finally {
      set({ isBusy: false });
    }
  },

  deleteModelService: async serviceId => {
    set({ isBusy: true, error: null });
    try {
      await request(`/model-services/${serviceId}`, { method: 'DELETE' });
      await get().loadModelServices();
      return true;
    } catch (error: any) {
      set({ error: error?.message || '模型服务删除失败' });
      return false;
    } finally {
      set({ isBusy: false });
    }
  },

  discoverModels: async (serviceId, baseUrl, apiKey = '') => {
    set({ isBusy: true, error: null });
    try {
      return await request<any[]>(`/model-services/${serviceId}/discover`, {
        method: 'POST',
        body: JSON.stringify({ base_url: baseUrl, api_key: apiKey }),
      });
    } catch (error: any) {
      set({ error: error?.message || '模型探测失败' });
      return null;
    } finally {
      set({ isBusy: false });
    }
  },

  activateModel: async (serviceId, modelId) => {
    set({ isBusy: true, error: null });
    try {
      await request(`/model-services/${serviceId}/activate/${encodeURIComponent(modelId)}`, { method: 'POST' });
      await get().loadWorkspace();
      set({ selectedModel: modelId });
      return true;
    } catch (error: any) {
      set({ error: error?.message || '模型切换失败' });
      return false;
    } finally {
      set({ isBusy: false });
    }
  },
}));

export default useCommerceStore;
