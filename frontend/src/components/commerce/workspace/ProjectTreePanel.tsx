import { useState } from 'react';
import { CheckCircle2, Folder, FolderOpen, MessageSquare, PanelLeftClose, Plus, Settings, Trash2, X } from 'lucide-react';
import useHarnessStore from '../../../stores/useHarnessStore';
import type { HarnessPermission, HarnessProject, HarnessSession } from '../../../types';
import type { SiteLanguage } from '../SiteHeader';
import { permissionLabel, type TemperatureLevel } from './report';

interface ProjectTreePanelProps {
  language: SiteLanguage;
  projects: HarnessProject[];
  fileCount: number;
  activeProject?: HarnessProject;
  activeSession?: HarnessSession;
  permission: HarnessPermission;
  temperature: TemperatureLevel;
  onCollapse: () => void;
  onOpenSettings: () => void;
  onUploadClick: () => void;
}

/** 左栏：项目/会话树 + 新建项目 + 上传快照入口 */
export default function ProjectTreePanel({
  language,
  projects,
  fileCount,
  activeProject,
  activeSession,
  permission,
  temperature,
  onCollapse,
  onOpenSettings,
  onUploadClick,
}: ProjectTreePanelProps) {
  const { selectProject, deleteProject, selectSession, deleteSession, createSession, createProject: addProject } = useHarnessStore();

  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

  const temperatureLabel: Record<TemperatureLevel, string> = { low: '低', medium: '中', high: '高' };

  const handleCreateProject = async () => {
    const title = newProjectName.trim() || `新项目 ${projects.length + 1}`;
    await addProject(title);
    setNewProjectName('');
    setShowNewProject(false);
  };

  return (
    <div className="dsh-left-inner project-left-inner">
      <div className="project-left-head">
        <div>
          <h2 className="project-left-title">{language === 'zh' ? 'Harness 项目' : 'Harness'}</h2>
          <p className="project-left-subtitle">{projects.length} 个项目 · {fileCount} 个文件</p>
        </div>
        <button className="dsh-icon-button" onClick={onCollapse} title="折叠左侧栏"><PanelLeftClose size={15} /></button>
      </div>

      <div className="project-actions">
        <button className="coach-primary-button project-action-button" onClick={() => setShowNewProject(true)}>
          <Plus size={14} /> {language === 'zh' ? '新建项目' : 'New Project'}
        </button>
        <button className="coach-secondary-button project-action-button" onClick={onUploadClick}>
          <FolderOpen size={14} /> {language === 'zh' ? '上传项目快照' : 'Upload Snapshot'}
        </button>
      </div>

      {showNewProject && (
        <div className="project-create-box">
          <input autoFocus className="coach-input" placeholder={language === 'zh' ? '项目名称' : 'Project name'} value={newProjectName} onChange={event => setNewProjectName(event.target.value)} onKeyDown={event => {
            if (event.key === 'Enter') void handleCreateProject();
            if (event.key === 'Escape') setShowNewProject(false);
          }} />
          <div className="project-create-actions">
            <button type="button" className="project-create-button coach-primary-button" onClick={() => void handleCreateProject()}><CheckCircle2 size={14} /> 创建</button>
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
                <button className="project-item-select" onClick={() => void selectProject(project.id)}>
                  <Folder size={15} className="project-folder-icon" />
                  <span className="project-item-title">{project.title}</span>
                  <span className="project-folder-name">{project.sessions.length} 会话</span>
                </button>
                <button className="project-delete" title="删除项目" onClick={() => {
                  if (window.confirm(`确定删除项目「${project.title}」吗？`)) void deleteProject(project.id);
                }}><Trash2 size={14} /></button>
              </div>
              {isActive && (
                <div className="session-list">
                  {project.sessions.map(session => (
                    <div key={session.id} className={`session-item ${session.id === activeSession?.id ? 'is-active' : ''}`}>
                      <button className="session-item-select" onClick={() => void selectSession(session.id)}>
                        <MessageSquare size={14} />
                        <span className="session-item-title">{session.title}</span>
                        <span className="session-message-count">{session.messages.length}</span>
                      </button>
                      <button className="session-delete" title="删除会话" onClick={() => {
                        if (window.confirm(`确定删除会话「${session.title}」吗？`)) void deleteSession(session.id);
                      }}><Trash2 size={13} /></button>
                    </div>
                  ))}
                  <button className="session-add" onClick={() => void createSession()}><Plus size={13} /> 新建会话</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="project-left-footer">
        <button className="dsh-settings-button" onClick={onOpenSettings}>
          <Settings size={15} /> 设置
          <span className="settings-badge">{permissionLabel(permission)} · {temperatureLabel[temperature]}</span>
        </button>
      </div>
    </div>
  );
}
