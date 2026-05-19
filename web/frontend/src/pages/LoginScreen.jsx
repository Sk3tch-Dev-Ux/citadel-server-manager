import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import API from '../api';

export default function LoginScreen() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  // Audit N6 — backend errors now ship an optional next-step suggestion;
  // render it as a secondary line under the main error message.
  const [errorSuggestion, setErrorSuggestion] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Username and password are required');
      setErrorSuggestion('');
      return;
    }
    setLoading(true);
    setError('');
    setErrorSuggestion('');
    try {
      const data = await API.post('/api/auth/login', { username: username.trim(), password }, { skipAuth: true });
      if (data.token) {
        login(data.user, data.token);
      } else {
        setError(data.error || 'Login failed');
        setErrorSuggestion(data.suggestion || '');
      }
    } catch {
      setError('Connection failed');
      setErrorSuggestion('Check that the Citadel backend is running and reachable.');
    }
    setLoading(false);
  };

  return (
    <div className="login-screen">
      <form className="login-box" onSubmit={handleSubmit}>
        <div className="sidebar-logo" style={{ justifyContent: 'center', marginBottom: 8 }}>
          <img src="/citadel-logo.svg" alt="Citadel" style={{ width: 48, height: 48 }} />
        </div>
        <div className="login-title">Citadel</div>
        <div className="login-sub">Sign in to manage your servers</div>
        <div aria-live="polite">
          {error && (
            <div className="login-error">
              <div>{error}</div>
              {errorSuggestion && (
                <div style={{ marginTop: 6, fontSize: 12, opacity: 0.9, fontWeight: 'normal' }}>
                  {errorSuggestion}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="input-group">
          <label className="input-label" htmlFor="login-username">Username</label>
          <input id="login-username" className="input" value={username} onChange={e => setUsername(e.target.value)} autoFocus required autoComplete="username" aria-label="Username" />
        </div>
        <div className="input-group">
          <label className="input-label" htmlFor="login-password">Password</label>
          <input id="login-password" className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" aria-label="Password" />
        </div>
        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} disabled={loading} aria-busy={loading}>
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}
