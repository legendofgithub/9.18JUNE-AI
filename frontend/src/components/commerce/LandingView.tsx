import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CreditCard,
  ExternalLink,
  Loader2,
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
    eyebrow: 'Vibe Coding 商业路径',
    title: '把 AI 变成可交付、可售卖的生产力',
    subtitle: 'June AI 面向零基础商业者，用自然语言推进 10 个关键动作：付费人群、可售卖结果、第一版 MVP、报价获客、首次交付与复盘。',
    secondaryCta: '查看套餐',
    productTitle: '产品介绍',
    productLead: '一位超级个体训练师，一条商业闭环路径',
    features: [
      { title: '商业目标先行', body: '从愿意付费的人群和痛点开始，而不是从技术栈开始。' },
      { title: '自然语言造产品', body: '用“用户看到什么、点什么、得到什么”描述 MVP，由 AI 完成实现。' },
      { title: '交付可验收', body: '每个节点都有客观交付物，完成后归档，形成可复盘资产。' },
    ],
    workflowTitle: '10 节点商业 MVP 路径',
    workflow: ['人群与痛点', '可售卖结果', '商业需求简报', '产品形态', '第一版 MVP', '迭代试用', '报价收款', '获客名单', '首次交付', '复盘迭代'],
    pricingTitle: '购买解锁',
    pricingNote: '一次性解锁超级个体训练师；产品承诺确定性交付物，不承诺收入。',
    purchase: '购买产品',
    studio: '模型服务',
    accountTitle: '账户状态',
    unlockStatus: '训练师权限',
    enterStudio: '进入模型服务',
    payTitle: '确认支付',
    merchantOrder: '商户单号',
    transaction: '沙箱流水号',
    confirm: '确认到账',
    callback: '支付完成后即可启动超级个体训练师。',
    payOnline: '打开 Stripe 支付',
    aboutTitle: '关于我们',
    about: 'OPC 团队能在这条路上受益，靠的不是赌对了什么，而是顺势借到了一股时代大势所趋——AI 正在把创造与变现的能力交回给每一个普通人。我们只是把超级个体的能力沉淀成可复制的训练流程，被这股大势托着往前走；愿意参与、愿意行动的个体，也自然会被它一并托起。',
    stats: [
      { value: '10', label: '必修商业节点' },
      { value: 'BYOK', label: '自带模型密钥' },
      { value: '39元', label: '一次性解锁' },
    ],
  },
  en: {
    eyebrow: 'Vibe Coding Business Path',
    title: 'Turn AI into deliverable, sellable productivity',
    subtitle: 'June AI guides non-technical founders through ten commercial actions: buyers, sellable outcomes, first MVP, pricing, acquisition, delivery, and review.',
    secondaryCta: 'View plans',
    productTitle: 'Products',
    productLead: 'One coach, one complete commercial loop',
    features: [
      { title: 'Business first', body: 'Start from paying customers and urgent pains, not technology stacks.' },
      { title: 'Build by language', body: 'Describe what users see, click, and receive; AI handles the implementation.' },
      { title: 'Verifiable delivery', body: 'Every step has an objective artifact and becomes a reusable asset.' },
    ],
    workflowTitle: '10-step commercial MVP path',
    workflow: ['Buyers & pains', 'Sellable outcome', 'Business brief', 'Product shape', 'First MVP', 'Iteration', 'Pricing', 'Acquisition', 'First delivery', 'Review'],
    pricingTitle: 'Unlock',
    pricingNote: 'One-time unlock for the Super-Solo Coach persona. June sells deterministic deliverables, never income guarantees.',
    purchase: 'Buy Product',
    studio: 'Model Studio',
    accountTitle: 'Account',
    unlockStatus: 'Coach access',
    enterStudio: 'Open Model Studio',
    payTitle: 'Confirm payment',
    merchantOrder: 'Merchant order',
    transaction: 'Sandbox transaction ID',
    confirm: 'Confirm payment',
    callback: 'Start the Super-Solo Coach after payment succeeds.',
    payOnline: 'Open Stripe Checkout',
    aboutTitle: 'About Us',
    about: 'The OPC team’s gains here came not from betting right, but from riding an inevitable tide of the era — AI is returning the power to create and earn to ordinary people. We simply codified super-solo capability into a repeatable training flow, carried forward by that tide; those who join and act get lifted by it too.',
    stats: [
      { value: '10', label: 'required steps' },
      { value: 'BYOK', label: 'bring your own model key' },
      { value: '¥39', label: 'one-time unlock' },
    ],
  },
};

