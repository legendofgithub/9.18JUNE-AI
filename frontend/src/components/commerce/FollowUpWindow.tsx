import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { GripHorizontal, Loader2, MessageSquarePlus, Send, Sparkles, X } from 'lucide-react';
import type { Message } from '../../types';
import type { SiteLanguage } from './SiteHeader';

export interface FollowUpWindowState {
  threadId: string;
  parentThreadId: string;
  level: number;
  sourceMessageId: string;
  selectedText: string;
  x: number;
  y: number;
  z: number;
}

interface Props {
  state: FollowUpWindowState;
  messages: Message[];
  isStreaming: boolean;
  isAdopting: boolean;
  language: SiteLanguage;
  onClose: (threadId: string) => void;
  onFocus: (threadId: string) => void;
  onAsk: (threadId: string, query: string) => void;
  onDeepen: (parent: FollowUpWindowState, sourceMessageId: string, selectedText: string) => void;
  onAdopt: (threadId: string) => void;
}

export function currentSelection(): string {
  const selection = window.getSelection();
  const text = selection ? selection.toString().trim() : '';
  return text.length > 1 ? text.slice(0, 400) : '';
}

export default function FollowUpWindow({
  state,
  messages,
  isStreaming,
  isAdopting,
  language,
  onClose,
  onFocus,
  onAsk,
  onDeepen,
  onAdopt,
}: Props) {
  const [draft, setDraft] = useState('');
  const [position, setPosition] = useState({ x: state.x, y: state.y });
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = messagesRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages.length, messages[messages.length - 1]?.content]);

  const startDrag = (event: ReactMouseEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    onFocus(state.threadId);
    const originX = event.clientX;
    const originY = event.clientY;
    const start = { ...position };
    const move = (moveEvent: MouseEvent) => {
      setPosition({
        x: Math.max(8, Math.min(window.innerWidth - 360, start.x + moveEvent.clientX - originX)),
        y: Math.max(8, Math.min(window.innerHeight - 200, start.y + moveEvent.clientY - originY)),
      });
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const submit = () => {
    const query = draft.trim();
    if (!query || isStreaming) return;
    setDraft('');
    onAsk(state.threadId, query);
  };

  const deepen = (sourceMessageId: string) => {
    onDeepen(state, sourceMessageId, currentSelection());
  };

  const canAdopt = messages.some(item => item.role === 'assistant' && item.content.trim());

  return (
    <div
      className="follow-up-window"
      style={{ left: position.x, top: position.y, zIndex: state.z }}
      onMouseDown={() => onFocus(state.threadId)}
    >
      <header className="follow-up-window-head" onMouseDown={startDrag}>
        <GripHorizontal size={14} className="follow-up-grip" />
        <span className="follow-up-level">L{state.level}</span>
        <span className="follow-up-title">
          {language === 'zh' ? '追问' : 'Follow-up'}
          {state.selectedText ? <em>· {state.selectedText.slice(0, 18)}</em> : null}
        </span>
        <button className="follow-up-icon" title="关闭" onClick={() => onClose(state.threadId)}>
          <X size={14} />
        </button>
      </header>

      <div ref={messagesRef} className="follow-up-window-body">
        {messages.length === 0 ? (
          <p className="follow-up-empty">
            {language === 'zh' ? '针对上面的内容继续问，次数不限。' : 'Ask anything about the selected content.'}
          </p>
        ) : messages.map(message => (
          <div key={message.id} className={`follow-up-message is-${message.role}`}>
            {message.content || (isStreaming ? '…' : '')}
            {message.role === 'assistant' && message.content.trim() ? (
              <button
                className="follow-up-deepen"
                title={language === 'zh' ? '针对这条回复再开一层追问' : 'Ask deeper'}
                onClick={() => deepen(message.id)}
              >
                <MessageSquarePlus size={13} />
                {language === 'zh' ? '再追问' : 'Deeper'}
              </button>
            ) : null}
          </div>
        ))}
      </div>

      <footer className="follow-up-window-foot">
        <textarea
          className="follow-up-input"
          rows={2}
          value={draft}
          placeholder={language === 'zh' ? '继续追问…（Enter 发送）' : 'Keep asking…'}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.altKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div className="follow-up-actions">
          <button
            className="follow-up-adopt"
            disabled={!canAdopt || isAdopting || isStreaming}
            title={language === 'zh' ? '把这条追问链的结论写进当前节点交付物' : 'Adopt into deliverable'}
            onClick={() => onAdopt(state.threadId)}
          >
            {isAdopting ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {language === 'zh' ? '采纳为交付物' : 'Adopt'}
          </button>
          <button className="follow-up-send" disabled={!draft.trim() || isStreaming} onClick={submit}>
            {isStreaming ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            {language === 'zh' ? '发送' : 'Send'}
          </button>
        </div>
      </footer>
    </div>
  );
}
