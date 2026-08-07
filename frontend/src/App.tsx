import { useEffect, useCallback } from 'react';
import useJuneStore from './stores/useJuneStore';
import Header from './components/layout/Header';
import MessageList from './components/chat/MessageList';
import InputBar from './components/chat/InputBar';
import FloatWindowLayer from './components/float/FloatWindowLayer';
import ContextMenu from './components/menu/ContextMenu';
import ParticleBackground from './components/ParticleBackground';
import ErrorBoundary from './components/ErrorBoundary';

export default function App() {
  const createSession = useJuneStore(s => s.createSession);
  const currentSessionId = useJuneStore(s => s.currentSessionId);
  const sessions = useJuneStore(s => s.sessions);
  const hideContextMenu = useJuneStore(s => s.hideContextMenu);

  // 自动创建默认会话
  useEffect(() => {
    if (sessions.length === 0) {
      createSession();
    }
  }, [sessions.length, createSession]);

  // 全局点击关闭右键菜单
  const handleGlobalClick = useCallback(() => {
    hideContextMenu();
  }, [hideContextMenu]);

  return (
    <ErrorBoundary name="app-root">
      <div
        className="h-screen flex flex-col relative overflow-hidden"
        style={{ background: 'var(--june-bg)' }}
        onClick={handleGlobalClick}
      >
        <ParticleBackground />
        <Header />

        {/* 主内容区 */}
        <ErrorBoundary name="main-chat-panel">
          <div className="flex-1 flex overflow-hidden relative z-[1]">
            {/* 聊天区 */}
            <div className="flex-1 flex flex-col overflow-hidden">
              <MessageList />
              <InputBar />
            </div>
          </div>
        </ErrorBoundary>

        {/* 悬浮窗层（每个 FloatWindow 内部独立包裹 ErrorBoundary） */}
        <FloatWindowLayer />

        {/* 右键菜单 */}
        <ContextMenu />
      </div>
    </ErrorBoundary>
  );
}
