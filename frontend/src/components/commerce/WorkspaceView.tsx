import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Folder,
  FileText,
  GitBranch,
  Loader2,
  MessageSquarePlus,
  Save,
  Send,
  ShieldCheck,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
} from 'lucide-react';
import CoachLaunchPanel, { CoachSettingsPanel } from './CoachLaunchPanel';
import ModelServicesPanel from './ModelServicesPanel';
import ProjectWorkspace from './ProjectWorkspace';
import useCommerceStore from '../../stores/useCommerceStore';
import { API_BASE } from '../../config';
import type { Message } from '../../types';
import type { SiteLanguage } from './SiteHeader';

function generateThreadId() {
  return `fu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function downloadReport(runId: string) {
  const token = localStorage.getItem('june_user_token');
  fetch(`${API_BASE}/mvp-runs/${runId}/report`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
    .then(async response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
  link.download = `vibe-mvp-report-${runId}.md`;
      link.click();
      URL.revokeObjectURL(url);
    })
    .catch(console.error);
}

export default function WorkspaceView({ language }: { language: SiteLanguage }) {
  const runs = useCommerceStore(s => s.runs);
  const currentRun = useCommerceStore(s => s.currentRun);
  const skill = useCommerceStore(s => s.skill);
  const modelServices = useCommerceStore(s => s.modelServices);
  const selectedModel = useCommerceStore(s => s.selectedModel);
  const activateModel = useCommerceStore(s => s.activateModel);
  const isBusy = useCommerceStore(s => s.isBusy);
  const isStreaming = useCommerceStore(s => s.isStreaming);
  const followUpStreaming = useCommerceStore(s => s.followUpStreaming);
  const error = useCommerceStore(s => s.error);
  const followUpMessages = useCommerceStore(s => s.followUpMessages);
  const followUpMeta = useCommerceStore(s => s.followUpMeta);
  const selectRun = useCommerceStore(s => s.selectRun);
  const patchStep = useCommerceStore(s => s.patchStep);
  const sendChat = useCommerceStore(s => s.sendChat);
  const sendFollowUp = useCommerceStore(s => s.sendFollowUp);
  const clearError = useCommerceStore(s => s.clearError);

  const [artifactTitle, setArtifactTitle] = useState('');
  const [artifactContent, setArtifactContent] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [mode, setMode] = useState<'main' | 'follow'>('main');
  const [pendingFollowUp, setPendingFollowUp] = useState<{
    threadId: string;
    parentThreadId: string;
    level: number;
    sourceMessageId: string;
    selectedText: string;
  } | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [followInput, setFollowInput] = useState('');
  const [leftWidth, setLeftWidth] = useState(280);
  const [rightWidth, setRightWidth] = useState(360);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightOpen, setRightOpen] = useState(true);

  useEffect(() => {
    const sync = () => setLeftCollapsed(window.innerWidth < 1024);
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  const startDrag = (kind: 'left' | 'right') => (event: ReactMouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = kind === 'left' ? leftWidth : rightWidth;
    const move = (moveEvent: MouseEvent) => {
      const delta = kind === 'left' ? moveEvent.clientX - startX : startX - moveEvent.clientX;
      const next = Math.min(Math.max(startWidth + delta, kind === 'left' ? 264 : 300), kind === 'left' ? 420 : 520);
      if (kind === 'left') setLeftWidth(next);
      else setRightWidth(next);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const step = currentRun?.currentStep;
  const isCompleted = currentRun?.status === 'completed';

  useEffect(() => {
    setArtifactTitle(step?.requiredArtifact || '');
    setArtifactContent(step?.artifactContent || '');
  }, [step?.id, step?.requiredArtifact, step?.artifactContent]);

  const threadOptions = useMemo(() => {
    return Object.entries(followUpMessages)
      .filter(([, messages]) => messages.length > 0)
      .map(([threadId, messages]) => ({
        threadId,
        level: followUpMeta[threadId]?.level ?? 1,
        count: messages.filter(message => message.role === 'user').length,
      }));
  }, [followUpMessages, followUpMeta]);

  const openFollowUp = (message: Message, parentThreadId = 'main', level = 1) => {
    const threadId = generateThreadId();
    setPendingFollowUp({
      threadId,
      parentThreadId,
      level,
      sourceMessageId: message.id,
      selectedText: message.content.slice(0, 600),
    });
    setActiveThreadId(threadId);
    setFollowInput('');
    setMode('follow');
  };

  const activeFollowMessages = activeThreadId
    ? followUpMessages[activeThreadId] || []
    : [];
  const activeFollowMeta = pendingFollowUp || (activeThreadId ? followUpMeta[activeThreadId] : undefined);

  const handleSendFollowUp = async () => {
    if (!pendingFollowUp || !followInput.trim()) return;
    await sendFollowUp({
      ...pendingFollowUp,
      query: followInput,
    });
    setFollowInput('');
  };

  if (!currentRun) {
    return (
      <main className="studio-shell flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-[620px]">
          <CoachLaunchPanel language={language} />
        </div>
      </main>
    );
  }

  if (currentRun) {
    return <ProjectWorkspace language={language} />;
  }

  return (
    <main className="studio-shell dsh-workspace" data-theme="dark">
      <div
        className="dsh-grid"
        style={{
          gridTemplateColumns: `${leftCollapsed ? 56 : leftWidth}px minmax(640px,1fr) ${rightOpen ? rightWidth : 0}px`,
        }}
      >
        <aside className={leftCollapsed ? 'dsh-left collapsed' : 'dsh-left'}>
          {leftCollapsed ? (
            <div className="dsh-rail">
              <button onClick={() => setLeftCollapsed(false)}><PanelLeftOpen size={17} /></button>
              <button><Folder size={17} /></button>
              <button><Settings size={17} /></button>
            </div>
          ) : (
            <div className="coach-card dsh-left-inner">
              <button className="dsh-new">新建会话</button>
              <div className="pb-3 border-b border-[var(--june-border)]">
            <h2 className="text-sm font-semibold text-[var(--june-text-bright)]">
              {language === 'zh' ? '超级个体训练师' : 'Super-Solo Coach'}
            </h2>
            <p className="mt-1 text-xs leading-5 text-[var(--june-text-dim)]">
              {skill?.modelName || (language === 'zh' ? '待连接模型' : 'Model not connected')}
            </p>
          </div>
              <CoachSettingsPanel language={language} />
          <div className="flex items-center justify-between mt-4">
            <h2 className="text-sm font-semibold text-[var(--june-text-bright)]">商业 MVP 路径</h2>
          </div>
          <div className="mt-3 space-y-2">
            {runs.map(run => (
              <button
                key={run.id}
                className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                  run.id === currentRun.id
                    ? 'border-[rgba(15,118,110,0.35)] bg-[var(--coach-accent-soft)]'
                    : 'border-[var(--june-border)] bg-[var(--june-surface-alt)]'
                }`}
                onClick={() => void selectRun(run.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-[var(--june-text)]">{run.title}</span>
                  {run.status === 'completed' ? (
                    <CheckCircle2 size={14} className="text-[var(--june-success)] shrink-0" />
                  ) : (
                    <span className="text-xs text-[var(--coach-accent)]">{run.currentStepOrder}/{run.totalSteps}</span>
                  )}
                </div>
                <div className="mt-1 truncate text-xs text-[var(--june-text-dim)]">
                  {run.vertical || '目标人群待明确'}
                </div>
              </button>
            ))}
          </div>
              <button className="dsh-collapse" onClick={() => setLeftCollapsed(true)}>
                <PanelLeftClose size={15} /> 折叠
              </button>
            </div>
          )}
          {!leftCollapsed && <div className="resizer left" onMouseDown={startDrag('left')} />}
        </aside>

        <section className="dsh-main">
          <ModelServicesPanel />
          <section className="coach-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-lg font-semibold text-[var(--june-text-bright)]">{currentRun.title}</h1>
                <p className="mt-1 text-sm text-[var(--june-text-dim)]">{currentRun.vertical || '目标人群待明确'}</p>
              </div>
              <button className="coach-secondary-button" onClick={() => downloadReport(currentRun.id)}>
                <FileText size={14} />
                商业 MVP 推进报告
              </button>
            </div>

            <div className="mt-4 h-2 rounded-full bg-[var(--june-surface-alt)] overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--coach-accent)]"
                style={{
                  width: `${(currentRun.steps.filter(item => item.isCompleted).length / currentRun.steps.length) * 100}%`,
                }}
              />
            </div>

            <div className="mt-4 grid sm:grid-cols-2 gap-3">
              <div className="rounded-lg border border-[var(--june-border)] bg-[var(--june-surface-alt)] p-3">
                <div className="text-xs font-semibold text-[var(--june-text-dim)]">阻塞点</div>
                <p className="mt-1 text-sm leading-6">{currentRun.blocker || '无'}</p>
              </div>
              <div className="rounded-lg border border-[var(--june-border)] bg-[var(--june-surface-alt)] p-3">
                <div className="text-xs font-semibold text-[var(--june-text-dim)]">下一个最小动作</div>
                <p className="mt-1 text-sm leading-6">{currentRun.nextAction || '无'}</p>
              </div>
            </div>

            <div className="mt-5">
              <h2 className="text-sm font-semibold text-[var(--june-text-bright)]">节点清单</h2>
              <ol className="mt-3 space-y-1.5">
                {currentRun.steps.map(item => (
                  <li
                    key={item.id}
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm"
                    style={{
                      background: item.id === step?.id ? 'var(--coach-accent-soft)' : 'transparent',
                    }}
                  >
                    {item.isCompleted ? (
                      <CheckCircle2 size={15} className="text-[var(--june-success)] shrink-0" />
                    ) : (
                      <Circle size={15} className="text-[var(--june-text-dim)] shrink-0" />
                    )}
                    <span className="w-5 text-xs text-[var(--june-text-dim)]">{item.order}</span>
                    <span className="truncate">{item.title}</span>
                  </li>
                ))}
              </ol>
            </div>

            {step && (
              <div className="mt-5 pt-5 border-t border-[var(--june-border)]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-[var(--june-text-bright)]">
                    {step.order}. {step.title}
                  </h2>
                  <span className="coach-chip">{step.tool}</span>
                </div>
                <p className="mt-2 text-sm leading-6 text-[var(--june-text-dim)]">{step.instructions}</p>

                {isCompleted ? (
                  <div className="mt-4 rounded-lg border border-[var(--june-border)] bg-[var(--june-surface-alt)] p-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-[var(--june-success)]">
                      <ShieldCheck size={15} />
                      路径已完成并锁定
                    </div>
                    <pre className="mt-3 whitespace-pre-wrap text-sm leading-6 font-sans">{artifactContent}</pre>
                  </div>
                ) : (
                  <div className="mt-4 space-y-3">
                    <div>
                      <label className="coach-label" htmlFor="artifactTitle">交付物标题</label>
                      <input
                        id="artifactTitle"
                        className="coach-input"
                        value={artifactTitle}
                        onChange={event => setArtifactTitle(event.target.value)}
                        maxLength={200}
                      />
                    </div>
                    <div>
                      <label className="coach-label" htmlFor="artifactContent">交付物内容</label>
                      <textarea
                        id="artifactContent"
                        className="coach-textarea min-h-[220px]"
                        value={artifactContent}
                        onChange={event => setArtifactContent(event.target.value)}
                        maxLength={20000}
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="coach-secondary-button"
                        disabled={isBusy}
                        onClick={() => void patchStep(step.id, artifactTitle, artifactContent, false)}
                      >
                        {isBusy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        保存草稿
                      </button>
                      <button
                        className="coach-primary-button"
                        disabled={isBusy || artifactContent.trim().length < 20}
                        onClick={() => void patchStep(step.id, artifactTitle, artifactContent, true)}
                      >
                        {isBusy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                        完成节点
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </section>

        {rightOpen && <div className="resizer right" onMouseDown={startDrag('right')} />}
        <aside className={rightOpen ? 'dsh-right' : 'dsh-right closed'}>
          {rightOpen ? (
          <section className="coach-card p-4 min-h-[640px] flex flex-col">
            <div className="flex items-center gap-2">
              <button
                className={mode === 'main' ? 'coach-primary-button' : 'coach-secondary-button'}
                onClick={() => setMode('main')}
              >
                <MessageSquarePlus size={14} />
                主对话
              </button>
              <button
                className={mode === 'follow' ? 'coach-primary-button' : 'coach-secondary-button'}
                onClick={() => setMode('follow')}
              >
                <GitBranch size={14} />
                追问链
              </button>
              <button className="dsh-icon-button" onClick={() => setRightOpen(false)} title="关闭详情栏">
                <PanelRightClose size={15} />
              </button>
            </div>

            {mode === 'main' ? (
              <>
                <div className="mt-4 flex-1 overflow-y-auto flex flex-col gap-3 pr-1">
                  {currentRun.messages.map(message => (
                    <div key={message.id} className={`flex flex-col ${message.role === 'user' ? 'items-end' : 'items-start'}`}>
                      <div className={message.role === 'user' ? 'coach-message-user' : 'coach-message-assistant'}>
                        {message.content || (isStreaming ? '...' : '')}
                      </div>
                      {message.role === 'assistant' && message.content && !isStreaming && !isCompleted && (
                        <button
                          className="mt-1 text-xs inline-flex items-center gap-1 text-[var(--june-text-dim)] hover:text-[var(--coach-accent)]"
                          onClick={() => openFollowUp(message)}
                        >
                          <GitBranch size={12} />
                          追问这条
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-3 pt-3 border-t border-[var(--june-border)]">
                  <label className="composer-model-picker">
                    <span>{selectedModel || '选择模型'}</span>
                    <select
                      value=""
                      disabled={isCompleted || isStreaming}
                      onChange={event => {
                        const [serviceId, modelId] = event.target.value.split('::');
                        if (serviceId && modelId) void activateModel(serviceId, modelId);
                      }}
                    >
                      <option value="">供应商 / 模型</option>
                      {modelServices.map(service => (
                        <optgroup key={service.id} label={service.displayName}>
                          {service.models.map(model => (
                            <option key={model.id} value={`${service.id}::${model.modelId}`}>
                              {model.displayName || model.modelId} · {model.reasoning === 'low' ? '低' : model.reasoning === 'high' ? '高' : '中'}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                  <textarea
                    className="coach-textarea min-h-[86px]"
                    value={chatInput}
                    onChange={event => setChatInput(event.target.value)}
                    disabled={isCompleted || isStreaming}
                    placeholder={isCompleted ? '路径已归档' : '描述你想让 AI 做出的结果，或回答超级个体训练师的问题'}
                  />
                  <button
                    className="coach-primary-button w-full mt-2"
                    disabled={isCompleted || isStreaming || !chatInput.trim()}
                    onClick={() => {
                      void sendChat(chatInput);
                      setChatInput('');
                    }}
                  >
                    {isStreaming ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                    发送
                  </button>
                </div>
              </>
            ) : (
              <>
                {threadOptions.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {threadOptions.map(thread => (
                      <button
                        key={thread.threadId}
                        className={`text-xs px-2 py-1 rounded-lg border ${
                          activeThreadId === thread.threadId && !pendingFollowUp
                            ? 'border-[rgba(15,118,110,0.35)] bg-[var(--coach-accent-soft)] text-[var(--coach-accent)]'
                            : 'border-[var(--june-border)] text-[var(--june-text-dim)]'
                        }`}
                        onClick={() => {
                          setPendingFollowUp(null);
                          setActiveThreadId(thread.threadId);
                        }}
                      >
                        L{thread.level} · {thread.count}问
                      </button>
                    ))}
                  </div>
                )}

                {pendingFollowUp ? (
                  <div className="mt-3 rounded-lg border border-[var(--june-border)] bg-[var(--june-surface-alt)] p-3">
                    <div className="text-xs font-semibold text-[var(--coach-accent)]">
                      新追问 L{pendingFollowUp.level}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[var(--june-text-dim)] line-clamp-3">
                      {pendingFollowUp.selectedText}
                    </p>
                  </div>
                ) : activeFollowMeta ? (
                  <div className="mt-3 rounded-lg border border-[var(--june-border)] bg-[var(--june-surface-alt)] p-3">
                    <div className="text-xs font-semibold text-[var(--coach-accent)]">
                      L{activeFollowMeta.level} 追问线程
                    </div>
                    <p className="mt-1 text-xs text-[var(--june-text-dim)]">
                      来源消息 {activeFollowMeta.sourceMessageId.slice(0, 8)}
                    </p>
                  </div>
                ) : (
                  <div className="mt-3 rounded-lg border border-dashed border-[var(--june-border)] p-4 text-sm text-[var(--june-text-dim)]">
                    在主对话中选择一条回复发起追问。
                  </div>
                )}

                <div className="mt-3 flex-1 overflow-y-auto flex flex-col gap-3 pr-1">
                  {activeFollowMessages.map(message => (
                    <div key={message.id} className={`flex flex-col ${message.role === 'user' ? 'items-end' : 'items-start'}`}>
                      <div className={message.role === 'user' ? 'coach-message-user' : 'coach-message-assistant'}>
                        {message.content || (followUpStreaming === activeThreadId ? '...' : '')}
                      </div>
                      {message.role === 'assistant' && message.content && followUpStreaming !== activeThreadId && !isCompleted && (
                        <button
                          className="mt-1 text-xs inline-flex items-center gap-1 text-[var(--june-text-dim)] hover:text-[var(--coach-accent)]"
                          onClick={() => openFollowUp(
                            message,
                            pendingFollowUp?.threadId || activeThreadId || 'main',
                            (pendingFollowUp?.level || activeFollowMeta?.level || 1) + 1,
                          )}
                        >
                          <GitBranch size={12} />
                          继续追问
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <div className="mt-3 pt-3 border-t border-[var(--june-border)]">
                  <textarea
                    className="coach-textarea min-h-[78px]"
                    value={followInput}
                    onChange={event => setFollowInput(event.target.value)}
                    disabled={isCompleted || !pendingFollowUp || followUpStreaming === activeThreadId}
                    placeholder={isCompleted ? '路径已归档' : '问当前商业动作或如何向 AI 描述效果'}
                  />
                  <button
                    className="coach-primary-button w-full mt-2"
                    disabled={isCompleted || !pendingFollowUp || !followInput.trim() || followUpStreaming === activeThreadId}
                    onClick={() => void handleSendFollowUp()}
                  >
                    {followUpStreaming === activeThreadId ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <Send size={15} />
                    )}
                    追问
                  </button>
                </div>
              </>
            )}
          </section>
          ) : null}
        </aside>
      </div>


      {error && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-[min(92vw,560px)] coach-card px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="text-[var(--coach-warm)] mt-0.5" />
            <p className="text-sm leading-6">{error}</p>
            <button className="ml-2 text-xs text-[var(--june-text-dim)]" onClick={clearError}>关闭</button>
          </div>
        </div>
      )}
    </main>
  );
}
