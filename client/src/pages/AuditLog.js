import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import './AuditLog.css';

export default function AuditLog() {
  const { users, API } = useApp();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pages, setPages] = useState([]);

  // Filters: only search, user, page
  const [filters, setFilters] = useState({ userId: '', budgetPage: '', search: '' });
  const [offset, setOffset] = useState(0);
  const LIMIT = 100;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = { ...filters, limit: LIMIT, offset };
      Object.keys(params).forEach(k => { if (!params[k] && params[k] !== 0) delete params[k]; });
      const res = await API.get('/audit', { params });
      setRows(res.data.rows);
      setTotal(res.data.total);
    } catch {} finally {
      setLoading(false);
    }
  }, [filters, offset, API]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    API.get('/audit/pages').then(r => setPages(r.data)).catch(() => {});
  }, [API]);

  const setFilter = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setOffset(0);
  };

  const clearFilters = () => {
    setFilters({ userId: '', budgetPage: '', search: '' });
    setOffset(0);
  };

  const hasFilters = Object.values(filters).some(v => v !== '');

  const actionColors = {
    'Value Updated': 'action--value',
    'Category Created': 'action--created',
    'Category Renamed': 'action--renamed',
    'Category Reordered': 'action--reordered',
    'Category Deleted': 'action--deleted',
    'Type Changed': 'action--type',
    'Excel Exported': 'action--export',
    'Year Created': 'action--created',
  };

  // Column order: Date&Time | User | Page | Category | Year | Month | Previous Value | New Value | Action
  return (
    <div className="audit-page">
      <div className="audit-header">
        <h1 className="audit-title">Audit Log</h1>
        <p className="audit-desc">Complete record of all changes. Read-only.</p>
      </div>

      {/* Filters: search + user + page only */}
      <div className="audit-filters">
        <div className="filter-row">
          <input
            type="text"
            className="filter-search"
            placeholder="Search..."
            value={filters.search}
            onChange={e => setFilter('search', e.target.value)}
          />
          <select className="filter-select" value={filters.userId} onChange={e => setFilter('userId', e.target.value)}>
            <option value="">All Users</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select className="filter-select" value={filters.budgetPage} onChange={e => setFilter('budgetPage', e.target.value)}>
            <option value="">All Pages</option>
            {pages.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          {hasFilters && (
            <button className="filter-clear" onClick={clearFilters}>Clear</button>
          )}
        </div>
        <div className="audit-count">{total.toLocaleString()} entries</div>
      </div>

      {/* Table */}
      <div className="audit-table-wrapper">
        {loading ? (
          <div className="audit-loading">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="skeleton" style={{ height: 44, marginBottom: 4 }} />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="audit-empty">No entries match the current filters.</div>
        ) : (
          <table className="audit-table">
            <thead>
              <tr>
                <th>Date &amp; Time</th>
                <th>User</th>
                <th>Page</th>
                <th>Category</th>
                <th>Year</th>
                <th>Month</th>
                <th>Previous Value</th>
                <th>New Value</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id}>
                  <td className="audit-timestamp">
                    {new Date(row.timestamp).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                  </td>
                  <td>{row.user_name || '—'}</td>
                  <td>{row.budget_page || '—'}</td>
                  <td className="cat-cell">{row.category_name || '—'}</td>
                  <td>{row.year || '—'}</td>
                  <td>{row.field || '—'}</td>
                  <td className="value-cell prev">{row.previous_value || '—'}</td>
                  <td className="value-cell next">{row.new_value || '—'}</td>
                  <td>
                    <span className={`action-badge ${actionColors[row.action] || ''}`}>
                      {row.action}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {total > LIMIT && (
        <div className="audit-pagination">
          <button className="page-btn" onClick={() => setOffset(Math.max(0, offset - LIMIT))} disabled={offset === 0}>Previous</button>
          <span className="page-info">{offset + 1}–{Math.min(offset + LIMIT, total)} of {total}</span>
          <button className="page-btn" onClick={() => setOffset(offset + LIMIT)} disabled={offset + LIMIT >= total}>Next</button>
        </div>
      )}
    </div>
  );
}
