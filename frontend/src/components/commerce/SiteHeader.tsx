import { useEffect, useRef, useState } from 'react';
import { Globe, LogIn, LogOut, Route, ShieldCheck, UserRound } from 'lucide-react';
import useCommerceStore from '../../stores/useCommerceStore';

export type SiteLanguage = 'zh' | 'en';
export type SiteRoute = 'home' | 'product' | 'payment' | 'success' | 'studio';

interface SiteHeaderProps {
  language: SiteLanguage;
  onLanguageChange: (language: SiteLanguage) => void;
  route: SiteRoute;
}

const copy = {
  zh: {
    products: '产品介绍',
    about: '关于我们',
    studio: '模型服务',
    promo: 'OPC 宣传页',
    home: '产品首页',
    login: '登录',
    logout: '退出',
    account: '账号',
    password: '密码',
    encrypted: '已加密保存',
    email: '邮箱',
    history: '已购买历史',
    emptyHistory: '暂无购买记录',
    admin: '管理员',
  },
  en: {
    products: 'Products',
    about: 'About Us',
    studio: 'Model Studio',
    promo: 'OPC Promo',
    home: 'Product Home',
    login: 'Sign in',
    logout: 'Sign out',
    account: 'Account',
    password: 'Password',
    encrypted: 'Encrypted',
    email: 'Email',
    history: 'Purchase history',
    emptyHistory: 'No purchases yet',
    admin: 'Admin',
  },
};

function formatOrderTime(timestamp: number, language: SiteLanguage) {
  return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
    month: '2-digit',
    day: '2-digit',
  }).format(timestamp);
}

export default function SiteHeader({ language, onLanguageChange, route }: SiteHeaderProps) {
  const user = useCommerceStore(s => s.user);
  const orders = useCommerceStore(s => s.orders);
  const logout = useCommerceStore(s => s.logout);
  const text = copy[language];
  const [accountOpen, setAccountOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  }, []);

  const openAccount = () => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setAccountOpen(true);
  };

  const scheduleAccountClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setAccountOpen(false), 180);
  };

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <a className="site-brand" href="#/">
          <span className="site-logo">
            <Route size={17} />
          </span>
          <span>
            <span className="site-brand-name">June AI</span>
            <span className="site-brand-caption">
              {language === 'zh' ? 'AI 变现训练官' : 'AI Monetization Coach'}
            </span>
          </span>
        </a>

        <nav className="site-nav" aria-label={language === 'zh' ? '主导航' : 'Main navigation'}>
          {route === 'product' ? (
            <>
              <a href="#/">{text.home}</a>
              <span className="site-nav-current">{text.promo}</span>
            </>
          ) : route === 'home' ? (
            <>
              <a href="#product-intro">{text.products}</a>
              <a href="#about">{text.about}</a>
            </>
          ) : (
            <>
              <a href="#/">{text.home}</a>
              <span className="site-nav-current">{text.studio}</span>
            </>
          )}
        </nav>

        <div className="site-header-actions">
          <button
            type="button"
            className="site-language-button"
            onClick={() => onLanguageChange(language === 'zh' ? 'en' : 'zh')}
            title={language === 'zh' ? 'Switch to English' : '切换到中文'}
          >
            <Globe size={14} />
            {language === 'zh' ? 'EN' : '中文'}
          </button>

          {user ? (
            <div
              className={accountOpen ? 'site-account is-open' : 'site-account'}
              onMouseEnter={openAccount}
              onMouseLeave={scheduleAccountClose}
            >
              <button type="button" className="site-avatar-button" title={user.displayName || user.account}>
                {user.displayName?.slice(0, 1).toUpperCase() || <UserRound size={16} />}
              </button>
              <div className="site-account-popover">
                <div className="site-account-header">
                  <strong>{user.displayName || user.account}</strong>
                  {user.isAdmin && (
                    <span className="site-admin-chip">
                      <ShieldCheck size={12} />
                      {text.admin}
                    </span>
                  )}
                </div>
                <dl>
                  <div>
                    <dt>{text.account}</dt>
                    <dd>{user.account}</dd>
                  </div>
                  <div>
                    <dt>{text.email}</dt>
                    <dd>{user.email}</dd>
                  </div>
                  <div>
                    <dt>{text.password}</dt>
                    <dd>•••••••• · {text.encrypted}</dd>
                  </div>
                </dl>
                <div className="site-history-title">{text.history}</div>
                {orders.length ? (
                  <ul className="site-history-list">
                    {orders.slice(0, 5).map(order => (
                      <li key={order.id}>
                        <span>{order.productName}</span>
                        <span>
                          {formatOrderTime(order.createdAt, language)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="site-history-empty">{text.emptyHistory}</p>
                )}
                <button type="button" className="site-popover-logout" onClick={logout}>
                  <LogOut size={13} />
                  {text.logout}
                </button>
              </div>
            </div>
          ) : (
            <a className="site-login-link" href="#auth">
              <LogIn size={14} />
              {text.login}
            </a>
          )}
        </div>
      </div>
    </header>
  );
}
