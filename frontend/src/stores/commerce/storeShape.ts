import type { StateCreator } from 'zustand';
import type { AuthSlice } from './authSlice';
import type { CommerceSlice } from './commerceSlice';
import type { WorkspaceSlice } from './workspaceSlice';
import type { AdminSlice } from './adminSlice';

/** 全局共享的忙碌/错误通道（admin 域有独立的 isAdminBusy/adminError） */
export interface CommerceBaseSlice {
  isBusy: boolean;
  error: string | null;
  clearError: () => void;
}

/** 对外唯一的 store 形状：四个领域切片 + base 层的交集。消费组件的 selector 名称全部保持不变 */
export type CommerceStore = AuthSlice & CommerceSlice & WorkspaceSlice & AdminSlice & CommerceBaseSlice;

export type CommerceSliceCreator<T> = StateCreator<CommerceStore, [], [], T>;