interface LandingViewProps {
  language: SiteLanguage;
  onEnterStudio: () => void;
}

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
  const products = useCommerceStore(s => s.products);
  const coachStatus = useCommerceStore(s => s.coachStatus);
  const lastOrder = useCommerceStore(s => s.lastOrder);
  const isBusy = useCommerceStore(s => s.isBusy);
  const error = useCommerceStore(s => s.error);
  const confirmOrder = useCommerceStore(s => s.confirmOrder);
  const refreshOrderStatus = useCommerceStore(s => s.refreshOrderStatus);
  const clearError = useCommerceStore(s => s.clearError);
  const text = copy[language];
  const [transactionId, setTransactionId] = useState('');

  useEffect(() => {
    if (lastOrder?.status === 'pending') setTransactionId(`SANDBOX-${lastOrder.providerOrderId}`);
  }, [lastOrder]);

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
              <a className="site-ghost-link" href="#pricing">
                {text.secondaryCta}
                <ArrowRight size={15} />
              </a>
            </div>
          </div>

          <aside className="home-auth-column" aria-label={language === 'zh' ? '账号与购买' : 'Account and purchase'}>
            {!user ? (
              <AuthView language={language} />
            ) : lastOrder?.status === 'pending' ? (
              <div className="coach-card p-5">
                <h2>{text.payTitle}</h2>
                <dl className="home-order-meta">
                  <div>
                    <dt>{text.merchantOrder}</dt>
                    <dd>{lastOrder.providerOrderId}</dd>
                  </div>
                  <div>
                    <dt>{language === 'zh' ? '商品' : 'Product'}</dt>
                    <dd>{lastOrder.productName}</dd>
                  </div>
                </dl>
                {lastOrder.sandbox ? (
                  <>
                    <label className="coach-label mt-4" htmlFor="transactionId">{text.transaction}</label>
                    <input id="transactionId" className="coach-input" value={transactionId} onChange={event => setTransactionId(event.target.value)} />
                    <button className="coach-primary-button w-full mt-3" disabled={isBusy || !transactionId.trim()} onClick={() => void confirmOrder(transactionId.trim())}>
                      {isBusy && <Loader2 size={15} className="animate-spin" />}
                      {text.confirm}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="coach-primary-button w-full mt-3"
                      disabled={isBusy}
                      onClick={() => {
                        if (lastOrder.paymentUrl) window.open(lastOrder.paymentUrl, '_blank', 'noopener,noreferrer');
                      }}
                    >
                      <ExternalLink size={15} />
                      {text.payOnline}
                    </button>
                    <button
                      type="button"
                      className="coach-secondary-button w-full mt-2"
                      disabled={isBusy}
                      onClick={() => void refreshOrderStatus()}
                    >
                      {language === 'zh' ? '我已完成支付' : 'I have paid'}
                    </button>
                    <p className="home-pricing-note mt-3">{text.callback}</p>
                  </>
                )}
              </div>
            ) : (
              <div className="coach-card p-5">
                <h2>{text.accountTitle}</h2>
                <p className="home-account-name">{user.displayName || user.account}</p>
                <p className="home-path-count">
                  {text.unlockStatus}: <strong>{coachStatus?.paid ? (language === 'zh' ? '已解锁' : 'Unlocked') : language === 'zh' ? '未解锁' : 'Locked'}</strong>
                </p>
                <button type="button" className="site-primary-link w-full" onClick={onEnterStudio}>
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
            {text.features.map(feature => (
              <article key={feature.title} className="home-feature-card">
                <BadgeCheck size={18} />
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </article>
            ))}
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

      <section id="pricing" className="home-section home-pricing">
        <div className="home-section-inner">
          <span className="home-section-label"><CreditCard size={15} />{text.pricingTitle}</span>
          <div className="home-pricing-grid">
            {products.map(product => (
              <article key={product.id} className="home-price-card">
                <span>{language === 'zh' ? '一次性解锁' : 'One-time unlock'}</span>
                <strong>{product.priceYuan}</strong>
                <p>{product.description}</p>
                <a className="site-primary-link" href="#/product">
                  <CreditCard size={14} />
                  {text.purchase}
                </a>
              </article>
            ))}
            <article className="home-price-card home-community-card" aria-label={language === 'zh' ? '社群入口' : 'Community entry'}>
              <span>{language === 'zh' ? '购买后加入' : 'After purchase'}</span>
              <strong className="home-community-title">
                {language === 'zh' ? '学员社群' : 'Member Community'}
              </strong>
              <div className="home-qr-code" aria-label={language === 'zh' ? '社群二维码' : 'Community QR code'}>
                <QRCodeSVG value={COMMUNITY_URL} size={132} level="M" marginSize={1} />
              </div>
              <p>
                {language === 'zh'
                  ? '扫码进入学员社群入口，购买解锁后获取同步更新和交流支持。'
                  : 'Scan to open the member community entry; unlocked members receive updates and peer support.'}
              </p>
            </article>
          </div>
          <p className="home-pricing-note">{text.pricingNote}</p>
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
