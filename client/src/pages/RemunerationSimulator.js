import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { useApp } from '../context/AppContext';
import { usePermissions } from '../hooks/usePermissions';
import { Modal } from './BudgetPage';
import { supabase } from '../lib/supabase';
import { generateRemunerationWorkbook } from '../lib/exportRemunerationWorkbook';
import {
  REMUNERATION_MONTHS,
  calculateMonthlyRemuneration,
  calculateRemuneration,
  normalizeEntryMonth,
} from '../lib/remunerationCalculations';
import './RemunerationSimulator.css';

// ─── NameCell: read-only td — clips text, shows portal tooltip on hover ──────
function NameCell({ children, text, className = '', style = {}, ...tdProps }) {
  const tdRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);

  const handleMouseEnter = () => {
    if (!tdRef.current) return;
    const r = tdRef.current.getBoundingClientRect();
    setTooltip({ top: r.top + r.height / 2, left: r.left });
  };
  const handleMouseLeave = () => setTooltip(null);

  return (
    <td
      ref={tdRef}
      className={`remun-name-td${className ? ' ' + className : ''}`}
      style={style}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      {...tdProps}
    >
      <div className="remun-name-wrap">{children}</div>
      {tooltip && ReactDOM.createPortal(
        <div className="remun-name-tooltip" style={{ top: tooltip.top, left: tooltip.left }}>
          {text || (typeof children === 'string' ? children : '')}
        </div>,
        document.body
      )}
    </td>
  );
}

