 import { useState, useEffect } from 'react';
import { Settings, FolderOpen, Plus, MessageSquare, Trash2, ChevronDown, Key, CheckCircle, XCircle, Loader2, X, Zap, FileText } from 'lucide-react';
 import useJuneStore from '../../stores/useJuneStore';

 /** 验证后端 Token 是否有效 */
 async function verifyToken(token: string): Promise<boolean> {
   try {
     const resp = await fetch('http://localhost:8000/api/status', {
       headers: { Authorization: `Bearer ${token}` },
     });
     return resp.ok;
   } catch {
     return false;
   }
 }
 
export default function Header() {
   const [showSessions, setShowSessions] = useState(false);
   const [showSettings, setShowSettings] = useState(false);
 
   const sessions = useJuneStore(s => s.sessions);
   const currentSessionId = useJuneStore(s => s.currentSessionId);
   const createSession = useJuneStore(s => s.createSession);
   const switchSession = useJuneStore(s => s.switchSession);
   const deleteSession = useJuneStore(s => s.deleteSession);
   const toggleFilePanel = useJuneStore(s => s.toggleFilePanel);
   const isFilePanelOpen = useJuneStore(s => s.isFilePanelOpen);
   const tokenValid = useJuneStore(s => s.tokenValid);
   const setTokenValid = useJuneStore(s => s.setTokenValid);
 
  const currentSession = sessions.find(s => s.id === currentSessionId);

  const downloadLearningReport = async () => {
    if (!currentSessionId) return;
    try {
      const token = localStorage.getItem('june_api_token');
      const resp = await fetch(`http://localhost:8000/api/sessions/${currentSessionId}/report`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `june-learning-report-${currentSessionId}.md`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('[June] 学习报告下载失败', e);
    }
  };
 
   // 页面加载时尝试验证已有 Token
   useEffect(() => {
     const saved = localStorage.getItem('june_api_token');
     if (saved && !tokenValid) {
       verifyToken(saved).then(valid => setTokenValid(valid));
     }
   }, []);
 
   return (
     <header
       className="h-14 border-b flex items-center justify-between px-4 shrink-0"
       style={{
         borderColor: 'var(--june-border)',
         background: 'var(--june-surface)',
       }}
     >
       <div className="flex items-center gap-3">
         {/* Logo */}
         <div className="flex items-center gap-2">
           <div
             className="w-8 h-8 rounded-xl flex items-center justify-center text-white font-bold text-sm card-shadow"
             style={{ background: 'linear-gradient(135deg, var(--june-primary), var(--june-accent-2))' }}
           >
             J
           </div>
           <span className="font-semibold text-sm gradient-text">June AI assistant</span>
         </div>
 
         {/* Token 状态指示器 */}
         <button
           className="flex items-center gap-1.5 text-xs transition-colors"
           style={{ color: tokenValid ? 'var(--june-success)' : '#f97316' }}
           onClick={() => setShowSettings(true)}
           title="点击打开设置"
         >
           <span
             className="inline-block w-2 h-2 rounded-full"
             style={{ backgroundColor: tokenValid ? 'var(--june-success)' : '#f97316' }}
           />
           <span className="hidden sm:inline">{tokenValid ? '已连接' : '未连接'}</span>
         </button>
 
         {/* 会话切换器 */}
         <div className="relative">
           <button
             onClick={() => setShowSessions(!showSessions)}
             className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors"
             style={{
               color: 'var(--june-text-dim)',
               background: showSessions ? 'var(--june-primary-light)' : 'transparent',
             }}
             onMouseEnter={e => { if (!showSessions) e.currentTarget.style.background = 'var(--june-surface-alt)'; }}
             onMouseLeave={e => { if (!showSessions) e.currentTarget.style.background = 'transparent'; }}
           >
             <MessageSquare size={14} style={{ color: 'var(--june-primary)' }} />
             <span className="max-w-[120px] truncate">
               {currentSession?.title ?? '新建对话'}
             </span>
             <ChevronDown size={12} />
           </button>
 
           {showSessions && (
             <>
               <div className="fixed inset-0 z-40" onClick={() => setShowSessions(false)} />
               <div
                 className="absolute top-full left-0 mt-1 w-64 rounded-xl py-1 z-50 animate-fade-in card-shadow-lg"
                 style={{ background: 'var(--june-surface)', border: '1px solid var(--june-border)' }}
               >
                 <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--june-border)' }}>
                   <button
                     onClick={() => {
                       createSession();
                       setShowSessions(false);
                     }}
                     className="flex items-center gap-2 text-xs w-full font-medium"
                     style={{ color: 'var(--june-primary)' }}
                   >
                     <Plus size={14} />
                     <span>新建对话</span>
                   </button>
                 </div>
                 <div className="max-h-48 overflow-y-auto">
                   {sessions.map(session => (
                     <div
                       key={session.id}
                       onClick={() => {
                         switchSession(session.id);
                         setShowSessions(false);
                       }}
                       className="flex items-center justify-between px-3 py-2 cursor-pointer text-xs transition-colors"
                       style={{
                         background: session.id === currentSessionId ? 'var(--june-primary-light)' : 'transparent',
                         color: session.id === currentSessionId ? 'var(--june-primary)' : 'var(--june-text)',
                       }}
                       onMouseEnter={e => { if (session.id !== currentSessionId) e.currentTarget.style.background = 'var(--june-surface-alt)'; }}
                       onMouseLeave={e => { if (session.id !== currentSessionId) e.currentTarget.style.background = 'transparent'; }}
                     >
                       <span className="truncate flex-1">{session.title}</span>
                       <button
                         onClick={e => {
                           e.stopPropagation();
                           deleteSession(session.id);
                         }}
                         className="p-0.5 rounded transition-colors ml-2"
                       >
                         <Trash2 size={12} style={{ color: 'var(--june-text-dim)' }} />
                       </button>
                     </div>
                   ))}
                 </div>
               </div>
             </>
           )}
         </div>
       </div>
 
       <div className="flex items-center gap-1">
         {/* 资料库开关 */}
         <button
           onClick={toggleFilePanel}
           className="p-2 rounded-lg transition-colors"
           style={{
             color: isFilePanelOpen ? 'var(--june-primary)' : 'var(--june-text-dim)',
             background: isFilePanelOpen ? 'var(--june-primary-light)' : 'transparent',
           }}
           onMouseEnter={e => { if (!isFilePanelOpen) { e.currentTarget.style.color = 'var(--june-text)'; e.currentTarget.style.background = 'var(--june-surface-alt)'; } }}
           onMouseLeave={e => { if (!isFilePanelOpen) { e.currentTarget.style.color = 'var(--june-text-dim)'; e.currentTarget.style.background = 'transparent'; } }}
           title="资料库"
         >
           <FolderOpen size={16} />
         </button>
 
        {/* 设置 */}
        <button
          onClick={downloadLearningReport}
          disabled={!currentSessionId}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
          style={{ color: 'var(--june-text-dim)' }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--june-text)'; e.currentTarget.style.background = 'var(--june-surface-alt)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--june-text-dim)'; e.currentTarget.style.background = 'transparent'; }}
          title="导出本次学习报告"
        >
          <FileText size={15} />
          <span>报告</span>
        </button>

        <button
          onClick={() => setShowSettings(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
           style={{ color: 'var(--june-text-dim)' }}
           onMouseEnter={e => { e.currentTarget.style.color = 'var(--june-text)'; e.currentTarget.style.background = 'var(--june-surface-alt)'; }}
           onMouseLeave={e => { e.currentTarget.style.color = 'var(--june-text-dim)'; e.currentTarget.style.background = 'transparent'; }}
          title="模型与连接设置"
        >
          <Settings size={15} />
          <span>设置</span>
        </button>
       </div>
 
       {/* 设置弹窗 */}
       {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
     </header>
   );
 }
 
function SettingsModal({ onClose }: { onClose: () => void }) {
  const modelConfig = useJuneStore(s => s.modelConfig);
 const setModel = useJuneStore(s => s.setModel);
 const setBaseUrl = useJuneStore(s => s.setBaseUrl);
 const setApiKey = useJuneStore(s => s.setApiKey);
 const applyModelConfig = useJuneStore(s => s.applyModelConfig);
   const setTokenValid = useJuneStore(s => s.setTokenValid);
 
   const [apiToken, setApiToken] = useState(() => localStorage.getItem('june_api_token') || '');
   const [tokenStatus, setTokenStatus] = useState<'idle' | 'verifying' | 'ok' | 'fail'>('idle');
 const [saving, setSaving] = useState(false);
 const [saveError, setSaveError] = useState('');
 const [testing, setTesting] = useState(false);
 const [testStatus, setTestStatus] = useState<'idle' | 'ok' | 'fail'>('idle');
 const [testMessage, setTestMessage] = useState('');
 
  const handleVerifyToken = async () => {
    if (!apiToken.trim()) return;
    setTokenStatus('verifying');
    const ok = await verifyToken(apiToken.trim());
    setTokenStatus(ok ? 'ok' : 'fail');
  };

 const handleTestConnection = async () => {
   setTesting(true);
   setTestStatus('idle');
   setTestMessage('');
   try {
     const headers: Record<string, string> = { 'Content-Type': 'application/json' };
     const token = localStorage.getItem('june_api_token');
     if (token) headers['Authorization'] = `Bearer ${token}`;

     const resp = await fetch('http://localhost:8000/api/config/test', {
       method: 'POST',
       headers,
       body: JSON.stringify({
         name: modelConfig.name,
         base_url: modelConfig.baseUrl,
         api_key: modelConfig.apiKey || undefined,
       }),
     });
     const json = await resp.json();
     const result = json?.data ?? {};
     if (resp.ok && result.ok) {
       setTestStatus('ok');
       setTestMessage(`连接成功${result.model ? `：${result.model}` : ''}`);
     } else {
       setTestStatus('fail');
       setTestMessage(result.error || json?.message || `连接失败：HTTP ${resp.status}`);
     }
   } catch (e: any) {
     setTestStatus('fail');
     setTestMessage(e?.message || '无法访问后端服务');
   } finally {
     setTesting(false);
   }
 };
 
  const handleSave = async () => {
    setSaving(true);
    setSaveError('');

    // 保存 Token 到 localStorage
     if (apiToken.trim()) {
       localStorage.setItem('june_api_token', apiToken.trim());
       setTokenValid(true);
     }
 
    const modelApplied = await applyModelConfig();
    if (!modelApplied) {
      setSaveError('模型配置未保存，请确认后端已启动且连接 Token 有效');
    }

    setSaving(false);
    if (modelApplied) onClose();
   };
 
   return (
     <>
       <div className="fixed inset-0 z-50 animate-fade-in" style={{ background: 'rgba(45, 49, 66, 0.2)', }} onClick={onClose} />
       <div
         className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 rounded-2xl z-[60] max-h-[85vh] overflow-y-auto animate-slide-up card-shadow-lg"
         onClick={e => e.stopPropagation()}
         style={{ background: 'var(--june-surface)', border: '1px solid var(--june-border)' }}
       >
         <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--june-border)' }}>
           <h3 className="font-semibold text-sm" style={{ color: 'var(--june-text-bright)' }}>设置</h3>
           <button onClick={onClose} className="p-1 rounded-lg transition-colors" style={{ color: 'var(--june-text-dim)' }}>
             <X size={16} />
           </button>
         </div>
 
         <div className="px-5 py-4 space-y-5">
           {/* Token 设置 */}
           <div>
             <div className="flex items-center gap-2 mb-1.5">
               <Key size={14} style={{ color: 'var(--june-primary)' }} />
              <label className="text-xs font-medium" style={{ color: 'var(--june-text)' }}>June 访问 Token</label>
               {tokenStatus === 'ok' && <CheckCircle size={14} style={{ color: 'var(--june-success)' }} />}
               {tokenStatus === 'fail' && <XCircle size={14} style={{ color: 'var(--june-danger)' }} />}
             </div>
             <div className="flex gap-2">
               <input
                 type="password"
                 value={apiToken}
                 onChange={e => { setApiToken(e.target.value); setTokenStatus('idle'); }}
                 placeholder="启动后端时终端显示的 Token"
                 className="flex-1 rounded-lg px-3 py-2 text-xs outline-none transition-all font-mono"
                 style={{
                   border: '1px solid var(--june-border)',
                   background: 'var(--june-surface-alt)',
                   color: 'var(--june-text)',
                 }}
                 onFocus={e => { e.target.style.borderColor = 'var(--june-primary)'; e.target.style.boxShadow = '0 0 0 3px var(--june-primary-light)'; }}
                 onBlur={e => { e.target.style.borderColor = 'var(--june-border)'; e.target.style.boxShadow = 'none'; }}
               />
               <button
                 onClick={handleVerifyToken}
                 disabled={!apiToken.trim() || tokenStatus === 'verifying'}
                 className="px-3 py-2 text-xs rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1"
                 style={{ border: '1px solid var(--june-border)', color: 'var(--june-text)', background: 'var(--june-surface-alt)' }}
               >
                 {tokenStatus === 'verifying' && <Loader2 size={12} className="animate-spin" />}
                 验证
               </button>
             </div>
             <p className="text-xs mt-1.5 leading-relaxed" style={{ color: 'var(--june-text-dim)' }}>
              这是打开本页面的访问凭证，由后端启动时打印。
             </p>
             {tokenStatus === 'fail' && (
               <p className="text-xs mt-1" style={{ color: 'var(--june-danger)' }}>Token 无效，请检查是否正确复制</p>
             )}
           </div>
 
          {/* 模型选择 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium" style={{ color: 'var(--june-text)' }}>模型强度</label>
              <button
                onClick={handleTestConnection}
                disabled={testing}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors disabled:opacity-50"
                style={{ border: '1px solid var(--june-border)', color: 'var(--june-primary)', background: 'var(--june-surface-alt)' }}
              >
                {testing ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                测试连接
              </button>
            </div>
             <select
               value={modelConfig.name}
               onChange={e => setModel(e.target.value)}
               className="w-full rounded-lg px-3 py-2 text-sm outline-none transition-all"
               style={{
                 border: '1px solid var(--june-border)',
                 background: 'var(--june-surface-alt)',
                 color: 'var(--june-text)',
               }}
               onFocus={e => { e.target.style.borderColor = 'var(--june-primary)'; e.target.style.boxShadow = '0 0 0 3px var(--june-primary-light)'; }}
               onBlur={e => { e.target.style.borderColor = 'var(--june-border)'; e.target.style.boxShadow = 'none'; }}
             >
              <optgroup label="智谱 GLM">
                <option value="glm-5.2">GLM-5.2 · 深度思考</option>
                <option value="glm-4-flash">GLM-4 Flash · 快速回答</option>
              </optgroup>
              <optgroup label="其他 OpenAI 兼容模型">
                <option value="deepseek-chat">DeepSeek Chat</option>
                <option value="gpt-4o">GPT-4o</option>
              </optgroup>
            </select>
            <p className="text-xs mt-1.5" style={{ color: 'var(--june-text-dim)' }}>
              当前选择会在保存后应用到主对话、追问和讲解模式。
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--june-text)' }}>API Base URL</label>
            <input
              type="text"
              value={modelConfig.baseUrl}
              onChange={e => setBaseUrl(e.target.value.trim())}
              placeholder="https://open.bigmodel.cn/api/paas/v4"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none transition-all font-mono"
              style={{
                border: '1px solid var(--june-border)',
                background: 'var(--june-surface-alt)',
                color: 'var(--june-text)',
              }}
              onFocus={e => { e.target.style.borderColor = 'var(--june-primary)'; e.target.style.boxShadow = '0 0 0 3px var(--june-primary-light)'; }}
              onBlur={e => { e.target.style.borderColor = 'var(--june-border)'; e.target.style.boxShadow = 'none'; }}
            />
          </div>

          {saveError && (
            <p className="text-xs" style={{ color: 'var(--june-danger)' }}>{saveError}</p>
          )}
 
           {/* API Key */}
           <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--june-text)' }}>模型 API Key</label>
             <input
              type="password"
              value={modelConfig.apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="留空则使用后端已配置的 API Key"
               className="w-full rounded-lg px-3 py-2 text-sm outline-none transition-all"
               style={{
                 border: '1px solid var(--june-border)',
                 background: 'var(--june-surface-alt)',
                 color: 'var(--june-text)',
               }}
               onFocus={e => { e.target.style.borderColor = 'var(--june-primary)'; e.target.style.boxShadow = '0 0 0 3px var(--june-primary-light)'; }}
               onBlur={e => { e.target.style.borderColor = 'var(--june-border)'; e.target.style.boxShadow = 'none'; }}
             />
            <p className="text-xs mt-1" style={{ color: 'var(--june-text-dim)' }}>
              获取 API Key: <a href="https://open.bigmodel.cn" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--june-primary)' }} className="hover:underline">open.bigmodel.cn</a>
            </p>
            {testStatus !== 'idle' && (
              <p className="flex items-center gap-1.5 text-xs mt-2" style={{ color: testStatus === 'ok' ? 'var(--june-success)' : 'var(--june-danger)' }}>
                {testStatus === 'ok' ? <CheckCircle size={13} /> : <XCircle size={13} />}
                <span className="break-all">{testMessage}</span>
              </p>
            )}
          </div>
         </div>
 
         <div className="px-5 py-3 border-t flex justify-end" style={{ borderColor: 'var(--june-border)' }}>
           <button
             onClick={handleSave}
             disabled={saving}
             className="px-5 py-2 text-sm rounded-lg transition-all disabled:opacity-50 flex items-center gap-2 font-medium text-white"
             style={{ background: 'linear-gradient(135deg, var(--june-primary), var(--june-accent-2))' }}
           >
             {saving && <Loader2 size={14} className="animate-spin" />}
             完成
           </button>
         </div>
       </div>
     </>
   );
 }
