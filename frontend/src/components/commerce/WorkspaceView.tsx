import CoachLaunchPanel from './CoachLaunchPanel';
import ProjectWorkspace from './ProjectWorkspace';
import useCommerceStore from '../../stores/useCommerceStore';
import type { SiteLanguage } from './SiteHeader';

export default function WorkspaceView({ language }: { language: SiteLanguage }) {
  const currentRun = useCommerceStore(s => s.currentRun);

  if (!currentRun) {
    return (
      <main className="studio-shell flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-[620px]">
          <CoachLaunchPanel language={language} />
        </div>
      </main>
    );
  }

  return <ProjectWorkspace language={language} />;
}
