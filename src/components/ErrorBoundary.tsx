import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Lumina failed to render', error, info.componentStack);
  }
  render() {
    if (this.state.failed)
      return (
        <main className="error-page">
          <span className="error-icon">
            <AlertCircle size={30} />
          </span>
          <h1>工作空间遇到了一点问题</h1>
          <p>请刷新页面重试。已保存的工作簿仍保留在此浏览器中。</p>
          <button className="button primary" onClick={() => location.reload()}>
            <RefreshCw size={16} />
            重新打开工作空间
          </button>
          <button
            className="button secondary"
            onClick={() => {
              const backup = Object.fromEntries(
                Object.keys(localStorage)
                  .filter((k) => k.startsWith('lumina.'))
                  .map((k) => [k, localStorage.getItem(k)]),
              );
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }),
              );
              const a = document.createElement('a');
              a.href = url;
              a.download = 'Lumina-本地数据备份.json';
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            下载本地数据备份
          </button>
        </main>
      );
    return this.props.children;
  }
}
