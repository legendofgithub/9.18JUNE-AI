import { useRef, useCallback, useState } from 'react';
import { FileText, Lightbulb, Loader2 } from 'lucide-react';
import type { Message } from '../../types';
import type { ExplainMode } from '../../types';
import FloatManager from '../../utils/floatManager';
import useJuneStore from '../../stores/useJuneStore';
import MarkdownRenderer from '../ui/MarkdownRenderer';

const EXPLAIN_MODES: { mode: ExplainMode; label: string }[] = [
  { mode: 'simple', label: '通俗' },
  { mode: 'standard', label: '标准' },
  { mode: 'advanced', label: '进阶' },
];

interface MessageBubbleProps {
  message: Message;
  onTextSelect?: (text: string, messageId: string) => void;
  isStreaming?: boolean;
}

export default function MessageBubble({ message, onTextSelect, isStreaming = false }: MessageBubbleProps) {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const floatWindows = useJuneStore(s => s.floatWindows);
  const openTextFollowUp = useJuneStore(s => s.openTextFollowUp);
  const reasoningMessageId = useJuneStore(s => s.reasoningMessageId);
  const explainLoading = useJuneStore(s => s.explainLoading);
  const explainMode = useJuneStore(s => s.explainMode);
  const requestExplain = useJuneStore(s => s.requestExplain);

  const [savedContent, setSavedContent] = useState<string | null>(null);

  const isUser = message.role === 'user';
  const isReasoning = reasoningMessageId === message.id;
  const showExplainBar = !isUser && !isStreaming && message.content.length > 0 && !isReasoning;

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
    useJuneStore.getState().bringToFront(threadId);
  };

  const handleExplain = (mode: ExplainMode) => {
    const original = savedContent ?? message.content;
    if (!savedContent) setSavedContent(message.content);
    requestExplain(message.id, original, mode);
  };

  const chainColors: Record<number, { bg: string; text: string; border: string }> = {
    1: { bg: 'rgba(91,110,245,0.10)', text: '#5b6ef5', border: 'rgba(91,110,245,0.20)' },
    2: { bg: 'rgba(168,85,247,0.10)', text: '#a855f7', border: 'rgba(168,85,247,0.20)' },
    3: { bg: 'rgba(249,115,22,0.10)', text: '#f97316', border: 'rgba(249,115,22,0.20)' },
    4: { bg: 'rgba(34,197,94,0.10)', text: '#22c55e', border: 'rgba(34,197,94,0.20)' },
  };

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4 animate-fade-in`}>
      <div className="max-w-[80%]">
        {!isUser && (
          <div className="flex items-center gap-2 mb-1 ml-1">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
              style={{ background: 'linear-gradient(135deg, var(--june-primary), var(--june-accent-2))' }}
            >
              J
            </div>
            <span className="text-xs" style={{ color: 'var(--june-text-dim)' }}>June AI</span>
          </div>
        )}
        <div
          ref={bubbleRef}
          onContextMenu={handleContextMenu}
          className={`select-text rounded-2xl px-4 py-3 text-sm leading-relaxed transition-all ${
            isUser ? 'rounded-br-md text-white' : 'rounded-bl-md card-shadow'
          }`}
          style={
            isUser
              ? { background: 'linear-gradient(135deg, var(--june-primary), var(--june-accent-2))' }
              : { background: 'var(--june-surface)', border: '1px solid var(--june-border)', color: 'var(--june-text)' }
          }
        >
          {message.content ? (
            isUser ? (
              <div className="whitespace-pre-wrap">{message.content}</div>
            ) : (
              <MarkdownRenderer content={message.content} isStreaming={isStreaming} />
            )
          ) : isReasoning ? (
            <div className="flex items-center gap-2 py-1">
              <Lightbulb size={14} className="animate-pulse" style={{ color: 'var(--june-primary)' }} />
              <span className="text-xs gradient-text font-medium" style={{ animation: 'pulse-soft 1.5s ease-in-out infinite' }}>
                June 正在思考...
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 py-1">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </div>
          )}

          {message.references && message.references.length > 0 && (
            <div className="mt-2 pt-2 border-t flex flex-col gap-1" style={{ borderColor: 'var(--june-border)' }}>
              {message.references.map((ref, i) => (
                <div key={i} className="text-xs flex items-center gap-1" style={{ color: 'var(--june-text-dim)' }}>
                  <FileText size={11} />
                  <span>来自: {ref.fileName}{ref.page ? ` (第${ref.page}页)` : ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {showExplainBar && (
          <div className="flex items-center gap-1.5 mt-1.5 ml-1">
            <span className="text-xs mr-0.5" style={{ color: 'var(--june-text-dim)' }}>
              {explainLoading && <Loader2 size={11} className="animate-spin inline mr-1" />}
              讲解:
            </span>
            {EXPLAIN_MODES.map(({ mode, label }) => (
              <button
                key={mode}
                onClick={() => handleExplain(mode)}
                disabled={explainLoading}
                className="text-xs px-2.5 py-1 rounded-lg transition-all disabled:opacity-50 font-medium"
                style={{
                  background: explainMode === mode
                    ? 'linear-gradient(135deg, var(--june-primary), var(--june-accent-2))'
                    : 'var(--june-surface-alt)',
                  color: explainMode === mode ? '#fff' : 'var(--june-text-dim)',
                  border: explainMode === mode ? 'none' : '1px solid var(--june-border)',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {followUpChain.length > 0 && (
          <div className="mt-1 ml-1 flex flex-col gap-0.5">
            {followUpChain.map(chain => {
              const c = chainColors[chain.level] ?? chainColors[4];
              return (
                <button
                  key={chain.threadId}
                  onClick={() => handleFollowUpClick(chain.threadId)}
                  className="text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 w-fit hover:opacity-80 transition-opacity"
                  style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
                >
                  <span className="font-bold">L{chain.level}</span>
                  <span>追问: {chain.summary}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