// ─── EditableNameCell: editable td — shows text clipped with tooltip on hover,
//     switches to a full-width input on click, saves on blur/Enter ─────────────
function EditableNameCell({ value, onChange, style = {} }) {
  const tdRef = useRef(null);
  const inputRef = useRef(null);
  const [editing, setEditing] = useState(false);
  const [tooltip, setTooltip] = useState(null);

  const handleMouseEnter = () => {
    if (editing) return;
    if (!tdRef.current) return;
    const r = tdRef.current.getBoundingClientRect();
    setTooltip({ top: r.top + r.height / 2, left: r.left });
  };
  const handleMouseLeave = () => setTooltip(null);

  const startEdit = () => {
    setTooltip(null);
    setEditing(true);
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, 0);
  };

  const stopEdit = () => setEditing(false);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      stopEdit();
    }
  };

  return (
    <td
      ref={tdRef}
      className="remun-name-td"
      style={{ cursor: editing ? 'text' : 'pointer', ...style }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={() => { if (!editing) startEdit(); }}
    >
      {editing ? (
        <input
          ref={inputRef}
          type="text"
          className="remun-num-input"
          style={{ textAlign: 'left', padding: '0 8px', fontSize: 12, height: '50px', cursor: 'text' }}
          value={value || ''}
          placeholder="Name..."
          onChange={e => onChange(e.target.value)}
          onBlur={stopEdit}
          onKeyDown={handleKeyDown}
          onClick={e => e.stopPropagation()}
        />
      ) : (
        <div className="remun-name-wrap" title="">
          {value
            ? <span style={{ color: 'var(--gray-800)', fontSize: 12 }}>{value}</span>
            : <span style={{ color: 'var(--gray-300)', fontSize: 12, fontStyle: 'italic' }}>Name...</span>
          }
        </div>
      )}
      {!editing && tooltip && value && ReactDOM.createPortal(
        <div className="remun-name-tooltip" style={{ top: tooltip.top, left: tooltip.left }}>
          {value}
        </div>,
        document.body
      )}
    </td>
  );
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ROLES = [
  'Trainee', 'Summer Trainee',
  'Junior Analyst', 'Analyst', 'Senior Analyst',
  'Associate', 'Senior Associate',
  'Manager', 'Senior Manager',
  'Director', 'General Director', 'CEO',
];

const MONTHS_FULL = REMUNERATION_MONTHS;
const MONTHS_S = REMUNERATION_MONTHS.map(month => month.slice(0, 3));

// ─── Calculation Engine ───────────────────────────────────────────────────────

function calcMonthly(fte, cfg) {
  return calculateMonthlyRemuneration(fte, cfg);
}

// ─── Format helpers ───────────────────────────────────────────────────────────

function fmtEur(v) {
  if (v === null || v === undefined) return '—';
  const n = parseFloat(v);
  if (isNaN(n)) return '—';
  if (n === 0) return '—';
  const abs = Math.abs(n);
  const fmt = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(abs) + '€';
  return n < 0 ? `(${fmt})` : fmt;
}

function fmtEur0(v) {
  // Same but shows 0
  const n = parseFloat(v) || 0;
  const abs = Math.abs(n);
  const fmt = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(abs) + '€';
  return n < 0 ? `(${fmt})` : fmt;
}

// ─── Tooltip Cell ─────────────────────────────────────────────────────────────

function CalcCell({ annual, monthly, label, className = '' }) {
  const tip = `${label}\nAnnual: ${fmtEur0(annual)}\nMonthly: ${fmtEur0(monthly)}`;
  return (
    <td className={`col-num-calc calc-cell ${className}`} title={tip}>
      <span className="calc-val">{fmtEur(annual)}</span>
      <span className="calc-monthly-hint">{fmtEur(monthly)}/mo</span>
    </td>
  );
}

function TotalCalcCell({ annual, monthly, className = '', label = '' }) {
  const tip = label ? `${label}\nAnnual: ${fmtEur0(annual)}\nMonthly: ${fmtEur0(monthly)}` : undefined;
  return (
    <td className={`col-num-calc calc-cell total-col ${className}`} title={tip}>
      <span className="calc-val">{fmtEur(annual)}</span>
      <span className="calc-monthly-hint">{fmtEur(monthly)}/mo</span>
    </td>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function RemunerationSimulator() {
  const { currentUser, users, availableYears, API, setSaving, setSaved, setSaveError, addNotification } = useApp();
  const perms = usePermissions();
  const currentUserId = currentUser?.id;

  // ── Year filter (shared with budget pages) ──────────────────────────────────
  const defaultYear = availableYears.length > 0 ? availableYears[0] : new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(defaultYear);

  // ── User filter (admins only) — 'me' = own page, userId = specific, '' = All ──
  const [viewUserId, setViewUserId] = useState('me'); // 'me' | '' (all) | specific userId

  // Effective userId for data loading
  const isAllView  = viewUserId === '';
  const targetUserId = viewUserId === 'me' ? currentUserId : viewUserId || currentUserId;
  const isOwnPage  = targetUserId === currentUserId;
  // Admins can edit any specific user's page; non-admins only their own. All-view is always read-only.
  const canEdit    = !isAllView && (isOwnPage || perms.isAdmin);

  const [ftes, setFtes] = useState([]);      // FTEs for current view
  const [allFtes, setAllFtes] = useState([]); // all users' FTEs (for All view)
  const [cfg, setCfg] = useState({
    monthly_payments: 14,
    iht_rate: 0.25,
    meal_allowance_days: 220,
    holiday_allowance_month: 6,
    christmas_allowance_month: 12,
  });
  const [loading, setLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportHistory, setExportHistory] = useState([]);
  const [showExportHistory, setShowExportHistory] = useState(false);

  const saveTimers = useRef({});

  // Update year when availableYears loads
  useEffect(() => {
    if (availableYears.length > 0 && !availableYears.includes(selectedYear)) {
      setSelectedYear(availableYears[0]);
    }
  }, [availableYears]);

  const loadData = useCallback(async () => {
    if (!currentUserId) return;
    setLoading(true);
    try {
      if (isAllView && perms.isAdmin) {
        // Load all users' FTEs consolidated
        const [allFtesRes, cfgRes] = await Promise.all([
          API.get(`/remuneration/ftes-all/${selectedYear}`),
          API.get(`/remuneration/config/${currentUserId}`),
        ]);
        setAllFtes(allFtesRes.data || []);
        setFtes([]);
        setCfg(cfgRes.data || cfg);
      } else {
        // Load specific user's FTEs
        const uid = targetUserId;
        const [ftesRes, cfgRes] = await Promise.all([
          API.get(`/remuneration/ftes/${uid}/${selectedYear}`),
          API.get(`/remuneration/config/${uid}`),
        ]);
        setFtes(ftesRes.data || []);
        setAllFtes([]);
        setCfg(cfgRes.data || cfg);
      }
    } catch { addNotification('error', 'Failed to load remuneration data.'); }
    finally { setLoading(false); }
  }, [currentUserId, targetUserId, selectedYear, isAllView, perms.isAdmin, API]);

  useEffect(() => { loadData(); }, [loadData]);

  const loadExportHistory = useCallback(async () => {
    const { data, error } = await supabase.from('export_history').select('*').eq('export_mode','remun').order('timestamp', { ascending:false }).limit(20);
    if (!error) setExportHistory(data || []);
  }, []);

  useEffect(() => { if (currentUserId) loadExportHistory(); }, [currentUserId, loadExportHistory]);

  const queueSaveFTE = useCallback((fteId, field, value) => {
    if (!canEdit) return;
    if (saveTimers.current[fteId]) clearTimeout(saveTimers.current[fteId]);
    setSaving();
    saveTimers.current[fteId] = setTimeout(async () => {
      try {
        const res = await API.put(`/remuneration/ftes/${fteId}`, {
          [field]: value,
          userId: targetUserId,   // targetUserId = page owner (may differ from currentUserId for admin)
          userName: currentUser?.name,
        });
        setFtes(prev => prev.map(f => f.id === fteId ? { ...f, ...res.data } : f));
        setSaved();
      } catch { setSaveError(); addNotification('error', 'Failed to save.'); }
    }, 600);
  }, [currentUserId, targetUserId, currentUser, canEdit, API, setSaving, setSaved, setSaveError]);

  const handleFTEChange = (fteId, field, value) => {
    if (!canEdit) return;
    setFtes(prev => prev.map(f => f.id === fteId ? { ...f, [field]: value } : f));
    queueSaveFTE(fteId, field, value);
  };

  const handleAddFTEs = async (count) => {
    if (!canEdit) return;
    try {
      const res = await API.post(`/remuneration/ftes/${targetUserId}`, {
        count, userName: currentUser?.name, year: selectedYear
      });
      setFtes(prev => [...prev, ...res.data]);
      setShowNewModal(false);
      addNotification('success', `${count} FTE${count > 1 ? 's' : ''} added.`);
    } catch (e) { addNotification('error', e.response?.data?.error || 'Failed to add FTEs.'); }
  };

  const handleRemoveFTE = async (fteId) => {
    if (!canEdit) return;
    try {
      await API.delete(`/remuneration/ftes/${fteId}`, { data: { userId: targetUserId, userName: currentUser?.name } });
      setFtes(prev => prev.filter(f => f.id !== fteId));
    } catch { addNotification('error', 'Failed to remove FTE.'); }
  };

  const handleReset = async () => {
    if (!canEdit) return;
    try {
      await API.delete(`/remuneration/reset/${targetUserId}/${selectedYear}`, {
        data: { requestingUserId: currentUserId, userName: currentUser?.name }
      });
      setFtes([]);
      setShowResetModal(false);
      addNotification('success', 'Simulation reset.');
    } catch { addNotification('error', 'Failed to reset.'); }
  };

  const handleSaveConfig = async (newCfg) => {
    try {
      const res = await API.put(`/remuneration/config/${currentUserId}`, newCfg);
      setCfg(res.data);
      setShowConfigModal(false);
      addNotification('success', 'Configuration saved.');
    } catch { addNotification('error', 'Failed to save config.'); }
  };

  const handleRemunerationExport = async () => {
    if (exporting || !currentUserId) return;
    setExporting(true);
    setSaving();
    let uploadedPath = '';
    try {
      const { data: payload, error: dataError } = await supabase.rpc('get_remuneration_export_data');
      if (dataError) throw dataError;
      const rows = payload?.ftes || [];
      const configs = new Map((payload?.configs || []).map(item => [item.user_id, item]));
      const prepared = rows.map(fte => {
        const rowCfg = configs.get(fte.user_id) || cfg;
        return { ...fte, calculated:calculateRemuneration(fte, rowCfg), monthly:calculateMonthlyRemuneration(fte, rowCfg) };
      });
      const result = await generateRemunerationWorkbook(prepared);
      uploadedPath = `remun/${currentUserId}/${crypto.randomUUID()}.xlsx`;
      const { error: uploadError } = await supabase.storage.from('exports').upload(uploadedPath, result.blob, { contentType:result.blob.type, upsert:false });
      if (uploadError) throw uploadError;
      const { data: record, error: recordError } = await supabase.rpc('register_remuneration_export', {
        p_filepath:uploadedPath,
        p_year:Math.max(...result.years),
        p_snapshot:{ years:result.years, fte_count:prepared.length },
      });
      if (recordError) throw recordError;
      const { data:urlData, error:urlError } = await supabase.storage.from('exports').createSignedUrl(uploadedPath, 3600);
      if (urlError) throw urlError;
      const link = document.createElement('a');
      link.href = urlData.signedUrl; link.download = record.filename; link.click();
      await loadExportHistory();
      setSaved();
      addNotification('success', `Export saved: ${record.filename}`);
    } catch (error) {
      if (uploadedPath) await supabase.storage.from('exports').remove([uploadedPath]);
      setSaveError();
      addNotification('error', error?.message || 'Failed to export remuneration.');
    } finally { setExporting(false); }
  };

  const handleExportDownload = async record => {
    try {
      const { data, error } = await supabase.storage.from('exports').createSignedUrl(record.filepath, 3600);
      if (error) throw error;
      const link = document.createElement('a'); link.href=data.signedUrl; link.download=record.filename; link.click();
    } catch { addNotification('error', 'Failed to download export.'); }
  };

  // In All view, use allFtes; otherwise use own ftes
  const activeFtes = isAllView ? allFtes : ftes;

  const computed = useMemo(() => activeFtes.map(f => ({ id: f.id, ...calculateRemuneration(f, cfg) })), [activeFtes, cfg]);
  const computedMap = useMemo(() => {
    const m = {}; computed.forEach(c => { m[c.id] = c; }); return m;
  }, [computed]);

  const monthly = useMemo(() => {
    const m = {}; activeFtes.forEach(f => { m[f.id] = calcMonthly(f, cfg); }); return m;
  }, [activeFtes, cfg]);

  // KPIs
  const kpis = useMemo(() => {
    const totalFTEs = activeFtes.length;
    const totalAnnual = computed.reduce((s, c) => s + c.total_annual_employer, 0);
    const avgAnnual = totalFTEs > 0 ? totalAnnual / totalFTEs : 0;
    const totalMonthly = totalAnnual / 12;
    const avgMonthly = totalFTEs > 0 ? totalMonthly / totalFTEs : 0;
    return { totalFTEs, totalAnnual, avgAnnual, totalMonthly, avgMonthly };
  }, [activeFtes, computed]);

  if (loading) return (
    <div className="remun-page">
      <div className="skeleton" style={{ height: 80, marginBottom: 16 }} />
      <div className="skeleton" style={{ height: 400 }} />
    </div>
  );

  // Label for current view
  const viewLabel = isAllView
    ? 'All users — consolidated view'
    : viewUserId === 'me' || targetUserId === currentUserId
      ? `Private to ${currentUser?.name}`
      : `Viewing: ${users.find(u => u.id === targetUserId)?.name || ''}`;

  return (
    <div className="remun-page">
      {/* Header */}
      <div className="remun-header">
        <div>
          <h1 className="remun-title">Remuneration Simulator</h1>
          <p className="remun-subtitle">{viewLabel}</p>
        </div>
        <div className="remun-header-actions">

          {/* Year filter — shared with other pages */}
          <div style={{display:'flex',alignItems:'center',gap:6}}>
            <span style={{fontSize:11,fontWeight:600,color:'var(--gray-400)',textTransform:'uppercase',letterSpacing:'0.06em'}}>Year</span>
            <select className="year-select" value={selectedYear}
              onChange={e => setSelectedYear(parseInt(e.target.value))}>
              {availableYears.length > 0
                ? availableYears.map(y => <option key={y} value={y}>{y}</option>)
                : <option value={selectedYear}>{selectedYear}</option>}
            </select>
          </div>

          {/* User filter — admins only */}
          {perms.isAdmin && (
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              <span style={{fontSize:11,fontWeight:600,color:'var(--gray-400)',textTransform:'uppercase',letterSpacing:'0.06em'}}>User</span>
              <select className="year-select" value={viewUserId}
                onChange={e => setViewUserId(e.target.value)}>
                <option value="me">My page</option>
                <option value="">All (consolidated)</option>
                {users.filter(u => u.id !== currentUserId).map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
          )}

          <button className="remun-btn remun-btn--ghost" onClick={() => setShowConfigModal(true)}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.9 2.9l1 1M10.1 10.1l1 1M10.1 2.9l-1 1M3.9 10.1l-1 1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            Settings
          </button>
          {canEdit && ftes.length > 0 && (
            <button className="remun-btn remun-btn--ghost remun-btn--danger" onClick={() => setShowResetModal(true)}>
              Reset
            </button>
          )}
          {canEdit && (
            <button className="remun-btn remun-btn--primary" onClick={() => setShowNewModal(true)} disabled={ftes.length >= MAX_FTES}>
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M6.5 1v11M1 6.5h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              {ftes.length === 0 ? 'New Simulation' : 'Add FTEs'}
            </button>
          )}
        </div>
      </div>

      {/* KPIs — 5 cards */}
      <div className="remun-kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Total FTEs</div>
          <div className="kpi-value" style={{fontSize:32, fontWeight:300}}>{kpis.totalFTEs}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Total Annual Cost</div>
          <div className="kpi-value kpi-value--negative">{fmtEur(kpis.totalAnnual)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Avg Annual Cost / FTE</div>
          <div className="kpi-value">{fmtEur(kpis.avgAnnual)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Total Monthly Cost</div>
          <div className="kpi-value kpi-value--negative">{fmtEur(kpis.totalMonthly)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Avg Monthly Cost / FTE</div>
          <div className="kpi-value">{fmtEur(kpis.avgMonthly)}</div>
        </div>
      </div>

      {activeFtes.length === 0 ? (
        <div className="remun-empty">
          <div className="remun-empty-icon">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <circle cx="24" cy="18" r="8" stroke="#d0d0d0" strokeWidth="2"/>
              <path d="M8 42c0-8.8 7.2-16 16-16s16 7.2 16 16" stroke="#d0d0d0" strokeWidth="2" strokeLinecap="round"/>
              <path d="M30 18h8M34 14v8" stroke="#b3946f" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>
          <h3>{isAllView ? 'No data for this year' : 'No simulation yet'}</h3>
          <p>{isAllView ? 'No remuneration data found for the selected year.' : 'Click "New Simulation" to start building your team cost model.'}</p>
          {canEdit && <button className="remun-btn remun-btn--primary" onClick={() => setShowNewModal(true)}>New Simulation</button>}
        </div>
      ) : (
        <>
          {/* All view: single consolidated table with User column */}
          {isAllView ? (
            <>
              <AllConsolidatedTable ftes={activeFtes} cfg={cfg} computedMap={computedMap} />
              <AllMonthlyOverview ftes={activeFtes} cfg={cfg} monthly={monthly} />
            </>
          ) : (
            <>
              <MainTable ftes={activeFtes} cfg={cfg} computedMap={computedMap} onFieldChange={canEdit ? handleFTEChange : () => {}} onRemove={canEdit ? handleRemoveFTE : () => {}} readOnly={!canEdit} />
              <MonthlyOverview ftes={activeFtes} cfg={cfg} monthly={monthly} />
            </>
          )}
        </>
      )}

      <RemunerationExport
        exporting={exporting}
        history={exportHistory}
        showHistory={showExportHistory}
        onToggleHistory={() => setShowExportHistory(value => !value)}
        onExport={handleRemunerationExport}
        onDownload={handleExportDownload}
      />

      {canEdit && showNewModal && <NewFTEModal current={ftes.length} onClose={() => setShowNewModal(false)} onAdd={handleAddFTEs} />}
      {canEdit && showResetModal && <ResetModal onClose={() => setShowResetModal(false)} onConfirm={handleReset} />}
      {showConfigModal && <ConfigModal cfg={cfg} onClose={() => setShowConfigModal(false)} onSave={handleSaveConfig} />}
    </div>
  );
}

function RemunerationExport({ exporting, history, showHistory, onToggleHistory, onExport, onDownload }) {
  return (
    <div className="remun-section remun-export-section">
      <div className="remun-section-header">
        <div>
          <h2 className="remun-section-title">Export to Excel</h2>
          <span className="remun-section-note">Consolidated remuneration for all users and all years</span>
        </div>
        <div className="remun-export-actions">
          {history.length > 0 && <button className="remun-btn remun-btn--ghost" onClick={onToggleHistory}>History ({history.length})</button>}
          <button className="remun-btn remun-btn--primary" onClick={onExport} disabled={exporting}>{exporting ? 'Exporting...' : 'Export All Years'}</button>
        </div>
      </div>
      {showHistory && history.length > 0 && (
        <div className="remun-export-history">
          <table className="remun-table">
            <thead><tr><th>Version</th><th>Filename</th><th>Date</th><th>Exported by</th><th /></tr></thead>
            <tbody>{history.map(record => (
              <tr key={record.id}>
                <td>v{String(record.version).padStart(3,'0')}</td>
                <td title={record.filename}>{record.filename}</td>
                <td>{new Date(record.timestamp).toLocaleDateString('en-GB')}</td>
                <td>{record.exported_by_name}</td>
                <td><button className="remun-btn remun-btn--ghost" onClick={() => onDownload(record)}>Download</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── All Consolidated Table (All view — single table with User column) ────────
function AllConsolidatedTable({ ftes, cfg, computedMap }) {
  const ihtLabel = `IHT (${(cfg.iht_rate * 100).toFixed(0)}%)`;
  const cVals = Object.values(computedMap);
  const sumK = k => cVals.reduce((s, c) => s + (c[k] || 0), 0);
  const gt = {
    annual_meal: sumK('annual_meal'),
    base_annual: ftes.reduce((s, f) => s + (parseFloat(f.annual_base_salary)||0), 0),
    iht_base: sumK('iht_base'),
    base_total_annual: sumK('base_total_annual'), base_total_monthly: sumK('base_total_monthly'),
    final_annual: sumK('final_annual'), iht_final: sumK('iht_final'),
    final_total_annual: sumK('final_total_annual'), final_total_monthly: sumK('final_total_monthly'),
    total_annual_employer: sumK('total_annual_employer'),
  };

  // Columns: # | Role | Name | Dept | Meal/Day | Annual Meal || Annual Sal | IHT | Base Total || Idx% | Inc% | Final Sal | IHT | Final Total || Employer
  // Total: 1+1+1+1 + 2 + 3 + 5 + 1 = 15 columns
  const TS = {textAlign:'left',paddingLeft:10,fontSize:10,letterSpacing:'0.08em',textTransform:'uppercase',color:'var(--gray-400)'};
  const HR = {textAlign:'right',padding:'0 10px'};
  const TH = {textAlign:'right',padding:'0 10px',borderBottom:'1px solid var(--gray-200)',fontSize:10,fontWeight:700,letterSpacing:'0.04em',textTransform:'uppercase',color:'var(--gray-500)',whiteSpace:'nowrap',background:'var(--gray-50)'};
  const THL = {...TH,textAlign:'left',padding:'8px 8px'};

  return (
    <div className="remun-section">
      <div className="remun-section-header">
        <h2 className="remun-section-title">Team Remuneration — All Users</h2>
        <span className="remun-section-note">{ftes.length} FTEs · Read-only · Hover for monthly</span>
      </div>
      <div className="remun-table-wrap">
        <table className="remun-table remun-all-table" style={{tableLayout:'fixed',minWidth:1350}}>
          <colgroup>
            <col style={{width:32}} />{/* # */}
            <col style={{width:110}} />{/* Role */}
            <col style={{width:110}} />{/* Name */}
            <col style={{width:100}} />{/* Dept */}
            <col style={{width:80}} />{/* Meal/Day */}
            <col style={{width:90}} />{/* Ann Meal */}
            <col style={{width:95}} />{/* Ann Sal */}
            <col style={{width:90}} />{/* IHT base */}
            <col style={{width:97}} />{/* Base Tot */}
            <col style={{width:52}} />{/* Idx% */}
            <col style={{width:52}} />{/* Inc% */}
            <col style={{width:95}} />{/* Final Sal */}
            <col style={{width:90}} />{/* IHT fin */}
            <col style={{width:97}} />{/* Final Tot */}
            <col style={{width:105}} />{/* Employer */}
          </colgroup>
          <thead>
            <tr className="remun-group-header">
              <th colSpan={4} className="group-cell group-identity"/>
              <th colSpan={2} className="group-cell group-meal">Meal Allowance</th>
              <th colSpan={3} className="group-cell group-base">Base Salary</th>
              <th colSpan={5} className="group-cell group-inc">After Increase</th>
              <th colSpan={1} className="group-cell group-employer">Employer Cost</th>
            </tr>
            <tr>
              <th style={{...TH,textAlign:'center'}}>#</th>
              <th style={THL}>Role</th>
              <th style={THL}>Name</th>
              <th style={THL}>Department</th>
              <th style={{...TH}}>Allow./Day</th>
              <th style={{...TH}}>Annual</th>
              <th style={{...TH}}>Annual Sal.</th>
              <th style={{...TH}}>{ihtLabel}</th>
              <th style={{...TH}} className="col-section-total">Base Total</th>
              <th style={{...TH}}>Idx%</th>
              <th style={{...TH}}>Inc%</th>
              <th style={{...TH}}>Final Sal.</th>
              <th style={{...TH}}>{ihtLabel}</th>
              <th style={{...TH}} className="col-section-total">Final Total</th>
              <th style={{...TH}}>Total Annual</th>
            </tr>
          </thead>
          <tbody>
            {ftes.map((fte, idx) => {
              const c = computedMap[fte.id] || {};
              return (
                <tr key={fte.id} className="remun-row">
                  <td style={{textAlign:'center',color:'var(--gray-400)',fontSize:11,verticalAlign:'middle'}}>{idx+1}</td>
                  <NameCell text={fte.role || '—'} style={{fontSize:11.5,color:'var(--gray-800)'}}>
                    {fte.role || <em style={{color:'var(--gray-300)'}}>—</em>}
                  </NameCell>
                  <NameCell text={fte.collaborator_name || '—'} style={{fontSize:11.5,color:'var(--gray-700)'}}>
                    {fte.collaborator_name || <em style={{color:'var(--gray-300)'}}>—</em>}
                  </NameCell>
                  <NameCell text={fte.user_name || fte.user_id} style={{fontSize:11,color:'var(--warm-sand)',fontWeight:500}}>
                    {fte.user_name || fte.user_id}
                  </NameCell>
                  <td style={{...CALC,fontSize:11}}><span className="calc-val">{fmtEur(fte.meal_allowance_day)}</span></td>
                  <td style={{...CALC,fontSize:11}}><span className="calc-val">{fmtEur(c.annual_meal)}</span></td>
                  <td style={{...CALC,fontSize:11}}><span className="calc-val">{fmtEur(c.base_annual)}</span></td>
                  <td style={{...CALC,fontSize:11}}><span className="calc-val">{fmtEur(c.iht_base)}</span></td>
                  <td style={{...TOTAL_COL,fontSize:11}} title={`Monthly: ${fmtEur(c.base_total_monthly)}`}><span className="calc-val">{fmtEur(c.base_total_annual)}</span></td>
                  <td style={{...CALC,fontSize:10}}>{fte.indexation_pct ? `${fte.indexation_pct}%` : '—'}</td>
                  <td style={{...CALC,fontSize:10}}>{fte.increase_pct ? `${fte.increase_pct}%` : '—'}</td>
                  <td style={{...CALC,fontSize:11}}><span className="calc-val">{fmtEur(c.final_annual)}</span></td>
                  <td style={{...CALC,fontSize:11}}><span className="calc-val">{fmtEur(c.iht_final)}</span></td>
                  <td style={{...TOTAL_COL,fontSize:11}} title={`Monthly: ${fmtEur(c.final_total_monthly)}`}><span className="calc-val">{fmtEur(c.final_total_annual)}</span></td>
                  <td style={{...EMPLOYER_COL,fontSize:11}} title={`Monthly avg: ${fmtEur(c.total_annual_employer/12)}`}><span className="calc-val">{fmtEur(c.total_annual_employer)}</span></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="remun-total-row">
              <td colSpan={4} style={TS}>Total All Users</td>
              <td />
              <td style={{...HR}}>{fmtEur(gt.annual_meal)}</td>
              <td style={{...HR}}>{fmtEur(gt.base_annual)}</td>
              <td style={{...HR}}>{fmtEur(gt.iht_base)}</td>
              <td className="total-highlight" style={{...HR}} title={`Monthly: ${fmtEur(gt.base_total_monthly)}`}>{fmtEur(gt.base_total_annual)}</td>
              <td /><td />
              <td style={{...HR}}>{fmtEur(gt.final_annual)}</td>
              <td style={{...HR}}>{fmtEur(gt.iht_final)}</td>
              <td className="total-highlight" style={{...HR}} title={`Monthly: ${fmtEur(gt.final_total_monthly)}`}>{fmtEur(gt.final_total_annual)}</td>
              <td className="total-highlight" style={{...HR,borderLeft:'2px solid #444'}}>{fmtEur(gt.total_annual_employer)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ─── All Monthly Overview (All view — single table with User column) ───────────
function AllMonthlyOverview({ ftes, cfg, monthly }) {
  const colTotals = MONTHS_FULL.map((_, mi) => ftes.reduce((s, f) => s + (monthly[f.id]?.[mi]?.total || 0), 0));
  const grandTotal = colTotals.reduce((s, v) => s + v, 0);
  return (
    <div className="remun-section">
      <div className="remun-section-header">
        <h2 className="remun-section-title">Monthly Remuneration Overview — All Users</h2>
        <span className="remun-section-note">{cfg.monthly_payments} payments · Hover for breakdown</span>
      </div>
      <div className="remun-monthly-wrap">
        <table className="remun-table remun-monthly-table" style={{tableLayout:'fixed', minWidth:`${100+110+100+12*82+100}px`}}>
          <colgroup>
            <col style={{width:110}} />{/* Role */}
            <col style={{width:100}} />{/* Name */}
            <col style={{width:100}} />{/* Dept */}
            {MONTHS_S.map((_, i) => <col key={i} style={{width:82}} />)}
            <col style={{width:100}} />
          </colgroup>
          <thead>
            <tr>
              <th style={{textAlign:'left',padding:'8px 10px',position:'sticky',top:0,background:'var(--gray-50)',zIndex:5,borderBottom:'1px solid var(--gray-200)',fontSize:10,fontWeight:700,letterSpacing:'0.04em',textTransform:'uppercase',color:'var(--gray-500)'}}>Role</th>
              <th style={{textAlign:'left',padding:'8px 8px',position:'sticky',top:0,background:'var(--gray-50)',zIndex:5,borderBottom:'1px solid var(--gray-200)',fontSize:10,fontWeight:700,letterSpacing:'0.04em',textTransform:'uppercase',color:'var(--gray-500)'}}>Name</th>
              <th style={{textAlign:'left',padding:'8px 8px',position:'sticky',top:0,background:'var(--gray-50)',zIndex:5,borderBottom:'1px solid var(--gray-200)',fontSize:10,fontWeight:700,letterSpacing:'0.04em',textTransform:'uppercase',color:'var(--gray-500)'}}>Department</th>
              {MONTHS_S.map((m, i) => (
                <th key={i} style={{textAlign:'right',padding:'8px 8px',position:'sticky',top:0,background:'var(--gray-50)',zIndex:5,borderBottom:'1px solid var(--gray-200)',fontSize:10,fontWeight:700,letterSpacing:'0.04em',textTransform:'uppercase',color:'var(--gray-500)',whiteSpace:'nowrap'}}>
                  {m}
                  {(i+1 === cfg.holiday_allowance_month) && <span className="month-badge" title="+Holiday">H</span>}
                  {(i+1 === cfg.christmas_allowance_month) && <span className="month-badge month-badge--xmas" title="+Christmas">X</span>}
                </th>
              ))}
              <th style={{textAlign:'right',padding:'8px 10px',position:'sticky',top:0,background:'var(--gray-50)',zIndex:5,borderBottom:'1px solid var(--gray-200)',fontSize:10,fontWeight:700,letterSpacing:'0.04em',textTransform:'uppercase',color:'var(--gray-500)',borderLeft:'1px solid var(--gray-200)'}}>Annual</th>
            </tr>
          </thead>
          <tbody>
            {ftes.map((fte) => {
              const months = monthly[fte.id] || [];
              const rowTotal = months.reduce((s, m) => s + m.total, 0);
              const base = {textAlign:'right',padding:'10px 8px',fontSize:11.5,fontVariantNumeric:'tabular-nums',color:'var(--gray-700)',verticalAlign:'middle',borderBottom:'1px solid var(--gray-100)'};
              return (
                <tr key={fte.id} onMouseEnter={e=>e.currentTarget.style.background='var(--gray-50)'} onMouseLeave={e=>e.currentTarget.style.background=''}>
                  <NameCell text={fte.role || 'No role'} style={{borderBottom:'1px solid var(--gray-100)',fontSize:11.5,color:'var(--gray-800)'}}>
                    {fte.role || <em style={{color:'var(--gray-300)',fontWeight:400}}>No role</em>}
                  </NameCell>
                  <NameCell text={fte.collaborator_name || '—'} style={{borderBottom:'1px solid var(--gray-100)',fontSize:11.5,color:'var(--gray-700)'}}>
                    {fte.collaborator_name || <em style={{color:'var(--gray-300)',fontWeight:400}}>—</em>}
                  </NameCell>
                  <NameCell text={fte.user_name || fte.user_id} style={{borderBottom:'1px solid var(--gray-100)',fontSize:11,fontWeight:500,color:'var(--warm-sand)'}}>
                    {fte.user_name || fte.user_id}
                  </NameCell>
                  {months.map((m, mi) => (
                    <td key={mi} style={m.isHoliday||m.isChristmas ? {...base,background:'rgba(179,148,111,0.05)'} : base}
                      title={`Salary: ${fmtEur0(m.salary)}\nIHT: ${fmtEur0(m.iht)}\nMeal: ${fmtEur0(m.meal)}\nTotal: ${fmtEur0(m.total)}`}>
                      {fmtEur(m.total)}
                    </td>
                  ))}
                  <td style={{...base,fontWeight:600,borderLeft:'1px solid var(--gray-200)',padding:'10px 10px'}}>{fmtEur(rowTotal)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} style={{background:'var(--gray-900)',color:'var(--gray-400)',fontSize:10,fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase',padding:'11px 10px',borderTop:'2px solid var(--gray-700)'}}>Total</td>
              {colTotals.map((v, i) => (
                <td key={i} style={{background:'var(--gray-900)',color:'#fff',fontSize:12,fontWeight:600,textAlign:'right',padding:'11px 8px',borderTop:'2px solid var(--gray-700)',fontVariantNumeric:'tabular-nums'}}>{fmtEur(v)}</td>
              ))}
              <td style={{background:'#111',color:'#fff',fontSize:12,fontWeight:700,textAlign:'right',padding:'11px 10px',borderTop:'2px solid var(--gray-700)',borderLeft:'1px solid var(--gray-700)',fontVariantNumeric:'tabular-nums'}}>{fmtEur(grandTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ─── Main Table ───────────────────────────────────────────────────────────────
// Columns (After Indexation section REMOVED — idx applied internally):
// # | Role | Meal/Day | Annual Meal ||
// Base Salary: Annual | IHT | Base Total ||
// After Increase: Idx % | Inc % | Final Salary | IHT | Final Total ||
// Employer Cost | ×

function MainTable({ ftes, cfg, computedMap, onFieldChange, onRemove, readOnly = false }) {
  const ihtLabel = `IHT (${(cfg.iht_rate * 100).toFixed(0)}%)`;

  const totals = useMemo(() => {
    const vals = Object.values(computedMap);
    const sum = k => vals.reduce((s, c) => s + (c[k] || 0), 0);
    return {
      base_annual: ftes.reduce((s, f) => s + (parseFloat(f.annual_base_salary) || 0), 0),
      iht_base: sum('iht_base'),
      base_total_annual: sum('base_total_annual'),
      base_total_monthly: sum('base_total_monthly'),
      annual_meal: sum('annual_meal'),
      final_annual: sum('final_annual'),
      iht_final: sum('iht_final'),
      final_total_annual: sum('final_total_annual'),
      final_total_monthly: sum('final_total_monthly'),
      total_annual_employer: sum('total_annual_employer'),
    };
  }, [computedMap, ftes]);

  return (
    <div className="remun-section">
      <div className="remun-section-header">
        <h2 className="remun-section-title">Team Remuneration</h2>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <span className="remun-hint-tip">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M6 5v3M6 4h.01" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            Hover calculated cells for monthly values
          </span>
          <span className="remun-section-note">{ftes.length} / 20 FTEs</span>
        </div>
      </div>
      <div className="remun-table-wrap">
        <table className="remun-table" style={{tableLayout:'fixed'}}>
          {/* colgroup fixes exact widths for every column — guarantees alignment */}
          <colgroup>
            <col style={{width:32}} />   {/* # */}
            <col style={{width:130}} />  {/* Role */}
            <col style={{width:120}} />  {/* Name (collaborator) */}
            <col style={{width:92}} />   {/* Entry month */}
            <col style={{width:92}} />   {/* Allow/Day */}
            <col style={{width:100}} />  {/* Annual Allow */}
            <col style={{width:100}} />  {/* Annual Salary */}
            <col style={{width:100}} />  {/* IHT base */}
            <col style={{width:102}} />  {/* Base Total */}
            <col style={{width:56}} />   {/* Idx % */}
            <col style={{width:56}} />   {/* Inc % */}
            <col style={{width:102}} />  {/* Final Salary */}
            <col style={{width:100}} />  {/* IHT final */}
            <col style={{width:102}} />  {/* Final Total */}
            <col style={{width:108}} />  {/* Employer */}
            <col style={{width:32}} />   {/* action */}
          </colgroup>
          <thead>
            {/* Group header */}
            <tr className="remun-group-header">
              <th colSpan={4} className="group-cell group-identity" />
              <th colSpan={2} className="group-cell group-meal">Meal Allowance</th>
              <th colSpan={3} className="group-cell group-base">Base Salary</th>
              <th colSpan={5} className="group-cell group-inc">After Increase</th>
              <th colSpan={1} className="group-cell group-employer">Employer Cost</th>
              <th colSpan={1} className="group-cell group-identity" />
            </tr>
            {/* Column labels */}
            <tr>
              <th style={{textAlign:'center'}}>#</th>
              <th style={{textAlign:'left'}}>Role</th>
              <th style={{textAlign:'left'}}>Name</th>
              <th style={{textAlign:'left'}}>Entry month</th>
              <th style={{textAlign:'right'}}>Allow. / Day</th>
              <th style={{textAlign:'right'}}>Annual Allow.</th>
              <th style={{textAlign:'right'}}>Annual Salary</th>
              <th style={{textAlign:'right'}}>{ihtLabel}</th>
              <th style={{textAlign:'right'}} className="col-section-total">Base Total</th>
              <th style={{textAlign:'right'}}>Idx %</th>
              <th style={{textAlign:'right'}}>Inc %</th>
              <th style={{textAlign:'right'}}>Final Salary</th>
              <th style={{textAlign:'right'}}>{ihtLabel}</th>
              <th style={{textAlign:'right'}} className="col-section-total">Final Total</th>
              <th style={{textAlign:'right'}}>Total Annual</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ftes.map((fte, idx) => {
              const c = computedMap[fte.id] || {};
              return <FTERow key={fte.id} fte={fte} idx={idx} c={c} cfg={cfg} onChange={onFieldChange} onRemove={onRemove} readOnly={readOnly} />;
            })}
          </tbody>
          <tfoot>
            <tr className="remun-total-row">
              {/* # + Role + Name merged */}
              <td colSpan={4} style={{textAlign:'left', paddingLeft:12, fontSize:10, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--gray-400)'}}>Total Team</td>
              {/* Meal Allow/Day — empty, start of Meal section */}
              <td style={{borderLeft:'2px solid #1a5c32'}} />
              {/* Annual Meal */}
              <td style={{textAlign:'right', padding:'0 10px'}}>{fmtEur(totals.annual_meal)}</td>
              {/* Annual Salary — start of Base section */}
              <td style={{textAlign:'right', padding:'0 10px', borderLeft:'2px solid var(--gray-600)'}}>{fmtEur(totals.base_annual)}</td>
              {/* IHT base */}
              <td style={{textAlign:'right', padding:'0 10px'}}>{fmtEur(totals.iht_base)}</td>
              {/* Base Total */}
              <td className="total-highlight" style={{textAlign:'right', padding:'0 10px'}} title={`Monthly: ${fmtEur(totals.base_total_monthly)}`}>{fmtEur(totals.base_total_annual)}</td>
              {/* Idx % — empty, start of After Increase section */}
              <td style={{borderLeft:'2px solid #312e81'}} />
              {/* Inc % — empty */}
              <td />
              {/* Final Salary */}
              <td style={{textAlign:'right', padding:'0 10px'}}>{fmtEur(totals.final_annual)}</td>
              {/* IHT final */}
              <td style={{textAlign:'right', padding:'0 10px'}}>{fmtEur(totals.iht_final)}</td>
              {/* Final Total */}
              <td className="total-highlight" style={{textAlign:'right', padding:'0 10px'}} title={`Monthly: ${fmtEur(totals.final_total_monthly)}`}>{fmtEur(totals.final_total_annual)}</td>
              {/* Employer — start of Employer section */}
              <td className="total-highlight" style={{textAlign:'right', padding:'0 10px', borderLeft:'2px solid #444'}}>{fmtEur(totals.total_annual_employer)}</td>
              {/* Action — empty */}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// Shared td style helpers for fixed-layout table
const R = {textAlign:'right', padding:'0 10px', verticalAlign:'middle'};
const CALC = {...R, background:'var(--gray-50)', color:'var(--gray-600)', fontSize:11.5, fontVariantNumeric:'tabular-nums', cursor:'help'};
const TOTAL_COL = {...CALC, fontWeight:600, background:'rgba(0,0,0,0.03)'};
const EMPLOYER_COL = {...TOTAL_COL, background:'rgba(0,0,0,0.06)', color:'var(--gray-800)'};
const PCT_TD = {padding:0, verticalAlign:'middle', overflow:'hidden'};
const INPUT_TD = {padding:0, verticalAlign:'middle'};

function FTERow({ fte, idx, c, cfg, onChange, onRemove, readOnly = false }) {
  return (
    <tr className="remun-row">
      {/* # */}
      <td style={{textAlign:'center', color:'var(--gray-400)', fontSize:11, verticalAlign:'middle'}}>{idx + 1}</td>

      {/* Role */}
      <td style={{padding:'0 4px', verticalAlign:'middle'}}>
        <select className="remun-select" value={fte.role || ''} onChange={e => !readOnly && onChange(fte.id, 'role', e.target.value)}
          style={{pointerEvents: readOnly ? 'none' : 'auto', opacity: readOnly ? 0.7 : 1}}>
          <option value="">— Select —</option>
          {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </td>

      {/* Collaborator Name */}
      {readOnly ? (
        <NameCell text={fte.collaborator_name || '—'} style={{fontSize:12,color:'var(--gray-800)'}}>
          {fte.collaborator_name || <em style={{color:'var(--gray-300)'}}>—</em>}
        </NameCell>
      ) : (
        <EditableNameCell
          value={fte.collaborator_name}
          onChange={v => onChange(fte.id, 'collaborator_name', v)}
        />
      )}

      {/* Entry month: null means the full year */}
      <td style={INPUT_TD}>
        {readOnly ? (
          <span className="remun-entry-month-readonly">{formatEntryMonth(fte.entry_month)}</span>
        ) : (
          <EntryMonthSelect value={fte.entry_month} onChange={v => onChange(fte.id, 'entry_month', v)} />
        )}
      </td>

      {/* Meal / Day */}
      <td style={INPUT_TD}>
        <NumInput value={fte.meal_allowance_day} onChange={v => onChange(fte.id, 'meal_allowance_day', v)} placeholder="0,00" min={0} />
      </td>

      {/* Annual Meal */}
      <td style={CALC} title={`${cfg.meal_allowance_days} days × ${fmtEur(parseFloat(fte.meal_allowance_day)||0)}/day`}>
        <span className="calc-val">{fmtEur(c.annual_meal)}</span>
        <span className="calc-monthly-hint">{fmtEur(c.annual_meal/12)}/mo</span>
      </td>

      {/* Annual Salary */}
      <td style={INPUT_TD}>
        <NumInput value={fte.annual_base_salary} onChange={v => onChange(fte.id, 'annual_base_salary', v)} placeholder="0,00" min={0} />
      </td>

      {/* IHT base */}
      <td style={CALC} title={`IHT on Base Salary\nAnnual: ${fmtEur(c.iht_base)}\nMonthly: ${fmtEur(c.iht_base_monthly)}`}>
        <span className="calc-val">{fmtEur(c.iht_base)}</span>
        <span className="calc-monthly-hint">{fmtEur(c.iht_base_monthly)}/mo</span>
      </td>

      {/* Base Total */}
      <td style={TOTAL_COL} title={`Base Salary + IHT\nAnnual: ${fmtEur(c.base_total_annual)}\nMonthly: ${fmtEur(c.base_total_monthly)}`}>
        <span className="calc-val">{fmtEur(c.base_total_annual)}</span>
        <span className="calc-monthly-hint">{fmtEur(c.base_total_monthly)}/mo</span>
      </td>

      {/* Idx % */}
      <td style={PCT_TD}>
        <PctInput value={fte.indexation_pct} onChange={v => onChange(fte.id, 'indexation_pct', v)} />
      </td>

      {/* Inc % */}
      <td style={PCT_TD}>
        <PctInput value={fte.increase_pct} onChange={v => onChange(fte.id, 'increase_pct', v)} />
      </td>

      {/* Final Salary */}
      <td style={CALC} title={`Base × (1+Idx%) × (1+Inc%)\nAnnual: ${fmtEur(c.final_annual)}\nMonthly: ${fmtEur(c.final_monthly)}`}>
        <span className="calc-val">{fmtEur(c.final_annual)}</span>
        <span className="calc-monthly-hint">{fmtEur(c.final_monthly)}/mo</span>
      </td>

      {/* IHT final */}
      <td style={CALC} title={`IHT on Final Salary\nAnnual: ${fmtEur(c.iht_final)}\nMonthly: ${fmtEur(c.iht_final_monthly)}`}>
        <span className="calc-val">{fmtEur(c.iht_final)}</span>
        <span className="calc-monthly-hint">{fmtEur(c.iht_final_monthly)}/mo</span>
      </td>

      {/* Final Total */}
      <td style={TOTAL_COL} title={`Final Salary + IHT\nAnnual: ${fmtEur(c.final_total_annual)}\nMonthly: ${fmtEur(c.final_total_monthly)}`}>
        <span className="calc-val">{fmtEur(c.final_total_annual)}</span>
        <span className="calc-monthly-hint">{fmtEur(c.final_total_monthly)}/mo</span>
      </td>

      {/* Total Employer Cost */}
      <td style={EMPLOYER_COL}
        title={`Final Salary+IHT: ${fmtEur(c.final_total_annual)}\nMeal: ${fmtEur(c.annual_meal)}\nTotal: ${fmtEur(c.total_annual_employer)}\nMonthly avg: ${fmtEur(c.total_annual_employer/12)}`}>
        <span className="calc-val">{fmtEur(c.total_annual_employer)}</span>
        <span className="calc-monthly-hint">{fmtEur(c.total_annual_employer/12)}/mo</span>
      </td>

      {/* Remove — hidden in readOnly mode */}
      <td style={{textAlign:'center', verticalAlign:'middle'}}>
        {!readOnly && (
          <button className="remun-remove-btn" onClick={() => onRemove(fte.id)} title="Remove FTE">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M2 2l9 9M11 2L2 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </button>
        )}
      </td>
    </tr>
  );
}

// ─── Monthly Overview ──────────────────────────────────────────────────────────

function MonthlyOverview({ ftes, cfg, monthly }) {
  const colTotals = useMemo(() =>
    MONTHS_FULL.map((_, mi) => ftes.reduce((s, f) => s + (monthly[f.id]?.[mi]?.total || 0), 0)),
  [ftes, monthly]);

  const grandTotal = colTotals.reduce((s, v) => s + v, 0);

  return (
    <div className="remun-section">
      <div className="remun-section-header">
        <h2 className="remun-section-title">Monthly Remuneration Overview</h2>
        <span className="remun-section-note">{cfg.monthly_payments} payments · Hover for breakdown</span>
      </div>
      <div className="remun-monthly-wrap">
        <table className="remun-table remun-monthly-table" style={{tableLayout:'fixed', minWidth: `${120+130+12*82+100}px`}}>
          <colgroup>
            <col style={{width:130}} /> {/* Role */}
            <col style={{width:120}} /> {/* Name */}
            {MONTHS_S.map((_, i) => <col key={i} style={{width:82}} />)}
            <col style={{width:100}} /> {/* Annual Total */}
          </colgroup>
          <thead>
            <tr>
              <th style={{textAlign:'left', padding:'8px 12px', position:'sticky', top:0, background:'var(--gray-50)', zIndex:5, borderBottom:'1px solid var(--gray-200)', fontSize:10, fontWeight:700, letterSpacing:'0.04em', textTransform:'uppercase', color:'var(--gray-500)'}}>Role</th>
              <th style={{textAlign:'left', padding:'8px 10px', position:'sticky', top:0, background:'var(--gray-50)', zIndex:5, borderBottom:'1px solid var(--gray-200)', fontSize:10, fontWeight:700, letterSpacing:'0.04em', textTransform:'uppercase', color:'var(--gray-500)'}}>Name</th>
              {MONTHS_S.map((m, i) => (
                <th key={i} style={{textAlign:'right', padding:'8px 8px', position:'sticky', top:0, background:'var(--gray-50)', zIndex:5, borderBottom:'1px solid var(--gray-200)', fontSize:10, fontWeight:700, letterSpacing:'0.04em', textTransform:'uppercase', color:'var(--gray-500)', whiteSpace:'nowrap'}}>
                  {m}
                  {(i + 1 === cfg.holiday_allowance_month) && <span className="month-badge" title="+ Holiday Allowance">H</span>}
                  {(i + 1 === cfg.christmas_allowance_month) && <span className="month-badge month-badge--xmas" title="+ Christmas Allowance">X</span>}
                </th>
              ))}
              <th style={{textAlign:'right', padding:'8px 10px', position:'sticky', top:0, background:'var(--gray-50)', zIndex:5, borderBottom:'1px solid var(--gray-200)', fontSize:10, fontWeight:700, letterSpacing:'0.04em', textTransform:'uppercase', color:'var(--gray-500)', borderLeft:'1px solid var(--gray-200)'}}>Annual</th>
            </tr>
          </thead>
          <tbody>
            {ftes.map((fte, idx) => {
              const months = monthly[fte.id] || [];
              const rowTotal = months.reduce((s, m) => s + m.total, 0);
              const cellBase = {textAlign:'right', padding:'10px 8px', fontSize:11.5, fontVariantNumeric:'tabular-nums', color:'var(--gray-700)', verticalAlign:'middle', borderBottom:'1px solid var(--gray-100)'};
              const cellSpec = {...cellBase, background:'rgba(179,148,111,0.05)'};
              return (
                <tr key={fte.id} style={{cursor:'default'}}
                  onMouseEnter={e => e.currentTarget.style.background='var(--gray-50)'}
                  onMouseLeave={e => e.currentTarget.style.background=''}>
                  <NameCell text={fte.role || 'No role'} style={{borderBottom:'1px solid var(--gray-100)',fontSize:12,fontWeight:500,color:'var(--gray-800)'}}>
                    <span style={{fontSize:10, color:'var(--gray-400)', marginRight:6}}>{idx + 1}</span>
                    {fte.role || <em style={{color:'var(--gray-300)', fontWeight:400}}>No role</em>}
                  </NameCell>
                  <NameCell text={fte.collaborator_name || '—'} style={{borderBottom:'1px solid var(--gray-100)',fontSize:12,color:'var(--gray-600)'}}>
                    {fte.collaborator_name || <em style={{color:'var(--gray-300)', fontWeight:400}}>—</em>}
                  </NameCell>
                  {months.map((m, mi) => (
                    <td key={mi} style={m.isHoliday || m.isChristmas ? cellSpec : cellBase}
                      title={[
                        `Salary: ${fmtEur0(m.salary)}`,
                        m.isHoliday ? '(incl. Holiday Allowance)' : '',
                        m.isChristmas ? '(incl. Christmas Allowance)' : '',
                        `IHT: ${fmtEur0(m.iht)}`,
                        `Meal: ${fmtEur0(m.meal)}`,
                        `─────────────`,
                        `Total: ${fmtEur0(m.total)}`,
                      ].filter(Boolean).join('\n')}>
                      {fmtEur(m.total)}
                    </td>
                  ))}
                  <td style={{...cellBase, fontWeight:600, borderLeft:'1px solid var(--gray-200)', padding:'10px 10px'}}>{fmtEur(rowTotal)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td style={{background:'var(--gray-900)', color:'var(--gray-400)', fontSize:10, fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase', padding:'11px 12px', borderTop:'2px solid var(--gray-700)'}}>Total</td>
              <td style={{background:'var(--gray-900)', borderTop:'2px solid var(--gray-700)'}} />
              {colTotals.map((v, i) => (
                <td key={i} style={{background:'var(--gray-900)', color:'#fff', fontSize:12, fontWeight:600, textAlign:'right', padding:'11px 8px', borderTop:'2px solid var(--gray-700)', fontVariantNumeric:'tabular-nums'}}>{fmtEur(v)}</td>
              ))}
              <td style={{background:'#111', color:'#fff', fontSize:12, fontWeight:700, textAlign:'right', padding:'11px 10px', borderTop:'2px solid var(--gray-700)', borderLeft:'1px solid var(--gray-700)', fontVariantNumeric:'tabular-nums'}}>{fmtEur(grandTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ─── Input Components ─────────────────────────────────────────────────────────

function formatEntryMonth(value) {
  const month = normalizeEntryMonth(value);
  return month === null ? 'All year' : MONTHS_FULL[month - 1];
}

function EntryMonthSelect({ value, onChange }) {
  const normalized = normalizeEntryMonth(value);
  return (
    <select
      className="remun-select remun-entry-month-select"
      value={normalized === null ? '' : normalized}
      onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
      title="Months before the entry month are not payable"
    >
      <option value="">All year</option>
      {MONTHS_S.map((month, index) => <option key={index + 1} value={index + 1}>{month}</option>)}
    </select>
  );
}

function NumInput({ value, onChange, placeholder, min }) {
  const [local, setLocal] = useState('');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setLocal(parseFloat(value) > 0 ? String(parseFloat(value)) : '');
  }, [value, editing]);

  const handleBlur = () => {
    setEditing(false);
    const raw = local.replace(/\./g, '').replace(',', '.');
    const v = parseFloat(raw) || 0;
    if (min !== undefined && v < min) { setLocal(''); onChange(0); return; }
    onChange(v);
  };

  const displayVal = editing
    ? local
    : (parseFloat(value) > 0
      ? parseFloat(value).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '');

  return (
    <input type="text" className="remun-num-input"
      value={displayVal}
      placeholder={placeholder || '—'}
      onFocus={() => { setEditing(true); setLocal(parseFloat(value) > 0 ? String(parseFloat(value)) : ''); }}
      onChange={e => setLocal(e.target.value)}
      onBlur={handleBlur}
    />
  );
}

function PctInput({ value, onChange }) {
  const [local, setLocal] = useState('');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setLocal(parseFloat(value) !== 0 ? String(parseFloat(value)) : '');
  }, [value, editing]);

  const handleBlur = () => {
    setEditing(false);
    const v = parseFloat(local.replace(',', '.')) || 0;
    onChange(v);
  };

  return (
    <div className="remun-pct-wrap">
      <input type="text" className="remun-pct-input"
        value={editing ? local : (parseFloat(value) !== 0 ? parseFloat(value).toFixed(2) : '')}
        placeholder="0.00"
        onFocus={() => { setEditing(true); setLocal(parseFloat(value) !== 0 ? String(parseFloat(value)) : ''); }}
        onChange={e => setLocal(e.target.value)}
        onBlur={handleBlur}
      />
      <span className="remun-pct-symbol">%</span>
    </div>
  );
}

// ─── Modals ───────────────────────────────────────────────────────────────────

const MAX_FTES = 100;

function NewFTEModal({ current, onClose, onAdd }) {
  const maxAdd = MAX_FTES - current;
  const [count, setCount] = useState(Math.min(1, maxAdd));
  const [error, setError] = useState('');

  const handleChange = (v) => {
    setError('');
    const n = parseInt(v) || 0;
    setCount(n);
    if (n < 1) setError('Minimum is 1.');
    else if (n > maxAdd) setError(`You can add up to ${maxAdd} more FTEs (current total would be ${current + n}, max is ${MAX_FTES}).`);
  };

  const handleAdd = () => {
    const n = parseInt(count) || 0;
    if (n < 1 || n > maxAdd) return;
    onAdd(n);
  };

  return (
    <Modal title={current === 0 ? 'New Simulation' : 'Add FTEs'} onClose={onClose}>
      <div className="modal-field">
        <label>How many employees do you want to {current === 0 ? 'simulate' : 'add'}?</label>
        <input
          type="number"
          className="modal-input"
          value={count}
          min={1}
          max={maxAdd}
          onChange={e => handleChange(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !error && handleAdd()}
          autoFocus
        />
        {error
          ? <p className="modal-error">{error}</p>
          : <p className="modal-hint">Currently {current} FTE{current !== 1 ? 's' : ''}. Maximum is {MAX_FTES}.</p>
        }
      </div>
      <div className="modal-actions">
        <button className="modal-btn modal-btn--secondary" onClick={onClose}>Cancel</button>
        <button className="modal-btn modal-btn--primary" onClick={handleAdd} disabled={!!error || !count || count < 1}>
          {current === 0 ? 'Create Simulation' : `Add ${count || ''} FTE${(count||0) > 1 ? 's' : ''}`}
        </button>
      </div>
    </Modal>
  );
}

function ResetModal({ onClose, onConfirm }) {
  return (
    <Modal title="Reset Simulation" onClose={onClose}>
      <div className="modal-warning-block">
        <div className="modal-warning-icon modal-warning-icon--red">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M10 6v4M10 13h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </div>
        <div>
          <p className="modal-warning-title">This will permanently delete your simulation.</p>
          <p className="modal-hint" style={{marginTop:6}}>Other users' simulations are not affected.</p>
        </div>
      </div>
      <div className="modal-actions">
        <button className="modal-btn modal-btn--secondary" onClick={onClose}>Cancel</button>
        <button className="modal-btn modal-btn--danger" onClick={onConfirm}>Yes, Reset</button>
      </div>
    </Modal>
  );
}

function ConfigModal({ cfg, onClose, onSave }) {
  const [local, setLocal] = useState({ ...cfg });
  return (
    <Modal title="Calculation Settings" onClose={onClose}>
      <div className="modal-field">
        <label>Annual Payments</label>
        <input type="number" className="modal-input" value={local.monthly_payments} min={12} max={16}
          onChange={e => setLocal(p => ({ ...p, monthly_payments: parseInt(e.target.value) || 14 }))} />
        <p className="modal-hint">e.g. 14 = 12 regular months + Holiday Allowance + Christmas Allowance</p>
      </div>
      <div className="modal-field">
        <label>Holiday Allowance Month</label>
        <select className="modal-input" value={local.holiday_allowance_month}
          onChange={e => setLocal(p => ({ ...p, holiday_allowance_month: parseInt(e.target.value) }))}>
          {MONTHS_FULL.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
        </select>
      </div>
      <div className="modal-field">
        <label>Christmas Allowance Month</label>
        <select className="modal-input" value={local.christmas_allowance_month}
          onChange={e => setLocal(p => ({ ...p, christmas_allowance_month: parseInt(e.target.value) }))}>
          {MONTHS_FULL.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
        </select>
      </div>
      <div className="modal-actions">
        <button className="modal-btn modal-btn--secondary" onClick={onClose}>Cancel</button>
        <button className="modal-btn modal-btn--primary" onClick={() => onSave(local)}>Save Settings</button>
      </div>
    </Modal>
  );
}
