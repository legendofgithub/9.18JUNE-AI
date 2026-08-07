import { useState, useEffect } from 'react';
import { Settings, FolderOpen, Plus, MessageSquare, Trash2, ChevronDown, Key, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import useJuneStore from '../../stores/useJuneStore';
import { sseService } from '../../services/sseService';

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

  // 页面加载时尝试验证已有 Token
  useEffect(() => {
    const saved = localStorage.getItem('june_api_token');
    if (saved && !tokenValid) {
      verifyToken(saved).then(valid => setTokenValid(valid));
    }
  }, []);

  return (
    <header className="h-12 border-b border-[#1e2d3d] bg-[#0d1520]/80 backdrop-blur-md flex items-center justify-between px-4 shrink-0">
      <div className="flex items-center gap-3">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center text-white font-bold text-sm shadow-[0_0_12px_rgba(0,229,255,0.4)]">
            J
          </div>
          <span className="font-semibold text-[#e8ecf1] text-sm neon-text">June AI 伴学</span>
        </div>

        {/* Token 状态指示 */}
        <div
          className={`flex items-center gap-1 text-xs ${tokenValid ? 'text-green-400' : 'text-orange-400 cursor-pointer'}`}
          onClick={() => !tokenValid && setShowSettings(true)}
          title={tokenValid ? 'API 连接正常' : '点击设置 API Token'}
        >
          {tokenValid ? <CheckCircle size={12} /> : <XCircle size={12} />}
          <span className="hidden sm:inline">{tokenValid ? '已连接' : '未连接'}</span>
        </div>

        {/* 会话切换器 */}
        <div className="relative">
          <button
            onClick={() => setShowSessions(!showSessions)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-[#c8d6e5] hover:bg-[#1a2332] transition-colors"
          >
            <MessageSquare size={14} />
            <span className="max-w-[120px] truncate">
              {currentSession?.title ?? '新建对话'}
            </span>
            <ChevronDown size={12} />
          </button>

          {showSessions && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowSessions(false)} />
              <div className="absolute top-full left-0 mt-1 w-64 bg-[#111827] rounded-xl shadow-xl border border-[#1e2d3d] z-50 py-1">
                <div className="px-3 py-2 border-b border-[#1e2d3d]">
                  <button
                    onClick={() => {
                      createSession();
                      setShowSessions(false);
                    }}
                    className="flex items-center gap-2 text-xs text-[#00e5ff] hover:text-[#00f0ff] w-full"
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
                      className={`flex items-center justify-between px-3 py-2 cursor-pointer text-xs hover:bg-[#1a2332] transition-colors ${
                        session.id === currentSessionId ? 'bg-[#00e5ff]/10 text-[#00e5ff]' : 'text-[#c8d6e5]'
                      }`}
                    >
                      <span className="truncate flex-1">{session.title}</span>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          deleteSession(session.id);
                        }}
                        className="p-0.5 hover:bg-red-500/10 rounded transition-colors ml-2"
                      >
                        <Trash2 size={12} className="text-[#6b7c93] hover:text-red-400" />
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
          className={`p-1.5 rounded-lg transition-colors ${
            isFilePanelOpen
              ? 'bg-[#00e5ff]/10 text-[#00e5ff]'
              : 'text-[#6b7c93] hover:text-[#c8d6e5] hover:bg-[#1a2332]'
          }`}
          title="资料库"
        >
          <FolderOpen size={16} />
        </button>

        {/* 设置 */}
        <button
          onClick={() => setShowSettings(true)}
          className="p-1.5 rounded-lg text-[#6b7c93] hover:text-[#c8d6e5] hover:bg-[#1a2332] transition-colors"
          title="设置"
        >
          <Settings size={16} />
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
  const setApiKey = useJuneStore(s => s.setApiKey);
  const setTokenValid = useJuneStore(s => s.setTokenValid);

  const [apiToken, setApiToken] = useState(() => localStorage.getItem('june_api_token') || '');
  const [tokenStatus, setTokenStatus] = useState<'idle' | 'verifying' | 'ok' | 'fail'>('idle');
  const [saving, setSaving] = useState(false);

  const handleVerifyToken = async () => {
    if (!apiToken.trim()) return;
    setTokenStatus('verifying');
    const ok = await verifyToken(apiToken.trim());
    setTokenStatus(ok ? 'ok' : 'fail');
  };

  const handleSave = async () => {
    setSaving(true);

    // 保存 Token 到 localStorage
    if (apiToken.trim()) {
      localStorage.setItem('june_api_token', apiToken.trim());
      setTokenValid(true);
    }

    // 保存 DeepSeek API Key 到后端
    if (modelConfig.apiKey) {
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        const token = localStorage.getItem('june_api_token');
        if (token) headers['Authorization'] = `Bearer ${token}`;

        await fetch('http://localhost:8000/api/config/api-key', {
          method: 'PUT',
          headers,
          body: JSON.stringify({ name: modelConfig.name, api_key: modelConfig.apiKey }),
        });
      } catch (e) {
        console.error('Failed to save API key:', e);
      }
    }

    setSaving(false);
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 bg-[#111827] rounded-2xl shadow-2xl border border-[#1e2d3d] z-50 max-h-[85vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-[#1e2d3d] flex items-center justify-between">
          <h3 className="font-semibold text-[#e8ecf1]">设置</h3>
          <button onClick={onClose} className="text-[#6b7c93] hover:text-[#c8d6e5] text-sm">✕</button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Token 设置（第一位，最重要） */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <Key size={14} className="text-[#00e5ff]" />
              <label className="text-xs font-medium text-[#c8d6e5]">API 连接 Token</label>
              {tokenStatus === 'ok' && <CheckCircle size={14} className="text-green-500" />}
              {tokenStatus === 'fail' && <XCircle size={14} className="text-red-500" />}
            </div>
            <div className="flex gap-2">
              <input
                type="password"
                value={apiToken}
                onChange={e => { setApiToken(e.target.value); setTokenStatus('idle'); }}
                placeholder="启动后端时终端显示的 Token"
                className="flex-1 rounded-lg border border-[#1e2d3d] bg-[#0a0e17] px-3 py-2 text-sm outline-none focus:border-[#00e5ff]/40 focus:ring-1 focus:ring-[#00e5ff]/20 font-mono text-[#c8d6e5] placeholder:text-[#3d4d5d]"
              />
              <button
                onClick={handleVerifyToken}
                disabled={!apiToken.trim() || tokenStatus === 'verifying'}
                className="px-3 py-2 text-xs bg-[#1a2332] hover:bg-[#1e2d3d] text-[#c8d6e5] rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1"
              >
                {tokenStatus === 'verifying' && <Loader2 size={12} className="animate-spin" />}
                验证
              </button>
            </div>
            <p className="text-xs text-[#3d4d5d] mt-1.5 leading-relaxed">
              后端启动时会在终端打印 Token，复制后粘贴到此处并点击验证。
              验证通过后即可正常使用。
            </p>
            {tokenStatus === 'fail' && (
              <p className="text-xs text-red-500 mt-1">Token 无效，请检查是否正确复制</p>
            )}
          </div>

          {/* 模型选择 */}
          <div>
            <label className="block text-xs font-medium text-[#c8d6e5] mb-1.5">模型</label>
            <select
              value={modelConfig.name}
              onChange={e => setModel(e.target.value)}
              className="w-full rounded-lg border border-[#1e2d3d] bg-[#0a0e17] px-3 py-2 text-sm outline-none focus:border-[#00e5ff]/40 focus:ring-1 focus:ring-[#00e5ff]/20 text-[#c8d6e5]"
            >
              <option value="deepseek-v4-pro">DeepSeek V4 Pro</option>
              <option value="deepseek-v4-flash">DeepSeek V4 Flash</option>
            </select>
          </div>

          {/* DeepSeek API Key */}
          <div>
            <label className="block text-xs font-medium text-[#c8d6e5] mb-1.5">DeepSeek API Key</label>
            <input
              type="password"
              value={modelConfig.apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full rounded-lg border border-[#1e2d3d] bg-[#0a0e17] px-3 py-2 text-sm outline-none focus:border-[#00e5ff]/40 focus:ring-1 focus:ring-[#00e5ff]/20 text-[#c8d6e5] placeholder:text-[#3d4d5d]"
            />
            <p className="text-xs text-[#3d4d5d] mt-1">
              获取 API Key: <a href="https://platform.deepseek.com" target="_blank" rel="noopener noreferrer" className="text-[#00e5ff] hover:underline">platform.deepseek.com</a>
            </p>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-[#1e2d3d] flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 bg-[#00e5ff] text-[#0a0e17] text-sm rounded-lg hover:bg-[#00f0ff] transition-colors disabled:opacity-50 flex items-center gap-2 font-medium"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            完成
          </button>
        </div>
      </div>
    </>
  );
}
