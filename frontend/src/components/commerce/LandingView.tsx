import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Layers,
  Loader2,
  MessageCircleQuestion,
  Repeat2,
  Sparkles,
  Target,
} from 'lucide-react';
import useCommerceStore from '../../stores/useCommerceStore';
import { COMMUNITY_URL } from '../../config';
import { QRCodeSVG } from 'qrcode.react';
import type { SiteLanguage } from './SiteHeader';
import AuthView from './AuthView';

const copy = {
  zh: {
    eyebrow: '免费 · 无限追问 · 自带 AI',
    title: '一层追不完，就再追一层',
    subtitle: 'June AI 超级个体训练师陪你把想法做成可售卖的产品：任意一句话都能继续追问，层级不限；追问的结论一键采纳为交付物，AI 使用费用走你自己的工具账户，产品完全免费。',
    secondaryCta: '了解无限追问',
    productTitle: '为什么是无限追问',
    productLead: '别人教你一次听懂，我们陪你问到懂为止',
    features: [
      { title: '层级不限的追问', body: '对任何一句话继续追问，线程像树枝一样层层生长，没有次数和层级上限。' },
      { title: '越问越聚焦的记忆', body: '近层保留原文、远层自动压缩成结论，链条再长也不会失忆，更不会撑爆上下文。' },
      { title: '结论落地为交付物', body: '追问出结果不是终点：一键采纳，写入当前节点的交付物，聊过的每一步都算数。' },
    ],
    workflowTitle: '追问所服务的 10 节点商业路径',
    workflow: ['人群与痛点', '可售卖结果', '商业需求简报', '产品形态', '第一版 MVP', '迭代试用', '报价收款', '获客名单', '首次交付', '复盘迭代'],
    studio: '模型服务',
    accountTitle: '账户状态',
    freeBadge: '免费使用 · 无限追问',
    enterStudio: '进入模型服务',
    aboutTitle: '关于我们',
    about: 'OPC 团队能在这条路上受益，靠的不是赌对了什么，而是顺势借到了一股时代大势所趋——AI 正在把创造与变现的能力交回给每一个普通人。我们只是把超级个体的能力沉淀成可复制的训练流程，被这股大势托着往前走；愿意参与、愿意行动的个体，也自然会被它一并托起。',
    stats: [
      { value: '∞', label: '追问层级' },
      { value: '10', label: '必修商业节点' },
      { value: 'BYOK', label: '自带模型密钥' },
      { value: '¥0', label: '完全免费' },
    ],
  },
  en: {
    eyebrow: 'Free · Unlimited follow-ups · BYOK',
    title: 'Ask again. And again. As deep as you need.',
    subtitle: 'The June AI Super-Solo Coach helps you turn an idea into a sellable product: follow up on any sentence, unlimited levels; adopt conclusions as deliverables in one click; AI usage runs on your own account — the product is completely free.',
    secondaryCta: 'See unlimited follow-ups',
    productTitle: 'Why unlimited follow-ups',
    productLead: 'Others explain once; we stay until you get it',
    features: [
      { title: 'Unlimited depth', body: 'Follow up on any sentence; threads branch like a tree with no caps on count or depth.' },
      { title: 'Memory that stays sharp', body: 'Recent layers keep full text, distant layers compress into conclusions — long chains never lose the plot.' },
      { title: 'Conclusions become deliverables', body: 'A follow-up answer is not the end: adopt it in one click into the current step’s artifact.' },
    ],
    workflowTitle: 'The 10-step path your questions serve',
    workflow: ['Buyers & pains', 'Sellable outcome', 'Business brief', 'Product shape', 'First MVP', 'Iteration', 'Pricing', 'Acquisition', 'First delivery', 'Review'],
    studio: 'Model Studio',
    accountTitle: 'Account',
    freeBadge: 'Free · Unlimited follow-ups',
    enterStudio: 'Open Model Studio',
    aboutTitle: 'About Us',
    about: 'The OPC team’s gains here came not from betting right, but from riding an inevitable tide of the era — AI is returning the power to create and earn to ordinary people. We simply codified super-solo capability into a repeatable training flow, carried forward by that tide; those who join and act get lifted by it too.',
    stats: [
      { value: '∞', label: 'follow-up levels' },
      { value: '10', label: 'required steps' },
      { value: 'BYOK', label: 'bring your own model key' },
      { value: '$0', label: 'completely free' },
    ],
  },
};

