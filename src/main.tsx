import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import PerformanceLab from './components/PerformanceLab';
import ErrorBoundary from './components/ErrorBoundary';
import { isPerformanceRoute, workspaceRoutes } from './lib/workspace-routes';
import './styles/global.css';
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {isPerformanceRoute(location.pathname, location.search) ? (
        <PerformanceLab onClose={() => location.assign(workspaceRoutes().workspace)} />
      ) : (
        <App />
      )}
    </ErrorBoundary>
  </React.StrictMode>,
);
