import { useState } from 'react';
import { Sparkles, MousePointerClick, Layers, Lightbulb, X, ChevronRight } from 'lucide-react';
import useJuneStore from '../stores/useJuneStore';

const STEPS = [
  {
    icon: Sparkles,
    title: 'June AI',
    subtitle: '你的 AI 伴学伙伴',
    description: '我在这里陪你一起探索知识的奥秘。\n没有笨问题，只有还没问出口的好奇心。',
  },
  {
    icon: MousePointerClick,
    title: '选中即追问',
    subtitle: '无限追问，层层深入',
    description: '选中 AI 回复中的任意文字，右键点击，\n就能在同一页面打开追问窗口，持续深入探索。',
  },
  {
    icon: Layers,
    title: '讲解模式',
    subtitle: '通俗 · 标准 · 进阶',
    description: '每条 AI 回复下方都能切换讲解深度。\n听不懂就切通俗，想深挖就切进阶。',
  },
];

export default function WelcomeOverlay() {
  const [step, setStep] = useState(0);
  const dismissWelcome = useJuneStore(s => s.dismissWelcome);
  const current = STEPS[step];
  const Icon = current.icon;
  const isLast = step === STEPS.length - 1;

  const handleNext = () => {
    if (isLast) {
      dismissWelcome();
    } else {
      setStep(s => s + 1);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center animate-fade-in"
      style={{ background: 'rgba(45, 49, 66, 0.35)', backdropFilter: 'blur(6px)' }}
    >
      <div
        className="relative w-[420px] max-w-[90vw] rounded-3xl p-8 animate-slide-up card-shadow-lg"
        style={{ background: 'var(--june-surface)', border: '1px solid var(--june-border)' }}
      >
        <button
          onClick={dismissWelcome}
          className="absolute top-4 right-4 p-1.5 rounded-lg transition-colors"
          style={{ color: 'var(--june-text-dim)' }}
        >
          <X size={18} />
        </button>

        <div className="flex flex-col items-center text-center">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5"
            style={{ background: 'linear-gradient(135deg, var(--june-primary), var(--june-accent-2))' }}
          >
            <Icon size={28} className="text-white" />
          </div>

          <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--june-text-bright)' }}>
            {current.title}
          </h2>
          <p className="text-sm mb-4 gradient-text font-medium">
            {current.subtitle}
          </p>
          <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: 'var(--june-text-dim)' }}>
            {current.description}
          </p>

          {step === 1 && (
            <div className="flex items-center gap-2 mt-5 px-4 py-3 rounded-xl" style={{ background: 'var(--june-surface-alt)' }}>
              <span className="text-xs px-2 py-1 rounded-md" style={{ background: 'var(--june-primary-light)', color: 'var(--june-primary)' }}>
                选中文字
              </span>
              <ChevronRight size={14} style={{ color: 'var(--june-text-dim)' }} />
              <span className="text-xs px-2 py-1 rounded-md" style={{ background: 'var(--june-primary-light)', color: 'var(--june-primary)' }}>
                右键
              </span>
              <ChevronRight size={14} style={{ color: 'var(--june-text-dim)' }} />
              <span className="text-xs px-2 py-1 rounded-md" style={{ background: 'var(--june-primary-light)', color: 'var(--june-primary)' }}>
                追问
              </span>
            </div>
          )}

          {step === 2 && (
            <div className="flex items-center gap-2 mt-5">
              {['通俗', '标准', '进阶'].map((label, i) => (
                <span
                  key={label}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium transition-all"
                  style={{
                    background: i === 1 ? 'linear-gradient(135deg, var(--june-primary), var(--june-accent-2))' : 'var(--june-surface-alt)',
                    color: i === 1 ? '#fff' : 'var(--june-text-dim)',
                  }}
                >
                  {label}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between mt-7">
          <div className="flex gap-1.5">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className="rounded-full transition-all"
                style={{
                  width: i === step ? '20px' : '6px',
                  height: '6px',
                  background: i === step ? 'linear-gradient(135deg, var(--june-primary), var(--june-accent-2))' : 'var(--june-border)',
                }}
              />
            ))}
          </div>

          <button
            onClick={handleNext}
            className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-medium text-white transition-all card-shadow"
            style={{ background: 'linear-gradient(135deg, var(--june-primary), var(--june-accent-2))' }}
          >
            {isLast ? (
              <>
                <Lightbulb size={15} />
                开始学习
              </>
            ) : (
              <>
                下一步
                <ChevronRight size={15} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
