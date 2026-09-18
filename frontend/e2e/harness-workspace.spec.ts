import { expect, test } from '@playwright/test';

function ok(data: unknown) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ code: 200, message: 'ok', data }),
  };
}

const user = {
  id: 'user-1',
  email: 'buyer@example.com',
  account: 'buyer',
  displayName: 'Buyer',
  isAdmin: false,
  token: 'mock-token',
};

const mvpRun = {
  id: 'mvp-1',
  title: '浏览器验证项目',
  vertical: '本地商家',
  status: 'active',
  currentStepOrder: 1,
  totalSteps: 10,
  createdAt: Date.now(),
  completedAt: null,
  blocker: '',
  nextAction: '选择人群',
  steps: [{
    id: 'step-1',
    key: 'buyer_pain',
    order: 1,
    title: '选择愿意付费的人群和痛点',
    requiredArtifact: '付费人群与痛点画布',
    isCompleted: false,
    artifactTitle: '',
  }],
  currentStep: {
    id: 'step-1',
    key: 'buyer_pain',
    order: 1,
    title: '选择愿意付费的人群和痛点',
    objective: '明确人群和痛点',
    requiredArtifact: '付费人群与痛点画布',
    isCompleted: false,
    tool: '付费人群筛选器',
    instructions: '列三个人群',
    template: '目标人群：',
    artifactContent: '',
  },
  messages: [],
  threads: [],
  threadMessages: {},
};

const harnessProject = {
  id: 'harness-1',
  title: '报价沙箱',
  mvpRunId: 'mvp-1',
  metadata: {},
  createdAt: Date.now(),
  updatedAt: Date.now(),
  sessions: [{
    id: 'session-1',
    projectId: 'harness-1',
    title: '会话 1',
    permission: 'read-only',
    summary: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  }],
};

const context = {
  model: 'fake-model',
  maxContextTokens: 32768,
  maxOutputTokens: 4096,
  totalTokens: 128,
  budgetTokens: 28672,
  components: [
    { name: 'system', tokens: 30, truncated: false },
    { name: 'history', tokens: 98, truncated: false },
  ],
  historyMessageCount: 2,
  totalMessageCount: 2,
};

