import React from 'react';
import { useApp } from '../../context/AppContext';
import { usePermissions } from '../../hooks/usePermissions';
import './Sidebar.css';

const NAV_ICONS = {
  remuneration: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="6" r="3.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M2 16c0-3.9 3.1-7 7-7s7 3.1 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M9 8v2M7.5 10h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  ),
  dashboard: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="1" y="1" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
      <rect x="10" y="1" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
      <rect x="1" y="10" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
      <rect x="10" y="10" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  ),
  budget: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="2" y="3" width="14" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M5 7h8M5 10h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
  total: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M2 14L6 10l3 3 4-5 3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <rect x="1" y="1" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  ),
  audit: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M4 4h10M4 8h10M4 12h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <circle cx="14" cy="14" r="3" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M16.5 16.5l-1.5-1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
  person: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M2 13c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
  collapse: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M10 4L6 8l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  expand: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
};

export default function Sidebar({ currentPage, navigate, collapsed, onToggle }) {
  const { users, currentUser, activeUsers } = useApp();
  const perms = usePermissions();

  const isActive = (type, userId) => {
    if (type === 'budget') return currentPage.type === 'budget' && currentPage.userId === userId;
    if (type === 'remuneration') return currentPage.type === 'remuneration';
    if (type === 'total-heads') return currentPage.type === 'total-heads';
    if (type === 'dashboard-heads') return currentPage.type === 'dashboard-heads';
    return currentPage.type === type;
  };

  return (
    <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
      {/* Logo */}
      <div className="sidebar-logo" onClick={() => navigate({ type: 'dashboard' })}>
        {collapsed ? (
          <svg viewBox="0 0 52 52" className="sidebar-logo-icon" style={{overflow:'visible'}}>
            <text x="2" y="44" fontFamily="Georgia, 'Times New Roman', serif" fontSize="46" fontStyle="italic" fill="#000">f:</text>
          </svg>
        ) : (
          <svg viewBox="0 0 200 48" className="sidebar-logo-full" style={{overflow:'visible'}}>
            <text x="2" y="42" fontFamily="Georgia, 'Times New Roman', serif" fontSize="44" fontStyle="italic" fill="#000">from:</text>
          </svg>
        )}
      </div>

      <div className="sidebar-divider" />

      {/* Navigation */}
      <nav className="sidebar-nav">
        {/* Dashboard From — admins only (locked for others) — FIRST */}
        {perms.isAdmin ? (
          <NavItem
            icon={NAV_ICONS.dashboard}
            label="Dashboard From"
            active={isActive('dashboard')}
            collapsed={collapsed}
            onClick={() => navigate({ type: 'dashboard' })}
          />
        ) : (
          <LockedNavItem
            label="Dashboard From"
            icon={NAV_ICONS.dashboard}
            collapsed={collapsed}
          />
        )}

        {/* Dashboard Heads — visible to ALL users — SECOND */}
        <NavItem
          icon={NAV_ICONS.dashboard}
          label="Dashboard Heads"
          active={isActive('dashboard-heads')}
          collapsed={collapsed}
          onClick={() => navigate({ type: 'dashboard-heads' })}
        />

        {/* Budgets section */}
        {!collapsed && (
          <div className="sidebar-section-label">Budgets</div>
        )}

        {collapsed && <div className="sidebar-section-divider" />}

        {users.map(user => {
          const isOnline = user.id !== currentUser?.id && !!activeUsers[user.id];
          const onlinePage = activeUsers[user.id]?.page;
          // Approver pages are locked for viewers who are neither admins nor approvers.
          const isApproverPage = !!user.is_approver;
          const isLockedForViewer = isApproverPage && !perms.isAdmin && !perms.isApprover;

          if (isLockedForViewer) {
            return (
              <LockedNavItem
                key={user.id}
                label={user.name}
                initials={user.initials}
                profilePicture={user.profile_picture}
                collapsed={collapsed}
              />
            );
          }

          return (
            <NavItem
              key={user.id}
              icon={NAV_ICONS.person}
              label={user.name}
              sublabel={user.id === currentUser?.id ? 'You' : null}
              onlineLabel={isOnline ? (onlinePage || 'Online') : null}
              active={isActive('budget', user.id)}
              collapsed={collapsed}
              onClick={() => navigate({ type: 'budget', userId: user.id })}
              isOnline={isOnline}
              profilePicture={user.profile_picture}
              initials={user.initials}
            />
          );
        })}

        {/* ── Totals section — no label, just a visual separator ── */}
        <div className="sidebar-section-divider" />

        {/* Total Budget (Heads) — heads users only — visible to ALL */}
        <NavItem
          icon={NAV_ICONS.total}
          label="Total Budget (Heads)"
          active={isActive('total-heads')}
          collapsed={collapsed}
          onClick={() => navigate({ type: 'total-heads' })}
        />

        {/* Total Budget From — all users — admins only (locked for others) */}
        {perms.isAdmin ? (
          <NavItem
            icon={NAV_ICONS.total}
            label="Total Budget From"
            active={isActive('total')}
            collapsed={collapsed}
            onClick={() => navigate({ type: 'total' })}
          />
        ) : (
          <LockedNavItem
            label="Total Budget From"
            icon={NAV_ICONS.total}
            collapsed={collapsed}
          />
        )}

        {/* REMUNERATION section */}
        <div className="sidebar-section-divider" />
        {!collapsed && <div className="sidebar-section-label">Remuneration</div>}

        <NavItem
          icon={NAV_ICONS.remuneration}
          label="Remuneration Simulator"
          active={isActive('remuneration')}
          collapsed={collapsed}
          onClick={() => navigate({ type: 'remuneration' })}
        />

        {/* Audit Log — admins only; locked for others */}
        <div className="sidebar-section-divider" style={{marginTop:'auto'}} />
        {perms.isAdmin ? (
          <NavItem
            icon={NAV_ICONS.audit}
            label="Audit Log"
            active={isActive('audit')}
            collapsed={collapsed}
            onClick={() => navigate({ type: 'audit' })}
          />
        ) : (
          <LockedNavItem
            label="Audit Log"
            initials="AL"
            profilePicture={null}
            collapsed={collapsed}
          />
        )}
      </nav>

      {/* Collapse toggle */}
      <button className="sidebar-toggle" onClick={onToggle} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
        {collapsed ? NAV_ICONS.expand : NAV_ICONS.collapse}
        {!collapsed && <span>Collapse</span>}
      </button>
    </aside>
  );
}

