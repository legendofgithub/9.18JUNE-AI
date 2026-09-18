import { useMemo, useState } from 'react';
import { CheckCircle2, Download, FileDown, FileText, Save, Trash2, Upload } from 'lucide-react';
import useHarnessStore from '../../../stores/useHarnessStore';
import type { HarnessContext, MvpRunDetail } from '../../../types';
import type { SiteLanguage } from '../SiteHeader';
import { downloadPdf, downloadWord, statusLabel } from './report';

export type RightTab = 'guide' | 'context' | 'files' | 'docs' | 'trace';

interface RightSidebarBodyProps {
  language: SiteLanguage;
  tab: RightTab;
  currentRun: MvpRunDetail | null;
  artifactDraft: string;
  onArtifactDraftChange: (value: string) => void;
  patchStep: (stepId: string, artifactTitle: string, artifactContent: string, completed: boolean) => Promise<void>;
  busy: boolean;
  onUploadClick: () => void;
}

/** 右栏详情体：引导（节点交付物）/ 上下文与记忆 / 文件 / 服务端文档 / 执行 Trace */
export default function RightSidebarBody({
  language,
  tab,
  currentRun,
  artifactDraft,
  onArtifactDraftChange,
  patchStep,
  busy,
  onUploadClick,
}: RightSidebarBodyProps) {
  const context = useHarnessStore(s => s.context) as HarnessContext | null;
  const memories = useHarnessStore(s => s.memories);
  const files = useHarnessStore(s => s.files);
  const documents = useHarnessStore(s => s.documents);
  const activeRun = useHarnessStore(s => s.activeRun);
  const runEvents = useHarnessStore(s => s.runEvents);
  const compressContext = useHarnessStore(s => s.compressContext);
  const addMemory = useHarnessStore(s => s.addMemory);
  const deleteDocument = useHarnessStore(s => s.deleteDocument);

  const [memoryDraft, setMemoryDraft] = useState('');

  const contextPercent = useMemo(() => {
    if (!context?.budgetTokens) return 0;
    return Math.min(100, Math.round((context.totalTokens / context.budgetTokens) * 100));
  }, [context]);

  if (tab === 'guide' && currentRun) {
    return (
      <div className="guide-panel">
        <div className="guide-run-header"><h3>{currentRun.title}</h3><span className={currentRun.status === 'completed' ? 'guide-status done' : 'guide-status'}>{currentRun.status === 'completed' ? '已完成' : '进行中'}</span></div>
        <div className="guide-progress"><div className="guide-progress-bar" style={{ width: `${(currentRun.steps.filter(step => step.isCompleted).length / currentRun.steps.length) * 100}%` }} /></div>
        <p className="guide-progress-text">{currentRun.steps.filter(step => step.isCompleted).length} / {currentRun.steps.length} 节点</p>
        <div className="guide-meta-grid"><div><span>阻塞点</span><p>{currentRun.blocker || '无'}</p></div><div><span>下一个最小动作</span><p>{currentRun.nextAction || '无'}</p></div></div>
        {currentRun.status !== 'completed' && currentRun.currentStep && (
          <div className="guide-artifact-box">
            <h4>当前交付物</h4><p className="guide-artifact-title">{currentRun.currentStep.requiredArtifact}</p>
            <textarea className="coach-textarea guide-artifact-textarea" rows={5} value={artifactDraft} onChange={event => onArtifactDraftChange(event.target.value)} />
            <div className="guide-artifact-actions">
              <button className="coach-secondary-button" disabled={busy} onClick={() => void patchStep(currentRun.currentStep.id, currentRun.currentStep.artifactTitle || currentRun.currentStep.requiredArtifact, artifactDraft, false)}><Save size={14} /> 保存草稿</button>
              <button className="coach-primary-button" disabled={busy || artifactDraft.trim().length < 20} onClick={() => void patchStep(currentRun.currentStep.id, currentRun.currentStep.artifactTitle || currentRun.currentStep.requiredArtifact, artifactDraft, true)}><CheckCircle2 size={14} /> 完成节点</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (tab === 'context') {
    return (
      <div className="harness-side-panel">
        <div className="context-meter"><span>{contextPercent}%</span><div><i style={{ width: `${contextPercent}%` }} /></div></div>
        <p>{context ? `${context.totalTokens}/${context.budgetTokens} tokens · ${context.historyMessageCount}/${context.totalMessageCount} messages` : '暂无上下文数据'}</p>
        <button className="coach-secondary-button" disabled={busy} onClick={() => void compressContext()}>压缩上下文</button>
        <div className="context-component-list">
          {(context?.components || []).map(component => (
            <div key={component.name}><span>{component.name}</span><strong>{component.tokens}</strong>{component.truncated ? <em>截断</em> : null}</div>
          ))}
        </div>
        <div className="memory-editor"><textarea value={memoryDraft} onChange={event => setMemoryDraft(event.target.value)} placeholder="写入项目长期记忆…" /><button className="coach-primary-button" disabled={busy || !memoryDraft.trim()} onClick={() => { void addMemory(memoryDraft); setMemoryDraft(''); }}>保存记忆</button></div>
        <div className="memory-list">{memories.map(memory => <div key={memory.id}><strong>{memory.memoryType}</strong><p>{memory.content}</p></div>)}</div>
      </div>
    );
  }

  if (tab === 'files') {
    return (
      <div className="harness-side-panel">
        <button className="coach-secondary-button" onClick={onUploadClick}><Upload size={14} /> 上传文本快照</button>
        <div className="file-list">{files.map(file => <div key={file.id}><FileText size={15} /><span>{file.path}</span><strong>{Math.ceil(file.size / 1024)}KB</strong></div>)}</div>
        {files.length === 0 && <p className="side-empty">项目沙箱暂无文件。</p>}
      </div>
    );
  }

  if (tab === 'docs') {
    return (
      <div className="harness-side-panel">
        <div className="file-list">{documents.map(document => (
          <div key={document.id}>
            <FileText size={15} /><span>{document.title}</span>
            <a href={`/api/harness/documents/${document.id}/download`} className="doc-mini-download"><Download size={14} /></a>
            <button className="doc-mini-download" onClick={() => downloadWord(document.title, document.content)}><FileDown size={14} /></button>
            <button className="doc-mini-download" onClick={() => downloadPdf(document.title, document.content)}><Download size={14} /></button>
            <button className="doc-mini-delete" onClick={() => void deleteDocument(document.id)}><Trash2 size={14} /></button>
          </div>
        ))}</div>
        {documents.length === 0 && <p className="side-empty">暂无服务端文档。</p>}
      </div>
    );
  }

  if (tab === 'trace') {
    return (
      <div className="harness-side-panel trace-panel">
        {activeRun ? <p>{statusLabel(activeRun.status)} · {activeRun.iterations}/6</p> : <p className="side-empty">暂无执行记录。</p>}
        {runEvents.map(event => <div key={event.id} className="trace-event"><strong>{event.type}</strong><pre>{JSON.stringify(event.payload, null, 2).slice(0, 1200)}</pre></div>)}
      </div>
    );
  }

  return null;
}
