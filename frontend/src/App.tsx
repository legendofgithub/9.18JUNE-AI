import CommerceApp from './components/commerce/CommerceApp';
import ErrorBoundary from './components/ErrorBoundary';

export default function App() {
  return (
    <ErrorBoundary name="app-root">
      <div className="relative">
        <CommerceApp />
      </div>
    </ErrorBoundary>
  );
}
