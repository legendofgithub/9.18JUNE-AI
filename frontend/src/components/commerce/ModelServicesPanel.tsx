import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, Circle, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import useCommerceStore from '../../stores/useCommerceStore';
import type { ModelEntryConfig, ModelServiceConfig } from '../../types';

type Draft = {
  id: string;
  displayName: string;
  vendor: string;
  baseUrl: string;
  protocol: ModelServiceConfig['protocol'];
  apiKey: string;
  version: number;
  models: ModelEntryConfig[];
};

// 常用供应商预设：非技术用户只需“选工具 + 填密钥”，端点与协议自动带好
const PRESET_PROVIDERS: { id: string; label: string; baseUrl: string; protocol: ModelServiceConfig['protocol']; modelId: string; modelName: string }[] = [
  { id: 'zhipu', label: '智谱 GLM（Zhipu）', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', protocol: 'openai-compatible', modelId: 'glm-5.2', modelName: 'GLM-5.2' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', protocol: 'openai-compatible', modelId: 'deepseek-chat', modelName: 'DeepSeek Chat' },
  { id: 'openai', label: 'OpenAI 兼容', baseUrl: 'https://api.openai.com/v1', protocol: 'openai-compatible', modelId: 'gpt-4o', modelName: 'GPT-4o' },
  { id: 'moonshot', label: 'Moonshot Kimi', baseUrl: 'https://api.moonshot.cn/v1', protocol: 'openai-compatible', modelId: 'moonshot-v1-128k', modelName: 'Kimi 128K' },
  { id: 'qwen', label: '通义千问 Qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', protocol: 'openai-compatible', modelId: 'qwen-plus', modelName: 'Qwen Plus' },
  { id: 'custom', label: '自定义（OpenAI 兼容）', baseUrl: '', protocol: 'openai-compatible', modelId: '', modelName: '' },
];

const emptyModel = (): ModelEntryConfig => ({
  id: '',
  modelId: '',
  displayName: '',
  contextTokens: 128000,
  maxOutputTokens: 4096,
  reasoning: 'medium',
});

const emptyDraft = (): Draft => ({
  id: '',
  displayName: '',
  vendor: 'Custom',
  baseUrl: '',
  protocol: 'openai-compatible',
  apiKey: '',
  version: 0,
  models: [emptyModel()],
});

function applyPreset(draft: Draft, presetId: string): Draft {
  const preset = PRESET_PROVIDERS.find(item => item.id === presetId);
  if (!preset) return draft;
  return {
    ...draft,
    id: preset.id,
    vendor: preset.id === 'custom' ? 'Custom' : preset.id,
    displayName: draft.displayName || preset.label,
    baseUrl: preset.baseUrl,
    protocol: preset.protocol,
    models: [{ ...emptyModel(), modelId: preset.modelId, displayName: preset.modelName }],
  };
}

function toDraft(service: ModelServiceConfig): Draft {
  return {
    id: service.id,
    displayName: service.displayName,
    vendor: service.vendor,
    baseUrl: service.baseUrl,
    protocol: service.protocol,
    apiKey: '',
    version: service.version,
    models: service.models.map(model => ({ ...model })),
  };
}

function parseTokens(value: string) {
  const match = value.trim().toUpperCase().match(/^(\d+(?:\.\d+)?)(K|M)?$/);
  if (!match) return NaN;
  return Math.round(Number(match[1]) * (match[2] === 'M' ? 1_000_000 : match[2] === 'K' ? 1000 : 1));
}

function formatTokens(value: number) {
  return value >= 1_000_000 ? `${value / 1_000_000}M` : `${Math.round(value / 1000)}K`;
}

