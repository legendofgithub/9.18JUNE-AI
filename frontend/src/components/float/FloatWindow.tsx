import { useState, useRef, useCallback, useEffect } from 'react';
import { X, Minus, GripHorizontal, Send, Settings } from 'lucide-react';
import type { FloatWindow as FloatWindowType } from '../../types';
import FloatManager from '../../utils/floatManager';
import useJuneStore from '../../stores/useJuneStore';
import ErrorBoundary from '../ErrorBoundary';
import MarkdownRenderer from '../ui/MarkdownRenderer';
import type { FollowUpSettings } from '../../types';

interface FloatWindowProps {
  window: FloatWindowType;
}

export default function FloatWindow({ window: win }: FloatWindowProps) {
  const [input, setInput] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number }>({ startX: 0, startY: 0, origX: 0, origY: 0 });
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number }>({ startX: 0, startY: 0, origW: 0, origH: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const settingsPanelRef = useRef<HTMLDivElement>(null);

  const updateFloatWindowPosition = useJuneStore(s => s.updateFloatWindowPosition);
  const updateFloatWindowSize = useJuneStore(s => s.updateFloatWindowSize);
  const closeFloatWindow = useJuneStore(s => s.closeFloatWindow);
  const minimizeFloatWindow = useJuneStore(s => s.minimizeFloatWindow);
  const restoreFloatWindow = useJuneStore(s => s.restoreFloatWindow);
  const bringToFront = useJuneStore(s => s.bringToFront);
  const sendFollowUp = useJuneStore(s => s.sendFollowUp);
  const showContextMenu = useJuneStore(s => s.showContextMenu);
  const openTextFollowUp = useJuneStore(s => s.openTextFollowUp);
  const updateFloatWindowSettings = useJuneStore(s => s.updateFloatWindowSettings);

  const colors = FloatManager.getLevelColors(win.level);

  // 点击外部关闭设置面板
  useEffect(() => {
    if (!showSettings) return;
    const handler = (e: MouseEvent) => {
      if (settingsPanelRef.current && !settingsPanelRef.current.contains(e.target as Node)) {
        setShowSettings(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSettings]);

  // 滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [win.messages]);

  // 拖拽处理
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    bringToFront(win.threadId);
    setIsDragging(true);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: win.position.x,
      origY: win.position.y,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [win.threadId, win.position, bringToFront]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (isDragging) {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      const newPos = FloatManager.clampToScreen(
        { x: dragRef.current.origX + dx, y: dragRef.current.origY + dy },
        win.size,
      );
      updateFloatWindowPosition(win.threadId, newPos);
    }
    if (isResizing) {
      const dx = e.clientX - resizeRef.current.startX;
      const dy = e.clientY - resizeRef.current.startY;
      const newSize = {
        width: Math.max(320, resizeRef.current.origW + dx),
        height: Math.max(240, resizeRef.current.origH + dy),
      };
      updateFloatWindowSize(win.threadId, newSize);
    }
  }, [isDragging, isResizing, win.threadId, win.size, updateFloatWindowPosition, updateFloatWindowSize]);

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
    setIsResizing(false);
  }, []);

  // 调整大小
  const handleResizePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origW: win.size.width,
      origH: win.size.height,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [win.size]);

  // 发送追问
  const handleSend = useCallback(() => {
    if (!input.trim()) return;
    sendFollowUp(win.threadId, input.trim());
    setInput('');
  }, [input, win.threadId, sendFollowUp]);

  // 追问内文本选中
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();
    if (selectedText) {
      e.preventDefault();
      const rect = selection?.getRangeAt(0)?.getBoundingClientRect();
      showContextMenu({
        x: rect ? rect.right + 5 : e.clientX,
        y: rect ? rect.top : e.clientY,
        items: [
          {
            label: '复制',
            icon: '📋',
            action: () => navigator.clipboard.writeText(selectedText),
          },
          {
            label: '追问 (创建子层)',
            icon: '💬',
            action: () => {
              const position = FloatManager.getChildPosition(win);
              openTextFollowUp({
                selectedText,
                sourceMessageId: win.messages[win.messages.length - 1]?.id ?? 'unknown',
                parentThreadId: win.threadId,
                level: win.level + 1,
                position,
              });
            },
          },
        ],
      });
    }
  }, [win, showContextMenu, openTextFollowUp]);

  // 最小化状态
  if (win.isMinimized) {
    return (
      <div
        onClick={() => restoreFloatWindow(win.threadId)}
        className="fixed rounded-lg shadow-lg border px-3 py-2 cursor-pointer hover:shadow-xl transition-shadow z-50 flex items-center gap-2"
        style={{
          left: win.position.x,
          top: win.position.y,
          zIndex: win.zIndex,
          backgroundColor: colors.header,
          borderColor: colors.border,
        }}
      >
        <span className="text-sm font-medium" style={{ color: colors.border }}>
          L{win.level}
        </span>
        <span className="text-xs text-gray-600 truncate max-w-[120px]">
          {win.source.selectedText?.slice(0, 20) ?? '追问'}
        </span>
      </div>
    );
  }

  return (
    <div
      data-float-window
      className={`fixed rounded-xl shadow-2xl border flex flex-col z-50 bg-[#0d1520] ${
        isDragging ? 'cursor-grabbing' : ''
      } ${isDragging || isResizing ? 'select-none' : ''}`}
      style={{
        left: win.position.x,
        top: win.position.y,
        width: win.size.width,
        height: win.size.height,
        zIndex: win.zIndex,
        borderColor: colors.border,
        borderWidth: 2,
      }}
      onClick={() => bringToFront(win.threadId)}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* 标题栏 */}
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-t-xl cursor-grab"
        style={{ backgroundColor: colors.header }}
        onPointerDown={handlePointerDown}
      >
        <GripHorizontal size={14} className="text-gray-400 cursor-grab" />

        {/* 层级标签 */}
        <span
          className="text-xs font-bold px-1.5 py-0.5 rounded text-white"
          style={{ backgroundColor: colors.border }}
        >
          L{win.level}
        </span>

        {/* 追问源预览 */}
        <span className="text-xs text-[#c8d6e5] truncate flex-1">
          {win.type === 'text' ? (
            <>📌 "{win.source.selectedText?.slice(0, 30)}{(win.source.selectedText?.length ?? 0) > 30 ? '...' : ''}"</>
          ) : (
            <>📸 追问</>
          )}
        </span>

        {/* 操作按钮 */}
        <div className="relative" ref={settingsPanelRef}>
          <button
            onClick={(e) => { e.stopPropagation(); setShowSettings(!showSettings); }}
            className={`p-0.5 rounded transition-colors ${showSettings ? 'bg-black/15' : 'hover:bg-black/10'}`}
            title="追问设置"
          >
            <Settings size={14} className="text-gray-500" />
          </button>

          {/* 设置面板 */}
          {showSettings && (
            <div
              className="absolute right-0 top-full mt-1 bg-[#111827] rounded-lg shadow-xl border border-[#1e2d3d] p-3 w-52 z-[9999]"
              onClick={e => e.stopPropagation()}
            >
              <SettingsPanel
                settings={win.settings ?? { verbosity: 'detailed', temperature: 'medium' }}
                onChange={(s) => updateFloatWindowSettings(win.threadId, s)}
              />
            </div>
          )}
        </div>
        <button
          onClick={() => minimizeFloatWindow(win.threadId)}
          className="p-0.5 hover:bg-black/10 rounded transition-colors"
        >
          <Minus size={14} className="text-gray-500" />
        </button>
        <button
          onClick={() => closeFloatWindow(win.threadId, true)}
          className="p-0.5 hover:bg-red-100 rounded transition-colors"
        >
          <X size={14} className="text-gray-500 hover:text-red-500" />
        </button>
      </div>

      {/* 追问源引用 */}
      <div className="px-3 py-2 bg-gray-50 border-b border-gray-100">
        <div className="text-xs text-gray-500 italic">
          {win.type === 'text'
            ? `引用: "...${win.source.selectedText?.slice(0, 100)}..."`
            : '引用: [截图内容]'}
        </div>
      </div>

      {/* 消息体 */}
      <div
        className="flex-1 overflow-y-auto px-3 py-2 text-sm"
        onContextMenu={handleContextMenu}
      >
        {win.messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[#3d4d5d] text-xs">
            在下方输入框继续追问...
          </div>
        ) : (
          win.messages.map(msg => (
            <div key={msg.id} className={`mb-3 ${msg.role === 'user' ? 'text-right' : ''}`}>
              <div
                className={`inline-block select-text rounded-lg px-3 py-1.5 text-xs max-w-[90%] ${
                  msg.role === 'user'
                    ? 'bg-blue-500 text-white'
                    : 'bg-[#111827] border border-[#1e2d3d] text-[#c8d6e5]'
                }`}
              >
                {msg.content ? (
                  msg.role === 'user' ? (
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  ) : (
                    <MarkdownRenderer
                      content={msg.content}
                      isStreaming={win.isStreaming && msg === win.messages[win.messages.length - 1]}
                    />
                  )
                ) : (
                  <span className="text-[#3d4d5d] animate-pulse">...</span>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入栏 */}
      <div className="border-t border-gray-100 px-3 py-2">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="继续追问..."
            className="flex-1 bg-[#0a0e17] rounded-lg px-3 py-1.5 text-xs outline-none border border-[#1e2d3d] focus:border-[#00e5ff]/40 focus:ring-1 focus:ring-[#00e5ff]/20 text-[#c8d6e5] placeholder:text-[#3d4d5d]"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className={`p-1.5 rounded-lg transition-colors ${
              input.trim()
                ? 'text-white hover:opacity-90'
                : 'text-[#3d4d5d] cursor-not-allowed'
            }`}
            style={{ backgroundColor: input.trim() ? colors.border : undefined }}
          >
            <Send size={14} />
          </button>
        </div>
      </div>

      {/* 右下角拖拽调整大小 */}
      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
        onPointerDown={handleResizePointerDown}
        style={{
          background: `linear-gradient(135deg, transparent 50%, ${colors.border}40 50%)`,
          borderBottomRightRadius: '0.75rem',
        }}
      />
    </div>
  );
}

/** 设置面板内容组件 */
function SettingsPanel({
  settings,
  onChange,
}: {
  settings: FollowUpSettings;
  onChange: (s: Partial<FollowUpSettings>) => void;
}) {
  return (
    <div className="space-y-3 text-xs">
      {/* 回复长度 */}
      <div>
        <div className="text-[#3d4d5d] mb-1.5 font-medium">回复长度</div>
        <div className="flex gap-1">
          {(['detailed', 'concise'] as const).map(v => (
            <button
              key={v}
              onClick={() => onChange({ verbosity: v })}
              className={`flex-1 px-2 py-1 rounded text-xs transition-colors ${
                settings.verbosity === v
                  ? 'bg-[#00e5ff] text-[#0a0e17]'
                  : 'bg-[#1a2332] text-[#c8d6e5] hover:bg-[#1e2d3d]'
              }`}
            >
              {v === 'detailed' ? '详细' : '简略'}
            </button>
          ))}
        </div>
      </div>

      {/* 温度 */}
      <div>
        <div className="text-gray-500 mb-1.5 font-medium">模型温度</div>
        <div className="flex gap-1">
          {([
            { key: 'low' as const, label: '低', desc: '0.2' },
            { key: 'medium' as const, label: '中', desc: '0.7' },
            { key: 'high' as const, label: '高', desc: '1.2' },
          ]).map(t => (
            <button
              key={t.key}
              onClick={() => onChange({ temperature: t.key })}
              className={`flex-1 px-2 py-1 rounded text-xs transition-colors ${
                settings.temperature === t.key
                  ? 'bg-blue-500 text-white'
                  : 'bg-[#1a2332] text-[#c8d6e5] hover:bg-[#1e2d3d]'
              }`}
              title={`温度 ${t.desc}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="text-gray-400 mt-1 text-[10px]">
          低=精确稳定 · 中=均衡 · 高=创意发散
        </div>
      </div>
    </div>
  );
}