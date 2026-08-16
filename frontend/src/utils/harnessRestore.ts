import type {
  FollowUpSettings,
  HarnessSessionDetail,
  HarnessThreadState,
  FloatWindow,
} from '../types';
import { DEFAULT_FOLLOW_UP_SETTINGS } from '../types';

interface RestoreOptions {
  viewportWidth?: number;
  viewportHeight?: number;
}

export function restoreFloatWindows(
  detail: HarnessSessionDetail,
  options: RestoreOptions = {},
): FloatWindow[] {
  const viewportWidth = options.viewportWidth ?? 1440;
  const viewportHeight = options.viewportHeight ?? 900;
  const openStates = (detail.threads ?? []).filter(state => !state.isClosed);
  const byId = new Map(openStates.map(state => [state.threadId, state]));
  const hasOpenAncestor = (state: HarnessThreadState, seen = new Set<string>()): boolean => {
    if (state.parentThreadId === 'main') return true;
    if (seen.has(state.threadId)) return false;
    seen.add(state.threadId);
    return byId.has(state.parentThreadId) && hasOpenAncestor(byId.get(state.parentThreadId)!, seen);
  };

  const windows = openStates
    .filter(state => hasOpenAncestor(state))
    .map((state, index) => {
      const settings: FollowUpSettings = {
        ...DEFAULT_FOLLOW_UP_SETTINGS,
        ...(state.settings ?? {}),
      };
      const fallbackX = 80 + (index % 5) * 42;
      const fallbackY = 100 + (index % 5) * 38;
      const maxX = Math.max(16, viewportWidth - state.size.width - 16);
      const maxY = Math.max(16, viewportHeight - 120);
      const rawX = Number(state.position?.x);
      const rawY = Number(state.position?.y);
      const safeX = Number.isFinite(rawX) ? rawX : fallbackX;
      const safeY = Number.isFinite(rawY) ? rawY : fallbackY;
      return {
        threadId: state.threadId,
        parentThreadId: state.parentThreadId || 'main',
        level: state.level || 1,
        type: state.type ?? 'text',
        source: {
          selectedText: state.source?.selectedText ?? '',
          sourceMessageId: state.source?.sourceMessageId ?? 'unknown',
        },
        messages: detail.threadMessages?.[state.threadId] ?? [],
        position: {
          x: Math.min(Math.max(safeX, 16), maxX),
          y: Math.min(Math.max(safeY, 16), maxY),
        },
        size: {
          width: Math.max(320, state.size?.width ?? 420),
          height: Math.max(240, state.size?.height ?? 360),
        },
        isMinimized: Boolean(state.isMinimized),
        zIndex: state.zIndex || 1000 + index,
        settings,
      } satisfies FloatWindow;
    });

  return windows.sort((a, b) => a.zIndex - b.zIndex);
}

export function buildLevelPath(threadId: string, windows: FloatWindow[]): string {
  const byId = new Map(windows.map(win => [win.threadId, win]));
  const levels: number[] = [];
  let current = byId.get(threadId);
  const seen = new Set<string>();
  while (current && !seen.has(current.threadId)) {
    seen.add(current.threadId);
    levels.unshift(current.level);
    current = current.parentThreadId === 'main' ? undefined : byId.get(current.parentThreadId);
  }
  return levels.length ? levels.map(level => `L${level}`).join(' / ') : 'L1';
}

export function toThreadRegisterRequest(win: FloatWindow): import('../types').ThreadRegisterRequest {
  return {
    parent_thread_id: win.parentThreadId,
    thread_id: win.threadId,
    level: win.level,
    source: {
      type: win.type,
      selected_text: win.source.selectedText,
      source_message_id: win.source.sourceMessageId,
      source_message_role: 'assistant',
    },
    position: win.position,
    size: win.size,
    zIndex: win.zIndex,
  };
}

export function toThreadPatchRequest(
  win: FloatWindow,
  overrides: Partial<{ isClosed: boolean }> = {},
): import('../types').ThreadPatchRequest {
  return {
    position: win.position,
    size: win.size,
    is_minimized: win.isMinimized,
    z_index: win.zIndex,
    settings: win.settings ?? DEFAULT_FOLLOW_UP_SETTINGS,
    is_closed: overrides.isClosed ?? false,
  };
}
