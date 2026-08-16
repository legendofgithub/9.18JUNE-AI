import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  Download,
  FileCode2,
  FileDown,
  FileText,
  Folder,
  FolderOpen,
  KeyRound,
  Loader2,
  Lock,
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
import type { Message, MvpRunDetail } from '../../types';
import type { SiteLanguage } from './SiteHeader';
import ModelServicesPanel from './ModelServicesPanel';

type Permission = 'read-only' | 'workspace-write' | 'full-access';
type TemperatureLevel = 'low' | 'medium' | 'high';

interface LocalSession {
  id: string;
  title: string;
  messages: Message[];
}

interface Project {
  id: string;
  title: string;
  folderName?: string;
  folderFileCount?: number;
  sessions: LocalSession[];
}

interface ReportDoc {
  id: string;
  title: string;
  content: string;
  createdAt: number;
}

interface UploadedFileDoc {
  id: string;
  name: string;
  size: number;
  type: string;
  content: string;
  uploadedAt: number;
}

const DEFAULT_SESSION_ID = 'default';

const TEMPERATURE_VALUES: Record<TemperatureLevel, number> = {
  low: 0.2,
  medium: 0.7,
  high: 1.2,
};

const STORAGE_KEY_PREFIX = 'june_project_workspace_';

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function todayText() {
  const d = new Date();
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function markdownToHtml(markdown: string) {
  const lines = markdown.split('\n');
  let html = '';
  let listType: 'ul' | 'ol' | null = null;
  const closeList = () => {
    if (listType === 'ul') html += '</ul>';
    if (listType === 'ol') html += '</ol>';
    listType = null;
  };
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html += `<h${level}>${escapeHtml(heading[2])}</h${level}>`;
      continue;
    }
    const ul = line.match(/^[-*]\s+(.*)$/);
    if (ul) {
      if (listType !== 'ul') {
        closeList();
        html += '<ul>';
        listType = 'ul';
      }
      html += `<li>${escapeHtml(ul[1])}</li>`;
      continue;
    }
    const ol = line.match(/^\d+[.)]\s+(.*)$/);
    if (ol) {
      if (listType !== 'ol') {
        closeList();
        html += '<ol>';
        listType = 'ol';
      }
      html += `<li>${escapeHtml(ol[1])}</li>`;
      continue;
    }
    if (!line.trim()) {
      closeList();
      continue;
    }
    closeList();
    html += `<p>${escapeHtml(line)}</p>`;
  }
  closeList();
  return html;
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

function downloadMarkdown(content: string) {
  downloadBlob(`今日学习成果报告-${todayText()}.md`, content, 'text/markdown;charset=utf-8');
}

function downloadWord(content: string) {
  const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>今日学习成果报告</title></head>
<body>
  <div style="display:flex;align-items:center;gap:10px;padding-bottom:14px;margin-bottom:18px;border-bottom:2px solid #0f766e;">
    <span style="width:36px;height:36px;border-radius:10px;background:#0f766e;color:#fff;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:800;">J</span>
    <div>
      <div style="font-size:20px;font-weight:800;color:#0f766e;">June AI</div>
      <div style="font-size:12px;color:#6b7280;">AI 变现训练官 · 学习成果报告</div>
    </div>
  </div>
  ${markdownToHtml(content)}
</body>
</html>`;
  downloadBlob(`今日学习成果报告-${todayText()}.doc`, html, 'application/msword;charset=utf-8');
}

function downloadPdf(content: string) {
  const win = window.open('', '_blank');
  if (!win) {
    window.alert('请允许浏览器弹出窗口，才能导出 PDF。你也可以使用“打印 → 另存为 PDF”。');
    return;
  }
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>今日学习成果报告</title><style>
  body { font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; max-width: 820px; margin: 40px auto; padding: 0 24px; line-height: 1.75; color: #1f2937; }
  h1, h2, h3 { color: #0f766e; }
  pre, code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; }
</style></head>
<body>
  <div style="display:flex;align-items:center;gap:10px;padding-bottom:14px;margin-bottom:18px;border-bottom:2px solid #0f766e;">
    <span style="width:36px;height:36px;border-radius:10px;background:#0f766e;color:#fff;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:800;">J</span>
    <div>
      <div style="font-size:20px;font-weight:800;color:#0f766e;">June AI</div>
      <div style="font-size:12px;color:#6b7280;">AI 变现训练官 · 学习成果报告</div>
    </div>
  </div>
  ${markdownToHtml(content)}
</body>
</html>`;
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}