export default function ModelServicesPanel() {
  const services = useCommerceStore(s => s.modelServices);
  const selectedModel = useCommerceStore(s => s.selectedModel);
  const isBusy = useCommerceStore(s => s.isBusy);
  const save = useCommerceStore(s => s.saveModelService);
  const remove = useCommerceStore(s => s.deleteModelService);
  const discover = useCommerceStore(s => s.discoverModels);
  const activate = useCommerceStore(s => s.activateModel);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [newDraft, setNewDraft] = useState<Draft | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [candidates, setCandidates] = useState<Record<string, any[]>>({});

  useEffect(() => {
    if (!expanded) return;
    const service = services.find(item => item.id === expanded);
    if (service && !drafts[expanded]) setDrafts(current => ({ ...current, [expanded]: toDraft(service) }));
  }, [expanded, services, drafts]);

  const totalModels = useMemo(
    () => services.reduce((sum, service) => sum + service.models.length, 0),
    [services],
  );

  const patchDraft = (id: string, patch: Partial<Draft>) => {
    setDrafts(current => ({ ...current, [id]: { ...current[id], ...patch } }));
  };

  const patchModel = (draftId: string, index: number, patch: Partial<ModelEntryConfig>) => {
    setDrafts(current => ({
      ...current,
      [draftId]: {
        ...current[draftId],
        models: current[draftId].models.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
      },
    }));
  };

  const apply = async (draft: Draft, serviceId?: string) => {
    const payload = {
      id: draft.id,
      display_name: draft.displayName,
      vendor: draft.vendor,
      base_url: draft.baseUrl,
      protocol: draft.protocol,
      api_key: draft.apiKey,
      version: draft.version,
      models: draft.models.map(model => ({
        id: model.id,
        model_id: model.modelId,
        display_name: model.displayName,
        context_tokens: model.contextTokens,
        max_output_tokens: model.maxOutputTokens,
        reasoning: model.reasoning,
      })),
    };
    const saved = await save(payload, serviceId);
    if (saved) {
      setExpanded(null);
      setNewDraft(null);
      setCandidates({});
    }
  };

  const discoverNow = async (draft: Draft, serviceId: string) => {
    setDiscovering(true);
    const found = await discover(serviceId, draft.baseUrl, draft.apiKey);
    if (found) setCandidates(current => ({ ...current, [serviceId]: found }));
    setDiscovering(false);
  };

  return (
    <section className="model-services-panel">
      <header className="model-services-header">
        <div>
          <h2>连接你的 AI 助手</h2>
          <p>选择一家服务商并填入密钥，AI 伴学助手就能开始对话。{services.length} 个服务 · {totalModels} 个模型</p>
        </div>
        <button type="button" className="studio-secondary-button" onClick={() => setNewDraft(emptyDraft())}>
          <Plus size={14} /> 连接新助手
        </button>
      </header>

      <div className="model-service-list">
        {services.map(service => (
          <article key={service.id}>
            <button
              type="button"
              className="model-service-row"
              onClick={() => setExpanded(expanded === service.id ? null : service.id)}
            >
              <span className="model-service-name">
                <strong>{service.displayName}</strong>
                <small>{service.vendor}</small>
              </span>
              <span className="model-service-meta">
                <small>{service.models.length} 模型</small>
                <small className={service.apiKeyReady ? 'text-ready' : 'text-muted'}>{service.apiKeyReady ? '已连接' : '待填密钥'}</small>
              </span>
              <ChevronDown size={16} className={expanded === service.id ? 'rotate-180' : ''} />
            </button>

            {expanded === service.id && drafts[service.id] && (
              <div
                className="model-edit-card"
                tabIndex={-1}
                onKeyDown={event => {
                  if (event.key === 'Escape') setExpanded(null);
                  if (event.key === 'Enter' && (event.target as HTMLElement).tagName === 'INPUT') {
                    event.preventDefault();
                    void apply(drafts[service.id], service.id);
                  }
                }}
              >
                {/* 主区：非技术用户只需填密钥 */}
                <div className="model-edit-grid">
                  <label>API Key（只写）
                    <input type="password" value={drafts[service.id].apiKey} placeholder={service.apiKeyReady ? '已保存，留空保持' : '粘贴你的密钥'} onChange={event => patchDraft(service.id, { apiKey: event.target.value })} />
                  </label>
                  <label>助手名称
                    <input value={drafts[service.id].displayName} placeholder="例如：我的 DeepSeek" onChange={event => patchDraft(service.id, { displayName: event.target.value })} />
                  </label>
                </div>

                {/* 高级设置：端点 / 协议 / 模型明细，默认收起 */}
                <details className="advanced-settings">
                  <summary>高级设置（端点、协议、模型）</summary>
                  <div className="model-edit-grid">
                    <label>BaseURL 端点
                      <input value={drafts[service.id].baseUrl} placeholder="https://" onChange={event => patchDraft(service.id, { baseUrl: event.target.value })} />
                    </label>
                    <label>通信协议
                      <select value={drafts[service.id].protocol} onChange={event => patchDraft(service.id, { protocol: event.target.value as ModelServiceConfig['protocol'] })}>
                        <option value="openai-compatible">OpenAI 兼容</option>
                        <option value="native">原生</option>
                        <option value="custom">自定义</option>
                      </select>
                    </label>
                  </div>

                  <div className="model-entry-list">
                    {drafts[service.id].models.map((model, index) => (
                      <div key={model.id || index} className="model-entry-row">
                        <input value={model.modelId} placeholder="模型 ID" onChange={event => patchModel(service.id, index, { modelId: event.target.value })} />
                        <input value={model.displayName} placeholder="显示名" onChange={event => patchModel(service.id, index, { displayName: event.target.value })} />
                        <input defaultValue={formatTokens(model.contextTokens)} placeholder="上下文" onChange={event => {
                          const value = parseTokens(event.target.value);
                          if (Number.isFinite(value)) patchModel(service.id, index, { contextTokens: value });
                        }} />
                        <input type="number" value={model.maxOutputTokens} onChange={event => patchModel(service.id, index, { maxOutputTokens: Number(event.target.value) })} />
                        <select value={model.reasoning} onChange={event => patchModel(service.id, index, { reasoning: event.target.value as ModelEntryConfig['reasoning'] })}>
                          <option value="low">低</option>
                          <option value="medium">中</option>
                          <option value="high">高</option>
                        </select>
                        <button type="button" onClick={() => patchDraft(service.id, { models: drafts[service.id].models.filter((_, i) => i !== index) })}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="model-entry-actions">
                    <button type="button" onClick={() => patchDraft(service.id, { models: [...drafts[service.id].models, emptyModel()] })}>
                      <Plus size={14} /> 添加模型
                    </button>
                    <button type="button" disabled={isBusy || discovering} onClick={() => void discoverNow(drafts[service.id], service.id)}>
                      {discovering ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} 从服务端获取模型
                    </button>
                  </div>

                  {candidates[service.id]?.length > 0 && (
                    <div className="candidate-models">
                      {candidates[service.id].map(item => (
                        <label key={item.modelId}>
                          <input type="checkbox" onChange={event => {
                            if (!event.target.checked) return;
                            patchDraft(service.id, {
                              models: [...drafts[service.id].models, {
                                ...emptyModel(),
                                modelId: item.modelId,
                                displayName: item.displayName || item.modelId,
                              }],
                            });
                          }} />
                          {item.displayName || item.modelId}
                        </label>
                      ))}
                    </div>
                  )}
                </details>

                <footer className="model-edit-footer">
                  <button type="button" className="danger" onClick={() => {
                    if (window.confirm(`确认移除 ${service.displayName}？`)) {
                      void remove(service.id);
                      setExpanded(null);
                    }
                  }}>移除</button>
                  <span>
                    {service.apiKeyReady && (
                      <button type="button" disabled={isBusy} onClick={() => void activate(service.id, service.models[0]?.modelId || '')}>
                        <CheckCircle2 size={14} /> 设为当前助手
                      </button>
                    )}
                    <button type="button" onClick={() => setExpanded(null)}>取消</button>
                    <button type="button" className="primary" disabled={isBusy || discovering} onClick={() => void apply(drafts[service.id], service.id)}>
                      {isBusy ? '应用中…' : '应用'}
                    </button>
                  </span>
                </footer>
              </div>
            )}
          </article>
        ))}
      </div>

      {newDraft && (
        <div
          className="model-edit-card create-card"
          tabIndex={-1}
          onKeyDown={event => {
            if (event.key === 'Escape') setNewDraft(null);
            if (event.key === 'Enter' && (event.target as HTMLElement).tagName === 'INPUT') {
              event.preventDefault();
              void apply(newDraft);
            }
          }}
        >
          <h3>连接新助手</h3>
          <p className="create-hint">第一步：选一家服务商；第二步：粘贴你的密钥。其余设置默认就好。</p>

          {/* 选工具 */}
          <label className="preset-select-label">选择服务商
            <select
              value={newDraft.vendor === 'Custom' ? 'custom' : newDraft.vendor}
              onChange={event => setNewDraft(applyPreset(newDraft, event.target.value))}
            >
              {PRESET_PROVIDERS.map(item => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </label>

          {/* 主区：名称 + 密钥 */}
          <div className="model-edit-grid">
            <label>助手名称
              <input value={newDraft.displayName} placeholder="例如：我的 DeepSeek" onChange={event => setNewDraft({ ...newDraft, displayName: event.target.value })} />
            </label>
            <label>API Key（只写）
              <input type="password" value={newDraft.apiKey} placeholder="粘贴你的密钥" onChange={event => setNewDraft({ ...newDraft, apiKey: event.target.value })} />
            </label>
          </div>

          {/* 高级设置：路由 ID / 端点 / 协议 / 模型明细 */}
          <details className="advanced-settings">
            <summary>高级设置（端点、协议、模型）</summary>
            <div className="model-edit-grid">
              <label>路由 ID<input value={newDraft.id} onChange={event => setNewDraft({ ...newDraft, id: event.target.value })} /></label>
              <label>端点<input value={newDraft.baseUrl} placeholder="https://" onChange={event => setNewDraft({ ...newDraft, baseUrl: event.target.value })} /></label>
            </div>
            <div className="model-entry-list">
              {newDraft.models.map((model, index) => (
                <div key={index} className="model-entry-row">
                  <input value={model.modelId} placeholder="模型 ID" onChange={event => setNewDraft({
                    ...newDraft,
                    models: newDraft.models.map((item, i) => i === index ? { ...item, modelId: event.target.value } : item),
                  })} />
                  <input value={model.displayName} placeholder="显示名" onChange={event => setNewDraft({
                    ...newDraft,
                    models: newDraft.models.map((item, i) => i === index ? { ...item, displayName: event.target.value } : item),
                  })} />
                </div>
              ))}
            </div>
          </details>

          <footer className="model-edit-footer">
            <button type="button" onClick={() => setNewDraft(null)}>取消</button>
            <span>
              <button type="button" className="primary" disabled={isBusy || !newDraft.id || !newDraft.apiKey || !newDraft.models[0].modelId} onClick={() => void apply(newDraft)}>
                {isBusy ? '连接中…' : '连接'}
              </button>
            </span>
          </footer>
        </div>
      )}

      <div className="selected-model-hint">
        {selectedModel ? <><CheckCircle2 size={14} /> 当前助手 {selectedModel}</> : <><Circle size={14} /> 未选择助手</>}
      </div>
    </section>
  );
}
