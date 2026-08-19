import { ArrowRight, BadgeCheck, CreditCard } from 'lucide-react';
import useCommerceStore from '../../stores/useCommerceStore';
import type { SiteLanguage } from './SiteHeader';

const copy = {
  zh: {
    title: '购买成功',
    subtitle: '超级个体训练师已解锁',
    desc: '你已完成一次性解锁，可进入模型服务启动训练师人格，开始推进 10 个商业节点的交付。',
    enter: '进入模型服务',
    notPaid: '支付尚未完成',
    notPaidDesc: '没有检测到已支付订单，请先完成支付。',
    toPayment: '去支付',
    home: '返回首页',
  },
  en: {
    title: 'Purchase successful',
    subtitle: 'Super-Solo Coach unlocked',
    desc: 'You have completed the one-time unlock. Enter Model Studio to launch the coach persona and start the 10 commercial steps.',
    enter: 'Open Model Studio',
    notPaid: 'Payment not completed',
    notPaidDesc: 'No paid order detected. Please complete payment first.',
    toPayment: 'Go to payment',
    home: 'Back home',
  },
};

interface PurchaseSuccessViewProps {
  language: SiteLanguage;
  onEnterStudio: () => void;
}

export default function PurchaseSuccessView({ language, onEnterStudio }: PurchaseSuccessViewProps) {
  const coachStatus = useCommerceStore(s => s.coachStatus);
  const text = copy[language];

  // 以“后端已确认支付”作为展示门禁：直接访问或支付未完成时引导回支付页，
  // 兼容将来真实支付回调到达后再进入本页的场景。
  if (!coachStatus?.paid) {
    return (
      <main className="site-home">
        <section className="home-section">
          <div className="home-section-inner">
            <div className="coach-card p-6 max-w-md mx-auto text-center">
              <h2>{text.notPaid}</h2>
              <p className="home-path-count">{text.notPaidDesc}</p>
              <div className="flex flex-col gap-2 mt-4">
                <a className="site-primary-link" href="#/payment"><CreditCard size={14} />{text.toPayment}</a>
                <a className="site-ghost-link" href="#/">{text.home}</a>
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="site-home">
      <section className="home-section">
        <div className="home-section-inner">
          <div className="coach-card p-8 max-w-md mx-auto text-center flex flex-col items-center">
            <BadgeCheck size={56} className="text-teal-600 mb-3" />
            <h2>{text.title}</h2>
            <span className="home-section-label mt-2">{text.subtitle}</span>
            <p className="home-path-count mt-3">{text.desc}</p>
            <button
              type="button"
              className="coach-primary-button w-full mt-6"
              onClick={onEnterStudio}
            >
              {text.enter}
              <ArrowRight size={15} />
            </button>
            <div className="mt-4">
              <a className="site-ghost-link" href="#/">{text.home}</a>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
