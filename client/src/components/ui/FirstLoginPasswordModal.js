import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import './FirstLoginPasswordModal.css';

const MIN_PASSWORD_LENGTH = 8;

export default function FirstLoginPasswordModal({ onPasswordChanged }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

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
      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();

      // The Auth update can succeed even if the Edge Function response is
      // interrupted. Trust the refreshed server state before showing an error.
      if (functionFailure && (refreshError || refreshed.session?.user?.app_metadata?.must_change_password !== false)) {
        throw functionFailure;
      }
      if (refreshError) throw refreshError;
      if (refreshed.session?.user?.app_metadata?.must_change_password !== false) {
        throw new Error('Could not confirm password update.');
      }
      setPassword('');
      setConfirmation('');
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
        </form>
      </div>
    </div>
  );
}
