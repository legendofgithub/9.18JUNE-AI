import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 单用户模式 store 单测：无登录，bootstrap 直接装载工作台数据。
 * 通过 stub localStorage / window / fetch，验证：
 * - bootstrap 拉取训练师状态并装载模型服务与工作区
 * - 初始化失败时错误可见
 */

const coachStatus = {
  paid: true,
  skillInstalled: false,
  apiKeyReady: false,
  modelName: '',
  activeRunId: null,
};

function installFetch(overrides: Record<string, () => unknown> = {}) {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    for (const [fragment, resolver] of Object.entries(overrides)) {
      if (url.includes(fragment)) return resolver() as never;
    }
    if (url.includes('/analytics/events')) return ok({ received: true }) as never;
    if (url.includes('/coach/status')) return ok(coachStatus) as never;
    if (url.includes('/model-services')) return ok([]) as never;
    if (url.includes('/mvp-runs')) return ok([]) as never;
    if (url.includes('/skills/current')) return ok(null) as never;
    return fail(404, `unexpected request: ${url}`) as never;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function ok(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ code: 200, message: 'ok', data }),
  };
}

function fail(status: number, message: string) {
  return {
    ok: false,
    status,
    json: async () => ({ code: status, message, data: null }),
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
  });
  vi.stubGlobal('window', { location: { hash: '#/studio' } });
});

describe('useCommerceStore 单用户引导', () => {
  it('bootstrap 装载训练师状态与工作区', async () => {
    installFetch();
    const { default: useCommerceStore } = await import('./useCommerceStore');

    await useCommerceStore.getState().bootstrap();

    const state = useCommerceStore.getState();
    expect(state.coachStatus?.paid).toBe(true);
    expect(state.isBootstrapping).toBe(false);
    expect(state.error).toBeNull();
  });

  it('bootstrap 失败时暴露错误', async () => {
    installFetch({ '/coach/status': () => fail(500, '服务未启动') });
    const { default: useCommerceStore } = await import('./useCommerceStore');

    await useCommerceStore.getState().bootstrap();

    const state = useCommerceStore.getState();
    expect(state.error).toContain('服务未启动');
    expect(state.isBootstrapping).toBe(false);
  });
});
