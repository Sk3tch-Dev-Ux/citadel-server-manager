import React from 'react';
import { AlertTriangle } from './Icon';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error('React ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--accent-red)', margin: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--accent-red)', marginBottom: 8 }}>
            <AlertTriangle size={20} />
            <h3 style={{ margin: 0 }}>Something went wrong</h3>
          </div>
          <pre style={{ color: 'var(--text-secondary)', fontSize: 12, whiteSpace: 'pre-wrap', marginBottom: 12, maxHeight: 200, overflow: 'auto' }}>
            {String(this.state.error)}{this.state.errorInfo ? '\n' + this.state.errorInfo.componentStack : ''}
          </pre>
          <button
            onClick={() => this.setState({ hasError: false, error: null, errorInfo: null })}
            className="btn btn-primary btn-sm"
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
