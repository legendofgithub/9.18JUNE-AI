import type { AdminAuditLog, AdminOverview, AdminUser } from '../../types';
import { request } from '../../services/apiClient';
import type { CommerceSliceCreator } from './storeShape';

/** 管理后台域（自包含：独立 busy/error 通道，不与用户侧混用） */
export interface AdminSlice {
  adminOverview: AdminOverview | null;
  adminUsers: AdminUser[];
  adminAuditLogs: AdminAuditLog[];
  adminError: string | null;
  isAdminBusy: boolean;

  loadAdminData: () => Promise<void>;
  setAdminUserDisabled: (userId: string, disabled: boolean, reason: string) => Promise<boolean>;
}

export const createAdminSlice: CommerceSliceCreator<AdminSlice> = (set, get) => ({
  adminOverview: null,
  adminUsers: [],
  adminAuditLogs: [],
  adminError: null,
  isAdminBusy: false,

  loadAdminData: async () => {
    set({ isAdminBusy: true, adminError: null });
    try {
      const [overview, users, auditLogs] = await Promise.all([
        request<AdminOverview>('/admin/overview'),
        request<AdminUser[]>('/admin/users'),
        request<AdminAuditLog[]>('/admin/audit-logs'),
      ]);
      set({ adminOverview: overview, adminUsers: users, adminAuditLogs: auditLogs });
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
});
