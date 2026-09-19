import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import useCommerceStore from '../../stores/useCommerceStore';
import { trackEvent } from '../../services/analyticsService';
import ErrorBoundary from '../ErrorBoundary';
import SiteHeader, { type SiteLanguage } from './SiteHeader';
import WorkspaceView from './WorkspaceView';

/**
 * 单用户模式应用外壳：打开即模型服务，无登录、无购买、无管理后台。
 */
export default function CommerceApp() {
  const bootstrap = useCommerceStore(s => s.bootstrap);
  const isBootstrapping = useCommerceStore(s => s.isBootstrapping);
  const [language, setLanguage] = useState<SiteLanguage>('zh');

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    trackEvent('app.route_view', '#/studio');
  }, []);

  if (isBootstrapping) {
    return (
      <div className="coach-shell h-screen flex items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-[var(--june-text-dim)]">
          <Loader2 size={16} className="animate-spin" />
          正在加载 June AI
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary name="commerce-app">
      <div className="site-root studio-mode">
        <SiteHeader language={language} onLanguageChange={setLanguage} route="studio" />
        <WorkspaceView language={language} />
      </div>
    </ErrorBoundary>
  );
}