interface LandingViewProps {
  language: SiteLanguage;
  onEnterStudio: () => void;
}

const FEATURE_ICONS = [Layers, MessageCircleQuestion, Repeat2];

/** 绿白相间的流苏垂帘装饰：铺满整条基准线，鼠标划过时被拨动 */
function HomeTassels() {
  const rowRef = useRef<HTMLDivElement>(null);
  const tasselRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [count, setCount] = useState(10);

  // 按容器宽度计算铺满数量，再左右两侧各去掉 4 根（共减 8）
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const measure = () => {
      setCount(Math.max(4, Math.min(40, Math.round(row.clientWidth / 35) - 8)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  // 指针划过：靠近指针的流苏被拨开，越近拨得越狠；远离则缓缓回正
  const deflect = (event: React.PointerEvent<HTMLDivElement>) => {
    const row = rowRef.current;
    if (!row) return;
    const rect = row.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    for (let i = 0; i < count; i++) {
      const el = tasselRefs.current[i];
      if (!el) continue;
      const centerX = el.offsetLeft + el.offsetWidth / 2;
      const dx = centerX - pointerX;
      const distance = Math.abs(dx);
      if (distance > 110) {
        el.style.transition = 'transform 0.3s ease-out';
        el.style.transform = 'rotate(0deg)';
        continue;
      }
      const angle = Math.max(-1, Math.min(1, dx / 45)) * 24;
      el.style.transition = 'transform 0.1s ease-out';
      el.style.transform = `rotate(${angle.toFixed(2)}deg)`;
    }
  };

  // 指针离开：全部弹性回弹（带过冲的弹簧曲线）
  const release = () => {
    for (const el of tasselRefs.current) {
      if (!el) continue;
      el.style.transition = 'transform 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)';
      el.style.transform = 'rotate(0deg)';
    }
  };

  return (
    <div
      className="home-tassel-valance"
      ref={rowRef}
      aria-hidden="true"
      onPointerMove={deflect}
      onPointerLeave={release}
    >
      <span className="home-tassel-rod" />
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className="home-tassel"
          ref={el => { tasselRefs.current[i] = el; }}
        >
          <span className="home-tassel-sway">
            <svg viewBox="0 0 24 130" width="26" height="141" fill="none">
              <rect x="11.2" y="0" width="1.6" height="14" rx="0.8" fill="#8b90a0" />
              <circle cx="12" cy="18" r="4.6" fill="#0f766e" />
              <rect x="6.4" y="24" width="11.2" height="9" rx="2.4" fill="#0f766e" />
              <rect x="6.6" y="33" width="1.8" height="80" rx="0.9" fill="#0f766e" />
              <rect x="8.8" y="33" width="1.8" height="96" rx="0.9" fill="#ffffff" />
              <rect x="11" y="33" width="1.8" height="96" rx="0.9" fill="#0f766e" />
              <rect x="13.2" y="33" width="1.8" height="96" rx="0.9" fill="#ffffff" />
              <rect x="15.4" y="33" width="1.8" height="96" rx="0.9" fill="#0f766e" />
              <rect x="17.6" y="33" width="1.8" height="80" rx="0.9" fill="#ffffff" />
            </svg>
          </span>
        </span>
      ))}
    </div>
  );
}

