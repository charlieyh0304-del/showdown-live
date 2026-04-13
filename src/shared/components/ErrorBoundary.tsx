import { Component, type ReactNode, type ErrorInfo } from 'react';
import i18n from '../i18n';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info);
  }

  resetError = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 w-full" role="alert">
          <div className="card text-center max-w-md w-full mx-auto">
            <h2 className="text-2xl font-bold text-red-500 mb-4">{i18n.t('common.error.occurred')}</h2>
            <p className="text-gray-400 mb-4">{this.state.error?.message || i18n.t('common.error.unknown')}</p>
            {import.meta.env.DEV && this.state.error?.stack && (
              <pre className="text-left text-xs text-gray-400 bg-gray-800 p-3 rounded overflow-auto max-h-40 mb-4">{this.state.error.stack}</pre>
            )}
            <button
              className="btn btn-primary"
              onClick={() => {
                this.resetError();
                window.location.reload();
              }}
              aria-label={i18n.t('common.error.refreshPage')}
            >
              {i18n.t('common.refresh')}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * 섹션 수준 ErrorBoundary — 페이지/위젯 단위 에러 격리.
 * 네비게이션은 유지하면서 해당 섹션만 에러 표시 + 재시도 버튼 제공.
 */
export class SectionErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('SectionErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="p-4 my-4 rounded-lg bg-gray-800 border border-red-500/30" role="alert">
          <p className="text-red-400 font-semibold mb-2">{i18n.t('common.error.sectionFailed')}</p>
          <p className="text-gray-400 text-sm mb-3">{this.state.error?.message || i18n.t('common.error.unknown')}</p>
          <button
            className="btn btn-primary text-sm"
            onClick={() => this.setState({ hasError: false, error: null })}
            aria-label={i18n.t('common.error.retry')}
          >
            {i18n.t('common.error.retry')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
