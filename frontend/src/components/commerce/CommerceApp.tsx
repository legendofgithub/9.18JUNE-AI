import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import useCommerceStore from '../../stores/useCommerceStore';
import { trackEvent } from '../../services/analyticsService';
import ErrorBoundary from '../ErrorBoundary';
import AdminView from './AdminView';
import LandingView from './LandingView';
import SiteHeader, { type SiteLanguage, type SiteRoute } from './SiteHeader';
import WorkspaceView from './WorkspaceView';

function readRoute(): SiteRoute {
  if (window.location.hash.startsWith('#/studio')) return 'studio';
  if (window.location.hash.startsWith('#/admin')) return 'admin';
  return 'home';
}

type TransitionPhase = 'cover' | 'reveal';

function StudioTransition({ phase }: { phase: TransitionPhase }) {
  return (
    <div className={`studio-transition-overlay studio-transition-${phase}`} aria-hidden="true">
      <div className="studio-transition-glow" />
      <div className="studio-transition-lines">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

export default function CommerceApp() {
  const bootstrap = useCommerceStore(s => s.bootstrap);
  const isBootstrapping = useCommerceStore(s => s.isBootstrapping);
  const user = useCommerceStore(s => s.user);
  const [route, setRoute] = useState<SiteRoute>(readRoute);
  const [language, setLanguage] = useState<SiteLanguage>('zh');
  const [transitionPhase, setTransitionPhase] = useState<TransitionPhase | null>(null);
  const timers = useRef<number[]>([]);

  const clearTimers = () => {
    timers.current.forEach(window.clearTimeout);
    timers.current = [];
  };

  const delay = (handler: () => void, milliseconds: number) => {
    timers.current.push(window.setTimeout(handler, milliseconds));
  };

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const syncRoute = () => setRoute(readRoute());
    window.addEventListener('hashchange', syncRoute);
    return () => window.removeEventListener('hashchange', syncRoute);
  }, []);

  useEffect(() => {
    trackEvent('app.route_view', `#${route === 'home' ? '/' : `/${route}`}`);
  }, [route]);

  useEffect(() => {
    if (route === 'studio' && !isBootstrapping && !user) window.location.hash = '#/';
  }, [route, user, isBootstrapping]);

  useEffect(() => clearTimers, []);

  const enterStudio = () => {
    if (transitionPhase) return;
    if (!user) {
      window.location.hash = '#auth';
      window.setTimeout(() => document.getElementById('account')?.focus(), 80);
      return;
    }

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      window.location.hash = '#/studio';
      return;
    }

    setTransitionPhase('cover');
    delay(() => {
      window.location.hash = '#/studio';
    }, 280);
    delay(() => setTransitionPhase('reveal'), 340);
    delay(() => setTransitionPhase(null), 780);
  };

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

  const effectiveRoute: SiteRoute = route === 'studio' && !user
    ? 'home'
    : route === 'admin' && (!user || !user.isAdmin)
      ? 'home'
      : route;

  return (
    <ErrorBoundary name="commerce-app">
      <div className={effectiveRoute === 'studio' ? 'site-root studio-mode' : 'site-root'}>
        <SiteHeader language={language} onLanguageChange={setLanguage} route={effectiveRoute} />
        {effectiveRoute === 'home' && <LandingView language={language} onEnterStudio={enterStudio} />}
        {effectiveRoute === 'studio' && <WorkspaceView language={language} />}
        {effectiveRoute === 'admin' && <AdminView language={language} />}
      </div>
      {transitionPhase && <StudioTransition phase={transitionPhase} />}
    </ErrorBoundary>
  );
}
