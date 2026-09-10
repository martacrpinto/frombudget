import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { usePermissions } from '../../hooks/usePermissions';
import Sidebar from './Sidebar';
import Header from './Header';
import Dashboard from '../../pages/Dashboard';
import DashboardHeads from '../../pages/DashboardHeads';
import BudgetPage from '../../pages/BudgetPage';
import TotalBudget from '../../pages/TotalBudget';
import TotalBudgetHeads from '../../pages/TotalBudgetHeads';
import AuditLog from '../../pages/AuditLog';
import RemunerationSimulator from '../../pages/RemunerationSimulator';
import './Layout.css';

// Simple blocked page for restricted sections
function BlockedPage({ title }) {
  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',minHeight:'50vh',gap:16,padding:48,textAlign:'center'}}>
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
        <rect x="6" y="22" width="36" height="22" rx="3" stroke="#d0d0d0" strokeWidth="2"/>
        <path d="M14 22V16a10 10 0 0120 0v6" stroke="#d0d0d0" strokeWidth="2" strokeLinecap="round"/>
        <circle cx="24" cy="33" r="3" fill="#d0d0d0"/>
      </svg>
      <h2 style={{fontSize:20,fontWeight:600,color:'#707070'}}>{title}</h2>
      <p style={{fontSize:13.5,color:'#a0a0a0',maxWidth:360}}>
        You don't have permission to view this section. Contact an admin if you need access.
      </p>
    </div>
  );
}

export default function Layout() {
  const { notifyPageChange, setAvailableYears, setCategories } = useApp();
  const perms = usePermissions();
  const [currentPage, setCurrentPage] = useState({ type: 'dashboard-heads' });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [pageKey, setPageKey] = useState(0);

  const navigate = (page) => {
    setCurrentPage(page);
    const label = page.type === 'budget' ? page.userId : page.type;
    notifyPageChange(label);
  };

  useEffect(() => {
    const handler = (e) => {
      if (e.detail?.type === 'system_reset') {
        setAvailableYears([]);
        setCategories([]);
        setPageKey(k => k + 1);
      }
      if (e.detail?.type === 'page_cleared' && currentPage.type === 'budget' && e.detail?.userId === currentPage.userId) {
        setPageKey(k => k + 1);
      }
    };
    window.addEventListener('ws_message', handler);
    return () => window.removeEventListener('ws_message', handler);
  }, [currentPage]);

  const handlePageCleared = useCallback(() => { setPageKey(k => k + 1); }, []);
  const handleRefresh    = useCallback(() => { setPageKey(k => k + 1); }, []);

  const renderPage = () => {
    switch (currentPage.type) {
      // Dashboard Heads — ALL users
      case 'dashboard-heads': return <DashboardHeads key={pageKey} />;

      // Dashboard From — admins only
      case 'dashboard':
        if (!perms.isAdmin) return <BlockedPage title="Dashboard From — Restricted" />;
        return <Dashboard key={pageKey} />;

      case 'budget': return <BudgetPage key={`${currentPage.userId}-${pageKey}`} userId={currentPage.userId} />;

      // Total Budget Heads — ALL users
      case 'total-heads': return <TotalBudgetHeads key={pageKey} />;

      // Total Budget From — admins only
      case 'total':
        if (!perms.isAdmin) return <BlockedPage title="Total Budget From — Restricted" />;
        return <TotalBudget key={pageKey} />;

      case 'audit':
        if (!perms.isAdmin) return <BlockedPage title="Audit Log — Restricted" />;
        return <AuditLog key={pageKey} />;

      case 'remuneration': return <RemunerationSimulator key={pageKey} />;
      default:
        // Non-admins start on Dashboard Heads; admins start on Dashboard Heads too (cleaner)
        return <DashboardHeads key={pageKey} />;
    }
  };

  return (
    <div className="layout">
      <Sidebar currentPage={currentPage} navigate={navigate} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(c => !c)} />
      <div className={`layout-main ${sidebarCollapsed ? 'layout-main--collapsed' : ''}`}>
        <Header currentPage={currentPage} onPageCleared={handlePageCleared} onRefresh={handleRefresh} />
        <main className="layout-content">
          {renderPage()}
        </main>
      </div>
    </div>
  );
}
