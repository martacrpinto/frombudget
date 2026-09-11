import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import './FirstLoginPasswordModal.css';

const MIN_PASSWORD_LENGTH = 8;

export default function FirstLoginPasswordModal({ onPasswordChanged }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    const reconcileServerState = async () => {
      if (!supabase) return;
      const { data, error: userError } = await supabase.auth.getUser();
      if (!active || userError || data.user?.app_metadata?.must_change_password === true) return;

      // A password update invalidates the old first-login state. End only the
      // local stale session so the user can sign in with the new password.
      await supabase.auth.signOut({ scope: 'local' });
      if (active) onPasswordChanged?.();
    };
    reconcileServerState();
    return () => { active = false; };
  }, [onPasswordChanged]);

  const returnToLogin = async () => {
    if (!supabase) return;
    setSaving(true);
    await supabase.auth.signOut({ scope: 'local' });
    onPasswordChanged?.();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError('Your password must be at least 8 characters.');
      return;
    }
    if (password !== confirmation) {
      setError('The passwords do not match.');
      return;
    }
    setSaving(true);
    try {
      if (!supabase) throw new Error('Authentication is not configured.');
      const { data, error: functionError } = await supabase.functions.invoke('admin-users', {
        body: { action: 'complete-first-login', password },
      });
      const functionFailure = functionError || (data?.error ? new Error(data.error) : null);
      if (functionFailure) {
        // The Auth update can succeed even if the Edge Function response is
        // interrupted. Check the authoritative user record before reporting it.
        const { data: verified, error: verifyError } = await supabase.auth.getUser();
        if (verifyError || verified.user?.app_metadata?.must_change_password !== false) {
          throw functionFailure;
        }
      }
      setPassword('');
      setConfirmation('');
      await supabase.auth.signOut({ scope: 'local' });
      onPasswordChanged?.();
    } catch (updateError) {
      setError(updateError?.message || 'Could not update your password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="first-login-overlay" role="dialog" aria-modal="true" aria-labelledby="first-login-title">
      <div className="first-login-card">
        <div className="first-login-lock" aria-hidden="true">●</div>
        <h1 id="first-login-title">Set your password</h1>
        <p className="first-login-copy">For security, choose a personal password before continuing.</p>
        <form onSubmit={handleSubmit}>
          <label className="first-login-label" htmlFor="first-login-password">New password</label>
          <input
            id="first-login-password"
            className="first-login-input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            autoFocus
            disabled={saving}
          />
          <label className="first-login-label" htmlFor="first-login-confirm">Confirm new password</label>
          <input
            id="first-login-confirm"
            className="first-login-input"
            type="password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="new-password"
            disabled={saving}
          />
          {error && <p className="first-login-error" role="alert">{error}</p>}
          <button className="first-login-submit" type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Save password'}
          </button>
          <button className="first-login-back" type="button" onClick={returnToLogin} disabled={saving}>
            Return to login
          </button>
        </form>
      </div>
    </div>
  );
}
