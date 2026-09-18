import type { CoachStatus, ModelServiceConfig, Order, CoachStartResult } from '../../types';
import { request } from '../../services/apiClient';
import { trackEvent } from '../../services/analyticsService';
import type { CommerceSliceCreator } from './storeShape';

/** 订单支付 + 训练师启动 + 模型服务（BYOK）域 */
export interface CommerceSlice {
  coachStatus: CoachStatus | null;
  modelServices: ModelServiceConfig[];
  selectedModel: string;
  lastOrder: Order | null;
  orders: Order[];

  createOrder: (productId: string) => Promise<void>;
  confirmOrder: (transactionId: string) => Promise<void>;
  refreshOrderStatus: () => Promise<boolean>;
  dismissOrder: () => void;
  startCoach: (modelName: string, baseUrl: string, apiKey?: string) => Promise<boolean>;
  loadModelServices: () => Promise<void>;
  saveModelService: (payload: any, serviceId?: string) => Promise<ModelServiceConfig | null>;
  deleteModelService: (serviceId: string) => Promise<boolean>;
  discoverModels: (serviceId: string, baseUrl: string, apiKey?: string) => Promise<any[] | null>;
  activateModel: (serviceId: string, modelId: string) => Promise<boolean>;
}

export const createCommerceSlice: CommerceSliceCreator<CommerceSlice> = (set, get) => ({
  coachStatus: null,
  modelServices: [],
  selectedModel: '',
  lastOrder: null,
  orders: [],

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
});
