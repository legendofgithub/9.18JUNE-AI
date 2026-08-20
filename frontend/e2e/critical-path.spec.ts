import { expect, test } from '@playwright/test';

const product = {
  id: 'super-solo-coach-unlock',
  name: '超级个体训练师解锁',
  description: '一次性解锁',
  priceCents: 3900,
  priceYuan: 39,
  pathCount: 1,
};

function ok(data: unknown) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ code: 200, message: 'ok', data }),
  };
}

test('login, checkout, payment callback state, community QR, and admin audit path', async ({ page }) => {
  let orderPaid = false;
  let disabledPayload: unknown = null;

  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === '/api/analytics/events') return route.fulfill(ok({ accepted: true }));
    if (path === '/api/products') return route.fulfill(ok([product]));
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
    if (path === '/api/orders' && method === 'POST') {
      orderPaid = false;
      return route.fulfill(ok({
        id: 'order-1',
        productId: product.id,
        productName: product.name,
        amountCents: 3900,
        pathCount: 1,
        status: 'pending',
        provider: 'stripe',
        providerOrderId: 'cs_test_order_1',
        paymentUrl: 'https://checkout.stripe.com/c/pay/order-1',
        createdAt: Date.now(),
        sandbox: false,
      }));
    }
    if (path === '/api/orders' && method === 'GET') {
      return route.fulfill(ok([{
        id: 'order-1',
        productId: product.id,
        productName: product.name,
        amountCents: 3900,
        pathCount: 1,
        status: orderPaid ? 'paid' : 'pending',
        provider: 'stripe',
        providerOrderId: 'cs_test_order_1',
        paymentUrl: orderPaid ? '' : 'https://checkout.stripe.com/c/pay/order-1',
        createdAt: Date.now(),
        paidAt: orderPaid ? Date.now() : null,
        sandbox: false,
      }]));
    }
    if (path === '/api/coach/status') {
      return route.fulfill(ok({
        paid: orderPaid,
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
        paidUsers: 1,
        disabledUsers: 0,
        activeRuns: 0,
        pendingOrders: orderPaid ? 0 : 1,
        revenueCents: orderPaid ? 3900 : 0,
        analyticsEvents: 1,
      }));
    }
    if (path === '/api/admin/users') {
      return route.fulfill(ok([
        { id: 'user-1', email: 'admin@example.com', account: 'admin', displayName: 'Admin', isAdmin: true, isDisabled: false, disabledReason: '', createdAt: Date.now(), orderCount: 1, paidCount: 1 },
        { id: 'user-2', email: 'buyer@example.com', account: 'buyer@example.com', displayName: 'Buyer', isAdmin: false, isDisabled: false, disabledReason: '', createdAt: Date.now(), orderCount: 0, paidCount: 0 },
      ]));
    }
    if (path === '/api/admin/orders') return route.fulfill(ok([]));
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

  await page.locator('#account').fill('admin');
  await page.locator('#password').fill('secure-password');
  await page.locator('form button[type="submit"]').click();
  await expect(page.locator('.home-account-name')).toHaveText('Admin');

  await page.goto('/#/product');
  await page.getByRole('button', { name: '立即购买' }).click();

  await page.goto('/#/payment');
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: /打开 Stripe 支付|付款/ }).click();
  const popup = await popupPromise;
  expect(popup.url()).toContain('checkout.stripe.com');
  await popup.close();

  orderPaid = true;
  await page.getByRole('button', { name: '我已完成支付' }).click();
  await expect(page.locator('main').last()).toContainText('购买成功');

  await page.goto('/#/admin');
  await expect(page.getByRole('heading', { name: '管理后台' })).toBeVisible();
  await expect(page.getByText('付费用户')).toBeVisible();
  await page.getByRole('button', { name: /禁用/ }).last().click();
  await page.locator('#admin-disable-reason').fill('安全演练');
  await page.getByRole('button', { name: '确认禁用' }).click();
  await expect.poll(() => disabledPayload).toEqual({ disabled: true, reason: '安全演练' });
});
