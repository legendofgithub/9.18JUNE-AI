import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  Activity,
  FileText,
  FolderOpen,
  Gauge,
  KeyRound,
  Lock,
  MessageSquare,
  PanelLeftOpen,
  PanelRightClose,
  Save,
  Settings,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import useCommerceStore from '../../stores/useCommerceStore';
import useHarnessStore from '../../stores/useHarnessStore';
import type { HarnessPermission } from '../../types';
import type { SiteLanguage } from './SiteHeader';
import ModelServicesPanel from './ModelServicesPanel';
import CoachChatPanel from './CoachChatPanel';
import AgentChatPanel from './workspace/AgentChatPanel';
import ProjectTreePanel from './workspace/ProjectTreePanel';
import RightSidebarBody, { type RightTab } from './workspace/RightSidebarBody';
import { buildDailyReport, permissionLabel, TEMPERATURE_VALUES, todayText, type TemperatureLevel } from './workspace/report';

const RIGHT_TABS: RightTab[] = ['guide', 'context', 'files', 'docs', 'trace'];
const RIGHT_TAB_LABELS: Record<RightTab, string> = { guide: '引导', context: '上下文', files: '文件', docs: '文档', trace: 'Trace' };

export default function ProjectWorkspace({ language }: { language: SiteLanguage }) {
  const currentRun = useCommerceStore(s => s.currentRun);
  const patchStep = useCommerceStore(s => s.patchStep);

  const harness = useHarnessStore();
  const {
    projects,
    activeProjectId,
    activeSessionId,
    isBusy,
  } = harness;

  const [rightOpen, setRightOpen] = useState(true);
  const [leftCollapsed, setLeftCollapsed] = useState(() => window.innerWidth < 1024);
  const [leftWidth, setLeftWidth] = useState(300);
  const [rightWidth, setRightWidth] = useState(390);
  const [rightTab, setRightTab] = useState<RightTab>('guide');
  const [mainTab, setMainTab] = useState<'coach' | 'agent'>('coach');
  const [showSettings, setShowSettings] = useState(false);
  const [showModelServices, setShowModelServices] = useState(false);
  const [temperature, setTemperature] = useState<TemperatureLevel>('medium');
  const [artifactDraft, setArtifactDraft] = useState('');
  const folderInputRef = useRef<HTMLInputElement>(null);

  const activeProject = projects.find(project => project.id === activeProjectId) || projects[0];
  const activeSession = activeProject?.sessions.find(session => session.id === activeSessionId) || activeProject?.sessions[0];
  const permission = activeSession?.permission || 'read-only';
  const activeMessages = activeSession?.messages || [];

  useEffect(() => {
    // 单用户模式：固定本地身份
    void harness.bootstrap('local');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const openFolderPicker = () => {
    const input = folderInputRef.current;
    if (!input) return;
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
    input.click();
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
            <ProjectTreePanel
              language={language}
              projects={projects}
              fileCount={harness.files.length}
              activeProject={activeProject}
              activeSession={activeSession}
              permission={permission}
              temperature={temperature}
              onCollapse={() => setLeftCollapsed(true)}
              onOpenSettings={() => setShowSettings(true)}
              onUploadClick={openFolderPicker}
            />
          )}
          {!leftCollapsed && <div className="resizer left" onMouseDown={startDrag('left')} />}
        </aside>

        <section className="dsh-main project-chat-main">
          <div className="workspace-main-tabs">
            <button className={mainTab === 'coach' ? 'is-active' : ''} onClick={() => setMainTab('coach')}>
              <MessageSquare size={14} /> {language === 'zh' ? '跟练对话' : 'Coaching'}
            </button>
            <button className={mainTab === 'agent' ? 'is-active' : ''} onClick={() => setMainTab('agent')}>
              <Activity size={14} /> {language === 'zh' ? 'Agent 工作台' : 'Agent'}
            </button>
          </div>
          {mainTab === 'coach' ? (
            <CoachChatPanel language={language} />
          ) : (
            <AgentChatPanel
              language={language}
              activeProject={activeProject}
              activeSession={activeSession}
              permission={permission}
              temperature={temperature}
              busy={busy}
              onOpenRight={() => setRightOpen(true)}
            />
          )}
        </section>

        {rightOpen && <div className="resizer right" onMouseDown={startDrag('right')} />}
        <aside className={rightOpen ? 'dsh-right project-right' : 'dsh-right closed'}>
          {rightOpen ? (
            <section className="project-right-panel">
              <header className="project-right-header">
                <div className="project-right-tabs harness-tabs">
                  {RIGHT_TABS.map(tab => (
                    <button key={tab} className={rightTab === tab ? 'is-active' : ''} onClick={() => setRightTab(tab)}>
                      {tab === 'guide' ? <FileText size={14} /> : tab === 'context' ? <Gauge size={14} /> : tab === 'files' ? <FolderOpen size={14} /> : tab === 'docs' ? <Save size={14} /> : <Activity size={14} />}
                      {RIGHT_TAB_LABELS[tab]}
                    </button>
                  ))}
                </div>
                <div className="project-right-header-actions">
                  <button className="daily-summary-button" onClick={() => void generateDailyReport()}><Sparkles size={14} /> 每日总结</button>
                  <button className="dsh-icon-button" onClick={() => setRightOpen(false)} title="关闭详情栏"><PanelRightClose size={15} /></button>
                </div>
              </header>

              <div className="project-right-body">
                <RightSidebarBody
                  language={language}
                  tab={rightTab}
                  currentRun={currentRun}
                  artifactDraft={artifactDraft}
                  onArtifactDraftChange={setArtifactDraft}
                  patchStep={patchStep}
                  busy={busy}
                  onUploadClick={openFolderPicker}
                />
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
