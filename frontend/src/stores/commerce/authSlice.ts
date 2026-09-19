import type { CoachStatus } from '../../types';
import { request } from '../../services/apiClient';
import type { CommerceSliceCreator } from './storeShape';

/** 单用户模式：无登录，bootstrap 只负责装载工作台数据 */
export interface AuthSlice {
  isBootstrapping: boolean;

  bootstrap: () => Promise<void>;
}

let bootstrapPromise: Promise<void> | null = null;

export const createAuthSlice: CommerceSliceCreator<AuthSlice> = (set, get) => ({
  isBootstrapping: true,

  bootstrap: async () => {
    if (bootstrapPromise) return bootstrapPromise;
    bootstrapPromise = (async () => {
      set({ isBootstrapping: true, error: null });
      try {
        const coachStatus = await request<CoachStatus>('/coach/status');
        set({ coachStatus });
        await get().loadModelServices();
        await get().loadWorkspace();
      } catch (error: any) {
        set({ error: error?.message || '初始化失败，请确认本地服务已启动' });
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
});
