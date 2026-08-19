import { afterEach, describe, expect, it, vi } from 'vitest';
import { sseService } from './sseService';

describe('sseService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not retry after a stream has emitted output', async () => {
    const deltas: string[] = [];
    const encoder = new TextEncoder();
    let reads = 0;

    vi.stubGlobal('localStorage', {
      getItem: () => '',
      setItem: () => undefined,
      removeItem: () => undefined,
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          cancel: async () => undefined,
          read: async () => {
            reads += 1;
            if (reads === 1) {
              return {
                done: false,
                value: encoder.encode('data: {"delta":"部分回答"}\n\n'),
              };
            }
            throw new Error('network disconnected');
          },
        }),
      },
    })));

    await expect(sseService.sendChatMessage('s1', 'question', delta => {
      deltas.push(delta);
    })).rejects.toThrow('network disconnected');

    expect(deltas).toEqual(['部分回答']);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