function buildMockReply(input: string, temperature: TemperatureLevel, runTitle?: string) {
  const trimmed = input.trim();
  const topic = runTitle || '当前项目';
  if (temperature === 'high') {
    return `好的，我明白你想围绕「${topic}」继续推进。我会尽量讲得细一些，也会多给你一些鼓励和陪伴。

你刚才提到：${trimmed}

我们可以先拆成三个小步骤：
1. 先明确你当前最想解决的一个具体问题；
2. 把它转成一句可以直接交给 AI 的自然语言指令；
3. 做出第一个可试用的小结果，再根据反馈迭代。

不用急，今天我们只要往前推进一小步就好。你愿意先说说看，你希望这个项目最终给谁带来什么结果吗？`;
  }
  if (temperature === 'low') {
    return `收到。基于「${topic}」，你当前的问题是：${trimmed}

建议下一步：把目标缩小为一个最小可交付结果，并用一句话描述给 AI。请告诉我这个结果的服务对象和验收标准，我会继续帮你推进。`;
  }
  return `收到。关于「${topic}」，你刚才说的是：${trimmed}

我们可以先把目标拆成“给谁用、解决什么问题、交付什么结果”三部分。你希望我先帮你整理哪一部分？`;
}

function buildDailyReport(
  currentRun: MvpRunDetail,
  activeSession: LocalSession | undefined,
  temperature: TemperatureLevel,
  permission: Permission,
) {
  const date = todayText();
  const completed = currentRun.steps.filter(step => step.isCompleted);
  const currentStep = currentRun.currentStep;
  const lines: string[] = [];
  lines.push(`# 🚀 June AI`);
  lines.push('');
  lines.push(`## 今日学习成果报告`);
  lines.push('');
  lines.push(`**日期**：${date}`);
  lines.push('');
  lines.push(`## 项目概览`);
  lines.push('');
  lines.push(`- 项目：${currentRun.title}`);
  lines.push(`- 目标人群/方向：${currentRun.vertical || '待明确'}`);
  lines.push(`- 当前状态：${currentRun.status === 'completed' ? '已完成' : '进行中'}`);
  lines.push(`- 进度：${completed.length}/${currentRun.steps.length}`);
  lines.push('');
  lines.push(`## 今日完成`);
  lines.push('');
  if (completed.length === 0) {
    lines.push('今天还没有标记完成的节点，但对话推进也是有价值的进展。');
  } else {
    completed.forEach(step => {
      lines.push(`- [x] ${step.order}. ${step.title}`);
    });
  }
  lines.push('');
  lines.push(`## 当前引导进度`);
  lines.push('');
  lines.push(`- 当前节点：${currentStep.order}. ${currentStep.title}`);
  lines.push(`- 节点说明：${currentStep.instructions || '无'}`);
  lines.push(`- 阻塞点：${currentRun.blocker || '无'}`);
  lines.push(`- 下一个最小动作：${currentRun.nextAction || '无'}`);
  lines.push('');
  lines.push(`## 对话记录摘要`);
  lines.push('');
  const messages = activeSession?.messages?.length ? activeSession.messages : currentRun.messages;
  if (messages.length === 0) {
    lines.push('今天还没有对话记录。');
  } else {
    const recent = messages.slice(-6);
    recent.forEach(message => {
      const role = message.role === 'user' ? '我' : 'AI';
      const content = message.content.replace(/\s+/g, ' ').trim();
      lines.push(`- **${role}**：${content.slice(0, 120)}${content.length > 120 ? '…' : ''}`);
    });
  }
  lines.push('');
  lines.push(`## 今日设置`);
  lines.push('');
  lines.push(`- 温度档位：${temperature === 'high' ? '高（更详细、更温和）' : temperature === 'low' ? '低（更理性、更高效）' : '中（均衡）'}`);
  lines.push(`- 权限模式：${permission === 'read-only' ? 'Read only' : permission === 'workspace-write' ? 'Workspace write' : 'Full access'}`);
  lines.push('');
  lines.push(`## 下一步建议`);
  lines.push('');
  lines.push(`1. 继续完成「${currentStep.title}」的交付物。`);
  lines.push(`2. 如果遇到卡点，在对话中描述你希望用户看到什么、点击什么、得到什么。`);
  lines.push(`3. 完成当前节点后，及时点击“完成节点”，让系统更新引导进度。`);
  return lines.join('\n');
}

function permissionLabel(permission: Permission) {
  if (permission === 'read-only') return 'Read only';
  if (permission === 'workspace-write') return 'Workspace write';
  return 'Full access';
}

