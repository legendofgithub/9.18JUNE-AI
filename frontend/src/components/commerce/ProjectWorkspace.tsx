import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  Activity,
  CheckCircle2,
  Database,
  Download,
  FileDown,
  FileText,
  Folder,
  FolderOpen,
  Gauge,
  KeyRound,
  Loader2,
  Lock,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Save,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import useCommerceStore from '../../stores/useCommerceStore';
import useHarnessStore from '../../stores/useHarnessStore';
import type { HarnessPermission } from '../../types';
import type { SiteLanguage } from './SiteHeader';
import ModelServicesPanel from './ModelServicesPanel';

type TemperatureLevel = 'low' | 'medium' | 'high';
type RightTab = 'guide' | 'context' | 'files' | 'docs' | 'trace';

const TEMPERATURE_VALUES: Record<TemperatureLevel, number> = {
  low: 0.2,
  medium: 0.7,
  high: 1.2,
};
const PERMISSION_STORAGE_KEY = 'june_project_permission';

function todayText() {
  return new Date().toISOString().slice(0, 10);
}

function permissionLabel(permission: HarnessPermission) {
  if (permission === 'read-only') return 'Read only';
  if (permission === 'workspace-write') return 'Workspace write';
  return 'Full access';
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    running: '执行中',
    waiting_approval: '等待审批',
    waiting_tool: '可继续',
    finished: '已完成',
    failed: '失败',
    cancelled: '已取消',
    rejected: '已拒绝',
  };
  return labels[status] || status;
}

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob(['\ufeff', content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function downloadWord(title: string, content: string) {
  const escaped = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head><body><pre>${escaped}</pre></body></html>`;
  downloadBlob(`${title}.doc`, html, 'application/msword;charset=utf-8');
}

function downloadPdf(title: string, content: string) {
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head><body><pre>${content}</pre></body></html>`);
  win.document.close();
  win.focus();
  win.print();
}

function buildDailyReport(
  runTitle: string,
  vertical: string,
  completed: number,
  total: number,
  currentStep: string,
  messages: { role: string; content: string }[],
  permission: HarnessPermission,
  temperature: TemperatureLevel,
) {
  const lines = [
    '# June AI 今日交付成果报告',
    '',
    `日期：${todayText()}`,
    `项目：${runTitle}`,
    `目标人群：${vertical || '待明确'}`,
    `进度：${completed}/${total}`,
    `当前节点：${currentStep}`,
    `权限：${permissionLabel(permission)}`,
    `温度：${temperature}`,
    '',
    '## 近期对话',
    ...messages.slice(-8).map(item => `- ${item.role === 'user' ? '我' : 'AI'}：${item.content.slice(0, 180)}`),
    '',
    '## 下一步',
    '继续完成当前节点交付物，并把可确认的结果写入项目记忆或文档。',
  ];
  return lines.join('\n');
}

export default function ProjectWorkspace({ language }: { language: SiteLanguage }) {
  const currentRun = useCommerceStore(s => s.currentRun);
  const user = useCommerceStore(s => s.user);
  const modelServices = useCommerceStore(s => s.modelServices);
  const selectedModel = useCommerceStore(s => s.selectedModel);
  const activateModel = useCommerceStore(s => s.activateModel);
  const patchStep = useCommerceStore(s => s.patchStep);

  const harness = useHarnessStore();
  const {
    projects,
    activeProjectId,
    activeSessionId,
    files,
    documents,
    memories,
    context,
    activeRun,
    toolCalls,
    runEvents,
    approval,
    isBusy,
    isRunning,
    error,
  } = harness;

  const [chatInput, setChatInput] = useState('');
  const [rightOpen, setRightOpen] = useState(true);
  const [leftCollapsed, setLeftCollapsed] = useState(() => window.innerWidth < 1024);
  const [leftWidth, setLeftWidth] = useState(300);
  const [rightWidth, setRightWidth] = useState(390);
  const [rightTab, setRightTab] = useState<RightTab>('guide');
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showModelServices, setShowModelServices] = useState(false);
  const [temperature, setTemperature] = useState<TemperatureLevel>('medium');
  const [artifactDraft, setArtifactDraft] = useState('');
  const [memoryDraft, setMemoryDraft] = useState('');
  const folderInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  const activeProject = projects.find(project => project.id === activeProjectId) || projects[0];
  const activeSession = activeProject?.sessions.find(session => session.id === activeSessionId) || activeProject?.sessions[0];
  const permission = activeSession?.permission || 'read-only';
  const activeMessages = activeSession?.messages || [];

  useEffect(() => {
    if (user?.id) void harness.bootstrap(user.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    const sync = () => {
      const narrow = window.innerWidth < 1024;
      setLeftCollapsed(narrow);
      setRightOpen(!narrow);
    };
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  useEffect(() => {
    setArtifactDraft(currentRun?.currentStep?.artifactContent || '');
  }, [currentRun?.currentStep?.id, currentRun?.currentStep?.artifactContent]);

  useEffect(() => {
    const element = messagesRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [activeMessages.length, activeMessages[activeMessages.length - 1]?.content]);

  const contextPercent = useMemo(() => {
    if (!context?.budgetTokens) return 0;
    return Math.min(100, Math.round((context.totalTokens / context.budgetTokens) * 100));
  }, [context]);

  const startDrag = (kind: 'left' | 'right') => (event: ReactMouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = kind === 'left' ? leftWidth : rightWidth;
    const move = (moveEvent: MouseEvent) => {
      const delta = kind === 'left' ? moveEvent.clientX - startX : startX - moveEvent.clientX;
      const next = Math.min(Math.max(startWidth + delta, kind === 'left' ? 240 : 300), kind === 'left' ? 420 : 520);
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

  const createProject = async () => {
    const title = newProjectName.trim() || `新项目 ${projects.length + 1}`;
    await harness.createProject(title);
    setNewProjectName('');
    setShowNewProject(false);
  };

  const openFolderPicker = () => {
    const input = folderInputRef.current;
    if (!input) return;
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
    input.click();
  };

  const handleSend = () => {
    const content = chatInput.trim();
    if (!content || !activeSession || currentRun?.status === 'completed') return;
    setChatInput('');
    void harness.sendMessage(content, TEMPERATURE_VALUES[temperature], permission);
  };

  const generateDailyReport = async () => {
    if (!currentRun || !activeSession) return;
    const completed = currentRun.steps.filter(step => step.isCompleted).length;
    const content = buildDailyReport(
      currentRun.title,
      currentRun.vertical,
      completed,
      currentRun.steps.length,
      currentRun.currentStep?.title || '无',
      activeMessages,
      permission,
      temperature,
    );
    const created = await harness.createDocument(`June AI · 今日交付成果报告 ${todayText()}`, content);
    if (created) setRightTab('docs');
  };

  const temperatureLabel: Record<TemperatureLevel, string> = { low: '低', medium: '中', high: '高' };
  const busy = isBusy || useCommerceStore.getState().isBusy;

  return (
    <main className="studio-shell dsh-workspace project-workspace" data-theme="dark">
      <input
        ref={folderInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={event => {
          if (event.target.files) void harness.uploadFiles(event.target.files);
          if (folderInputRef.current) folderInputRef.current.value = '';
        }}
      />

      <div className="dsh-grid" style={{ gridTemplateColumns: `${leftCollapsed ? 56 : leftWidth}px minmax(0,1fr) ${rightOpen ? rightWidth : 0}px` }}>
        <aside className={leftCollapsed ? 'dsh-left collapsed' : 'dsh-left'}>
          {leftCollapsed ? (
            <div className="dsh-rail">
              <button onClick={() => setLeftCollapsed(false)} title="展开左侧栏"><PanelLeftOpen size={17} /></button>
              <button onClick={() => setShowSettings(true)} title="设置"><Settings size={17} /></button>
            </div>
          ) : (
            <div className="dsh-left-inner project-left-inner">
              <div className="project-left-head">
                <div>
                  <h2 className="project-left-title">{language === 'zh' ? 'Harness 项目' : 'Harness'}</h2>
                  <p className="project-left-subtitle">{projects.length} 个项目 · {files.length} 个文件</p>
                </div>
                <button className="dsh-icon-button" onClick={() => setLeftCollapsed(true)} title="折叠左侧栏"><PanelLeftClose size={15} /></button>
              </div>

              <div className="project-actions">
                <button className="coach-primary-button project-action-button" onClick={() => setShowNewProject(true)}>
                  <Plus size={14} /> {language === 'zh' ? '新建项目' : 'New Project'}
                </button>
                <button className="coach-secondary-button project-action-button" onClick={openFolderPicker}>
                  <FolderOpen size={14} /> {language === 'zh' ? '上传项目快照' : 'Upload Snapshot'}
                </button>
              </div>

              {showNewProject && (
                <div className="project-create-box">
                  <input autoFocus className="coach-input" placeholder={language === 'zh' ? '项目名称' : 'Project name'} value={newProjectName} onChange={event => setNewProjectName(event.target.value)} onKeyDown={event => {
                    if (event.key === 'Enter') void createProject();
                    if (event.key === 'Escape') setShowNewProject(false);
                  }} />
                  <div className="project-create-actions">
                    <button type="button" className="project-create-button coach-primary-button" onClick={() => void createProject()}><CheckCircle2 size={14} /> 创建</button>
                    <button className="coach-secondary-button" onClick={() => setShowNewProject(false)}><X size={14} /> 取消</button>
                  </div>
                </div>
              )}

              <div className="project-list">
                {projects.map(project => {
                  const isActive = project.id === activeProject?.id;
                  return (
                    <div key={project.id} className={`project-item ${isActive ? 'is-active' : ''}`}>
                      <div className="project-item-head">
                        <button className="project-item-select" onClick={() => void harness.selectProject(project.id)}>
                          <Folder size={15} className="project-folder-icon" />
                          <span className="project-item-title">{project.title}</span>
                          <span className="project-folder-name">{project.sessions.length} 会话</span>
                        </button>
                        <button className="project-delete" title="删除项目" onClick={() => {
                          if (window.confirm(`确定删除项目「${project.title}」吗？`)) void harness.deleteProject(project.id);
                        }}><Trash2 size={14} /></button>
                      </div>
                      {isActive && (
                        <div className="session-list">
                          {project.sessions.map(session => (
                            <div key={session.id} className={`session-item ${session.id === activeSession?.id ? 'is-active' : ''}`}>
                              <button className="session-item-select" onClick={() => void harness.selectSession(session.id)}>
                                <MessageSquare size={14} />
                                <span className="session-item-title">{session.title}</span>
                                <span className="session-message-count">{session.messages.length}</span>
                              </button>
                              <button className="session-delete" title="删除会话" onClick={() => {
                                if (window.confirm(`确定删除会话「${session.title}」吗？`)) void harness.deleteSession(session.id);
                              }}><Trash2 size={13} /></button>
                            </div>
                          ))}
                          <button className="session-add" onClick={() => void harness.createSession()}><Plus size={13} /> 新建会话</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="project-left-footer">
                <button className="dsh-settings-button" onClick={() => setShowSettings(true)}>
                  <Settings size={15} /> 设置
                  <span className="settings-badge">{permissionLabel(permission)} · {temperatureLabel[temperature]}</span>
                </button>
              </div>
            </div>
          )}
          {!leftCollapsed && <div className="resizer left" onMouseDown={startDrag('left')} />}
        </aside>

        <section className="dsh-main project-chat-main">
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
                <button className="dsh-icon-button" onClick={() => setRightOpen(true)} title="打开详情栏"><PanelRightOpen size={16} /></button>
              </div>
            </header>

            <div ref={messagesRef} className="chat-messages">
              {activeMessages.length === 0 ? (
                <div className="chat-empty"><Sparkles size={28} /><p>{language === 'zh' ? '描述项目目标，Agent 会按需检索文件并推进交付。' : 'Describe the project goal to start.'}</p></div>
              ) : activeMessages.map(message => (
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
                    <button className="coach-primary-button" disabled={busy} onClick={() => void harness.approve(true)}>批准写入</button>
                    <button className="coach-secondary-button" disabled={busy} onClick={() => void harness.approve(false)}>拒绝</button>
                  </>
                ) : activeRun.status === 'waiting_tool' ? (
                  <button className="coach-primary-button" disabled={isRunning} onClick={() => void harness.resume(TEMPERATURE_VALUES[temperature])}>继续执行</button>
                ) : ['failed', 'rejected'].includes(activeRun.status) ? (
                  <button className="coach-secondary-button" onClick={() => void harness.retry(TEMPERATURE_VALUES[temperature], permission)}>重试</button>
                ) : null}
                {['running', 'waiting_approval', 'waiting_tool'].includes(activeRun.status) && (
                  <button className="coach-secondary-button" onClick={() => void harness.cancel()}>停止</button>
                )}
              </div>
            )}

            {error && (
              <div className="chat-error-bar"><span>{error}</span><button onClick={harness.clearError}>关闭</button></div>
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
        </section>

        {rightOpen && <div className="resizer right" onMouseDown={startDrag('right')} />}
        <aside className={rightOpen ? 'dsh-right project-right' : 'dsh-right closed'}>
          {rightOpen ? (
            <section className="project-right-panel">
              <header className="project-right-header">
                <div className="project-right-tabs harness-tabs">
                  {(['guide', 'context', 'files', 'docs', 'trace'] as RightTab[]).map(tab => (
                    <button key={tab} className={rightTab === tab ? 'is-active' : ''} onClick={() => setRightTab(tab)}>
                      {tab === 'guide' ? <FileText size={14} /> : tab === 'context' ? <Gauge size={14} /> : tab === 'files' ? <FolderOpen size={14} /> : tab === 'docs' ? <Save size={14} /> : <Activity size={14} />}
                      {{ guide: '引导', context: '上下文', files: '文件', docs: '文档', trace: 'Trace' }[tab]}
                    </button>
                  ))}
                </div>
                <div className="project-right-header-actions">
                  <button className="daily-summary-button" onClick={() => void generateDailyReport()}><Sparkles size={14} /> 每日总结</button>
                  <button className="dsh-icon-button" onClick={() => setRightOpen(false)} title="关闭详情栏"><PanelRightClose size={15} /></button>
                </div>
              </header>

              <div className="project-right-body">
                {rightTab === 'guide' && currentRun && (
                  <div className="guide-panel">
                    <div className="guide-run-header"><h3>{currentRun.title}</h3><span className={currentRun.status === 'completed' ? 'guide-status done' : 'guide-status'}>{currentRun.status === 'completed' ? '已完成' : '进行中'}</span></div>
                    <div className="guide-progress"><div className="guide-progress-bar" style={{ width: `${(currentRun.steps.filter(step => step.isCompleted).length / currentRun.steps.length) * 100}%` }} /></div>
                    <p className="guide-progress-text">{currentRun.steps.filter(step => step.isCompleted).length} / {currentRun.steps.length} 节点</p>
                    <div className="guide-meta-grid"><div><span>阻塞点</span><p>{currentRun.blocker || '无'}</p></div><div><span>下一个最小动作</span><p>{currentRun.nextAction || '无'}</p></div></div>
                    {currentRun.status !== 'completed' && currentRun.currentStep && (
                      <div className="guide-artifact-box">
                        <h4>当前交付物</h4><p className="guide-artifact-title">{currentRun.currentStep.requiredArtifact}</p>
                        <textarea className="coach-textarea guide-artifact-textarea" rows={5} value={artifactDraft} onChange={event => setArtifactDraft(event.target.value)} />
                        <div className="guide-artifact-actions">
                          <button className="coach-secondary-button" disabled={busy} onClick={() => void patchStep(currentRun.currentStep.id, currentRun.currentStep.artifactTitle || currentRun.currentStep.requiredArtifact, artifactDraft, false)}><Save size={14} /> 保存草稿</button>
                          <button className="coach-primary-button" disabled={busy || artifactDraft.trim().length < 20} onClick={() => void patchStep(currentRun.currentStep.id, currentRun.currentStep.artifactTitle || currentRun.currentStep.requiredArtifact, artifactDraft, true)}><CheckCircle2 size={14} /> 完成节点</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {rightTab === 'context' && (
                  <div className="harness-side-panel">
                    <div className="context-meter"><span>{contextPercent}%</span><div><i style={{ width: `${contextPercent}%` }} /></div></div>
                    <p>{context ? `${context.totalTokens}/${context.budgetTokens} tokens · ${context.historyMessageCount}/${context.totalMessageCount} messages` : '暂无上下文数据'}</p>
                    <button className="coach-secondary-button" disabled={busy} onClick={() => void harness.compressContext()}>压缩上下文</button>
                    <div className="context-component-list">
                      {(context?.components || []).map(component => (
                        <div key={component.name}><span>{component.name}</span><strong>{component.tokens}</strong>{component.truncated ? <em>截断</em> : null}</div>
                      ))}
                    </div>
                    <div className="memory-editor"><textarea value={memoryDraft} onChange={event => setMemoryDraft(event.target.value)} placeholder="写入项目长期记忆…" /><button className="coach-primary-button" disabled={busy || !memoryDraft.trim()} onClick={() => { void harness.addMemory(memoryDraft); setMemoryDraft(''); }}>保存记忆</button></div>
                    <div className="memory-list">{memories.map(memory => <div key={memory.id}><strong>{memory.memoryType}</strong><p>{memory.content}</p></div>)}</div>
                  </div>
                )}

                {rightTab === 'files' && (
                  <div className="harness-side-panel">
                    <button className="coach-secondary-button" onClick={openFolderPicker}><Upload size={14} /> 上传文本快照</button>
                    <div className="file-list">{files.map(file => <div key={file.id}><FileText size={15} /><span>{file.path}</span><strong>{Math.ceil(file.size / 1024)}KB</strong></div>)}</div>
                    {files.length === 0 && <p className="side-empty">项目沙箱暂无文件。</p>}
                  </div>
                )}

                {rightTab === 'docs' && (
                  <div className="harness-side-panel">
                    <div className="file-list">{documents.map(document => (
                      <div key={document.id}>
                        <FileText size={15} /><span>{document.title}</span>
                        <a href={`/api/harness/documents/${document.id}/download`} className="doc-mini-download"><Download size={14} /></a>
                        <button className="doc-mini-download" onClick={() => downloadWord(document.title, document.content)}><FileDown size={14} /></button>
                        <button className="doc-mini-download" onClick={() => downloadPdf(document.title, document.content)}><Download size={14} /></button>
                        <button className="doc-mini-delete" onClick={() => void harness.deleteDocument(document.id)}><Trash2 size={14} /></button>
                      </div>
                    ))}</div>
                    {documents.length === 0 && <p className="side-empty">暂无服务端文档。</p>}
                  </div>
                )}

                {rightTab === 'trace' && (
                  <div className="harness-side-panel trace-panel">
                    {activeRun ? <p>{statusLabel(activeRun.status)} · {activeRun.iterations}/6</p> : <p className="side-empty">暂无执行记录。</p>}
                    {runEvents.map(event => <div key={event.id} className="trace-event"><strong>{event.type}</strong><pre>{JSON.stringify(event.payload, null, 2).slice(0, 1200)}</pre></div>)}
                  </div>
                )}
              </div>
            </section>
          ) : null}
        </aside>
      </div>

      {showSettings && (
        <div className="settings-overlay" onClick={() => setShowSettings(false)}>
          <div className="settings-popover" onClick={event => event.stopPropagation()}>
            <div className="settings-popover-head"><h3><Settings size={16} /> 设置</h3><button className="dsh-icon-button" onClick={() => setShowSettings(false)}><X size={15} /></button></div>
            <div className="settings-section"><h4>权限</h4><div className="permission-options">
              {(['read-only', 'workspace-write', 'full-access'] as HarnessPermission[]).map(item => (
                <button key={item} className={`permission-option ${permission === item ? 'is-active' : ''}`} onClick={() => void harness.setPermission(item)}>
                  {item === 'read-only' ? <Lock size={14} /> : item === 'workspace-write' ? <Save size={14} /> : <ShieldCheck size={14} />}{permissionLabel(item)}
                </button>
              ))}
            </div></div>
            <div className="settings-section"><h4>模型温度</h4><div className="temperature-slider-row">
              <span className={temperature === 'low' ? 'is-active' : ''}>低</span>
              <input type="range" min={0} max={2} step={1} value={temperature === 'low' ? 0 : temperature === 'medium' ? 1 : 2} onChange={event => setTemperature(Number(event.target.value) === 0 ? 'low' : Number(event.target.value) === 1 ? 'medium' : 'high')} />
              <span className={temperature === 'high' ? 'is-active' : ''}>高</span>
            </div></div>
            <div className="settings-section"><button className="coach-secondary-button settings-model-button" onClick={() => setShowModelServices(true)}><KeyRound size={14} /> 模型服务管理</button></div>
          </div>
        </div>
      )}

      {showModelServices && (
        <div className="settings-overlay" onClick={() => setShowModelServices(false)}>
          <div className="model-services-modal" onClick={event => event.stopPropagation()}>
            <div className="model-services-modal-head"><h3>模型服务管理</h3><button className="dsh-icon-button" onClick={() => setShowModelServices(false)}><X size={15} /></button></div>
            <ModelServicesPanel />
          </div>
        </div>
      )}
    </main>
  );
}
