import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { adminUsers } from '../../lib/supabase';
import { Modal } from '../../pages/BudgetPage';
import './UserManagement.css';

const ADMIN_DESC = 'Can edit all budget pages, create years, manage categories, clear data, add/manage users.';
const APPROVER_DESC = 'Can validate and lock budget pages (approve submissions).';

export default function UserManagement({ onClose }) {
  const { currentUser, addNotification } = useApp();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId,       setEditingId]       = useState(null);
  const [editName,        setEditName]        = useState('');
  const [editingPassId,   setEditingPassId]   = useState(null);
  const [editPass,        setEditPass]        = useState('');
  const [setupLoginId,    setSetupLoginId]    = useState(null);
  const [setupEmail,      setSetupEmail]      = useState('');
  const [newName,         setNewName]         = useState('');
  const [newEmail,        setNewEmail]        = useState('');
  const [showAddForm,     setShowAddForm]     = useState(false);
  const [temporaryCredentials, setTemporaryCredentials] = useState(null);
  const [credentialsCopied, setCredentialsCopied] = useState(false);
  const [saving,          setSaving]          = useState(false);

  const generateTemporaryPassword = () => {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
    const values = new Uint32Array(16);
    window.crypto.getRandomValues(values);
    return Array.from(values, value => alphabet[value % alphabet.length]).join('');
  };

  const load = () => {
    setLoading(true);
    adminUsers('list')
      .then(data => setUsers(data.users || data || []))
      .catch(() => addNotification('error', 'Failed to load users.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleRename = async (userId) => {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      const result = await adminUsers('update', { profileId: userId, name: editName.trim() });
      const updated = result.user || result;
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, ...updated } : u));
      // ctxUsers updated via WS 'user_renamed' event
      setEditingId(null);
      addNotification('success', 'Name updated.');
    } catch (e) { addNotification('error', e.response?.data?.error || 'Failed to rename.'); }
    finally { setSaving(false); }
  };

  const handleRoleToggle = async (userId, field, currentVal) => {
    try {
      const user = users.find(u => u.id === userId);
      const newRoles = {
        is_admin: field === 'is_admin' ? !currentVal : user.is_admin,
        is_approver: field === 'is_approver' ? !currentVal : user.is_approver,
      };
      await adminUsers('update', { profileId: userId, isAdmin: newRoles.is_admin, isApprover: newRoles.is_approver });
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, ...newRoles } : u));
    } catch (e) { addNotification('error', e.response?.data?.error || 'Failed to update role.'); }
  };

  const handleAdd = async () => {
    if (!newName.trim() || !newEmail.trim()) return;
    setSaving(true);
    try {
      const temporaryPassword = generateTemporaryPassword();
      const result = await adminUsers('create-with-temp-password', { name: newName.trim(), email: newEmail.trim(), password: temporaryPassword });
      const createdUser = result.user?.data || result.user || result.data?.user || result.data || result;
      // Add to local usermgmt list
      setUsers(prev => createdUser?.id && prev.find(u => u.id === createdUser.id) ? prev : [...prev, createdUser]);
      // DO NOT call setCtxUsers here — the WS 'user_added' event handles it
      setNewName('');
      setNewEmail('');
      setShowAddForm(false);
      setCredentialsCopied(false);
      setTemporaryCredentials({ name: createdUser?.name || newName.trim(), email: createdUser?.email || newEmail.trim(), password: temporaryPassword });
      addNotification('success', `"${createdUser?.name || newName.trim()}" added to the system.`);
    } catch (e) { addNotification('error', e.response?.data?.error || 'Failed to add user.'); }
    finally { setSaving(false); }
  };

  const handleSetupLogin = async (user) => {
    if (!setupEmail.trim()) return;
    setSaving(true);
    try {
      const temporaryPassword = generateTemporaryPassword();
      const result = await adminUsers('create-with-temp-password', {
        profileId: user.id,
        name: user.name,
        email: setupEmail.trim(),
        password: temporaryPassword,
      });
      const linkedUser = result.user?.data || result.user || result.data?.user || result.data || result;
      const email = linkedUser?.email || setupEmail.trim().toLowerCase();
      setUsers(prev => prev.map(item => item.id === user.id ? { ...item, ...linkedUser, email } : item));
      setSetupLoginId(null);
      setSetupEmail('');
      setCredentialsCopied(false);
      setTemporaryCredentials({ name: user.name, email, password: temporaryPassword });
      addNotification('success', `Login created for "${user.name}".`);
    } catch (e) {
      addNotification('error', e?.message || 'Failed to create login.');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (userId) => {
    if (!editPass.trim()) return;
    setSaving(true);
    try {
      const newPass = editPass.trim();
      await adminUsers('set-password', { profileId: userId, password: newPass });
      setEditingPassId(null);
      setEditPass('');
      addNotification('success', 'Password updated successfully.');
    } catch (e) { addNotification('error', e.response?.data?.error || 'Failed to update password.'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (user) => {
    if (!window.confirm(`Delete "${user.name}"? This cannot be undone.`)) return;
    try {
      await adminUsers('delete', { profileId: user.id });
      setUsers(prev => prev.filter(u => u.id !== user.id));
      // ctxUsers updated via WS 'user_deleted' event
      addNotification('success', `"${user.name}" removed.`);
    } catch (e) { addNotification('error', e.response?.data?.error || 'Failed to delete.'); }
  };

  return (
    <Modal title="Manage Budget Pages & Users" onClose={onClose} wide>
      <div className="usermgmt-panel">

        {temporaryCredentials && (
          <div className="usermgmt-credentials" role="status">
            <strong>Temporary login created</strong>
            <p>Share these credentials now. The password will not be shown again.</p>
            <div><span>Username</span><code>{temporaryCredentials.email}</code></div>
            <div><span>Password</span><code>{temporaryCredentials.password}</code></div>
            <div className="modal-actions" style={{paddingTop: 4}}>
              <button className="modal-btn modal-btn--primary" onClick={async () => {
                await navigator.clipboard?.writeText(`${temporaryCredentials.email}\n${temporaryCredentials.password}`);
                setCredentialsCopied(true);
              }}>{credentialsCopied ? 'Copied' : 'Copy credentials'}</button>
              <button className="modal-btn modal-btn--secondary" onClick={() => { setTemporaryCredentials(null); setCredentialsCopied(false); }}>Close</button>
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="usermgmt-legend">
          <div className="legend-item">
            <span className="role-badge role-badge--admin" title={ADMIN_DESC}>A</span>
            <div>
              <strong>Admin</strong>
              <p>{ADMIN_DESC}</p>
            </div>
          </div>
          <div className="legend-item">
            <span className="role-badge role-badge--approver" title={APPROVER_DESC}>✓</span>
            <div>
              <strong>Approver</strong>
              <p>{APPROVER_DESC}</p>
            </div>
          </div>
        </div>

        {/* User list — modal-body already scrolls */}
        {loading ? (
            <div className="skeleton" style={{ height: 200 }} />
          ) : (
              <div className="usermgmt-list">
              {users.map(user => (
                <div key={user.id} className="usermgmt-row-wrap">
                <div className="usermgmt-row">
                  {/* Avatar */}
                  <div className="usermgmt-avatar"
                    style={{ backgroundImage: user.profile_picture ? `url(${user.profile_picture})` : undefined }}>
                    {!user.profile_picture && user.initials}
                  </div>

                  {/* Name / edit inline */}
                  <div className="usermgmt-info">
                    {editingId === user.id ? (
                      <div className="usermgmt-edit-row">
                        <input
                          className="modal-input usermgmt-name-input"
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleRename(user.id);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          autoFocus
                        />
                        <button className="modal-btn modal-btn--primary"
                          style={{padding:'5px 10px', fontSize:12}} onClick={() => handleRename(user.id)} disabled={saving}>
                          Save
                        </button>
                        <button className="modal-btn modal-btn--secondary"
                          style={{padding:'5px 10px', fontSize:12}} onClick={() => setEditingId(null)}>
                          ✕
                        </button>
                      </div>
                    ) : (
                      <div>
                        <span className="usermgmt-name">{user.name}</span>
                        {user.email
                          ? <div style={{fontSize:11,color:'var(--gray-500)',marginTop:2}}>{user.email}</div>
                          : <div className="usermgmt-no-login">No email / login</div>}
                      </div>
                    )}
                  </div>

                  {/* Role toggle badges — clickable */}
                  <div className="usermgmt-badges">
                    <button
                      className={`role-badge ${user.is_admin ? 'role-badge--admin' : 'role-badge--off'}`}
                      onClick={() => handleRoleToggle(user.id, 'is_admin', user.is_admin)}
                      title={`${user.is_admin ? 'Remove' : 'Grant'} Admin — ${ADMIN_DESC}`}
                    >A</button>
                    <button
                      className={`role-badge ${user.is_approver ? 'role-badge--approver' : 'role-badge--off'}`}
                      onClick={() => handleRoleToggle(user.id, 'is_approver', user.is_approver)}
                      title={`${user.is_approver ? 'Remove' : 'Grant'} Approver — ${APPROVER_DESC}`}
                    >✓</button>
                  </div>

                  {/* Action buttons */}
                  {editingId !== user.id && editingPassId !== user.id && (
                    <div className="usermgmt-actions">
                      {/* Rename */}
                      <button className="usermgmt-btn"
                        onClick={() => { setEditingId(user.id); setEditName(user.name); setEditingPassId(null); }}
                        title="Rename">
                        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                          <path d="M9.5 2l1.5 1.5-7 7H2.5V9L9.5 2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                        </svg>
                      </button>
                      {user.email ? (
                        /* Change password — never read or display the current password */
                        <button className="usermgmt-btn"
                          onClick={() => { setEditingPassId(user.id); setEditPass(''); setEditingId(null); setSetupLoginId(null); }}
                          title="Issue a new temporary password">
                          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                            <rect x="2.5" y="5.5" width="8" height="6" rx="1" stroke="currentColor" strokeWidth="1.2"/>
                            <path d="M4.5 5.5V4a2 2 0 014 0v1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                            <circle cx="6.5" cy="8.5" r="1" fill="currentColor"/>
                          </svg>
                        </button>
                      ) : (
                        <button className="usermgmt-btn usermgmt-btn--setup"
                          onClick={() => { setSetupLoginId(user.id); setSetupEmail(''); setEditingId(null); setEditingPassId(null); }}
                          title="Set up email and login">
                          @
                        </button>
                      )}
                      {/* Delete */}
                      <button
                        className={`usermgmt-btn ${user.is_admin ? '' : 'usermgmt-btn--danger'}`}
                        onClick={() => !user.is_admin && handleDelete(user)}
                        title={user.is_admin ? 'Cannot delete admin users' : 'Delete user'}
                        style={{opacity: user.is_admin ? 0.3 : 1, cursor: user.is_admin ? 'not-allowed' : 'pointer'}}
                      >
                        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                          <path d="M2 3h9M5 3V2h3v1M4 3v7h5V3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    </div>
                  )}

                </div>
                {editingPassId === user.id && (
                  <div className="usermgmt-pass-row">
                    <span style={{fontSize:11.5,color:'var(--gray-500)',whiteSpace:'nowrap'}}>
                      Password for <strong>{user.name}</strong>:
                    </span>
                    <input
                      type="password"
                      className="modal-input usermgmt-name-input"
                      value={editPass}
                      onChange={e => setEditPass(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleChangePassword(user.id);
                        if (e.key === 'Escape') { setEditingPassId(null); setEditPass(''); }
                      }}
                      placeholder="Password..."
                      autoFocus
                    />
                    <button className="modal-btn modal-btn--primary"
                      style={{padding:'5px 10px',fontSize:12,whiteSpace:'nowrap'}}
                      onClick={() => handleChangePassword(user.id)} disabled={saving || !editPass.trim()}>
                      Save
                    </button>
                    <button className="modal-btn modal-btn--secondary"
                      style={{padding:'5px 10px',fontSize:12}}
                      onClick={() => { setEditingPassId(null); setEditPass(''); }}>
                      ✕
                    </button>
                  </div>
                )}
                {setupLoginId === user.id && (
                  <div className="usermgmt-pass-row">
                    <span style={{fontSize:11.5,color:'var(--gray-500)',whiteSpace:'nowrap'}}>
                      Email for <strong>{user.name}</strong>:
                    </span>
                    <input
                      type="email"
                      className="modal-input usermgmt-name-input"
                      value={setupEmail}
                      onChange={e => setSetupEmail(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleSetupLogin(user);
                        if (e.key === 'Escape') { setSetupLoginId(null); setSetupEmail(''); }
                      }}
                      placeholder="name@company.com"
                      autoFocus
                    />
                    <button className="modal-btn modal-btn--primary"
                      style={{padding:'5px 10px',fontSize:12,whiteSpace:'nowrap'}}
                      onClick={() => handleSetupLogin(user)} disabled={saving || !setupEmail.trim()}>
                      {saving ? 'Creating...' : 'Set up login'}
                    </button>
                    <button className="modal-btn modal-btn--secondary"
                      style={{padding:'5px 10px',fontSize:12}}
                      onClick={() => { setSetupLoginId(null); setSetupEmail(''); }}>
                      ✕
                    </button>
                  </div>
                )}
                </div>
              ))}
            </div>
          )}

          {/* Add new user */}
          {showAddForm ? (
            <div className="usermgmt-add-form">
              <input
                className="modal-input"
                placeholder="Full name (e.g. João Silva)"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setShowAddForm(false); }}
                autoFocus
              />
              <input
                className="modal-input"
                type="email"
                placeholder="Email address"
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
              />
              <p className="modal-hint">A temporary password will be generated. Give it to the user; they must change it on first login.</p>
              <div className="modal-actions" style={{paddingTop:0}}>
                <button className="modal-btn modal-btn--secondary" onClick={() => { setShowAddForm(false); setNewName(''); setNewEmail(''); }}>Cancel</button>
                <button className="modal-btn modal-btn--primary" onClick={handleAdd} disabled={saving || !newName.trim() || !newEmail.trim()}>
                  {saving ? 'Creating user...' : 'Create User'}
                </button>
              </div>
            </div>
          ) : (
            <button className="usermgmt-add-btn" onClick={() => setShowAddForm(true)}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              Add New User / Budget Page
            </button>
          )}
      </div>{/* usermgmt-panel */}

      <div style={{display:'flex', justifyContent:'flex-end', padding:'4px 0'}}>
        <button className="modal-btn modal-btn--secondary" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
