import type { HarnessPermission } from '../../types';

export type TemperatureLevel = 'low' | 'medium' | 'high';

export const TEMPERATURE_VALUES: Record<TemperatureLevel, number> = {
  low: 0.2,
  medium: 0.7,
  high: 1.2,
};

export function todayText() {
  return new Date().toISOString().slice(0, 10);
}

export function permissionLabel(permission: HarnessPermission) {
  if (permission === 'read-only') return 'Read only';
  if (permission === 'workspace-write') return 'Workspace write';
  return 'Full access';
}

export function statusLabel(status: string) {
  const labels: Record<string, string> = {
    running: '执行中',
    waiting_approval: '等待审批',
    waiting_tool: '可继续',
    finished: '已完成',
    failed: '失败',
    cancelled: '已取消',
    rejected: '已拒绝',
  };
  return labels[status] || status;
}

export function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob(['\ufeff', content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function downloadWord(title: string, content: string) {
  const escaped = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head><body><pre>${escaped}</pre></body></html>`;
  downloadBlob(`${title}.doc`, html, 'application/msword;charset=utf-8');
}

export function downloadPdf(title: string, content: string) {
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head><body><pre>${content}</pre></body></html>`);
  win.document.close();
  win.focus();
  win.print();
}

export function buildDailyReport(
  runTitle: string,
  vertical: string,
  completed: number,
  total: number,
  currentStep: string,
  messages: { role: string; content: string }[],
  permission: HarnessPermission,
  temperature: TemperatureLevel,
) {
  const lines = [
    '# June AI 今日交付成果报告',
    '',
    `日期：${todayText()}`,
    `项目：${runTitle}`,
    `目标人群：${vertical || '待明确'}`,
    `进度：${completed}/${total}`,
    `当前节点：${currentStep}`,
    `权限：${permissionLabel(permission)}`,
    `温度：${temperature}`,
    '',
    '## 近期对话',
    ...messages.slice(-8).map(item => `- ${item.role === 'user' ? '我' : 'AI'}：${item.content.slice(0, 180)}`),
    '',
    '## 下一步',
    '继续完成当前节点交付物，并把可确认的结果写入项目记忆或文档。',
  ];
  return lines.join('\n');
}
