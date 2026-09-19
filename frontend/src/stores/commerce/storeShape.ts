import type { StateCreator } from 'zustand';
import type { AuthSlice } from './authSlice';
import type { CommerceSlice } from './commerceSlice';
import type { WorkspaceSlice } from './workspaceSlice';

/** 全局共享的忙碌/错误通道 */
export interface CommerceBaseSlice {
  isBusy: boolean;
  error: string | null;
  clearError: () => void;
}

/** 单用户模式：无登录态，四个切片组合成对外唯一的 store 形状 */
export type CommerceStore = AuthSlice & CommerceSlice & WorkspaceSlice & CommerceBaseSlice;

