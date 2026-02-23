import React from 'react';

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
        <div style={{ padding: 24, background: '#2a2e37', borderRadius: 8, border: '1px solid #e74c3c', margin: 16 }}>
          <h3 style={{ color: '#e74c3c', marginBottom: 8 }}>Something went wrong</h3>
          <pre style={{ color: '#ccc', fontSize: 12, whiteSpace: 'pre-wrap', marginBottom: 12, maxHeight: 200, overflow: 'auto' }}>
            {String(this.state.error)}{this.state.errorInfo ? '\n' + this.state.errorInfo.componentStack : ''}
          </pre>
          <button
            onClick={() => this.setState({ hasError: false, error: null, errorInfo: null })}
            style={{ padding: '6px 16px', background: '#6cb4f0', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
