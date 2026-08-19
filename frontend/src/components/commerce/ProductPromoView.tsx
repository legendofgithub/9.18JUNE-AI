import { Rocket, ShieldCheck, Sparkles } from 'lucide-react';
import useCommerceStore from '../../stores/useCommerceStore';
import type { SiteLanguage } from './SiteHeader';

const PRODUCT_PROMO_VIDEO = import.meta.env.VITE_PRODUCT_PROMO_VIDEO || '/deep-space-compute-field.mp4';

const copy = {
  zh: {
    badge: 'OPC 超级个体计划',
    title: 'June AI 的一站式 C 端个体户 AI 变现说明书',
    subtitle: '最前沿的 OPC 超级个体培养解决方案',
    mission: '我们致力于用先进的超级个体理念帮助 AI 更好地反馈社会，帮助全人类离解放生产力更进一步。在这个过程中产生的财富聚集效应，将惠及有能力、愿意加入我们的 OPC 个体。',
    productLabel: 'OPC 一次性解锁',
    productName: '超级个体训练师',
    productDetail: '10 个必修商业节点 · 追问式推进 · 可复盘交付物',
    pricePrefix: 'CNY',
    priceSuffix: '一次性解锁',
    purchase: '立即购买',
    note: '产品承诺确定性交付物，不承诺收入。',
  },
  en: {
    badge: 'OPC Super-Solo Program',
    title: 'June AI: the one-stop AI monetization manual for consumer solo operators',
    subtitle: 'A frontier OPC super-solo development solution',
    mission: 'We apply advanced super-solo thinking to help AI create more value for society and move humanity closer to liberated productivity. The resulting wealth concentration is intended to benefit capable individuals who choose to join the OPC program.',
    productLabel: 'OPC one-time unlock',
    productName: 'Super-Solo Coach',
    productDetail: '10 required steps · follow-up progression · reviewable deliverables',
    pricePrefix: 'CNY',
    priceSuffix: 'one-time unlock',
    purchase: 'Buy now',
    note: 'Deterministic deliverables only; no income guarantee.',
  },
};

export default function ProductPromoView({ language }: { language: SiteLanguage }) {
  const products = useCommerceStore(s => s.products);
  const user = useCommerceStore(s => s.user);
  const lastOrder = useCommerceStore(s => s.lastOrder);
  const isBusy = useCommerceStore(s => s.isBusy);
  const createOrder = useCommerceStore(s => s.createOrder);
  const text = copy[language];
  const product = products[0];

  const handleBuy = async () => {
    if (!user) {
      window.location.hash = '#auth';
      return;
    }
    // 已有订单则直接进入对应页面，避免重复下单
    if (lastOrder?.status === 'pending') {
      window.location.hash = '#/payment';
      return;
    }
    if (lastOrder?.status === 'paid') {
      window.location.hash = '#/success';
      return;
    }
    await createOrder(product?.id ?? '');
    const next = useCommerceStore.getState().lastOrder;
    if (next?.status === 'paid') window.location.hash = '#/success';
    else if (next?.status === 'pending') window.location.hash = '#/payment';
  };

  return (
    <main className="product-promo">
      <div className="product-promo-media" aria-hidden="true">
        <video
          src={PRODUCT_PROMO_VIDEO}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
        />
      </div>
      <div className="product-promo-inner">
        <section className="product-promo-copy">
          <span className="product-promo-badge">
            <Rocket size={14} />
            {text.badge}
          </span>
          <h1>{text.title}</h1>
          <p className="product-promo-subtitle">{text.subtitle}</p>
          <p className="product-promo-mission">{text.mission}</p>
        </section>

        <aside className="product-promo-frame" aria-label={text.productName}>
          <span className="product-promo-frame-arc" aria-hidden="true" />
          <span className="product-promo-frame-ribbon" aria-hidden="true" />
          <div className="product-promo-frame-content">
            <span className="product-promo-product-label">
              <Sparkles size={14} />
              {text.productLabel}
            </span>
            <h2>{text.productName}</h2>
            <p>{text.productDetail}</p>
            <div className="product-promo-price">
              <span>{text.pricePrefix}</span>
              <strong>{product?.priceYuan ?? 39}</strong>
              <em>{text.priceSuffix}</em>
            </div>
            <button
              type="button"
              className="product-promo-purchase"
              disabled={isBusy}
              onClick={() => void handleBuy()}
            >
              {text.purchase}
            </button>
            <small>
              <ShieldCheck size={13} />
              {text.note}
            </small>
          </div>
        </aside>
      </div>
    </main>
  );
}
