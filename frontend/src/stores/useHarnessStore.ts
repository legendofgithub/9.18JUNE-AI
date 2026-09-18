import { create } from 'zustand';
import type {
  AgentRun,
  AgentRunEvent,
  AgentToolCall,
  HarnessContext,
  HarnessDocument,
  HarnessFile,
  HarnessMemory,
  HarnessMessage,
  HarnessPermission,
  HarnessProject,
} from '../types';
import { API_BASE } from '../config';
import { authHeaders, request, streamEvents } from '../services/apiClient';

const LOCAL_WORKSPACE_PREFIX = 'june_project_workspace_';
const MIGRATED_SUFFIX = '_migrated';
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'yaml', 'yml',
  'py', 'js', 'ts', 'tsx', 'jsx', 'css', 'html', 'xml', 'svg',
  'log', 'ini', 'toml', 'sql', 'sh', 'ps1',
]);

function localMessage(role: HarnessMessage['role'], content: string): HarnessMessage {
  return {
    id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    tokens: 0,
    meta: {},
    timestamp: Date.now(),
  };
}

function readStoredProjects(userId: string): any[] {
  try {
    const raw = localStorage.getItem(`${LOCAL_WORKSPACE_PREFIX}${userId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function readSnapshot(files: FileList): Promise<any[]> {
  const selected = Array.from(files).slice(0, 200);
  if (Array.from(files).length > 200) {
    throw new Error('单次最多上传 200 个文件');
  }
  let total = 0;
  const encoder = new TextEncoder();
  const payload: any[] = [];
  for (const file of selected) {
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    const relative = (file as any).webkitRelativePath || file.name;
    if (!TEXT_EXTENSIONS.has(extension) && !file.type.startsWith('text/')) continue;
    if (file.size > 10 * 1024 * 1024) throw new Error(`文件超过 10MB 限制：${relative}`);
    const content = await file.text();
    if (content.includes('\x00')) throw new Error(`文件包含二进制空字节：${relative}`);
    total += encoder.encode(content).length;
    if (total > 100 * 1024 * 1024) throw new Error('单次上传总量超过 100MB');
    payload.push({
      path: relative,
      name: file.name,
      mime_type: file.type || 'text/plain',
      content,
    });
  }
  return payload;
}

interface HarnessStore {
  projects: HarnessProject[];
  activeProjectId: string;
  activeSessionId: string;
  files: HarnessFile[];
  memories: HarnessMemory[];
  documents: HarnessDocument[];
  context: HarnessContext | null;
  activeRun: AgentRun | null;
  runEvents: AgentRunEvent[];
  toolCalls: AgentToolCall[];
  approval: Record<string, any> | null;
  isBootstrapping: boolean;
  isBusy: boolean;
  isRunning: boolean;
  error: string | null;

  bootstrap: (userId: string) => Promise<void>;
  loadProjects: () => Promise<void>;
  createProject: (title: string) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  createSession: () => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  selectProject: (projectId: string) => Promise<void>;
  selectSession: (sessionId: string) => Promise<void>;
  setPermission: (permission: HarnessPermission) => Promise<void>;
  uploadFiles: (files: FileList) => Promise<void>;
  loadContext: () => Promise<void>;
  compressContext: () => Promise<void>;
  addMemory: (content: string) => Promise<void>;
  createDocument: (title: string, content: string) => Promise<HarnessDocument | null>;
  deleteDocument: (documentId: string) => Promise<void>;
  sendMessage: (message: string, temperature: number, permission: HarnessPermission) => Promise<void>;
  approve: (approved: boolean) => Promise<void>;
  resume: (temperature: number) => Promise<void>;
  cancel: () => Promise<void>;
  retry: (temperature: number, permission: HarnessPermission) => Promise<void>;
  runStream: (path: string, body: unknown) => Promise<void>;
  clearError: () => void;
  reset: () => void;
}

export const useHarnessStore = create<HarnessStore>((set, get) => ({
  projects: [],
  activeProjectId: '',
  activeSessionId: '',
  files: [],
  memories: [],
  documents: [],
  context: null,
  activeRun: null,
  runEvents: [],
  toolCalls: [],
  approval: null,
  isBootstrapping: false,
  isBusy: false,
  isRunning: false,
  error: null,

  bootstrap: async userId => {
    if (!userId) return;
    set({ isBootstrapping: true, error: null });
    try {
      let projects = await request<HarnessProject[]>('/harness/projects');
      const migrationKey = `${LOCAL_WORKSPACE_PREFIX}${userId}${MIGRATED_SUFFIX}`;
      if (projects.length === 0 && localStorage.getItem(migrationKey) !== '1') {
        const localProjects = readStoredProjects(userId);
        if (localProjects.length > 0) {
          await request('/harness/projects/migrate', {
            method: 'POST',
            body: JSON.stringify({ projects: localProjects }),
          });
          projects = await request<HarnessProject[]>('/harness/projects');
        }
        localStorage.setItem(migrationKey, '1');
      }
      const activeProjectId = projects[0]?.id || '';
      const activeSessionId = projects[0]?.sessions[0]?.id || '';
      set({ projects, activeProjectId, activeSessionId });
      if (activeSessionId) await get().selectSession(activeSessionId);
    } catch (error: any) {
      set({ error: error?.message || 'Harness 工作区加载失败' });
    } finally {
      set({ isBootstrapping: false });
    }
  },

  loadProjects: async () => {
    try {
      const projects = await request<HarnessProject[]>('/harness/projects');
      const previousProject = get().activeProjectId;
      const activeProjectId = projects.find(item => item.id === previousProject)?.id || projects[0]?.id || '';
      const activeSessionId = projects
        .find(item => item.id === activeProjectId)?.sessions
        .find(item => item.id === get().activeSessionId)?.id
        || projects.find(item => item.id === activeProjectId)?.sessions[0]?.id
        || '';
      set({ projects, activeProjectId, activeSessionId });
      if (activeSessionId) await get().selectSession(activeSessionId);
    } catch (error: any) {
      set({ error: error?.message || 'Harness 项目加载失败' });
    }
  },

  createProject: async title => {
    set({ isBusy: true, error: null });
    try {
      const project = await request<HarnessProject>('/harness/projects', {
        method: 'POST',
        body: JSON.stringify({ title }),
      });
      set(state => ({
        projects: [project, ...state.projects],
        activeProjectId: project.id,
        activeSessionId: project.sessions[0]?.id || '',
      }));
      if (project.sessions[0]) await get().selectSession(project.sessions[0].id);
    } catch (error: any) {
      set({ error: error?.message || '项目创建失败' });
    } finally {
      set({ isBusy: false });
    }
  },

  deleteProject: async projectId => {
    set({ isBusy: true, error: null });
    try {
      await request(`/harness/projects/${projectId}`, { method: 'DELETE' });
      await get().loadProjects();
    } catch (error: any) {
      set({ error: error?.message || '项目删除失败' });
    } finally {
      set({ isBusy: false });
    }
  },

  createSession: async () => {
    const projectId = get().activeProjectId;
    if (!projectId) return;
    set({ isBusy: true, error: null });
    try {
      const session = await request<HarnessProject['sessions'][number]>(`/harness/projects/${projectId}/sessions`, {
        method: 'POST',
        body: JSON.stringify({ title: `会话 ${(get().projects.find(item => item.id === projectId)?.sessions.length || 0) + 1}` }),
      });
      set(state => ({
        projects: state.projects.map(item => item.id === projectId
          ? { ...item, sessions: [...item.sessions, session] }
          : item),
        activeSessionId: session.id,
      }));
      await get().selectSession(session.id);
    } catch (error: any) {
      set({ error: error?.message || '会话创建失败' });
    } finally {
      set({ isBusy: false });
    }
  },

  deleteSession: async sessionId => {
    set({ isBusy: true, error: null });
    try {
      await request(`/harness/sessions/${sessionId}`, { method: 'DELETE' });
      await get().loadProjects();
    } catch (error: any) {
      set({ error: error?.message || '会话删除失败' });
    } finally {
      set({ isBusy: false });
    }
  },

  selectProject: async projectId => {
    const project = get().projects.find(item => item.id === projectId);
    const sessionId = project?.sessions[0]?.id || '';
    set({ activeProjectId: projectId, activeSessionId: sessionId });
    if (sessionId) await get().selectSession(sessionId);
    else set({ files: [], memories: [], documents: [], context: null });
  },

  selectSession: async sessionId => {
    const session = get().projects.flatMap(item => item.sessions).find(item => item.id === sessionId);
    if (!session) return;
    const latestRun = session.agentRun || null;
    const waitingCall = latestRun?.toolCalls?.find(call => call.status === 'waiting_approval') || null;
    set({
      activeSessionId: sessionId,
      files: [],
      memories: [],
      documents: [],
      context: null,
      activeRun: latestRun,
      runEvents: latestRun?.events || [],
      toolCalls: latestRun?.toolCalls || [],
      approval: waitingCall ? {
        agentRunId: latestRun.id,
        toolCallId: waitingCall.id,
        name: waitingCall.name,
        path: waitingCall.arguments?.path,
        bytes: waitingCall.result?.bytes,
      } : null,
    });
    await Promise.all([
      get().loadContext(),
      request<HarnessFile[]>(`/harness/sessions/${sessionId}/files`).then(files => set({ files })).catch(() => undefined),
      request<HarnessMemory[]>(`/harness/sessions/${sessionId}/memories`).then(memories => set({ memories })).catch(() => undefined),
      request<HarnessDocument[]>(`/harness/sessions/${sessionId}/documents`).then(documents => set({ documents })).catch(() => undefined),
    ]);
  },

  setPermission: async permission => {
    const sessionId = get().activeSessionId;
    if (!sessionId) return;
    set(state => ({
      projects: state.projects.map(project => ({
        ...project,
        sessions: project.sessions.map(session =>
          session.id === sessionId ? { ...session, permission } : session,
        ),
      })),
    }));
    try {
      await request(`/harness/sessions/${sessionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ permission }),
      });
    } catch (error: any) {
      set({ error: error?.message || '权限更新失败' });
      await get().loadProjects();
    }
  },

  uploadFiles: async files => {
    const sessionId = get().activeSessionId;
    if (!sessionId) return;
    set({ isBusy: true, error: null });
    try {
      const payload = await readSnapshot(files);
      if (!payload.length) throw new Error('没有可上传的文本文件');
      await request(`/harness/sessions/${sessionId}/files`, {
        method: 'POST',
        body: JSON.stringify({ files: payload }),
      });
      const uploaded = await request<HarnessFile[]>(`/harness/sessions/${sessionId}/files`);
      set({ files: uploaded });
    } catch (error: any) {
      set({ error: error?.message || '文件快照上传失败' });
    } finally {
      set({ isBusy: false });
    }
  },

  loadContext: async () => {
    const sessionId = get().activeSessionId;
    if (!sessionId) return;
    try {
      const context = await request<HarnessContext>(`/harness/sessions/${sessionId}/context`);
      set({ context });
    } catch (error: any) {
      set({ error: error?.message || '上下文加载失败' });
    }
  },

  compressContext: async () => {
    const sessionId = get().activeSessionId;
    if (!sessionId) return;
    set({ isBusy: true, error: null });
    try {
      const result = await request<{ context: HarnessContext }>(`/harness/sessions/${sessionId}/context/compress`, { method: 'POST' });
      set({ context: result.context });
    } catch (error: any) {
      set({ error: error?.message || '上下文压缩失败' });
    } finally {
      set({ isBusy: false });
    }
  },

  addMemory: async content => {
    const sessionId = get().activeSessionId;
    if (!sessionId || !content.trim()) return;
    set({ isBusy: true, error: null });
    try {
      await request(`/harness/sessions/${sessionId}/memories`, {
        method: 'POST',
        body: JSON.stringify({ memory_type: 'fact', content }),
      });
      const memories = await request<HarnessMemory[]>(`/harness/sessions/${sessionId}/memories`);
      set({ memories });
    } catch (error: any) {
      set({ error: error?.message || '记忆保存失败' });
    } finally {
      set({ isBusy: false });
    }
  },

  createDocument: async (title, content) => {
    const sessionId = get().activeSessionId;
    if (!sessionId) return null;
    set({ isBusy: true, error: null });
    try {
      const document = await request<HarnessDocument>(`/harness/sessions/${sessionId}/documents`, {
        method: 'POST',
        body: JSON.stringify({ title, content }),
      });
      set(state => ({ documents: [document, ...state.documents] }));
      return document;
    } catch (error: any) {
      set({ error: error?.message || '文档生成失败' });
      return null;
    } finally {
      set({ isBusy: false });
    }
  },

  deleteDocument: async documentId => {
    set({ isBusy: true, error: null });
    try {
      await request(`/harness/documents/${documentId}`, { method: 'DELETE' });
      set(state => ({ documents: state.documents.filter(item => item.id !== documentId) }));
    } catch (error: any) {
      set({ error: error?.message || '文档删除失败' });
    } finally {
      set({ isBusy: false });
    }
  },

  sendMessage: async (message, temperature, permission) => {
    const sessionId = get().activeSessionId;
    if (!sessionId || get().isRunning || !message.trim()) return;
    const optimistic = localMessage('user', message.trim());
    const assistant = localMessage('assistant', '');
    set(state => ({
      isRunning: true,
      error: null,
      activeRun: null,
      approval: null,
      runEvents: [],
      toolCalls: [],
      projects: state.projects.map(project => ({
        ...project,
        sessions: project.sessions.map(session =>
          session.id === sessionId
            ? { ...session, messages: [...session.messages, optimistic, assistant] }
            : session,
        ),
      })),
    }));
    await get().runStream(`/harness/sessions/${sessionId}/run`, {
      session_id: sessionId,
      message: message.trim(),
      temperature,
      permission,
    });
  },

  resume: async temperature => {
    const run = get().activeRun;
    if (!run) return;
    set({ isRunning: true, error: null });
    await get().runStream(`/harness/agent-runs/${run.id}/resume`, {});
  },

  retry: async (temperature, permission) => {
    const input = get().activeRun?.input;
    if (!input) return;
    await get().sendMessage(input, temperature, permission);
  },

  approve: async approved => {
    const run = get().activeRun;
    const approval = get().approval;
    if (!run || !approval) return;
    set({ isBusy: true, error: null });
    try {
      const trace = await request<AgentRun>(`/harness/agent-runs/${run.id}/approval`, {
        method: 'POST',
        body: JSON.stringify({ approved, tool_call_id: approval.toolCallId }),
      });
      set(applyTrace(trace));
      if (approved) await get().loadProjects();
    } catch (error: any) {
      set({ error: error?.message || '审批失败' });
    } finally {
      set({ isBusy: false });
    }
  },

  cancel: async () => {
    const run = get().activeRun;
    if (!run) return;
    set({ isBusy: true, error: null });
    try {
      const trace = await request<AgentRun>(`/harness/agent-runs/${run.id}/cancel`, { method: 'POST' });
      set(applyTrace(trace));
    } catch (error: any) {
      set({ error: error?.message || '取消失败' });
    } finally {
      set({ isBusy: false });
    }
  },

  clearError: () => set({ error: null }),
  reset: () => set({
    projects: [],
    activeProjectId: '',
    activeSessionId: '',
    files: [],
    memories: [],
    documents: [],
    context: null,
    activeRun: null,
    runEvents: [],
    toolCalls: [],
    approval: null,
    isBootstrapping: false,
    isBusy: false,
    isRunning: false,
    error: null,
  }),

  runStream: async (path: string, body: unknown) => {
    set({ isRunning: true, error: null });
    try {
      await streamEvents(path, body, event => {
        if (event.type === 'context') {
          set({ context: event.context });
        } else if (event.type === 'message.delta') {
          const delta = event.delta || '';
          set(state => ({
            projects: state.projects.map(project => ({
              ...project,
              sessions: project.sessions.map(session => {
                if (session.id !== get().activeSessionId) return session;
                const messages = [...session.messages];
                const last = messages[messages.length - 1];
                if (last?.role === 'assistant') messages[messages.length - 1] = { ...last, content: last.content + delta };
                return { ...session, messages };
              }),
            })),
          }));
        } else if (event.type === 'tool.start' || event.type === 'tool.end') {
          const call = event.toolCall as AgentToolCall;
          set(state => {
            const calls = state.toolCalls.filter(item => item.id !== call.id);
            return { toolCalls: [...calls, call] };
          });
        } else if (event.type === 'approval.required') {
          set(state => ({
            approval: event.approval,
            activeRun: state.activeRun || event.approval?.agentRunId
              ? { ...(state.activeRun || {
                  id: event.approval?.agentRunId || '',
                  projectId: state.activeProjectId,
                  sessionId: state.activeSessionId,
                  permission: 'read-only',
                  iterations: 0,
                  startedAt: Date.now(),
                }), status: 'waiting_approval' }
              : null,
          }));
        } else if (event.type === 'done') {
          set(state => ({
            activeRun: event.run,
            runEvents: event.run.events || state.runEvents,
            toolCalls: event.run.toolCalls || state.toolCalls,
            approval: null,
          }));
        } else if (event.type === 'error') {
          set(state => ({
            error: event.error || 'Agent 执行失败',
            activeRun: state.activeRun ? { ...state.activeRun, status: 'failed', error: event.error } : null,
          }));
        }
      });
    } catch (error: any) {
      set({ error: error?.message || 'Agent 执行失败' });
    } finally {
      set({ isRunning: false });
      await get().loadProjects().catch(() => undefined);
    }
  },
}));

function applyTrace(trace: AgentRun) {
  return {
    activeRun: trace,
    runEvents: trace.events || [],
    toolCalls: trace.toolCalls || [],
    approval: null,
  };
}

export default useHarnessStore;