test('Harness workspace streams tools, approvals, context, and trace', async ({ page }) => {
  let permissionPayload: unknown;
  let approvalPayload: unknown;
  let latestRun: any = null;
  let contextLoaded = false;

  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();

    if (path === '/api/auth/me') return route.fulfill(ok(user));
    if (path === '/api/products') return route.fulfill(ok([]));
    if (path === '/api/orders') return route.fulfill(ok([]));
    if (path === '/api/coach/status') {
      return route.fulfill(ok({ paid: true, skillInstalled: true, apiKeyReady: true, modelName: 'fake-model', activeRunId: 'mvp-1' }));
    }
    if (path === '/api/model-services') {
      return route.fulfill(ok([{
        id: 'fake-service',
        displayName: 'Fake Model',
        vendor: 'Fake',
        baseUrl: 'https://model.example.com/v1',
        protocol: 'openai-compatible',
        apiKeyReady: true,
        version: 1,
        models: [{ id: 'model-1', modelId: 'fake-model', displayName: 'Fake Model', contextTokens: 32768, maxOutputTokens: 4096, reasoning: 'medium' }],
      }]));
    }
    if (path === '/api/skills/current') {
      return route.fulfill(ok({ id: 'skill-1', skillKey: 'super-solo-coach', name: 'Coach', version: '2.0.0', modelName: 'fake-model', baseUrl: 'https://model.example.com/v1', apiKeyReady: true, installedAt: Date.now() }));
    }
    if (path === '/api/mvp-runs' && method === 'GET') return route.fulfill(ok([mvpRun]));
    if (path === '/api/mvp-runs/mvp-1') return route.fulfill(ok(mvpRun));
    if (path === '/api/harness/projects' && method === 'GET') {
      return route.fulfill(ok([{
        ...harnessProject,
        agentRun: latestRun,
        sessions: [{ ...harnessProject.sessions[0], agentRun: latestRun }],
      }]));
    }
    if (path === '/api/harness/sessions/session-1' && method === 'PATCH') {
      permissionPayload = request.postDataJSON();
      return route.fulfill(ok({ ...harnessProject.sessions[0], permission: 'workspace-write' }));
    }
    if (path === '/api/harness/sessions/session-1/context') {
      contextLoaded = true;
      return route.fulfill(ok(context));
    }
    if (path === '/api/harness/sessions/session-1/files') return route.fulfill(ok([]));
    if (path === '/api/harness/sessions/session-1/memories') return route.fulfill(ok([]));
    if (path === '/api/harness/sessions/session-1/documents') return route.fulfill(ok([]));
    if (path === '/api/harness/sessions/session-1/run') {
      latestRun = {
        id: 'agent-1',
        projectId: 'harness-1',
        sessionId: 'session-1',
        status: 'waiting_approval',
        permission: 'workspace-write',
        iterations: 1,
        startedAt: 1,
        finishedAt: null,
        events: [],
        toolCalls: [{ id: 'tool-1', agentRunId: 'agent-1', name: 'write_file', arguments: { path: 'offer.md' }, result: { path: 'offer.md', bytes: 20 }, status: 'waiting_approval', error: '', startedAt: 1, endedAt: null }],
      };
      const events = [
        'event: run.start\ndata: {"type":"run.start"}\n\n',
        'event: context\ndata: {"type":"context","context":{"totalTokens":128,"budgetTokens":28672}}\n\n',
        'event: tool.start\ndata: {"type":"tool.start","toolCall":{"id":"tool-1","agentRunId":"agent-1","name":"write_file","arguments":{"path":"offer.md"},"result":{},"status":"pending","error":"","startedAt":1}}\n\n',
        'event: approval.required\ndata: {"type":"approval.required","approval":{"agentRunId":"agent-1","toolCallId":"tool-1","path":"offer.md","bytes":20}}\n\n',
      ].join('');
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: events });
    }
    if (path === '/api/harness/agent-runs/agent-1/approval') {
      approvalPayload = request.postDataJSON();
      latestRun = {
        id: 'agent-1',
        projectId: 'harness-1',
        sessionId: 'session-1',
        status: 'waiting_tool',
        permission: 'workspace-write',
        iterations: 1,
        startedAt: 1,
        finishedAt: null,
        events: [],
        toolCalls: [{ id: 'tool-1', agentRunId: 'agent-1', name: 'write_file', arguments: { path: 'offer.md' }, result: { path: 'offer.md' }, status: 'success', error: '', startedAt: 1, endedAt: 2 }],
      };
      return route.fulfill(ok(latestRun));
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 404, message: path }) });
  });

  await page.addInitScript(token => localStorage.setItem('june_user_token', token), 'mock-token');
  await page.goto('/#/studio');
  await expect(page.getByRole('heading', { name: 'Harness 项目' })).toBeVisible();
  await expect.poll(() => contextLoaded).toBe(true);

  await page.locator('.dsh-settings-button').click();
  await page.getByRole('button', { name: 'Workspace write' }).click();
  await expect.poll(() => permissionPayload).toEqual({ permission: 'workspace-write' });
  await page.locator('.settings-popover .dsh-icon-button').first().click();

  // 工作台默认落在「跟练对话」tab，Agent 流程需先切换
  await page.getByRole('button', { name: /Agent 工作台/ }).click();
  await page.locator('.chat-composer .coach-textarea').fill('生成报价文档');
  await page.getByRole('button', { name: /发送/ }).click();
  await expect(page.getByText('等待审批')).toBeVisible();
  await expect(page.getByText('offer.md', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '批准写入' }).click();
  await expect.poll(() => approvalPayload).toEqual({ approved: true, tool_call_id: 'tool-1' });
  await expect(page.getByText('可继续')).toBeVisible();

  await page.getByRole('button', { name: /上下文/ }).click();
  await expect(page.getByText('128/28672 tokens')).toBeVisible();
  await page.getByRole('button', { name: /Trace/ }).click();
  await expect(page.getByText('write_file')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.project-workspace')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
