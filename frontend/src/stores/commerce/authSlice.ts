import type { CommerceUser, CoachStatus } from '../../types';
import { request, USER_TOKEN_KEY } from '../../services/apiClient';
import { trackEvent } from '../../services/analyticsService';
import type { CommerceSliceCreator } from './storeShape';

export interface AuthSlice {
  user: CommerceUser | null;
  isBootstrapping: boolean;

  bootstrap: () => Promise<void>;
  login: (account: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => void;
}

let bootstrapPromise: Promise<void> | null = null;

export const createAuthSlice: CommerceSliceCreator<AuthSlice> = (set, get) => ({
  user: null,
  isBootstrapping: true,

  bootstrap: async () => {
    if (bootstrapPromise) return bootstrapPromise;
    bootstrapPromise = (async () => {
      set({ isBootstrapping: true, error: null });
      try {
        const token = localStorage.getItem(USER_TOKEN_KEY);
        if (!token) return;

        const user = await request<CommerceUser>('/auth/me');
        const coachStatus = await request<CoachStatus>('/coach/status');
        set({ user, coachStatus });
        await get().loadModelServices();
        await get().loadWorkspace();
      } catch {
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
      const coachStatus = await request<CoachStatus>('/coach/status');
      set({ user, coachStatus, skill: null, runs: [], currentRun: null });
      await get().loadModelServices();
      await get().loadWorkspace();
    } catch (error: any) {
      localStorage.removeItem(USER_TOKEN_KEY);
      set({ user: null, coachStatus: null, skill: null, runs: [], currentRun: null });
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
      const coachStatus = await request<CoachStatus>('/coach/status');
      set({ user, coachStatus, skill: null, runs: [], currentRun: null });
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
      error: null,
    });
  },
});
