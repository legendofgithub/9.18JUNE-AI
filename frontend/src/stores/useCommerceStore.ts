import { create } from 'zustand';
import { createAuthSlice } from './commerce/authSlice';
import { createCommerceSlice } from './commerce/commerceSlice';
import { createWorkspaceSlice } from './commerce/workspaceSlice';
import type { CommerceStore } from './commerce/storeShape';

/**
 * 组合入口：单用户模式三切片（引导/商业/工作台）+ 全局 busy/error 通道。
 * 对外 hook 名与 state/action 名保持稳定，消费组件零改动。
 */
export const useCommerceStore = create<CommerceStore>()((set, get, store) => ({
  ...createAuthSlice(set, get, store),
  ...createCommerceSlice(set, get, store),
  ...createWorkspaceSlice(set, get, store),
  isBusy: false,
  error: null,
  clearError: () => set({ error: null }),
}));

export default useCommerceStore;
