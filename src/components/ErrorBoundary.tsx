import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { getPersistence } from '../lib/persistence';
import { downloadRecoveryBackup } from '../lib/recovery-download';
export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean; saving: boolean; message: string }
> {
  state = { failed: false, saving: false, message: '' };
  private mounted = true;
  private backupPending = false;
  componentDidMount() {
    this.mounted = true;
  }
  componentWillUnmount() {
    this.mounted = false;
  }
  private backup = async () => {
    if (this.backupPending) return;
    this.backupPending = true;
    this.setState({ saving: true, message: '' });
    try {
      const message = await downloadRecoveryBackup(getPersistence(), () => this.mounted);
      if (this.mounted && message) this.setState({ message });
    } catch {
      if (this.mounted) this.setState({ message: '备份生成失败，请保留当前浏览器数据后重试。' });
    } finally {
      this.backupPending = false;
      if (this.mounted) this.setState({ saving: false });
    }
  };
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
          <p>请先导出恢复备份，再刷新重试。仅内存会话中的数据可能在刷新后丢失。</p>
          <button className="button primary" onClick={() => location.reload()}>
            <RefreshCw size={16} />
            重新打开工作空间
          </button>
          <button className="button secondary" disabled={this.state.saving} onClick={this.backup}>
            {this.state.saving ? '正在读取本地数据…' : '下载恢复备份'}
          </button>
          {this.state.message && <p role="status">{this.state.message}</p>}
        </main>
      );
    return this.props.children;
  }
}
