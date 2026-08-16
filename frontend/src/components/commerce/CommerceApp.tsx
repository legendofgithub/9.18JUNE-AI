import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import useCommerceStore from '../../stores/useCommerceStore';
import ErrorBoundary from '../ErrorBoundary';
import LandingView from './LandingView';
import SiteHeader, { type SiteLanguage, type SiteRoute } from './SiteHeader';
import WorkspaceView from './WorkspaceView';

function readRoute(): SiteRoute {
  return window.location.hash.startsWith('#/studio') ? 'studio' : 'home';
}

type DoorPhase = 'closing' | 'impact';

function StudioDoors({ phase }: { phase: DoorPhase }) {
  return (
    <div className={`studio-door-overlay studio-door-${phase}`} aria-hidden="true">
      <div className="studio-door-panel studio-door-left">
        <span />
        <span />
        <span />
      </div>
      <div className="studio-door-panel studio-door-right">
        <span />
        <span />
        <span />
      </div>
      <div className="studio-door-impact" />
      <div className="studio-door-dust studio-door-dust-left" />
      <div className="studio-door-dust studio-door-dust-right" />
    </div>
  );
}

export default function CommerceApp() {
  const bootstrap = useCommerceStore(s => s.bootstrap);
  const isBootstrapping = useCommerceStore(s => s.isBootstrapping);
  const user = useCommerceStore(s => s.user);
  const [route, setRoute] = useState<SiteRoute>(readRoute);
  const [language, setLanguage] = useState<SiteLanguage>('zh');
  const [doorPhase, setDoorPhase] = useState<DoorPhase | null>(null);
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
    if (route === 'studio' && !isBootstrapping && !user) window.location.hash = '#/';
  }, [route, user, isBootstrapping]);

  useEffect(() => clearTimers, []);

  const enterStudio = () => {
    if (doorPhase) return;
    if (!user) {
      window.location.hash = '#auth';
      window.setTimeout(() => document.getElementById('account')?.focus(), 80);
      return;
    }

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setDoorPhase('closing');
    if (reduced) {
      window.location.hash = '#/studio';
      delay(() => setDoorPhase(null), 180);
      return;
    }

    delay(() => {
      window.location.hash = '#/studio';
    }, 180);
    delay(() => setDoorPhase('impact'), 300);
    delay(() => setDoorPhase(null), 720);
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

  const effectiveRoute: SiteRoute = route === 'studio' && user ? 'studio' : 'home';

  return (
    <ErrorBoundary name="commerce-app">
      <div className={effectiveRoute === 'studio' ? 'site-root studio-mode' : 'site-root'}>
        <SiteHeader language={language} onLanguageChange={setLanguage} route={effectiveRoute} />
        {effectiveRoute === 'home'
          ? <LandingView language={language} onEnterStudio={enterStudio} />
          : <WorkspaceView language={language} />}
      </div>
      {doorPhase && <StudioDoors phase={doorPhase} />}
    </ErrorBoundary>
  );
}
