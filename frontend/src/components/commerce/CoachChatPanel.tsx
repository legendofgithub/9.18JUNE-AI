import { useEffect, useRef, useState } from 'react';
import { Loader2, MessageSquarePlus, RotateCcw, Send } from 'lucide-react';
import useCommerceStore from '../../stores/useCommerceStore';
import type { SiteLanguage } from './SiteHeader';
import FollowUpWindow, { currentSelection, type FollowUpWindowState } from './FollowUpWindow';

function newThreadId() {
  return `thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function CoachChatPanel({ language }: { language: SiteLanguage }) {
  const currentRun = useCommerceStore(s => s.currentRun);
  const sendChat = useCommerceStore(s => s.sendChat);
  const sendFollowUp = useCommerceStore(s => s.sendFollowUp);
  const adoptFollowUp = useCommerceStore(s => s.adoptFollowUp);
  const followUpMessages = useCommerceStore(s => s.followUpMessages);
  const followUpMeta = useCommerceStore(s => s.followUpMeta);
  const followUpStreaming = useCommerceStore(s => s.followUpStreaming);
  const isStreaming = useCommerceStore(s => s.isStreaming);
  const error = useCommerceStore(s => s.error);
  const clearError = useCommerceStore(s => s.clearError);

  const [input, setInput] = useState('');
  const [windows, setWindows] = useState<FollowUpWindowState[]>([]);
  const [topZ, setTopZ] = useState(1200);
  const [adoptingId, setAdoptingId] = useState<string | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  const messages = currentRun?.messages || [];
  const archived = currentRun?.status === 'completed';
  const currentStep = currentRun?.currentStep;

  useEffect(() => {
    const element = messagesRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages.length, messages[messages.length - 1]?.content]);

  const slot = () => windows.length % 6;

  const openFromMain = (sourceMessageId: string, selectedText: string) => {
    const offset = slot();
    const nextZ = topZ + 1;
    setTopZ(nextZ);
    setWindows(previous => [...previous, {
      threadId: newThreadId(),
      parentThreadId: 'main',
      level: 2,
      sourceMessageId,
      selectedText,
      x: 96 + offset * 26,
      y: 110 + offset * 26,
      z: nextZ,
    }]);
  };

  const deepen = (parent: FollowUpWindowState, sourceMessageId: string, selectedText: string) => {
    const nextZ = topZ + 1;
    setTopZ(nextZ);
    setWindows(previous => [...previous, {
      threadId: newThreadId(),
      parentThreadId: parent.threadId,
      level: parent.level + 1,
      sourceMessageId,
      selectedText,
      x: Math.min(parent.x + 30, 520),
      y: Math.min(parent.y + 30, 320),
      z: nextZ,
    }]);
  };

  const ask = (threadId: string, query: string) => {
    const target = windows.find(item => item.threadId === threadId);
    if (!target) return;
    void sendFollowUp({
      threadId,
      parentThreadId: target.parentThreadId,
      level: target.level,
      sourceMessageId: target.sourceMessageId,
      selectedText: target.selectedText,
      query,
    });
  };

  const adopt = async (threadId: string) => {
    setAdoptingId(threadId);
    await adoptFollowUp(threadId);
    setAdoptingId(null);
  };

  const focus = (threadId: string) => {
    const nextZ = topZ + 1;
    setTopZ(nextZ);
    setWindows(previous => previous.map(item => (item.threadId === threadId ? { ...item, z: nextZ } : item)));
  };

  const submit = () => {
    const content = input.trim();
    if (!content || isStreaming || archived) return;
    setInput('');
    void sendChat(content);
  };

  const historyThreads = Object.keys(followUpMeta).filter(
    threadId => !windows.some(item => item.threadId === threadId),
  );

  const restoreThreads = () => {
    let cursor = topZ;
    const restored = historyThreads.map(threadId => {
      const meta = followUpMeta[threadId];
      cursor += 1;
      return {
        threadId,
        parentThreadId: meta.parentThreadId,
        level: meta.level,
        sourceMessageId: meta.sourceMessageId || '',
        selectedText: '',
        x: 96 + (cursor % 6) * 26,
        y: 110 + (cursor % 6) * 26,
        z: cursor,
      };
    });
    setTopZ(cursor);
    setWindows(previous => [...previous, ...restored]);
  };

  return (
    <div className="coach-chat-panel">
      <header className="coach-chat-head">
        <div>
          <h2>{currentRun?.title || (language === 'zh' ? '商业 MVP 跟练' : 'Business MVP')}</h2>
          <p>
            {currentStep
              ? `第 ${currentStep.order}/${currentRun?.steps.length} 节点 · ${currentStep.title}`
              : language === 'zh' ? '暂无进行中的节点' : 'No active step'}
          </p>
        </div>
        {historyThreads.length > 0 ? (
          <button className="coach-restore-threads" onClick={restoreThreads}>
            <RotateCcw size={13} />
            {language === 'zh' ? `恢复 ${historyThreads.length} 条追问链` : `Restore ${historyThreads.length}`}
          </button>
        ) : null}
      </header>

      <div ref={messagesRef} className="coach-chat-messages">
        {messages.length === 0 ? (
          <p className="coach-chat-empty">
            {language === 'zh' ? '训练官已就位，先说说你想服务谁。' : 'Tell the coach who you want to serve.'}
          </p>
        ) : messages.map(message => (
          <div key={message.id} className={`coach-chat-row is-${message.role}`}>
            <div className={message.role === 'user' ? 'coach-message-user' : 'coach-message-assistant'}>
              {message.content}
              {message.role === 'assistant' && message.content.trim() && !archived ? (
                <button
                  className="coach-inline-followup"
                  title={language === 'zh' ? '针对这条回复追问，次数不限' : 'Ask about this reply'}
                  onClick={() => openFromMain(message.id, currentSelection())}
                >
                  <MessageSquarePlus size={13} />
                  {language === 'zh' ? '追问' : 'Ask'}
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div className="chat-error-bar">
          <span>{error}</span>
          <button onClick={clearError}>关闭</button>
        </div>
      )}

      <footer className="coach-chat-composer">
        {archived && (
          <div className="chat-archived-bar">
            {language === 'zh' ? '该路径已完成归档，仅可查看，追问与提问均已停止。' : 'Archived. Read only.'}
          </div>
        )}
        <textarea
          className="coach-textarea"
          rows={3}
          value={input}
          disabled={isStreaming || archived}
          placeholder={language === 'zh' ? '回答训练官，推进当前节点…' : 'Reply to the coach…'}
          onChange={event => setInput(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.altKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div className="chat-composer-actions">
          <span className="chat-composer-hint">
            {language === 'zh' ? 'Enter 发送 · Alt+Enter 换行 · 选中文字后点「追问」' : 'Enter to send'}
          </span>
          <button className="coach-primary-button" disabled={!input.trim() || isStreaming || archived} onClick={submit}>
            {isStreaming ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            {language === 'zh' ? '发送' : 'Send'}
          </button>
        </div>
      </footer>

      <div className="coach-followup-layer">
        {windows.map(window => (
          <FollowUpWindow
            key={window.threadId}
            state={window}
            messages={followUpMessages[window.threadId] || []}
            isStreaming={followUpStreaming === window.threadId}
            isAdopting={adoptingId === window.threadId}
            language={language}
            onClose={threadId => setWindows(previous => previous.filter(item => item.threadId !== threadId))}
            onFocus={focus}
            onAsk={ask}
            onDeepen={deepen}
            onAdopt={threadId => void adopt(threadId)}
          />
        ))}
      </div>
    </div>
  );
}
