import type { CoachStatus, ModelServiceConfig, CoachStartResult } from '../../types';
import { request } from '../../services/apiClient';
import type { CommerceSliceCreator } from './storeShape';

/** 训练师启动 + 模型服务（BYOK）域 */
export interface CommerceSlice {
  coachStatus: CoachStatus | null;
  modelServices: ModelServiceConfig[];
  selectedModel: string;

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
      set({ error: error?.message || '连接失败，请检查访问密钥' });
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
