import { describe, expect, it } from 'vitest';
import type { HarnessSessionDetail, HarnessThreadState } from '../types';
import { buildLevelPath, restoreFloatWindows, toThreadPatchRequest } from './harnessRestore';

function state(threadId: string, parentThreadId: string, level: number, overrides: Partial<HarnessThreadState> = {}): HarnessThreadState {
  return {
    threadId,
    parentThreadId,
    level,
    type: 'text',
    source: {
      selectedText: `selected ${threadId}`,
      sourceMessageId: `source-${threadId}`,
      sourceMessageRole: 'assistant',
    },
    position: { x: 40, y: 50 },
    size: { width: 420, height: 360 },
    isMinimized: false,
    zIndex: 1000 + level,
    isClosed: false,
    ...overrides,
  };
}

const detail: HarnessSessionDetail = {
  id: 'session',
  title: 'Session',
  createdAt: 1,
  model: 'glm-5.2',
  messages: [],
  threads: [
    state('f1', 'main', 1),
    state('f2', 'f1', 2),
    state('f3', 'f2', 3),
    state('closed', 'main', 1, { isClosed: true }),
  ],
  threadMessages: {
    f1: [
      { id: 'm1', role: 'user', content: 'q1', timestamp: 1, threadId: 'f1' },
    ],
    f2: [],
    f3: [],
    closed: [],
  },
};

describe('harnessRestore', () => {
  it('restores an open nested window tree with messages', () => {
    const windows = restoreFloatWindows(detail);
    expect(windows.map(win => win.threadId)).toEqual(['f1', 'f2', 'f3']);
    expect(windows.find(win => win.threadId === 'f1')?.messages[0].content).toBe('q1');
    expect(windows.find(win => win.threadId === 'f2')?.parentThreadId).toBe('f1');
  });

  it('drops descendants when an ancestor is closed', () => {
    const windows = restoreFloatWindows({
      ...detail,
      threads: detail.threads.map(item => item.threadId === 'f1' ? { ...item, isClosed: true } : item),
    });
    expect(windows.map(win => win.threadId)).toEqual([]);
  });

  it('uses deterministic on-screen layout for missing geometry', () => {
    const windows = restoreFloatWindows({
      ...detail,
      threads: detail.threads.map(item => ({
        ...item,
        position: { x: Number.NaN, y: -20 },
      })),
    }, { viewportWidth: 500, viewportHeight: 400 });
    windows.forEach(win => {
      expect(Number.isFinite(win.position.x)).toBe(true);
      expect(win.position.x).toBeLessThanOrEqual(500 - win.size.width - 16);
      expect(win.position.y).toBeGreaterThanOrEqual(16);
    });
  });

  it('builds a level path and closed-state patch', () => {
    const windows = restoreFloatWindows(detail);
    expect(buildLevelPath('f3', windows)).toBe('L1 / L2 / L3');
    const f1 = windows.find(win => win.threadId === 'f1')!;
    expect(toThreadPatchRequest(f1, { isClosed: true }).is_closed).toBe(true);
  });
});
