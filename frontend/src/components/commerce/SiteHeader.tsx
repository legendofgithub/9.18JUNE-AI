import { Globe, Route } from 'lucide-react';

export type SiteLanguage = 'zh' | 'en';

interface SiteHeaderProps {
  language: SiteLanguage;
  onLanguageChange: (language: SiteLanguage) => void;
  route?: 'studio';
}

/** 单用户模式顶栏：仅品牌与语言切换，无登录、无导航、无账户 */
export default function SiteHeader({ language, onLanguageChange }: SiteHeaderProps) {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <a className="site-brand" href="#/studio">
          <span className="site-logo">
            <Route size={17} />
          </span>
          <span>
            <span className="site-brand-name">June AI</span>
            <span className="site-brand-caption">
              {language === 'zh' ? 'AI 伴学助手 · 无限追问' : 'AI Study Companion · Unlimited Follow-ups'}
            </span>
          </span>
        </a>

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
        </div>
      </div>
    </header>
  );
}
