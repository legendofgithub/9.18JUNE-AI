import { expect, test } from '@playwright/test';

function ok(data: unknown) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ code: 200, message: 'ok', data }),
  };
}

test('open product lands directly on studio, ready for unlimited follow-ups', async ({ page }) => {
  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === '/api/analytics/events') return route.fulfill(ok({ accepted: true }));
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
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 404, message: path }) });
  });

  await page.goto('/#/studio');

  // 无登录门禁：直接显示免费启动面板
  await expect(page.getByRole('heading', { name: '超级个体训练师' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('已解锁')).toBeVisible();
  await expect(page.getByRole('button', { name: '启动超级个体训练师' })).toBeVisible();
});
