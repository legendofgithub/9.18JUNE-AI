import { beforeEach, describe, expect, it, vi } from 'vitest';

const ok = (data: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ code: 200, message: 'ok', data }),
});

const fail = (message: string) => ({
  ok: false,
  status: 400,
  json: async () => ({ code: 400, message, data: null }),
});

function streamResponse(events: string[]) {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    ok: true,
    status: 200,
    json: async () => ({ code: 200, data: null }),
    body: {
      getReader: () => ({
        read: async () => {
          if (index >= events.length) return { done: true, value: undefined };
          const value = encoder.encode(events[index++]);
          return { done: false, value };
        },
      }),
    },
  };
}

const project = {
  id: 'p1',
  title: 'Harness 项目',
  mvpRunId: 'r1',
  metadata: {},
  createdAt: 1,
  updatedAt: 1,
  sessions: [{
    id: 's1',
    projectId: 'p1',
    title: '会话 1',
    permission: 'read-only',
    summary: '',
    createdAt: 1,
    updatedAt: 1,
    messages: [],
  }],
};

const traceRun = {
  id: 'a1',
  projectId: 'p1',
  sessionId: 's1',
  status: 'finished',
  permission: 'read-only',
  iterations: 0,
  startedAt: 1,
  finishedAt: 1,
  events: [],
  toolCalls: [],
};

function installFetch(overrides: Record<string, () => unknown> = {}, listProject = project) {
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    if (url.includes('/harness/projects/migrate')) return ok({ projects: 1 }) as never;
    for (const [fragment, resolver] of Object.entries(overrides)) {
      if (url.includes(fragment)) return resolver() as never;
    }
    if (url.includes('/harness/projects') && method === 'GET') return ok([listProject]) as never;
    if (url.includes('/context/compress')) return ok({ summary: '', context: {} }) as never;
    if (url.includes('/context')) return ok({ model: 'm', totalTokens: 1, budgetTokens: 10, components: [] }) as never;
    if (url.includes('/files')) return ok([]) as never;
    if (url.includes('/memories')) return ok([]) as never;
    if (url.includes('/documents')) return ok([]) as never;
    return fail(`unexpected request ${method} ${url}`) as never;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
    clear: () => storage.clear(),
  });
  vi.stubGlobal('window', { location: { hash: '#/studio' } });
});

describe('useHarnessStore', () => {
  it('首次装载时迁移本地项目并加载服务端工作区', async () => {
    let emptyOnce = true;
    const fetchMock = installFetch({
      '/harness/projects': () => (emptyOnce ? (emptyOnce = false, ok([])) : ok([project])),
    });
    localStorage.setItem('june_project_workspace_u1', JSON.stringify([{
      title: '旧项目',
      sessions: [{ title: '旧会话', messages: [{ id: 'old-1', role: 'user', content: '旧消息', timestamp: 1 }] }],
    }]));
    const { default: useHarnessStore } = await import('./useHarnessStore');

    await useHarnessStore.getState().bootstrap('u1');

    expect(useHarnessStore.getState().projects[0].id).toBe('p1');
    expect(localStorage.getItem('june_project_workspace_u1_migrated')).toBe('1');
    const migration = fetchMock.mock.calls.find(([url]) => String(url).includes('/harness/projects/migrate'));
    expect(migration).toBeTruthy();
  });

  it('Agent SSE 增量更新最后一条助手消息', async () => {
    const delivered = {
      ...project,
      agentRun: {
        id: 'a1',
        projectId: 'p1',
        sessionId: 's1',
        status: 'finished',
        permission: 'read-only',
        iterations: 0,
        startedAt: 1,
        finishedAt: 1,
        events: [],
        toolCalls: [],
      },
      sessions: [{
        ...project.sessions[0],
        agentRun: {
          id: 'a1',
          projectId: 'p1',
          sessionId: 's1',
          status: 'finished',
          permission: 'read-only',
          iterations: 0,
          startedAt: 1,
          finishedAt: 1,
          events: [],
          toolCalls: [],
        },
        messages: [
          { id: 'm1', role: 'user', content: '推进项目', tokens: 0, meta: {}, timestamp: 1 },
          { id: 'm2', role: 'assistant', content: '已完成', tokens: 0, meta: {}, timestamp: 1 },
        ],
      }],
    };
    installFetch({
      '/run': () => streamResponse([
        'event: context\ndata: {"type":"context","context":{"totalTokens":3,"budgetTokens":10,"components":[]}}\n\n',
        'event: message.delta\ndata: {"type":"message.delta","delta":"已"}\n\n',
        'event: message.delta\ndata: {"type":"message.delta","delta":"完成"}\n\n',
        'event: done\ndata: {"type":"done","run":{"id":"a1","projectId":"p1","sessionId":"s1","status":"finished","permission":"read-only","iterations":0,"startedAt":1}}\n\n',
      ]),
    }, delivered);
    const { default: useHarnessStore } = await import('./useHarnessStore');
    useHarnessStore.setState({
      projects: [project] as any,
      activeProjectId: 'p1',
      activeSessionId: 's1',
      isRunning: false,
      error: null,
    });

    await useHarnessStore.getState().sendMessage('推进项目', 0.7, 'read-only');

    const state = useHarnessStore.getState();
    const messages = state.projects[0].sessions[0].messages;
    expect(messages[messages.length - 1].content).toBe('已完成');
    expect(state.context?.totalTokens).toBe(1);
    expect(state.activeRun?.status).toBe('finished');
    expect(state.isRunning).toBe(false);
  });

  it('权限保存失败后回滚为服务端状态', async () => {
    installFetch({
      '/harness/sessions/s1': () => fail('权限更新失败'),
    });
    const { default: useHarnessStore } = await import('./useHarnessStore');
    useHarnessStore.setState({
      projects: [project] as any,
      activeProjectId: 'p1',
      activeSessionId: 's1',
      error: null,
    });

    await useHarnessStore.getState().setPermission('workspace-write');

    expect(useHarnessStore.getState().error).toBe('权限更新失败');
    expect(useHarnessStore.getState().projects[0].sessions[0].permission).toBe('read-only');
  });

  it('刷新装载时恢复等待审批的 Agent 现场和路径', async () => {
    const waitingProject = {
      ...project,
      sessions: [{
        ...project.sessions[0],
        permission: 'workspace-write',
        agentRun: {
          id: 'a1',
          projectId: 'p1',
          sessionId: 's1',
          status: 'waiting_approval',
          permission: 'workspace-write',
          iterations: 1,
          startedAt: 1,
          finishedAt: null,
          events: [],
          toolCalls: [{
            id: 'tool-1',
            agentRunId: 'a1',
            name: 'write_file',
            arguments: { path: 'offer.md', content: { bytes: 20 } },
            result: { path: 'offer.md', bytes: 20 },
            status: 'waiting_approval',
            error: '',
            startedAt: 1,
            endedAt: null,
          }],
        },
      }],
    };
    installFetch({}, waitingProject);
    const { default: useHarnessStore } = await import('./useHarnessStore');

    await useHarnessStore.getState().bootstrap('u1');

    const state = useHarnessStore.getState();
    expect(state.activeRun?.status).toBe('waiting_approval');
    expect(state.approval?.toolCallId).toBe('tool-1');
    expect(state.approval?.path).toBe('offer.md');
  });
});
