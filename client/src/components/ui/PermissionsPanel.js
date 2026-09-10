import React, { useState, useEffect } from 'react';
import { useApp, ADMIN_USERS } from '../../context/AppContext';
import { Modal } from '../../pages/BudgetPage';
import './PermissionsPanel.css';

const PERM_LABELS = {
  can_edit_all_pages: { label: 'Edit all budget pages', desc: 'Can view and edit other users\' budget pages' },
  can_create_years: { label: 'Create budget years', desc: 'Can create new budget years' },
  can_add_categories: { label: 'Add / manage categories', desc: 'Can add, rename or delete categories' },
  can_clear_data: { label: 'Clear data / System Reset', desc: 'Can clear a page\'s data or reset the entire system' },
};

export default function PermissionsPanel({ onClose }) {
  const { users, currentUser, API, addNotification } = useApp();
  const [allPerms, setAllPerms] = useState([]);
  const [saving, setSaving] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    API.get('/permissions')
      .then(r => setAllPerms(r.data))
      .catch(() => addNotification('error', 'Failed to load permissions.'))
      .finally(() => setLoading(false));
  }, [API]);

  const updatePerm = async (userId, key, value) => {
    const user = allPerms.find(u => u.id === userId);
    if (!user) return;
    const updated = { ...user, [key]: value ? 1 : 0 };
    setAllPerms(prev => prev.map(u => u.id === userId ? updated : u));
    setSaving(prev => ({ ...prev, [userId]: true }));
    try {
      await API.put(`/permissions/${userId}`, {
        requestingUserId: currentUser?.id,
        can_edit_all_pages: updated.can_edit_all_pages,
        can_create_years: updated.can_create_years,
        can_add_categories: updated.can_add_categories,
        can_clear_data: updated.can_clear_data,
        restricted_pages: updated.restricted_pages || '',
      });
    } catch { addNotification('error', 'Failed to save permission.'); }
    finally { setSaving(prev => ({ ...prev, [userId]: false })); }
  };

  const regularUsers = allPerms.filter(u => !u.is_admin);

  return (
    <Modal title="User Permissions" onClose={onClose}>
      <div className="perms-panel">
        {loading ? (
          <div className="skeleton" style={{ height: 200 }} />
        ) : (
          <>
            <p className="perms-intro">
              Configure permissions for non-admin users.
              Admins (<strong>Francisco Esteves, Bianca Levy, Benedita C. Machado</strong>) always have full access.
            </p>
            <div className="perms-table">
              <div className="perms-header-row">
                <div className="perms-user-col">User</div>
                {Object.entries(PERM_LABELS).map(([key, { label }]) => (
                  <div key={key} className="perms-check-col" title={PERM_LABELS[key].desc}>{label}</div>
                ))}
              </div>
              {regularUsers.map(user => (
                <div key={user.id} className={`perms-row ${saving[user.id] ? 'perms-row--saving' : ''}`}>
                  <div className="perms-user-col">
                    <span className="perms-avatar">{user.initials}</span>
                    <span className="perms-name">{user.name}</span>
                    {saving[user.id] && <span className="perms-saving-dot" />}
                  </div>
                  {Object.keys(PERM_LABELS).map(key => (
                    <div key={key} className="perms-check-col">
                      <label className="perms-toggle">
                        <input
                          type="checkbox"
                          checked={!!user[key]}
                          onChange={e => updatePerm(user.id, key, e.target.checked)}
                        />
                        <span className="perms-toggle-track" />
                      </label>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <p className="perms-note">
              Changes take effect immediately. Users need to refresh their browser to see permission changes.
            </p>
          </>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 0 4px' }}>
        <button className="modal-btn modal-btn--secondary" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
