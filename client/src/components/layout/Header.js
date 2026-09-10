import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../../pages/BudgetPage';
import { usePermissions } from '../../hooks/usePermissions';
import UserManagement from '../ui/UserManagement';
import { supabase, uploadAvatar, removeAvatar } from '../../lib/supabase';
import './Header.css';

const PAGE_LABELS = {
  dashboard: 'Dashboard From',
  'dashboard-heads': 'Dashboard Heads',
  total: 'Total Budget From',
  'total-heads': 'Total Budget (Heads)',
  audit: 'Audit Log',
  remuneration: 'Remuneration Simulator',
};

export default function Header({ currentPage, onPageCleared, onRefresh }) {
  const { currentUser, users, logout, saveStatus, API, addNotification, setCurrentUser, setAvailableYears, setCategories } = useApp();
  const perms = usePermissions();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [showUserMgmt, setShowUserMgmt] = useState(false);

  const menuRef = useRef(null);
  const fileInputRef = useRef(null);

  const isBudgetPage = currentPage.type === 'budget';
  const pageUser = isBudgetPage ? users.find(u => u.id === currentPage.userId) : null;
  const pageLabel = isBudgetPage ? (pageUser?.name || 'Budget') : PAGE_LABELS[currentPage.type] || '';

  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handlePictureUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const result = await uploadAvatar(currentUser.id, file);
      setCurrentUser(prev => ({ ...prev, profile_picture: result.url, profile_picture_path: result.path }));
      addNotification('success', 'Profile picture updated.');
    } catch { addNotification('error', 'Failed to upload picture.'); }
    setMenuOpen(false);
  };

  const handleRemovePicture = async () => {
    try {
      await removeAvatar(currentUser.id, currentUser.profile_picture_path || currentUser.profile_picture);
      setCurrentUser(prev => ({ ...prev, profile_picture: null }));
      addNotification('success', 'Profile picture removed.');
    } catch { addNotification('error', 'Failed to remove picture.'); }
    setMenuOpen(false);
  };

  const handleClearPage = async () => {
    try {
      await API.delete(`/budget/clear/${currentPage.userId}`, {
        data: { requestingUserId: currentUser?.id, requestingUserName: currentUser?.name }
      });
      setShowClearModal(false);
      addNotification('success', `All data for ${pageUser?.name} has been cleared.`);
      if (onPageCleared) onPageCleared();
    } catch { addNotification('error', 'Failed to clear page data.'); }
  };

  const handleSystemReset = async () => {
    try {
      await API.delete('/budget/system-reset', {
        data: { requestingUserId: currentUser?.id, requestingUserName: currentUser?.name }
      });
      setShowResetModal(false);
      setAvailableYears([]);
      setCategories([]);
      addNotification('success', 'System has been reset. All data cleared.');
      window.dispatchEvent(new CustomEvent('ws_message', { detail: { type: 'system_reset' } }));
    } catch { addNotification('error', 'Failed to reset system.'); }
  };

  const saveLabel = { idle: null, saving: 'Saving...', saved: 'Saved', error: 'Error saving changes' }[saveStatus];

  return (
    <>
      <header className="header">
        <div className="header-left">
          <div className="header-breadcrumb">
            <span className="header-section">from:</span>
            {pageLabel && (<><span className="header-sep">·</span><span className="header-page">{pageLabel}</span></>)}
          </div>
        </div>

        <div className="header-right">
          {saveLabel && (
            <div className={`save-status save-status--${saveStatus}`}>
              {saveStatus === 'saving' && <span className="save-spinner" />}
              {saveLabel}
            </div>
          )}

          {/* Refresh current page */}
          <button className="header-refresh-btn" onClick={onRefresh} title="Refresh page">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2.5 8a5.5 5.5 0 0 1 9.5-3.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M13.5 8a5.5 5.5 0 0 1-9.5 3.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M12 2.5v3.5h-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M4 13.5v-3.5h3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          <div className="user-menu-wrapper" ref={menuRef}>
            <button className="user-avatar-btn" onClick={() => setMenuOpen(o => !o)} title={currentUser?.name}>
              {currentUser?.profile_picture ? (
                <img src={currentUser.profile_picture} alt={currentUser.name} className="user-avatar-img" />
              ) : (
                <span className="user-avatar-initials">{currentUser?.initials}</span>
              )}
            </button>

            {menuOpen && (
              <div className="user-menu animate-slideIn">
                <div className="user-menu-header">
                  <div className="user-menu-name">{currentUser?.name}</div>
                  <div className="user-menu-role">Active session</div>
                </div>
                <div className="user-menu-divider" />

                <button className="user-menu-item" onClick={() => { fileInputRef.current?.click(); setMenuOpen(false); }}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M7 1v8M4 6l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M1 11h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                  Upload Profile Picture
                </button>
                {currentUser?.profile_picture && (
                  <button className="user-menu-item user-menu-item--danger" onClick={handleRemovePicture}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                    Remove Profile Picture
                  </button>
                )}

                {isBudgetPage && (perms.canClearData || (perms.canClearOwnPage && currentPage.userId === currentUser?.id)) && (
                  <>
                    <div className="user-menu-divider" />
                    <button className="user-menu-item user-menu-item--danger" onClick={() => { setMenuOpen(false); setShowClearModal(true); }}>
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M2 4h10M5 4V2.5h4V4M3 4l1 8h6l1-8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      Clear All Page Data
                    </button>
                  </>
                )}

                {perms.canClearData && (
                  <>
                    <div className="user-menu-divider" />
                    <button className="user-menu-item user-menu-item--warning" onClick={() => { setMenuOpen(false); setShowResetModal(true); }}>
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M7 1.5A5.5 5.5 0 1 0 12.5 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                        <path d="M12.5 1.5v3h-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M7 5v2.5l1.5 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                      </svg>
                      System Reset (all data)
                    </button>
                  </>
                )}



                {/* User management — admin only */}
                {perms.isAdmin && (
                  <>
                    <div className="user-menu-divider" />
                    <button className="user-menu-item" onClick={() => { setMenuOpen(false); setShowUserMgmt(true); }}>
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <circle cx="5" cy="4.5" r="2.5" stroke="currentColor" strokeWidth="1.3"/>
                        <path d="M1 12c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                        <path d="M11 7v4M9 9h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                      </svg>
                      Manage Users & Pages
                    </button>
                  </>
                )}

                <div className="user-menu-divider" />
                <button className="user-menu-item user-menu-item--danger" onClick={() => { setMenuOpen(false); logout(); }}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M5 2H2v10h3M10 9l3-2-3-2M6 7h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Log Out
                </button>
              </div>
            )}
          </div>

          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePictureUpload} />
        </div>
      </header>

      {/* Clear Page Modal */}
      {showClearModal && (
        <Modal title="Clear All Page Data" onClose={() => setShowClearModal(false)}>
          <div className="modal-warning-block">
            <div className="modal-warning-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M12 9v4M12 17h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
              </svg>
            </div>
            <div>
              <p className="modal-warning-title">This will permanently delete all budget data for <strong>{pageUser?.name}</strong>.</p>
              <p className="modal-hint" style={{marginTop:8}}>All values across all years, notes and page status will be erased. This action cannot be undone.</p>
            </div>
          </div>
          <div className="modal-actions">
            <button className="modal-btn modal-btn--secondary" onClick={() => setShowClearModal(false)}>Cancel</button>
            <button className="modal-btn modal-btn--danger" onClick={handleClearPage}>Yes, Clear All Data</button>
          </div>
        </Modal>
      )}

      {showUserMgmt && <UserManagement onClose={() => setShowUserMgmt(false)} />}

      {/* System Reset Modal */}
      {showResetModal && (
        <Modal         title="System Reset — All Data" onClose={() => setShowResetModal(false)}>
          <div className="modal-warning-block">
            <div className="modal-warning-icon modal-warning-icon--red">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <p className="modal-warning-title">This will erase <strong>all data in the system</strong>.</p>
              <ul className="modal-reset-list">
                <li>All budget values (all users, all years)</li>
                <li>All categories and types</li>
                <li>All notes and comments</li>
                <li>All audit log entries</li>
                <li>All export history and Excel files</li>
                <li>All page statuses</li>
              </ul>
              <p className="modal-hint" style={{marginTop:8}}>User accounts and profile pictures will be preserved. This resets the system to a clean state ready for new budget data.</p>
            </div>
          </div>
          <div className="modal-actions">
            <button className="modal-btn modal-btn--secondary" onClick={() => setShowResetModal(false)}>Cancel</button>
            <button className="modal-btn modal-btn--danger" onClick={handleSystemReset}>Yes, Reset Everything</button>
          </div>
        </Modal>
      )}
    </>
  );
}