export default function LandingView({ language, onEnterStudio }: LandingViewProps) {
  const user = useCommerceStore(s => s.user);
  const isBusy = useCommerceStore(s => s.isBusy);
  const error = useCommerceStore(s => s.error);
  const clearError = useCommerceStore(s => s.clearError);
  const text = copy[language];

  return (
    <main className="site-home">
      <section className="home-hero">
        <div className="home-hero-inner">
          <div className="home-hero-copy">
            <span className="home-eyebrow">
              <Sparkles size={14} />
              {text.eyebrow}
            </span>
            <h1>{text.title}</h1>
            <p>{text.subtitle}</p>
            <div className="home-hero-actions">
              {user ? (
                <button type="button" className="site-primary-link" onClick={onEnterStudio}>
                  {text.enterStudio}
                  <ArrowRight size={15} />
                </button>
              ) : (
                <a className="site-ghost-link" href="#product-intro">
                  {text.secondaryCta}
                  <ArrowRight size={15} />
                </a>
              )}
            </div>
          </div>

          <aside className="home-auth-column" aria-label={language === 'zh' ? '账号' : 'Account'}>
            {!user ? (
              <AuthView language={language} />
            ) : (
              <div className="coach-card p-5">
                <h2>{text.accountTitle}</h2>
                <p className="home-account-name">{user.displayName || user.account}</p>
                <p className="home-path-count">
                  {text.freeBadge}
                </p>
                <button type="button" className="site-primary-link w-full" onClick={onEnterStudio} disabled={isBusy}>
                  {isBusy && <Loader2 size={15} className="animate-spin" />}
                  <ArrowRight size={15} />
                  {text.enterStudio}
                </button>
              </div>
            )}
          </aside>
        </div>
      </section>

      <section id="product-intro" className="home-section home-product-intro">
        <HomeTassels />
        <div className="home-section-inner">
          <span className="home-section-label">
            <Target size={15} />
            {text.productTitle}
          </span>
          <h2>{text.productLead}</h2>
          <div className="home-feature-grid">
            {text.features.map((feature, index) => {
              const Icon = FEATURE_ICONS[index] ?? BadgeCheck;
              return (
                <article key={feature.title} className="home-feature-card">
                  <Icon size={18} />
                  <h3>{feature.title}</h3>
                  <p>{feature.body}</p>
                </article>
              );
            })}
          </div>

          <div className="home-product-visual">
            <video
              src="/hero-video.mp4"
              poster="/hero-platform.png"
              autoPlay
              loop
              muted
              playsInline
              preload="auto"
              aria-label="June AI model service workspace"
            />
          </div>

          <div className="home-workflow">
            <h3>{text.workflowTitle}</h3>
            <ol>
              {text.workflow.map((item, index) => (
                <li key={item}><span>{String(index + 1).padStart(2, '0')}</span>{item}</li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section id="community" className="home-section home-pricing">
        <div className="home-section-inner">
          <div className="home-pricing-grid">
            <article className="home-price-card home-community-card" aria-label={language === 'zh' ? '社群入口' : 'Community entry'}>
              <span>{language === 'zh' ? '免费加入' : 'Join for free'}</span>
              <strong className="home-community-title">
                {language === 'zh' ? '使用者社群' : 'Community'}
              </strong>
              <div className="home-qr-code" aria-label={language === 'zh' ? '社群二维码' : 'Community QR code'}>
                <QRCodeSVG value={COMMUNITY_URL} size={132} level="M" marginSize={1} />
              </div>
              <p>
                {language === 'zh'
                  ? '扫码进入使用者社群，获取同步更新和使用交流支持。'
                  : 'Scan to open the community entry for updates and peer support.'}
              </p>
            </article>
          </div>
        </div>
      </section>

      <section id="about" className="home-about">
        <div className="home-section-inner">
          <span className="home-section-label"><Sparkles size={15} />{text.aboutTitle}</span>
          <p>{text.about}</p>
          <div className="home-stat-grid">
            {text.stats.map(stat => (
              <div key={stat.label}><strong>{stat.value}</strong><span>{stat.label}</span></div>
            ))}
          </div>
        </div>
      </section>

      {error && (
        <div className="home-error">
          <AlertTriangle size={16} />
          <p>{error}</p>
          <button onClick={clearError}>×</button>
        </div>
      )}
    </main>
  );
}