// Locked page — shown to non-admins for restricted pages.
// If `icon` prop is passed, it is rendered instead of the avatar initials.
function LockedNavItem({ label, initials, profilePicture, collapsed, icon }) {
  return (
    <div
      className="nav-item nav-item--locked"
      title={collapsed ? `${label} (Restricted)` : undefined}
    >
      <span className="nav-item-icon" style={{opacity: 0.45}}>
        {icon ? icon : (
          <span className="nav-avatar nav-avatar--locked"
            style={{ backgroundImage: profilePicture ? `url(${profilePicture})` : undefined }}>
            {!profilePicture && initials}
          </span>
        )}
      </span>
      {!collapsed && (
        <span className="nav-item-content">
          <span className="nav-item-label truncate" style={{color:'var(--gray-300)'}}>{label}</span>
          <span className="nav-locked-badge">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <rect x="1.5" y="4.5" width="7" height="5" rx="0.8" stroke="currentColor" strokeWidth="1.1"/>
              <path d="M3 4.5V3.5a2 2 0 014 0v1" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
            </svg>
            Restricted
          </span>
        </span>
      )}
    </div>
  );
}

function NavItem({ icon, label, sublabel, onlineLabel, active, collapsed, onClick, isOnline, profilePicture, initials, isSpecial }) {
  return (
    <button
      className={`nav-item ${active ? 'nav-item--active' : ''} ${isSpecial ? 'nav-item--special' : ''}`}
      onClick={onClick}
      title={collapsed ? (isOnline ? `${label} · Online` : label) : undefined}
    >
      <span className="nav-item-icon">
        {initials ? (
          <span
            className={`nav-avatar ${isOnline ? 'nav-avatar--online' : ''}`}
            style={{ backgroundImage: profilePicture ? `url(${profilePicture})` : undefined }}
          >
            {!profilePicture && initials}
            {isOnline && <span className="nav-online-dot" />}
          </span>
        ) : (
          icon
        )}
      </span>
      {!collapsed && (
        <span className="nav-item-content">
          <span className="nav-item-label truncate">{label}</span>
          {sublabel && <span className="nav-item-sublabel">{sublabel}</span>}
          {isOnline && !sublabel && <span className="nav-online-badge">● online</span>}
        </span>
      )}
    </button>
  );
}
