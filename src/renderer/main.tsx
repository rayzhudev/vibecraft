import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/index.css';

if (import.meta.env.DEV && typeof window !== 'undefined') {
  const isResizeObserverNoise = (value: unknown) => {
    if (typeof value === 'string') {
      return value.includes('ResizeObserver loop completed with undelivered notifications.');
    }
    if (value && typeof value === 'object' && 'message' in value) {
      const message = (value as { message?: unknown }).message;
      return (
        typeof message === 'string' &&
        message.includes('ResizeObserver loop completed with undelivered notifications.')
      );
    }
    return false;
  };

  const suppressResizeObserverNoise = (event: ErrorEvent) => {
    if (!isResizeObserverNoise(event.message) && !isResizeObserverNoise(event.error)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const suppressResizeObserverRejection = (event: PromiseRejectionEvent) => {
    if (!isResizeObserverNoise(event.reason)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  window.addEventListener('error', suppressResizeObserverNoise, true);
  window.addEventListener('unhandledrejection', suppressResizeObserverRejection, true);
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  const app = <App />;
  const useStrictMode = !import.meta.env.DEV || import.meta.env.VITE_STRICT_MODE === '1';
  root.render(useStrictMode ? <React.StrictMode>{app}</React.StrictMode> : app);
}
