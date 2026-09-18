import { expect, test } from '@playwright/test';

function ok(data: unknown) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ code: 200, message: 'ok', data }),
  };
}

test('login, free studio entry with unlimited follow-ups, community QR, and admin audit path', async ({ page }) => {
  let disabledPayload: unknown = null;

  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === '/api/analytics/events') return route.fulfill(ok({ accepted: true }));
    if (path === '/api/auth/login' && method === 'POST') {
      return route.fulfill(ok({
        id: 'user-1',
        email: 'admin@example.com',
        account: 'admin',
        displayName: 'Admin',
        isAdmin: true,
        token: 'mock-token',
      }));
    }
    if (path === '/api/auth/me') {
      return route.fulfill(ok({
        id: 'user-1',
        email: 'admin@example.com',
        account: 'admin',
        displayName: 'Admin',
        isAdmin: true,
        token: 'mock-token',
      }));
    }
    if (path === '/api/coach/status') {
      return route.fulfill(ok({
        paid: true,
        skillInstalled: false,
        apiKeyReady: false,
        modelName: '',
        activeRunId: null,
      }));
    }
    if (path === '/api/model-services') {
      return route.fulfill(ok([{
        id: 'zhipu',
        displayName: '智谱清言 GLM',
        vendor: 'Zhipu',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        protocol: 'openai-compatible',
        apiKeyReady: false,
        version: 1,
        models: [{ id: 'model-1', modelId: 'glm-5.2', displayName: 'GLM-5.2', contextTokens: 128000, maxOutputTokens: 8192, reasoning: 'medium' }],
      }]));
    }
    if (path === '/api/mvp-runs') return route.fulfill(ok([]));
    if (path === '/api/skills/current') return route.fulfill(ok(null));
    if (path === '/api/admin/overview') {
      return route.fulfill(ok({
        totalUsers: 2,
        disabledUsers: 0,
        activeRuns: 0,
        analyticsEvents: 1,
      }));
    }
    if (path === '/api/admin/users') {
      return route.fulfill(ok([
        { id: 'user-1', email: 'admin@example.com', account: 'admin', displayName: 'Admin', isAdmin: true, isDisabled: false, disabledReason: '', createdAt: Date.now() },
        { id: 'user-2', email: 'buyer@example.com', account: 'buyer@example.com', displayName: 'Buyer', isAdmin: false, isDisabled: false, disabledReason: '', createdAt: Date.now() },
      ]));
    }
    if (path === '/api/admin/audit-logs') {
      return route.fulfill(ok([{
        id: 'audit-1', actorId: 'user-1', actorAccount: 'admin', action: 'auth.login_locked',
        targetType: '', targetId: '', ip: '127.0.0.1', userAgent: 'test', detail: {}, createdAt: Date.now(),
      }]));
    }
    if (path === '/api/admin/users/user-2' && method === 'PATCH') {
      disabledPayload = request.postDataJSON();
      return route.fulfill(ok({
        id: 'user-2', email: 'buyer@example.com', account: 'buyer@example.com', displayName: 'Buyer',
        isAdmin: false, isDisabled: true, disabledReason: '安全演练', createdAt: Date.now(),
      }));
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 404, message: path }) });
  });

  await page.goto('/#/');
  await expect(page.getByLabel('社群二维码')).toBeVisible();
  await expect(page.locator('.home-qr-code svg')).toBeVisible();
  await expect(page.getByText('一层追不完，就再追一层')).toBeVisible();

  await page.locator('#account').fill('admin');
  await page.locator('#password').fill('secure-password');
  await page.locator('form button[type="submit"]').click();
  await expect(page.locator('.home-account-name')).toHaveText('Admin');
  await expect(page.getByText('免费使用 · 无限追问')).toBeVisible();

  await page.getByLabel('账号').getByRole('button', { name: /进入模型服务/ }).click();
  // mock 中技能未安装，studio 应显示免费启动面板
  await expect(page.getByRole('heading', { name: '超级个体训练师' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('已解锁')).toBeVisible();

  await page.goto('/#/admin');
  await expect(page.getByRole('heading', { name: '管理后台' })).toBeVisible();
  await expect(page.getByLabel('管理后台').getByText('用户', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /禁用/ }).last().click();
  await page.locator('#admin-disable-reason').fill('安全演练');
  await page.getByRole('button', { name: '确认禁用' }).click();
  await expect.poll(() => disabledPayload).toEqual({ disabled: true, reason: '安全演练' });
});
