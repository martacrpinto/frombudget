import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { isPasswordActionUrl, isSupabaseConfigured, updatePassword, supabase } from '../../lib/supabase';
import './LoginModal.css';

export default function LoginModal({ forcePasswordAction = false, onPasswordActionFinished = () => {} }) {
  const { users, login } = useApp();
  const [email, setEmail] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [step, setStep]         = useState('select'); // 'select' | 'password'
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(() => forcePasswordAction || isPasswordActionUrl());
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordUpdated, setPasswordUpdated] = useState(false);
  const passwordRef = useRef(null);

  // Focus password input when step changes
  useEffect(() => {
    if (step === 'password') {
      setTimeout(() => passwordRef.current?.focus(), 80);
    }
  }, [step]);

  // Supabase emits PASSWORD_RECOVERY when a reset link is opened. Invite links
  // contain the same temporary session and are detected from the URL above.
  useEffect(() => {
    if (!supabase) return undefined;
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'USER_UPDATED') setRecoveryMode(true);
      if (session?.user?.email) setEmail(current => current || session.user.email);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user?.email) setEmail(current => current || data.session.user.email);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (forcePasswordAction) setRecoveryMode(true);
  }, [forcePasswordAction]);

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

  const handlePasswordUpdate = async () => {
    if (newPassword.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (newPassword !== confirmPassword) { setError('Passwords do not match.'); return; }
    setLoading(true); setError('');
    try {
      const { error: updateError } = await updatePassword(newPassword);
      if (updateError) throw updateError;
      setPasswordUpdated(true);
      setNewPassword('');
      setConfirmPassword('');
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch (e) {
      setError(e?.message || 'Unable to set your password. Please request a new link.');
    } finally { setLoading(false); }
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

        {isSupabaseConfigured && recoveryMode && !passwordUpdated ? (
          <div className="login-form" onKeyDown={e => e.key === 'Enter' && !loading && handlePasswordUpdate()}>
            <div className="login-recovery-heading">Set your password</div>
            <div className="login-recovery-copy">Choose a password to finish setting up your account.</div>
            <label className="login-label">New password</label>
            <input ref={passwordRef} type="password" className={`login-input ${error ? 'login-input--error' : ''}`} value={newPassword} onChange={e => { setNewPassword(e.target.value); setError(''); }} placeholder="At least 8 characters" autoComplete="new-password" autoFocus />
            <label className="login-label">Confirm password</label>
            <input type="password" className={`login-input ${error ? 'login-input--error' : ''}`} value={confirmPassword} onChange={e => { setConfirmPassword(e.target.value); setError(''); }} placeholder="Repeat your password" autoComplete="new-password" />
            {error && <div className="login-error">{error}</div>}
            <button className="login-btn" onClick={handlePasswordUpdate} disabled={!newPassword || !confirmPassword || loading}>{loading ? <span className="login-btn-spinner" /> : 'Save password'}</button>
          </div>
        ) : isSupabaseConfigured && passwordUpdated ? (
          <div className="login-form">
            <div className="login-success login-recovery-success">Password saved successfully. You can now sign in.</div>
            <button className="login-btn" onClick={async () => { if (supabase) await supabase.auth.signOut(); setPasswordUpdated(false); setRecoveryMode(false); onPasswordActionFinished(); }}>Continue to sign in</button>
          </div>
        ) : isSupabaseConfigured ? (
          <div className="login-form" onKeyDown={e => e.key === 'Enter' && !loading && handleLogin()}>
            <label className="login-label">Email</label>
            <input className={`login-input ${error ? 'login-input--error' : ''}`} type="email" value={email} onChange={e => { setEmail(e.target.value); setError(''); }} placeholder="you@company.com" autoComplete="email" autoFocus />
            <label className="login-label">Password</label>
            <input ref={passwordRef} type="password" className={`login-input ${error ? 'login-input--error' : ''}`} value={password} onChange={e => { setPassword(e.target.value); setError(''); }} placeholder="Password" autoComplete="current-password" />
            {error && <div className="login-error">{error}</div>}
            <button className="login-btn" onClick={handleLogin} disabled={!email || !password || loading}>{loading ? <span className="login-btn-spinner" /> : 'Enter'}</button>
            <div className="login-help-copy">Need a new password? Ask an administrator for temporary login credentials.</div>
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
