import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * useCommerceStore 核心认证/引导流程单测。
 * 通过 stub localStorage / window / fetch，验证：
 * - 登录成功后 token 持久化、用户态就绪
 * - 登录失败后 token 被清除、错误可见
 * - 登出后状态完全复位
 * - 引导时无效 token 被自动清除（会话过期自愈）
 */

const USER_TOKEN_KEY = 'june_user_token';

const ok = (data: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ code: 200, message: 'ok', data }),
});

const fail = (status: number, message: string) => ({
  ok: false,
  status,
  json: async () => ({ code: status, message, data: null }),
});

const fakeUser = {
  id: 'u1',
  email: 'buyer@example.com',
  displayName: 'Buyer',
  token: 'tok-1',
  isAdmin: false,
};

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
    if (url.includes('/auth/me')) return fail(401, '登录状态已失效') as never;
    if (url.includes('/products')) return ok([]) as never;
    if (url.includes('/orders')) return ok([]) as never;
    if (url.includes('/coach/status')) return ok(coachStatus) as never;
    if (url.includes('/model-services')) return ok([]) as never;
    if (url.includes('/mvp-runs')) return ok([]) as never;
    if (url.includes('/skills/current')) return ok(null) as never;
    return fail(404, `unexpected request: ${url}`) as never;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, String(value)),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  });
  vi.stubGlobal('window', { location: { hash: '#/' } });
});

describe('useCommerceStore 认证流程', () => {
  it('登录成功后持久化 token 并装载用户态', async () => {
    const fetchMock = installFetch({ '/auth/login': () => ok(fakeUser) });
    const { default: useCommerceStore } = await import('./useCommerceStore');

    await useCommerceStore.getState().login('buyer@example.com', 'secure-password');

    const state = useCommerceStore.getState();
    expect(state.user?.email).toBe('buyer@example.com');
    expect(state.error).toBeNull();
    expect(localStorage.getItem(USER_TOKEN_KEY)).toBe('tok-1');

    const loginCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/auth/login'),
    ) as unknown as [{ url: string }, RequestInit | undefined];
    expect(loginCall?.[1]?.body).toContain('secure-password');
    // 后续数据装载必须带上认证头
    const authedCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).includes('/coach/status') &&
        (init?.headers as Record<string, string>)?.Authorization === 'Bearer tok-1',
    );
    expect(authedCall).toBeTruthy();
  });

  it('登录失败后清除 token 并暴露错误', async () => {
    installFetch({ '/auth/login': () => fail(401, '账号或密码错误') });
    const { default: useCommerceStore } = await import('./useCommerceStore');
    localStorage.setItem(USER_TOKEN_KEY, 'stale-token');

    await useCommerceStore.getState().login('buyer@example.com', 'wrong-password');

    const state = useCommerceStore.getState();
    expect(state.user).toBeNull();
    expect(state.error).toBe('账号或密码错误');
    expect(localStorage.getItem(USER_TOKEN_KEY)).toBeNull();
  });

  it('登出后完全复位状态', async () => {
    installFetch({ '/auth/login': () => ok(fakeUser) });
    const { default: useCommerceStore } = await import('./useCommerceStore');
    await useCommerceStore.getState().login('buyer@example.com', 'secure-password');
    expect(useCommerceStore.getState().user).not.toBeNull();

    useCommerceStore.getState().logout();

    const state = useCommerceStore.getState();
    expect(localStorage.getItem(USER_TOKEN_KEY)).toBeNull();
    expect(state.user).toBeNull();
    expect(state.currentRun).toBeNull();
    expect(state.runs).toEqual([]);
    expect(state.modelServices).toEqual([]);
    expect(state.error).toBeNull();
  });

  it('引导时无效 token 被自动清除', async () => {
    installFetch();
    localStorage.setItem(USER_TOKEN_KEY, 'expired-token');
    const { default: useCommerceStore } = await import('./useCommerceStore');

    await useCommerceStore.getState().bootstrap();

    const state = useCommerceStore.getState();
    expect(localStorage.getItem(USER_TOKEN_KEY)).toBeNull();
    expect(state.user).toBeNull();
    expect(state.currentRun).toBeNull();
    expect(state.isBootstrapping).toBe(false);
  });
});
