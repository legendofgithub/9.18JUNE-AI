import { useEffect, useRef, useState } from 'react';
import { Activity, Database, Loader2, PanelRightOpen, Send, Sparkles } from 'lucide-react';
import useCommerceStore from '../../../stores/useCommerceStore';
import useHarnessStore from '../../../stores/useHarnessStore';
import type { HarnessPermission, HarnessProject, HarnessSession } from '../../../types';
import type { SiteLanguage } from '../SiteHeader';
import { permissionLabel, statusLabel, TEMPERATURE_VALUES, type TemperatureLevel } from './report';

interface AgentChatPanelProps {
  language: SiteLanguage;
  activeProject?: HarnessProject;
  activeSession?: HarnessSession;
  permission: HarnessPermission;
  temperature: TemperatureLevel;
  busy: boolean;
  onOpenRight: () => void;
}

/** 中栏 Agent 工作台：模型选择、消息流、工具卡片、写入审批条与指令输入 */
export default function AgentChatPanel({
  language,
  activeProject,
  activeSession,
  permission,
  temperature,
  busy,
  onOpenRight,
}: AgentChatPanelProps) {
  const currentRun = useCommerceStore(s => s.currentRun);
  const modelServices = useCommerceStore(s => s.modelServices);
  const selectedModel = useCommerceStore(s => s.selectedModel);
  const activateModel = useCommerceStore(s => s.activateModel);

  const {
    toolCalls,
    activeRun,
    approval,
    isRunning,
    error,
    sendMessage,
    approve,
    resume,
    retry,
    cancel,
    clearError,
  } = useHarnessStore();

  const [chatInput, setChatInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  const messages = activeSession?.messages || [];

  useEffect(() => {
    const element = messagesRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages.length, messages[messages.length - 1]?.content]);

  const handleSend = () => {
    const content = chatInput.trim();
    if (!content || !activeSession || currentRun?.status === 'completed') return;
    setChatInput('');
    void sendMessage(content, TEMPERATURE_VALUES[temperature], permission);
  };

  return (
    <div className="chat-panel">
      <header className="chat-panel-header">
        <div className="chat-panel-titles">
          <h1>{activeProject?.title || '未选择项目'}</h1>
          <p>{activeSession?.title || '未选择会话'} · {permissionLabel(permission)}</p>
        </div>
        <div className="chat-panel-tools">
          <label className="chat-model-picker">
            <span>{selectedModel || modelServices[0]?.models[0]?.displayName || '选择模型'}</span>
            <select value="" onChange={event => {
              const [serviceId, modelId] = event.target.value.split('::');
              if (serviceId && modelId) void activateModel(serviceId, modelId);
            }}>
              <option value="">切换模型</option>
              {modelServices.map(service => (
                <optgroup key={service.id} label={service.displayName}>
                  {service.models.map(model => <option key={model.id} value={`${service.id}::${model.modelId}`}>{model.displayName || model.modelId}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <button className="dsh-icon-button" onClick={onOpenRight} title="打开详情栏"><PanelRightOpen size={16} /></button>
        </div>
      </header>

      <div ref={messagesRef} className="chat-messages">
        {messages.length === 0 ? (
          <div className="chat-empty"><Sparkles size={28} /><p>{language === 'zh' ? '描述项目目标，Agent 会按需检索文件并推进交付。' : 'Describe the project goal to start.'}</p></div>
        ) : messages.map(message => (
          <div key={message.id} className={`chat-message-row ${message.role === 'user' ? 'is-user' : message.role === 'tool' ? 'is-tool' : 'is-assistant'}`}>
            <div className={message.role === 'user' ? 'coach-message-user' : 'coach-message-assistant'}>
              {message.role === 'tool' ? <span className="tool-message-mark">工具结果</span> : null}
              {message.content}
            </div>
          </div>
        ))}
        {toolCalls.map(call => (
          <div key={call.id} className={`agent-tool-card ${call.status}`}>
            <div><Database size={14} /><strong>{call.name}</strong><span>{statusLabel(call.status)}</span></div>
            <pre>{JSON.stringify(call.arguments, null, 2).slice(0, 1200)}</pre>
            {call.error && <p>{call.error}</p>}
          </div>
        ))}
      </div>

      {activeRun && (
        <div className="agent-status-strip">
          <Activity size={14} />
          <span>{statusLabel(activeRun.status)} · {activeRun.iterations}/6 轮</span>
          {activeRun.status === 'waiting_approval' && approval ? (
            <>
              <span className="approval-path">{approval.path}</span>
              <button className="coach-primary-button" disabled={busy} onClick={() => void approve(true)}>批准写入</button>
              <button className="coach-secondary-button" disabled={busy} onClick={() => void approve(false)}>拒绝</button>
            </>
          ) : activeRun.status === 'waiting_tool' ? (
            <button className="coach-primary-button" disabled={isRunning} onClick={() => void resume(TEMPERATURE_VALUES[temperature])}>继续执行</button>
          ) : ['failed', 'rejected'].includes(activeRun.status) ? (
            <button className="coach-secondary-button" onClick={() => void retry(TEMPERATURE_VALUES[temperature], permission)}>重试</button>
          ) : null}
          {['running', 'waiting_approval', 'waiting_tool'].includes(activeRun.status) && (
            <button className="coach-secondary-button" onClick={() => void cancel()}>停止</button>
          )}
        </div>
      )}

      {error && (
        <div className="chat-error-bar"><span>{error}</span><button onClick={clearError}>关闭</button></div>
      )}

      <footer className="chat-composer">
        {currentRun?.status === 'completed' && <div className="chat-archived-bar">该路径已完成归档，仅可查看。</div>}
        <textarea ref={inputRef} className="coach-textarea" rows={3} value={chatInput} disabled={isRunning || currentRun?.status === 'completed'} placeholder="输入项目指令…" onChange={event => setChatInput(event.target.value)} onKeyDown={event => {
          if (event.key === 'Enter' && !event.altKey) {
            event.preventDefault();
            handleSend();
          }
        }} />
        <div className="chat-composer-actions">
          <span className="chat-composer-hint">Enter 发送 · Alt+Enter 换行</span>
          <button className="coach-primary-button" disabled={!chatInput.trim() || isRunning || currentRun?.status === 'completed'} onClick={handleSend}>
            {isRunning ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} 发送
          </button>
        </div>
      </footer>
    </div>
  );
}
