import { create } from 'zustand';
import { createAuthSlice } from './commerce/authSlice';
import { createCommerceSlice } from './commerce/commerceSlice';
import { createWorkspaceSlice } from './commerce/workspaceSlice';
import { createAdminSlice } from './commerce/adminSlice';
import type { CommerceStore } from './commerce/storeShape';

/**
 * 组合入口：四个领域切片 + 全局 busy/error 通道。
 * 对外 hook 名与全部 state/action 名与拆分前完全一致，消费组件无需改动。
 */
export const useCommerceStore = create<CommerceStore>()((set, get, store) => ({
  ...createAuthSlice(set, get, store),
  ...createCommerceSlice(set, get, store),
  ...createWorkspaceSlice(set, get, store),
  ...createAdminSlice(set, get, store),
  isBusy: false,
  error: null,
  clearError: () => set({ error: null }),
}));

export default useCommerceStore;
