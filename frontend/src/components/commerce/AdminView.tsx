import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, Loader2, RefreshCw, ShieldCheck, ShieldOff } from 'lucide-react';
import useCommerceStore from '../../stores/useCommerceStore';
import type { SiteLanguage } from './SiteHeader';

const copy = {
  zh: {
    title: '管理后台',
    refresh: '刷新',
    users: '用户',
    audit: '审计日志',
    totalUsers: '用户',
    disabledUsers: '禁用用户',
    activeRuns: '进行路径',
    events: '埋点事件',
    account: '账号',
    email: '邮箱',
    status: '状态',
    action: '操作',
    disable: '禁用',
    enable: '启用',
    reason: '禁用原因',
    confirmDisable: '确认禁用',
    cancel: '取消',
    admin: '管理员',
    normal: '正常',
    disabled: '已禁用',
    time: '时间',
    actor: '操作者',
    event: '事件',
    target: '对象',
    empty: '暂无数据',
  },
  en: {
    title: 'Admin console',
    refresh: 'Refresh',
    users: 'Users',
    audit: 'Audit logs',
    totalUsers: 'Users',
    disabledUsers: 'Disabled',
    activeRuns: 'Active runs',
    events: 'Analytics events',
    account: 'Account',
    email: 'Email',
    status: 'Status',
    action: 'Action',
    disable: 'Disable',
    enable: 'Enable',
    reason: 'Disable reason',
    confirmDisable: 'Confirm disable',
    cancel: 'Cancel',
    admin: 'Admin',
    normal: 'Active',
    disabled: 'Disabled',
    time: 'Time',
    actor: 'Actor',
    event: 'Event',
    target: 'Target',
    empty: 'No data',
  },
};

function formatTime(timestamp: number, language: SiteLanguage) {
  return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);
}

export default function AdminView({ language }: { language: SiteLanguage }) {
  const overview = useCommerceStore(s => s.adminOverview);
  const users = useCommerceStore(s => s.adminUsers);
  const auditLogs = useCommerceStore(s => s.adminAuditLogs);
  const error = useCommerceStore(s => s.adminError);
  const isBusy = useCommerceStore(s => s.isAdminBusy);
  const loadAdminData = useCommerceStore(s => s.loadAdminData);
  const setAdminUserDisabled = useCommerceStore(s => s.setAdminUserDisabled);
  const text = copy[language];
  const [disableTarget, setDisableTarget] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    void loadAdminData();
  }, [loadAdminData]);

  const metrics = overview ? [
    { label: text.totalUsers, value: overview.totalUsers },
    { label: text.disabledUsers, value: overview.disabledUsers },
    { label: text.activeRuns, value: overview.activeRuns },
    { label: text.events, value: overview.analyticsEvents },
  ] : [];

  return (
    <main className="admin-shell">
      <section className="admin-header">
        <div>
          <h1>{text.title}</h1>
          <Activity size={18} />
        </div>
        <button type="button" className="coach-secondary-button" disabled={isBusy} onClick={() => void loadAdminData()}>
          {isBusy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {text.refresh}
        </button>
      </section>

      {error && (
        <div className="admin-error">
          <AlertTriangle size={15} />
          <span>{error}</span>
        </div>
      )}

      <section className="admin-metric-grid" aria-label={text.title}>
        {metrics.map(item => (
          <div key={item.label} className="admin-metric">
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </section>

      <section className="admin-panel">
        <h2>{text.users}</h2>
        <div className="admin-table-wrap">
          <table>
            <thead>
              <tr>
                <th>{text.account}</th>
                <th>{text.email}</th>
                <th>{text.status}</th>
                <th>{text.action}</th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => (
                <tr key={user.id}>
                  <td>{user.account}</td>
                  <td>{user.email}</td>
                  <td>
                    <span className={user.isAdmin ? 'admin-status is-admin' : user.isDisabled ? 'admin-status is-disabled' : 'admin-status'}>
                      {user.isAdmin ? text.admin : user.isDisabled ? text.disabled : text.normal}
                    </span>
                  </td>
                  <td>
                    {user.isAdmin ? (
                      <span className="admin-no-action">-</span>
                    ) : user.isDisabled ? (
                      <button type="button" disabled={isBusy} onClick={() => void setAdminUserDisabled(user.id, false, '')}>
                        <ShieldCheck size={13} />
                        {text.enable}
                      </button>
                    ) : (
                      <button type="button" disabled={isBusy} onClick={() => {
                        setDisableTarget(user.id);
                        setReason('');
                      }}>
                        <ShieldOff size={13} />
                        {text.disable}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {disableTarget && (
          <div className="admin-disable-bar">
            <label htmlFor="admin-disable-reason">{text.reason}</label>
            <input
              id="admin-disable-reason"
              value={reason}
              maxLength={300}
              onChange={event => setReason(event.target.value)}
            />
            <button
              type="button"
              className="coach-primary-button"
              disabled={isBusy || !reason.trim()}
              onClick={() => {
                void setAdminUserDisabled(disableTarget, true, reason.trim());
                setDisableTarget('');
              }}
            >
              {text.confirmDisable}
            </button>
            <button type="button" className="coach-secondary-button" onClick={() => setDisableTarget('')}>
              {text.cancel}
            </button>
          </div>
        )}
      </section>

      <section className="admin-panel">
        <h2>{text.audit}</h2>
        <div className="admin-table-wrap">
          <table>
            <thead>
              <tr>
                <th>{text.time}</th>
                <th>{text.actor}</th>
                <th>{text.event}</th>
                <th>{text.target}</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.map(log => (
                <tr key={log.id}>
                  <td>{formatTime(log.createdAt, language)}</td>
                  <td>{log.actorAccount || '-'}</td>
                  <td>{log.action}</td>
                  <td>{log.targetType ? `${log.targetType}:${log.targetId}` : '-'}</td>
                  <td>{log.ip || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
