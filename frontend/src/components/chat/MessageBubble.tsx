import { useRef, useCallback } from 'react';
import type { Message } from '../../types';
import FloatManager from '../../utils/floatManager';
import useJuneStore from '../../stores/useJuneStore';
import MarkdownRenderer from '../ui/MarkdownRenderer';

interface MessageBubbleProps {
  message: Message;
  onTextSelect?: (text: string, messageId: string) => void;
  /** 该消息是否正在流式接收中（仅对最后一条 assistant 消息为 true） */
  isStreaming?: boolean;
}

export default function MessageBubble({ message, onTextSelect, isStreaming = false }: MessageBubbleProps) {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const floatWindows = useJuneStore(s => s.floatWindows);
  const openTextFollowUp = useJuneStore(s => s.openTextFollowUp);

  const isUser = message.role === 'user';

  // 获取该消息的追问链
  const followUpChain = FloatManager.getFollowUpChain(message.id, floatWindows);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();

    if (selectedText && bubbleRef.current?.contains(selection?.anchorNode)) {
      e.preventDefault();
      onTextSelect?.(selectedText, message.id);
    }
  }, [message.id, onTextSelect]);

  const handleFollowUpClick = (threadId: string) => {
    // 聚焦对应的悬浮窗
    useJuneStore.getState().bringToFront(threadId);
  };

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div className="max-w-[80%]">
        {!isUser && (
          <div className="flex items-center gap-2 mb-1 ml-1">
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center text-white text-xs font-bold shadow-[0_0_8px_rgba(0,229,255,0.3)]">
              J
            </div>
            <span className="text-xs text-[#6b7c93]">June AI</span>
          </div>
        )}
        <div
          ref={bubbleRef}
          onContextMenu={handleContextMenu}
          className={`select-text rounded-xl px-4 py-3 text-sm leading-relaxed ${
            isUser
              ? 'bg-[#00e5ff]/15 text-[#e8ecf1] rounded-br-md border border-[#00e5ff]/20'
              : 'bg-[#111827] border border-[#1e2d3d] text-[#c8d6e5] rounded-bl-md shadow-lg'
          }`}
        >
          {message.content ? (
            isUser ? (
              <div className="whitespace-pre-wrap">{message.content}</div>
            ) : (
              <MarkdownRenderer
                content={message.content}
                isStreaming={isStreaming}
              />
            )
          ) : (
            <div className="flex items-center gap-1 text-[#6b7c93]">
              <span className="animate-pulse">●</span>
              <span className="animate-pulse" style={{ animationDelay: '0.2s' }}>●</span>
              <span className="animate-pulse" style={{ animationDelay: '0.4s' }}>●</span>
            </div>
          )}

          {/* 资料库引用 */}
          {message.references && message.references.length > 0 && (
            <div className="mt-2 pt-2 border-t border-[#1e2d3d]">
              {message.references.map((ref, i) => (
                <div key={i} className="text-xs text-[#6b7c93] flex items-center gap-1">
                  <span>📎</span>
                  <span>来自: {ref.fileName}{ref.page ? ` (第${ref.page}页)` : ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 追问链指示器 */}
        {followUpChain.length > 0 && (
          <div className="mt-1 ml-1 flex flex-col gap-0.5">
            {followUpChain.map(chain => (
              <button
                key={chain.threadId}
                onClick={() => handleFollowUpClick(chain.threadId)}
                className={`text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 w-fit hover:opacity-80 transition-opacity ${
                  chain.level === 1 ? 'bg-[#00e5ff]/10 text-[#00e5ff] border border-[#00e5ff]/20' :
                  chain.level === 2 ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' :
                  'bg-orange-500/10 text-orange-400 border border-orange-500/20'
                }`}
              >
                <span className="font-bold">L{chain.level}</span>
                <span>追问: {chain.summary}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
