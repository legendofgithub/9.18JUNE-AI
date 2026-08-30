import { useEffect, useRef, useState } from 'react';
import { Bot, KeyRound, Loader2, Lock, ShieldCheck } from 'lucide-react';
import useCommerceStore from '../../stores/useCommerceStore';
import { AI_TOOL_OPTIONS, MODEL_BASE_URLS } from '../../types';
import type { SiteLanguage } from './SiteHeader';

const copy = {
  zh: {
    title: '超级个体训练师',
    subtitle: '自动装载超级个体训练师 skill，启动 AI 跟踪交付流程。',
    paid: '已解锁',
    unpaid: '未解锁',
    installed: '训练师已装载',
    notInstalled: '待装载',
    keyReady: '密钥已保存',
    keyMissing: '待填写密钥',
    start: '启动超级个体训练师',
    buyStart: '购买后启动',
    buy: '返回首页购买',
    tool: 'AI 工具',
    apiKey: '访问密钥',
    settings: '模型连接设置',
    update: '更新连接并启动',
    hint: '已保存密钥会自动复用；AI 服务费用由你的模型账户承担。',
    focusHint: '请先填写访问密钥。',
  },
  en: {
    title: 'Super-Solo Coach',
    subtitle: 'Automatically load the coach skill and start AI-tracked delivery.',
    paid: 'Unlocked',
    unpaid: 'Locked',
    installed: 'Coach loaded',
    notInstalled: 'Not loaded',
    keyReady: 'Key saved',
    keyMissing: 'Key required',
    start: 'Start Super-Solo Coach',
    buyStart: 'Buy to start',
    buy: 'Buy on home page',
    tool: 'AI tool',
    apiKey: 'API key',
    settings: 'Model connection settings',
    update: 'Update and start',
    hint: 'Saved keys are reused automatically. AI usage is billed to your model account.',
    focusHint: 'Enter your API key first.',
  },
};

export default function CoachLaunchPanel({ language }: { language: SiteLanguage }) {
  const text = copy[language];
  const status = useCommerceStore(s => s.coachStatus);
  const isBusy = useCommerceStore(s => s.isBusy);
  const error = useCommerceStore(s => s.error);
  const clearError = useCommerceStore(s => s.clearError);
  const startCoach = useCommerceStore(s => s.startCoach);
  const apiKeyRef = useRef<HTMLInputElement>(null);
  const [showSettings, setShowSettings] = useState(!status?.apiKeyReady);
  const [modelName, setModelName] = useState(status?.modelName || 'glm-5.2');
  const [baseUrl, setBaseUrl] = useState(MODEL_BASE_URLS[status?.modelName || 'glm-5.2'] || '');
  const [apiKey, setApiKey] = useState('');
  const [localHint, setLocalHint] = useState('');

  useEffect(() => {
    if (!status?.apiKeyReady) setShowSettings(true);
  }, [status?.apiKeyReady]);

  useEffect(() => {
    setBaseUrl(MODEL_BASE_URLS[modelName] || '');
  }, [modelName]);

  const handleStart = async () => {
    clearError();
    if (!status?.paid) return;
    if (!status.apiKeyReady && !apiKey.trim()) {
      setShowSettings(true);
      setLocalHint(text.focusHint);
      window.setTimeout(() => apiKeyRef.current?.focus(), 30);
      return;
    }
    setLocalHint('');
    await startCoach(modelName, baseUrl, apiKey.trim());
  };

  return (
    <section className="studio-launch-panel">
      <div className="studio-launch-head">
        <span className="studio-launch-icon">
          <Bot size={24} />
        </span>
        <div>
          <h1>{text.title}</h1>
          <p>{text.subtitle}</p>
        </div>
      </div>

      <div className="studio-status-row">
        <span className={status?.paid ? 'studio-status-chip is-on' : 'studio-status-chip'}>
          {status?.paid ? <ShieldCheck size={13} /> : <Lock size={13} />}
          {status?.paid ? text.paid : text.unpaid}
        </span>
        <span className={status?.skillInstalled ? 'studio-status-chip is-on' : 'studio-status-chip'}>
          <Bot size={13} />
          {status?.skillInstalled ? text.installed : text.notInstalled}
        </span>
        <span className={status?.apiKeyReady ? 'studio-status-chip is-on' : 'studio-status-chip'}>
          <KeyRound size={13} />
          {status?.apiKeyReady ? text.keyReady : text.keyMissing}
        </span>
      </div>

      {showSettings && (
        <div className="studio-settings-form">
          <div>
            <label className="coach-label" htmlFor="coachModel">{text.tool}</label>
            <select
              id="coachModel"
              className="coach-select"
              value={modelName}
              onChange={event => setModelName(event.target.value)}
            >
              {AI_TOOL_OPTIONS.map(option => (
                <option key={option.model} value={option.model}>{option.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="coach-label" htmlFor="coachApiKey">{text.apiKey}</label>
            <input
              id="coachApiKey"
              ref={apiKeyRef}
              className="coach-input"
              type="password"
              value={apiKey}
              onChange={event => setApiKey(event.target.value)}
              autoComplete="off"
            />
          </div>
          <p>{text.hint}</p>
        </div>
      )}

      <button
        type="button"
        className="studio-start-button"
        disabled={!status?.paid || isBusy}
        onClick={() => void handleStart()}
      >
        {isBusy ? <Loader2 size={16} className="animate-spin" /> : <Bot size={16} />}
        {status?.paid ? text.start : text.buyStart}
      </button>
      {!status?.paid && <a className="studio-buy-link" href="#/">{text.buy}</a>}
      {(localHint || error) && <p className="studio-launch-error">{localHint || error}</p>}
    </section>
  );
}
