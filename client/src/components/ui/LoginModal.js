import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { isSupabaseConfigured, requestPasswordReset } from '../../lib/supabase';
import './LoginModal.css';

export default function LoginModal() {
  const { users, login } = useApp();
  const [email, setEmail] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [step, setStep]         = useState('select'); // 'select' | 'password'
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const passwordRef = useRef(null);

  // Focus password input when step changes
  useEffect(() => {
    if (step === 'password') {
      setTimeout(() => passwordRef.current?.focus(), 80);
    }
  }, [step]);

  const selectedUser = null;

  const handleSelectNext = () => {
    if (!selectedUserId) return;
    setPassword('');
    setError('');
    setStep('password');
  };

  const handleLogin = async () => {
    if (!password) { setError('Please enter your password.'); return; }
    setLoading(true);
    setError('');
    try {
      if (!isSupabaseConfigured) throw new Error('Supabase is not configured');
      if (!email.trim()) { setError('Please enter your email.'); setLoading(false); return; }
      await login(email.trim(), password);
    } catch (e) {
      if (e.response?.status === 401) {
        setError('Incorrect password. Please try again.');
        setPassword('');
        passwordRef.current?.focus();
      } else {
        setError('Login failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    if (!email.trim()) { setError('Enter your email to reset your password.'); return; }
    setLoading(true); setError('');
    try { await requestPasswordReset(email.trim()); setResetSent(true); }
    catch { setError('Unable to send a reset email. Please try again.'); }
    finally { setLoading(false); }
  };

  const handleBack = () => {
    setStep('select');
    setPassword('');
    setError('');
  };

  return (
    <div className="login-overlay">
      <div className="login-modal animate-slideIn">
        {/* Logo */}
        <div className="login-logo">
          <svg viewBox="0 0 260 64" xmlns="http://www.w3.org/2000/svg" className="login-logo-svg">
            <text x="4" y="56" fontFamily="Georgia, 'Times New Roman', serif" fontSize="60" fontStyle="italic" fill="#000000">from:</text>
          </svg>
        </div>

        <div className="login-divider" />
        <div className="login-app-label">Budget System</div>

        {isSupabaseConfigured ? (
          <div className="login-form" onKeyDown={e => e.key === 'Enter' && !loading && handleLogin()}>
            <label className="login-label">Email</label>
            <input className={`login-input ${error ? 'login-input--error' : ''}`} type="email" value={email} onChange={e => { setEmail(e.target.value); setError(''); setResetSent(false); }} placeholder="you@company.com" autoComplete="email" autoFocus />
            <label className="login-label">Password</label>
            <input ref={passwordRef} type="password" className={`login-input ${error ? 'login-input--error' : ''}`} value={password} onChange={e => { setPassword(e.target.value); setError(''); }} placeholder="Password" autoComplete="current-password" />
            {error && <div className="login-error">{error}</div>}
            {resetSent && <div className="login-success">Password reset email sent.</div>}
            <button className="login-btn" onClick={handleLogin} disabled={!email || !password || loading}>{loading ? <span className="login-btn-spinner" /> : 'Enter'}</button>
            <button className="login-back-btn" type="button" onClick={handleReset} disabled={loading}>Forgot password?</button>
          </div>
        ) : step === 'select' ? (
          /* ── Step 1: Select user ── */
          <div className="login-form" onKeyDown={e => e.key === 'Enter' && selectedUserId && handleSelectNext()}>
            <label className="login-label">Select your name to continue</label>
            <select
              className="login-select"
              value={selectedUserId}
              onChange={e => setSelectedUserId(e.target.value)}
              autoFocus
            >
              <option value="">— Choose your name —</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            <button
              className="login-btn"
              onClick={handleSelectNext}
              disabled={!selectedUserId}
            >
              Next
            </button>
          </div>
        ) : (
          /* ── Step 2: Enter password ── */
          <div className="login-form" onKeyDown={e => e.key === 'Enter' && !loading && handleLogin()}>
            {/* Show selected user */}
            <div className="login-user-selected">
              <div className="login-user-avatar">{selectedUser?.initials}</div>
              <div className="login-user-name">{selectedUser?.name}</div>
              <button className="login-back-btn" onClick={handleBack} title="Change user">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>

            <label className="login-label">Enter your password</label>
            <input
              ref={passwordRef}
              type="password"
              className={`login-input ${error ? 'login-input--error' : ''}`}
              value={password}
              onChange={e => { setPassword(e.target.value); setError(''); }}
              placeholder="Password"
              autoComplete="current-password"
            />

            {error && <div className="login-error">{error}</div>}

            <button
              className="login-btn"
              onClick={handleLogin}
              disabled={!password || loading}
            >
              {loading ? <span className="login-btn-spinner" /> : 'Enter'}
            </button>
          </div>
        )}

        <div className="login-footer">
          <span>from: · Budget</span>
        </div>
      </div>
    </div>
  );
}
