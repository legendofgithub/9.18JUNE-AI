import useJuneStore from '../../stores/useJuneStore';
import FloatWindowComponent from './FloatWindow';
import ErrorBoundary from '../ErrorBoundary';

export default function FloatWindowLayer() {
  const floatWindows = useJuneStore(s => s.floatWindows);

  if (floatWindows.length === 0) return null;

  // 按 zIndex 排序以确保正确的堆叠顺序
  const sortedWindows = [...floatWindows].sort((a, b) => a.zIndex - b.zIndex);

  return (
    <>
      {sortedWindows.map(win => (
        <ErrorBoundary key={win.threadId} name={`float-window-${win.threadId}`}>
          <FloatWindowComponent window={win} />
        </ErrorBoundary>
      ))}
    </>
  );
}
