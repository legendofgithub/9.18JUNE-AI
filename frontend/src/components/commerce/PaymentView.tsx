import { useEffect } from 'react';
import { AlertTriangle, ArrowRight, CreditCard, Loader2, ShieldCheck } from 'lucide-react';
import useCommerceStore from '../../stores/useCommerceStore';
import type { SiteLanguage } from './SiteHeader';

const copy = {
  zh: {
    title: '确认支付',
    merchantOrder: '商户单号',
    product: '商品',
    amount: '应付金额',
    pay: '付款',
    paying: '正在确认到账',
    callback: '点击「付款」即模拟现金到账信号，后端确认支付后会自动跳转到购买成功页。',
    noOrder: '当前没有待支付订单',
    alreadyPaid: '该订单已支付',
    goBuy: '去购买',
    home: '返回首页',
    note: '产品承诺确定性交付物，不承诺收入。',
  },
  en: {
    title: 'Confirm payment',
    merchantOrder: 'Merchant order',
    product: 'Product',
    amount: 'Amount due',
    pay: 'Pay',
    paying: 'Confirming payment',
    callback: 'Click “Pay” to simulate a cash-received signal; the backend confirms and redirects to the success page.',
    noOrder: 'No pending order',
    alreadyPaid: 'This order is already paid',
    goBuy: 'Go to buy',
    home: 'Back home',
    note: 'Deterministic deliverables only; no income guarantee.',
  },
};

export default function PaymentView({ language }: { language: SiteLanguage }) {
  const user = useCommerceStore(s => s.user);
  const lastOrder = useCommerceStore(s => s.lastOrder);
  const coachStatus = useCommerceStore(s => s.coachStatus);
  const isBusy = useCommerceStore(s => s.isBusy);
  const error = useCommerceStore(s => s.error);
  const confirmOrder = useCommerceStore(s => s.confirmOrder);
  const clearError = useCommerceStore(s => s.clearError);
  const dismissOrder = useCommerceStore(s => s.dismissOrder);
  const text = copy[language];

  const hasPending = lastOrder?.status === 'pending';

  // 后端订单已支付（含将来真实支付回调触发）时直接前往成功页，
  // 保证跳转由“订单已支付”状态驱动，而非前端按钮硬跳。
  useEffect(() => {
    if (coachStatus?.paid || lastOrder?.status === 'paid') {
      window.location.hash = '#/success';
    }
  }, [coachStatus?.paid, lastOrder?.status]);

  const handlePay = async () => {
    if (!lastOrder) return;
    // 沙箱模拟：以商户单号生成沙箱流水号，等同于支付渠道回传的支付成功信号。
    // 接入真实支付时，由支付渠道回调 /api/orders/{id}/confirm（带签名）置为已支付，
    // 本页与成功页逻辑完全复用，无需改动。
    const txId = `SANDBOX-${lastOrder.providerOrderId}`;
    await confirmOrder(txId);
    if (useCommerceStore.getState().lastOrder?.status === 'paid') {
      window.location.hash = '#/success';
    }
  };

  if (!hasPending) {
    return (
      <main className="site-home">
        <section className="home-section">
          <div className="home-section-inner">
            <div className="coach-card p-6 max-w-md mx-auto text-center">
              <h2>{text.noOrder}</h2>
              {lastOrder?.status === 'paid' && <p className="home-path-count">{text.alreadyPaid}</p>}
              <div className="flex flex-col gap-2 mt-4">
                <a className="site-primary-link" href="#/product"><CreditCard size={14} />{text.goBuy}</a>
                <a className="site-ghost-link" href="#/">{text.home}</a>
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  const priceYuan = (lastOrder.amountCents / 100).toFixed(2);

  return (
    <main className="site-home">
      <section className="home-section">
        <div className="home-section-inner">
          <div className="coach-card p-6 max-w-md mx-auto">
            <h2 className="mb-4">{text.title}</h2>
            <dl className="home-order-meta">
              <div>
                <dt>{text.merchantOrder}</dt>
                <dd>{lastOrder.providerOrderId}</dd>
              </div>
              <div>
                <dt>{text.product}</dt>
                <dd>{lastOrder.productName}</dd>
              </div>
              <div>
                <dt>{text.amount}</dt>
                <dd>¥{priceYuan}</dd>
              </div>
            </dl>

            <button
              type="button"
              className="coach-primary-button w-full mt-5"
              disabled={isBusy || !user}
              onClick={() => void handlePay()}
            >
              {isBusy && <Loader2 size={15} className="animate-spin" />}
              {isBusy ? text.paying : text.pay}
            </button>

            <p className="home-pricing-note mt-3 flex items-center gap-1">
              <ShieldCheck size={13} />{text.callback}
            </p>

            {error && (
              <div className="home-error mt-3">
                <AlertTriangle size={16} />
                <p>{error}</p>
                <button onClick={clearError}>×</button>
              </div>
            )}

            <div className="mt-4 text-center">
              <a
                className="site-ghost-link"
                href="#/"
                onClick={() => dismissOrder()}
              >
                {text.home}
              </a>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