export default function ProjectWorkspace({ language }: { language: SiteLanguage }) {
  const currentRun = useCommerceStore(s => s.currentRun);
    const user = useCommerceStore(s => s.user);
  const runs = useCommerceStore(s => s.runs);
  const modelServices = useCommerceStore(s => s.modelServices);
  const selectedModel = useCommerceStore(s => s.selectedModel);
  const isStreaming = useCommerceStore(s => s.isStreaming);
  const isBusy = useCommerceStore(s => s.isBusy);
    const error = useCommerceStore(s => s.error);
    const clearError = useCommerceStore(s => s.clearError);
  const sendChat = useCommerceStore(s => s.sendChat);
  const activateModel = useCommerceStore(s => s.activateModel);
  const patchStep = useCommerceStore(s => s.patchStep);
  const selectRun = useCommerceStore(s => s.selectRun);

  const [projects, setProjects] = useState<Project[]>(() => {
    const storageKey = `${STORAGE_KEY_PREFIX}${user?.id || 'anonymous'}`;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Project[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {
      // ignore corrupted storage
    }
    const initialSession: LocalSession = {
      id: DEFAULT_SESSION_ID,
      title: '默认会话',
      messages: currentRun?.messages || [],
    };
    return [
      {
        id: uid('project'),
        title: currentRun?.title || '默认项目',
        sessions: [initialSession],
      },
    ];
  });
  const [activeProjectId, setActiveProjectId] = useState<string>(() => projects[0]?.id || '');
  const [activeSessionId, setActiveSessionId] = useState<string>(DEFAULT_SESSION_ID);
  const [chatInput, setChatInput] = useState('');
  const [rightOpen, setRightOpen] = useState(true);
  const [leftCollapsed, setLeftCollapsed] = useState(() => window.innerWidth < 1024);
  const [rightWidth, setRightWidth] = useState(380);
  const [leftWidth, setLeftWidth] = useState(300);
  const [rightTab, setRightTab] = useState<'guide' | 'docs'>('guide');
  const [reports, setReports] = useState<ReportDoc[]>([]);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
    const [uploadedFiles, setUploadedFiles] = useState<UploadedFileDoc[]>([]);
    const [activeUploadedId, setActiveUploadedId] = useState<string | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [permission, setPermission] = useState<Permission>('read-only');
  const [temperature, setTemperature] = useState<TemperatureLevel>('medium');
  const [showModelServices, setShowModelServices] = useState(false);
  const [folderNotice, setFolderNotice] = useState('');
  const [artifactDraft, setArtifactDraft] = useState('');
  const folderInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const chatMessagesRef = useRef<HTMLDivElement>(null);

  const activeProject = projects.find(project => project.id === activeProjectId) || projects[0];
  const activeSession = activeProject?.sessions.find(session => session.id === activeSessionId) || activeProject?.sessions[0];

  useEffect(() => {
    if (!currentRun) return;
    setProjects(prev => prev.map(project => {
      if (!project.sessions.some(session => session.id === DEFAULT_SESSION_ID)) return project;
      return {
        ...project,
        sessions: project.sessions.map(session =>
          session.id === DEFAULT_SESSION_ID
            ? { ...session, messages: currentRun.messages }
            : session,
        ),
      };
    }));
  }, [currentRun]);

  useEffect(() => {
    const sync = () => setLeftCollapsed(window.innerWidth < 1024);
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  useEffect(() => {
    setArtifactDraft(currentRun?.currentStep?.artifactContent || '');
  }, [currentRun?.currentStep?.id, currentRun?.currentStep?.artifactContent]);

    useEffect(() => {
      const handler = (event: BeforeUnloadEvent) => {
        if (reports.length === 0 && uploadedFiles.length === 0) return;
        event.preventDefault();
        event.returnValue = '';
      };
      window.addEventListener('beforeunload', handler);
      return () => window.removeEventListener('beforeunload', handler);
    }, [reports.length, uploadedFiles.length]);

    useEffect(() => {
      const storageKey = `${STORAGE_KEY_PREFIX}${user?.id || 'anonymous'}`;
      try {
        localStorage.setItem(storageKey, JSON.stringify(projects));
      } catch {
        // storage may be unavailable
      }
    }, [projects, user?.id]);

  const activeMessages = activeSession?.messages || [];

    useEffect(() => {
      const el = chatMessagesRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }, [activeMessages]);

  const updateActiveProject = (updater: (project: Project) => Project) => {
    setProjects(prev => prev.map(project => project.id === activeProject?.id ? updater(project) : project));
  };

  const createProject = () => {
    const title = newProjectName.trim() || `新项目 ${projects.length + 1}`;
    const project: Project = {
      id: uid('project'),
      title,
      sessions: [{ id: uid('session'), title: '会话 1', messages: [] }],
    };
    setProjects(prev => [...prev, project]);
    setActiveProjectId(project.id);
    setActiveSessionId(project.sessions[0].id);
    setNewProjectName('');
    setShowNewProject(false);
  };

  const createSession = () => {
    if (!activeProject) return;
    const count = activeProject.sessions.length + 1;
    const session: LocalSession = {
      id: uid('session'),
      title: `会话 ${count}`,
      messages: [],
    };
    updateActiveProject(project => ({ ...project, sessions: [...project.sessions, session] }));
    setActiveSessionId(session.id);
  };

  const selectFolder = (files: FileList | null) => {
    if (!files || files.length === 0 || !activeProject) return;
    const first = files[0];
    const folderName = (first as any).webkitRelativePath?.split('/')[0] || first.name || '已选择文件夹';
    updateActiveProject(project => ({
      ...project,
      folderName,
      folderFileCount: files.length,
    }));
    setFolderNotice(`已挂载「${folderName}」，共 ${files.length} 个文件`);
  };

  const handleSend = () => {
    const baseContent = chatInput.trim();
      const fileContext = uploadedFiles.length > 0
        ? `\n\n[临时文档库文件内容]\n${uploadedFiles.map(file => `--- ${file.name} ---\n${file.content}`).join('\n\n').slice(0, 20000)}`
        : '';
      const content = baseContent;
    if (!content || !activeSession) return;
    if (activeSession.id === DEFAULT_SESSION_ID && currentRun) {
      setChatInput('');
      const userMessage: Message = {
          id: uid('msg'),
          role: 'user',
          content,
          timestamp: Date.now(),
          threadId: activeSession.id,
        };
        updateActiveProject(project => ({
          ...project,
          sessions: project.sessions.map(session =>
            session.id === activeSession.id
              ? { ...session, messages: [...session.messages, userMessage] }
              : session,
          ),
        }));
        setChatInput('');
        const placeholder: Message = {
            id: uid('msg'),
            role: 'assistant',
            content: '...',
            timestamp: Date.now(),
            threadId: activeSession.id,
          };
          updateActiveProject(project => ({
            ...project,
            sessions: project.sessions.map(session =>
              session.id === activeSession.id
                ? { ...session, messages: [...session.messages, placeholder] }
                : session,
            ),
          }));
          void sendChat(content, TEMPERATURE_VALUES[temperature], fileContext || undefined);
      return;
    }
    const userMessage: Message = {
      id: uid('msg'),
      role: 'user',
      content,
      timestamp: Date.now(),
      threadId: activeSession.id,
    };
    updateActiveProject(project => ({
      ...project,
      sessions: project.sessions.map(session =>
        session.id === activeSession.id
          ? { ...session, messages: [...session.messages, userMessage] }
          : session,
      ),
    }));
    setChatInput('');
    window.setTimeout(() => {
      const reply = buildMockReply(content, temperature, activeProject?.title);
      const assistantMessage: Message = {
        id: uid('msg'),
        role: 'assistant',
        content: reply,
        timestamp: Date.now(),
        threadId: activeSession.id,
      };
      setProjects(prev => prev.map(project => ({
        ...project,
        sessions: project.sessions.map(session =>
          session.id === activeSession.id
            ? { ...session, messages: [...session.messages, assistantMessage] }
            : session,
        ),
      })));
    }, 500);
  };

  const generateDailyReport = () => {
    if (!currentRun) return;
    const content = buildDailyReport(currentRun, activeSession, temperature, permission);
    const report: ReportDoc = {
      id: uid('report'),
      title: `June AI · 今日学习成果报告 ${todayText()}`,
      content,
      createdAt: Date.now(),
    };
    setReports(prev => [report, ...prev]);
    setActiveReportId(report.id);
    setRightTab('docs');
    setRightOpen(true);
  };

  const deleteReport = (reportId: string) => {
    const next = reports.filter(report => report.id !== reportId);
    setReports(next);
    if (activeReportId === reportId) {
      setActiveReportId(next[0]?.id || null);
    }
  };

  const activeReport = reports.find(report => report.id === activeReportId) || reports[0];
    const activeUploadedFile = uploadedFiles.find(file => file.id === activeUploadedId) || uploadedFiles[0];

    const uploadFiles = async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const loaded = await Promise.all(
        Array.from(files).slice(0, 20).map(async file => {
          let content = '';
          try {
            content = await file.text();
          } catch {
            content = '';
          }
          return {
            id: uid('file'),
            name: file.name,
            size: file.size,
            type: file.type || 'text/plain',
            content: content.slice(0, 20000),
            uploadedAt: Date.now(),
          } satisfies UploadedFileDoc;
        }),
      );
      setUploadedFiles(prev => [...loaded, ...prev]);
      if (loaded[0]) {
        setActiveUploadedId(loaded[0].id);
        setActiveReportId(null);
      }
      if (uploadInputRef.current) uploadInputRef.current.value = '';
    };

    const deleteUploadedFile = (fileId: string) => {
      const next = uploadedFiles.filter(file => file.id !== fileId);
      setUploadedFiles(next);
      if (activeUploadedId === fileId) {
        setActiveUploadedId(next[0]?.id || null);
      }
    };

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

  const temperatureLabel: Record<TemperatureLevel, string> = {
    low: '低',
    medium: '中',
    high: '高',
  };

  const openFolderPicker = () => {
    const input = folderInputRef.current;
    if (!input) return;
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
    input.click();
    };

    const openUploadPicker = () => {
      uploadInputRef.current?.click();
    };

  return (
    <main className="studio-shell dsh-workspace project-workspace" data-theme="dark">
      <input
        ref={folderInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={event => selectFolder(event.target.files)}
      />

      <div
        className="dsh-grid"
        style={{
          gridTemplateColumns: `${leftCollapsed ? 56 : leftWidth}px minmax(0,1fr) ${rightOpen ? rightWidth : 0}px`,
        }}
      >
        {/* ===== 左侧：项目 / 会话 / 设置 ===== */}
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
                  <h2 className="project-left-title">{language === 'zh' ? '项目工作区' : 'Projects'}</h2>
                  <p className="project-left-subtitle">{runs.length} 个引导路径 · {projects.length} 个本地项目</p>
                </div>
                <button className="dsh-icon-button" onClick={() => setLeftCollapsed(true)} title="折叠左侧栏">
                  <PanelLeftClose size={15} />
                </button>
              </div>

              <div className="project-actions">
                <button className="coach-primary-button project-action-button" onClick={() => setShowNewProject(true)}>
                  <Plus size={14} /> {language === 'zh' ? '新建项目' : 'New Project'}
                </button>
                <button className="coach-secondary-button project-action-button" onClick={openFolderPicker}>
                  <FolderOpen size={14} /> {language === 'zh' ? '选择挂载文件夹' : 'Mount Folder'}
                </button>
              </div>

              {showNewProject && (
                <div className="project-create-box">
                  <input
                    autoFocus
                    className="coach-input"
                    placeholder={language === 'zh' ? '项目名称' : 'Project name'}
                    value={newProjectName}
                    onChange={event => setNewProjectName(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') createProject();
                      if (event.key === 'Escape') setShowNewProject(false);
                    }}
                  />
                  <div className="project-create-actions">
                    <button className="coach-primary-button" onClick={createProject}>
                      <CheckCircle2 size={14} /> {language === 'zh' ? '创建' : 'Create'}
                    </button>
                    <button className="coach-secondary-button" onClick={() => setShowNewProject(false)}>
                      <X size={14} /> {language === 'zh' ? '取消' : 'Cancel'}
                    </button>
                  </div>
                </div>
              )}

              {folderNotice && <p className="project-folder-notice">{folderNotice}</p>}

              <div className="project-list">
                {projects.map(project => {
                  const isActive = project.id === activeProject?.id;
                  return (
                    <div key={project.id} className={`project-item ${isActive ? 'is-active' : ''}`}>
                      <button
                        className="project-item-head"
                        onClick={() => {
                          setActiveProjectId(project.id);
                          setActiveSessionId(project.sessions[0]?.id || DEFAULT_SESSION_ID);
                        }}
                      >
                        <Folder size={15} className="project-folder-icon" />
                        <span className="project-item-title">{project.title}</span>
                        {project.folderName && <span className="project-folder-name">{project.folderName}</span>}
                        <ChevronDown size={14} className={isActive ? 'project-chevron open' : 'project-chevron'} />
                      </button>

                      {isActive && (
                        <div className="session-list">
                          {project.sessions.map(session => (
                            <button
                              key={session.id}
                              className={`session-item ${session.id === activeSession?.id ? 'is-active' : ''}`}
                              onClick={() => setActiveSessionId(session.id)}
                            >
                              <MessageSquareIcon />
                              <span>{session.title}</span>
                              <span className="session-message-count">{session.messages.length}</span>
                            </button>
                          ))}
                          <button className="session-add" onClick={createSession}>
                            <Plus size={13} /> {language === 'zh' ? '新建会话' : 'New Session'}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="project-left-footer">
                <button className="dsh-settings-button" onClick={() => setShowSettings(true)}>
                  <Settings size={15} />
                  {language === 'zh' ? '设置' : 'Settings'}
                  <span className="settings-badge">{permissionLabel(permission)} · {temperatureLabel[temperature]}</span>
                </button>
              </div>
            </div>
          )}
          {!leftCollapsed && <div className="resizer left" onMouseDown={startDrag('left')} />}
        </aside>

        {/* ===== 中间：模型对话区域 ===== */}
        <section className="dsh-main project-chat-main">
          <div className="chat-panel">
            <header className="chat-panel-header">
              <div className="chat-panel-titles">
                <h1>{activeProject?.title || '未选择项目'}</h1>
                <p>{activeSession?.title || '未选择会话'}{activeProject?.folderName ? ` · ${activeProject.folderName}` : ''}</p>
              </div>
              <div className="chat-panel-tools">
                <label className="chat-model-picker">
                  <span>{selectedModel || (modelServices[0]?.models[0]?.displayName || '选择模型')}</span>
                  <select
                    value=""
                    onChange={event => {
                      const [serviceId, modelId] = event.target.value.split('::');
                      if (serviceId && modelId) void activateModel(serviceId, modelId);
                    }}
                  >
                    <option value="">{language === 'zh' ? '切换模型' : 'Switch model'}</option>
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
                <button className="dsh-icon-button" onClick={() => setRightOpen(true)} title="打开详情栏">
                  <PanelRightOpen size={16} />
                </button>
              </div>
            </header>

            <div ref={chatMessagesRef} className="chat-messages">
              {activeMessages.length === 0 ? (
                <div className="chat-empty">
                  <Sparkles size={28} />
                  <p>{language === 'zh' ? '开始和模型对话吧。你可以描述项目目标，或直接问当前引导问题。' : 'Start a conversation with the model.'}</p>
                </div>
              ) : (
                activeMessages.map(message => (
                  <div key={message.id} className={`chat-message-row ${message.role === 'user' ? 'is-user' : 'is-assistant'}`}>
                    <div className={message.role === 'user' ? 'coach-message-user' : 'coach-message-assistant'}>
                      {message.content || (isStreaming ? '...' : '')}
                    </div>
                  </div>
                ))
              )}
            </div>

            {error && (
                <div className="chat-error-bar">
                  <span>{error}</span>
                  <button onClick={clearError}>关闭</button>
                </div>
              )}
              <footer className="chat-composer">
              <textarea
                ref={inputRef}
                className="coach-textarea"
                rows={3}
                value={chatInput}
                disabled={isStreaming && activeSession?.id === DEFAULT_SESSION_ID}
                placeholder={language === 'zh' ? '输入你的问题或项目指令…' : 'Type your message…'}
                onChange={event => setChatInput(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.altKey) {
                      event.preventDefault();
                      handleSend();
                    }
                }}
              />
              <div className="chat-composer-actions">
                <span className="chat-composer-hint">Enter 发送 · Alt+Enter 换行</span>
                <button
                  className="coach-primary-button"
                  disabled={!chatInput.trim() || (isStreaming && activeSession?.id === DEFAULT_SESSION_ID)}
                  onClick={handleSend}
                >
                  {isStreaming && activeSession?.id === DEFAULT_SESSION_ID ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                  {language === 'zh' ? '发送' : 'Send'}
                </button>
              </div>
            </footer>
          </div>
        </section>

        {/* ===== 右侧：详情 / 文档库 ===== */}
        {rightOpen && <div className="resizer right" onMouseDown={startDrag('right')} />}
        <aside className={rightOpen ? 'dsh-right project-right' : 'dsh-right closed'}>
          {rightOpen ? (
            <section className="project-right-panel">
              <header className="project-right-header">
                <div className="project-right-tabs">
                  <button className={rightTab === 'guide' ? 'is-active' : ''} onClick={() => setRightTab('guide')}>
                    <FileText size={14} /> {language === 'zh' ? '项目引导' : 'Guide'}
                  </button>
                  <button className={rightTab === 'docs' ? 'is-active' : ''} onClick={() => setRightTab('docs')}>
                    <FolderOpen size={14} /> {language === 'zh' ? '临时文档库' : 'Temp Docs'}
                  </button>
                </div>
                <div className="project-right-header-actions">
                  <button className="daily-summary-button" onClick={generateDailyReport}>
                    <Sparkles size={14} /> {language === 'zh' ? '每日总结' : 'Daily Summary'}
                  </button>
                  <button className="dsh-icon-button" onClick={() => setRightOpen(false)} title="关闭详情栏">
                    <PanelRightClose size={15} />
                  </button>
                </div>
              </header>

              <div className="project-right-body">
                {rightTab === 'guide' ? (
                  <div className="guide-panel">
                    {currentRun ? (
                      <>
                        <div className="guide-run-header">
                          <h3>{currentRun.title}</h3>
                          <span className={currentRun.status === 'completed' ? 'guide-status done' : 'guide-status'}>{currentRun.status === 'completed' ? '已完成' : '进行中'}</span>
                        </div>
                        <div className="guide-progress">
                          <div
                            className="guide-progress-bar"
                            style={{ width: `${(currentRun.steps.filter(step => step.isCompleted).length / currentRun.steps.length) * 100}%` }}
                          />
                        </div>
                        <p className="guide-progress-text">
                          {currentRun.steps.filter(step => step.isCompleted).length} / {currentRun.steps.length} 节点
                        </p>

                        <div className="guide-meta-grid">
                          <div>
                            <span>阻塞点</span>
                            <p>{currentRun.blocker || '无'}</p>
                          </div>
                          <div>
                            <span>下一个最小动作</span>
                            <p>{currentRun.nextAction || '无'}</p>
                          </div>
                        </div>

                        <div className="guide-steps">
                          <h4>{language === 'zh' ? '节点进度' : 'Steps'}</h4>
                          {currentRun.steps.map(step => (
                            <div
                              key={step.id}
                              className={`guide-step ${step.id === currentRun.currentStep?.id ? 'is-current' : ''} ${step.isCompleted ? 'is-done' : ''}`}
                            >
                              <span className="guide-step-icon">
                                {step.isCompleted ? <CheckCircle2 size={14} /> : <span className="guide-step-order">{step.order}</span>}
                              </span>
                              <div className="guide-step-body">
                                <strong>{step.order}. {step.title}</strong>
                                {step.id === currentRun.currentStep?.id && <p>{currentRun.currentStep.instructions}</p>}
                              </div>
                            </div>
                          ))}
                        </div>

                        {currentRun.currentStep && currentRun.status !== 'completed' && (
                          <div className="guide-artifact-box">
                            <h4>{language === 'zh' ? '当前交付物' : 'Current Artifact'}</h4>
                            <p className="guide-artifact-title">{currentRun.currentStep.requiredArtifact}</p>
                              <textarea
                                className="coach-textarea guide-artifact-textarea"
                                rows={4}
                                value={artifactDraft}
                                onChange={event => setArtifactDraft(event.target.value)}
                                  onBlur={() => {
                                    if (currentRun?.currentStep) {
                                      void patchStep(
                                        currentRun.currentStep.id,
                                        currentRun.currentStep.artifactTitle || currentRun.currentStep.requiredArtifact,
                                        artifactDraft,
                                        false,
                                      );
                                    }
                                  }}
                                placeholder={language === 'zh' ? '填写当前节点交付物内容…' : 'Write the artifact content…'}
                              />
                            <div className="guide-artifact-actions">
                              <button
                                className="coach-secondary-button"
                                disabled={isBusy}
                                onClick={() => void patchStep(
                                  currentRun.currentStep.id,
                                  currentRun.currentStep.artifactTitle || currentRun.currentStep.requiredArtifact,
                                  currentRun.currentStep.artifactContent,
                                  false,
                                )}
                              >
                                <Save size={14} /> {language === 'zh' ? '保存草稿' : 'Save Draft'}
                              </button>
                              <button
                                className="coach-primary-button"
                                disabled={isBusy || (artifactDraft || '').trim().length < 20}
                                onClick={() => void patchStep(
                                  currentRun.currentStep.id,
                                  currentRun.currentStep.artifactTitle || currentRun.currentStep.requiredArtifact,
                                  currentRun.currentStep.artifactContent,
                                  true,
                                )}
                              >
                                <CheckCircle2 size={14} /> {language === 'zh' ? '完成节点' : 'Complete'}
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="guide-empty">{language === 'zh' ? '暂无项目引导数据' : 'No guide data'}</div>
                    )}
                  </div>
                ) : (
                  <div className="docs-panel">
                      <div className="docs-toolbar">
                        <input ref={uploadInputRef} type="file" multiple style={{ display: 'none' }} onChange={event => void uploadFiles(event.target.files)} />
                        <button className="coach-secondary-button" onClick={openUploadPicker}>
                          <Upload size={14} /> {language === 'zh' ? '上传文件' : 'Upload Files'}
                        </button>
                      </div>

                      {uploadedFiles.length > 0 && (
                        <div className="docs-section">
                          <h4>{language === 'zh' ? '上传的文件' : 'Uploaded Files'}</h4>
                          <div className="docs-list">
                            {uploadedFiles.map(file => (
                              <button
                                key={file.id}
                                className={`doc-item ${activeUploadedFile?.id === file.id ? 'is-active' : ''}`}
                                onClick={() => { setActiveUploadedId(file.id); setActiveReportId(null); }}
                              >
                                <FileText size={15} />
                                <span>{file.name}</span>
                                <span className="doc-delete" role="button" tabIndex={0} title="删除文件" onClick={event => { event.stopPropagation(); deleteUploadedFile(file.id); }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); deleteUploadedFile(file.id); } }}><Trash2 size={14} /></span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="docs-section">
                        <h4>{language === 'zh' ? '生成的报告' : 'Generated Reports'}</h4>
                    <div className="docs-list">
                      {reports.length === 0 ? (
                        <div className="docs-empty">
                          <FileText size={24} />
                          <p>{language === 'zh' ? '还没有报告。可以上传文件，或点击右上角“每日总结”生成今日报告。' : 'No reports yet. Upload files or generate a daily summary.'}</p>
                        </div>
                      ) : (
                        reports.map(report => (
                          <button
                            key={report.id}
                            className={`doc-item ${report.id === activeReport?.id ? 'is-active' : ''}`}
                            onClick={() => setActiveReportId(report.id)}
                          >
                            <FileText size={15} />
                            <span>{report.title}</span><span className="doc-delete" role="button" tabIndex={0} title="删除文档" onClick={event => { event.stopPropagation(); deleteReport(report.id); }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); deleteReport(report.id); } }}><Trash2 size={14} /></span>
                          </button>
                        ))
                      )}
                    </div>

                    </div>

                      {activeUploadedFile && !activeReport && (
                        <div className="doc-viewer">
                          <div className="doc-viewer-head">
                            <h3>{activeUploadedFile.name}</h3>
                            <span className="doc-file-size">{Math.ceil(activeUploadedFile.size / 1024)} KB</span>
                          </div>
                          <div className="doc-content file-content">
                            <pre>{activeUploadedFile.content || '（无法读取文件内容或文件为空）'}</pre>
                          </div>
                        </div>
                      )}

                      {activeReport && (
                      <div className="doc-viewer">
                        <div className="doc-viewer-head">
                          <h3>{activeReport.title}</h3>
                          <div className="doc-downloads">
                            <button className="coach-secondary-button" onClick={() => downloadMarkdown(activeReport.content)} title="下载 Markdown">
                              <FileCode2 size={14} /> MD
                            </button>
                            <button className="coach-secondary-button" onClick={() => downloadWord(activeReport.content)} title="下载 Word">
                              <FileDown size={14} /> Word
                            </button>
                            <button className="coach-secondary-button" onClick={() => downloadPdf(activeReport.content)} title="导出 PDF">
                              <Download size={14} /> PDF
                            </button>
                          </div>
                        </div>
                        <div className="doc-logo">
                          <span className="doc-logo-mark">J</span>
                          <div>
                            <strong>June AI</strong>
                            <small>AI 变现训练官 · 学习成果报告</small>
                          </div>
                        </div>
                        <div className="doc-content">
                          {activeReport.content.split('\n').map((line, index) => {
                            if (line.startsWith('# ')) return <h1 key={index}>{line.slice(2)}</h1>;
                            if (line.startsWith('## ')) return <h2 key={index}>{line.slice(3)}</h2>;
                            if (line.startsWith('- ')) return <li key={index}>{line.slice(2)}</li>;
                            if (line.startsWith('1. ') || line.startsWith('2. ') || line.startsWith('3. ')) return <li key={index}>{line.slice(3)}</li>;
                            if (!line.trim()) return <div key={index} className="doc-blank" />;
                            return <p key={index}>{line}</p>;
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>
          ) : (
            <button className="dsh-right-open" onClick={() => setRightOpen(true)}>
              <PanelRightOpen size={16} /> {language === 'zh' ? '详情' : 'Details'}
            </button>
          )}
        </aside>
      </div>

      {/* ===== 设置弹层 ===== */}
      {showSettings && (
        <div className="settings-overlay" onClick={() => setShowSettings(false)}>
          <div className="settings-popover" onClick={event => event.stopPropagation()}>
            <div className="settings-popover-head">
              <h3><Settings size={16} /> {language === 'zh' ? '设置' : 'Settings'}</h3>
              <button className="dsh-icon-button" onClick={() => setShowSettings(false)}><X size={15} /></button>
            </div>

            <div className="settings-section">
              <h4>{language === 'zh' ? '权限' : 'Permission'}</h4>
              <div className="permission-options">
                {(['read-only', 'workspace-write', 'full-access'] as Permission[]).map(item => (
                  <button
                    key={item}
                    className={`permission-option ${permission === item ? 'is-active' : ''}`}
                    onClick={() => setPermission(item)}
                  >
                    {item === 'read-only' ? <Lock size={14} /> : item === 'workspace-write' ? <Save size={14} /> : <ShieldCheck size={14} />}
                    {item === 'read-only' ? 'Read only' : item === 'workspace-write' ? 'Workspace write' : 'Full access'}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-section">
              <h4>{language === 'zh' ? '模型温度' : 'Temperature'}</h4>
              <div className="temperature-slider-row">
                <span className={temperature === 'low' ? 'is-active' : ''}>低</span>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={1}
                  value={temperature === 'low' ? 0 : temperature === 'medium' ? 1 : 2}
                  onChange={event => {
                    const value = Number(event.target.value);
                    setTemperature(value === 0 ? 'low' : value === 1 ? 'medium' : 'high');
                  }}
                />
                <span className={temperature === 'high' ? 'is-active' : ''}>高</span>
              </div>
              <p className="settings-hint">
                {temperature === 'high'
                  ? language === 'zh' ? '高温度：讲得更细、更温柔，适合需要陪伴和详细解释的场景。' : 'High: more detailed and warmer.'
                  : temperature === 'low'
                    ? language === 'zh' ? '低温度：更理性、更高效，省略多余寒暄，但始终尊重客户。' : 'Low: more rational and efficient.'
                    : language === 'zh' ? '中温度：在详细与高效之间保持平衡。' : 'Medium: balanced.'}
              </p>
            </div>

            <div className="settings-section">
              <button
                className="coach-secondary-button settings-model-button"
                onClick={() => setShowModelServices(true)}
              >
                <KeyRound size={14} /> {language === 'zh' ? '模型服务管理' : 'Model Services'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 模型服务管理弹层 ===== */}
      {showModelServices && (
        <div className="settings-overlay" onClick={() => setShowModelServices(false)}>
          <div className="model-services-modal" onClick={event => event.stopPropagation()}>
            <div className="model-services-modal-head">
              <h3>{language === 'zh' ? '模型服务管理' : 'Model Services'}</h3>
              <button className="dsh-icon-button" onClick={() => setShowModelServices(false)}><X size={15} /></button>
            </div>
            <ModelServicesPanel />
          </div>
        </div>
      )}
    </main>
  );
}

function MessageSquareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
