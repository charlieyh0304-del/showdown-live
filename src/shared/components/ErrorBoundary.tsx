import { Component, type ReactNode, type ErrorInfo } from 'react';

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

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="flex items-center justify-center min-h-screen bg-gray-900">
          <div className="card text-center max-w-md">
            <h2 className="text-2xl font-bold text-red-500 mb-4">오류가 발생했습니다</h2>
            <p className="text-gray-400 mb-4">{this.state.error?.message || '알 수 없는 오류'}</p>
            {this.state.error?.stack && (
              <pre className="text-left text-xs text-gray-500 bg-gray-800 p-3 rounded overflow-auto max-h-40 mb-4">{this.state.error.stack}</pre>
            )}
            <button
              className="btn btn-primary"
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
            >
              새로고침
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
