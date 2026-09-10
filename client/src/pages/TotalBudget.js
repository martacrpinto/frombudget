import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import { exportWorkbook, getExportHistory, getExportSignedUrl } from '../lib/exportWorkbook';
import { formatCurrency, formatCurrencySigned, formatPercent, calcChange, MONTHS_SHORT, MONTHS_FULL } from '../utils/format';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { buildRenderList } from '../utils/hierarchy';
import './BudgetPage.css';
import './TotalBudget.css';

const MONTHS = MONTHS_FULL();
const MONTHS_S = MONTHS_SHORT();

// mode: 'all' = Total Budget From (all users), 'heads' = Total Budget Heads (non-approvers)
export default function TotalBudget({ mode = 'all' }) {
  const isHeads = mode === 'heads';
  const { availableYears, API, addNotification, currentUser } = useApp();
  const [year, setYear] = useState(availableYears[0] || 2026);
  const [categories, setLocalCategories] = useState([]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Collapsed state in sessionStorage — persists across refresh
  const COLLAPSED_KEY = isHeads ? 'collapsed_total_heads' : 'collapsed_total';
  const [collapsedTotal, setCollapsedTotalRaw] = useState(() => {
    try {
      const s = sessionStorage.getItem(COLLAPSED_KEY);
      if (s) return new Set(JSON.parse(s));
    } catch {}
    return new Set();
  });
  const setCollapsedTotal = (updater) => {
    setCollapsedTotalRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try { sessionStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next])); } catch {}
      return next;
    });
  };
  const [entries, setEntries] = useState({});
  const [prevEntries, setPrevEntries] = useState({});
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportHistory, setExportHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  // Total Budget custom order stored in sessionStorage per year — separate for each mode
  const ORDER_KEY = isHeads ? `total_heads_order_${year}` : `total_from_order_${year}`;

  const applySavedOrder = (cats) => {
    try {
      const saved = sessionStorage.getItem(ORDER_KEY);
      if (!saved) return cats;
      const savedIds = JSON.parse(saved);
      // Reorder cats according to saved order, appending any new cats at the end
      const idMap = {};
      cats.forEach(c => { idMap[c.id] = c; });
      const ordered = savedIds.map(id => idMap[id]).filter(Boolean);
      const newCats = cats.filter(c => !savedIds.includes(c.id));
      return [...ordered, ...newCats];
    } catch { return cats; }
  };

  const saveOrder = (cats) => {
    try {
      sessionStorage.setItem(ORDER_KEY, JSON.stringify(cats.map(c => c.id)));
    } catch {}
  };

  const loadData = useCallback(async () => {
    if (!year) return;
    setLoading(true);
    try {
      const endpoint = isHeads ? `/budget/total-heads/${year}` : `/budget/total/${year}`;
      const res = await API.get(endpoint);
      // Deduplicate categories from API response
      const cats = (res.data.categories || []).filter((c, i, arr) => arr.findIndex(x => x.id === c.id) === i);
      // Apply saved order if exists, otherwise use server order
      setLocalCategories(applySavedOrder(cats));
      setEntries(res.data.entries || {});
      setPrevEntries(res.data.previousYearEntries || {});
    } catch {
      addNotification('error', `Failed to load ${isHeads ? 'Total Budget (Heads)' : 'Total Budget From'}.`);
    } finally {
      setLoading(false);
    }
  }, [year, API]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      // Filter history by mode: 'heads' for Heads page, 'from' for From page
      const mode = isHeads ? 'heads' : 'from';
      setExportHistory(await getExportHistory(supabase, mode));
    } catch {} finally {
      setHistoryLoading(false);
    }
  }, [API, isHeads]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  useEffect(() => {
    const handler = (e) => {
      const msg = e.detail;
      if (msg.type === 'entry_updated' && msg.year === year) loadData();
      if (msg.type === 'entries_bulk_updated' && msg.year === year) loadData();
      // Only reload history if the export mode matches this page's mode
      if (msg.type === 'export_created') {
        const myMode = isHeads ? 'heads' : 'from';
        if (!msg.exportMode || msg.exportMode === myMode) loadHistory();
      }
    };
    window.addEventListener('ws_message', handler);
    return () => window.removeEventListener('ws_message', handler);
  }, [year]);

  // Leaf categories only — no double-counting with parents
  const leafCats = React.useMemo(() => categories.filter(c => !c.is_parent), [categories]);

  const getCellValue = (catId, month) => {
    const raw = entries[catId]?.[month] || 0;
    const cat = categories.find(c => c.id === catId);
    if (!cat || cat.is_parent) return 0;
    return cat.type === 'Cost' ? -Math.abs(raw) : Math.abs(raw);
  };

  // Parent month value = sum of children
  const getParentMonthVal = (parentId, month) =>
    categories
      .filter(c => !c.is_parent && c.parent_category_id === parentId)
      .reduce((sum, c) => sum + getCellValue(c.id, month), 0);

  const getPrevValue = (catId, month) => {
    const raw = prevEntries[catId]?.[month] || 0;
    const cat = categories.find(c => c.id === catId);
    if (!cat || cat.is_parent) return 0;
    return cat.type === 'Cost' ? -Math.abs(raw) : Math.abs(raw);
  };

  const getRowTotal = (catId) => {
    const cat = categories.find(c => c.id === catId);
    if (cat?.is_parent) {
      return categories
        .filter(c => !c.is_parent && c.parent_category_id === catId)
        .reduce((sum, c) => {
          let t = 0; for (let m = 1; m <= 12; m++) t += getCellValue(c.id, m); return sum + t;
        }, 0);
    }
    let t = 0;
    for (let m = 1; m <= 12; m++) t += getCellValue(catId, m);
    return t;
  };

  // Column totals: leaf only
  const getColTotal = (month) => {
    let t = 0;
    for (const cat of leafCats) t += getCellValue(cat.id, month);
    return t;
  };

  const getGrandTotal = () => {
    let t = 0;
    for (const cat of leafCats) t += getRowTotal(cat.id);
    return t;
  };

  const kpis = React.useMemo(() => {
    let totalBudget = 0, totalCosts = 0, totalRevenue = 0;
    let prevBudget = 0, prevCosts = 0, prevRevenue = 0;
    for (const cat of leafCats) {
      const rowTotal = getRowTotal(cat.id);
      let prevTotal = 0;
      for (let m = 1; m <= 12; m++) prevTotal += getPrevValue(cat.id, m);
      totalBudget += rowTotal;
      prevBudget += prevTotal;
      if (cat.type === 'Cost') { totalCosts += rowTotal; prevCosts += prevTotal; }
      else { totalRevenue += rowTotal; prevRevenue += prevTotal; }
    }
    return { totalBudget, totalCosts, totalRevenue, prevBudget, prevCosts, prevRevenue };
  }, [categories, entries, prevEntries]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const result = await exportWorkbook({ supabase, currentUser, years: availableYears, headsOnly: isHeads });
      addNotification('success', `Excel file exported: ${result.filename}`);
      loadHistory();
      // Auto-download
      const link = document.createElement('a');
      link.href = result.url;
      link.download = result.filename;
      link.click();
    } catch {
      addNotification('error', 'Failed to export Excel file.');
    } finally {
      setExporting(false);
    }
  };

  const handleDownload = async (record) => {
    try {
      const url = await getExportSignedUrl(supabase, record.filepath);
      const link = document.createElement('a'); link.href = url; link.download = record.filename; link.click();
    } catch { addNotification('error', 'Failed to download export.'); }
  };

  if (loading) {
    return (
      <div className="budget-page">
        <div className="budget-loading">
          <div className="skeleton" style={{ width: 200, height: 28, marginBottom: 24 }} />
          <div className="skeleton" style={{ width: '100%', height: 400 }} />
        </div>
      </div>
    );
  }

  return (
    <div className="budget-page">
      <div className="budget-header">
        <div className="budget-header-left">
          <h1 className="budget-title">{isHeads ? 'Total Budget (Heads)' : 'Total Budget From'}</h1>
          <div className="budget-year-selector">
            <select className="year-select" value={year} onChange={e => setYear(parseInt(e.target.value))}>
              {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
        <div className="readonly-badge">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <rect x="2" y="5" width="8" height="6" rx="1" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M4 5V4a2 2 0 014 0v1" stroke="currentColor" strokeWidth="1.2"/>
          </svg>
          {isHeads
            ? 'Read-only · Heads only (Francisco E., Carlota, Francisco C., Pedro)'
            : 'Read-only · All users consolidated'}
        </div>
      </div>

      <div className="kpi-grid">
        <KPICard label="Total Budget" value={kpis.totalBudget} prev={kpis.prevBudget} year={year} colorByValue />
        <KPICard label="Total Revenue" value={kpis.totalRevenue} prev={kpis.prevRevenue} year={year} positive />
        <KPICard label="Total Costs" value={kpis.totalCosts} prev={kpis.prevCosts} year={year} isCosts />
      </div>

      <div className="budget-table-section">
        <div className="budget-table-header">
          <h2 className="budget-table-title">{isHeads ? 'Total Budget (Heads)' : 'Total Budget From'} — {year}</h2>
          {categories.some(c => c.is_parent) && (() => {
            const parentIds = categories.filter(c => c.is_parent).map(c => c.id);
            const allCollapsed = parentIds.every(id => collapsedTotal.has(id));
            return (
              <button className="add-category-btn" onClick={() => {
                setCollapsedTotal(allCollapsed ? new Set() : new Set(parentIds));
              }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  {allCollapsed ? (
                    <><path d="M2 5h10M2 9h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                    <path d="M5 3l2-2 2 2M5 11l2 2 2-2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></>
                  ) : (
                    <><path d="M2 5h10M2 9h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                    <path d="M5 2l2 2 2-2M5 12l2-2 2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></>
                  )}
                </svg>
                {allCollapsed ? 'Expand All' : 'Collapse All'}
              </button>
            );
          })()}
        </div>
        <div className="budget-table-container">
          <DndContext sensors={sensors} collisionDetection={closestCenter}
            onDragEnd={({ active, over }) => {
              if (!over || active.id === over.id) return;
              const buildSegs = (cats) => {
                const childMap = {};
                cats.forEach(c => {
                  if (!c.is_parent && c.parent_category_id) {
                    if (!childMap[c.parent_category_id]) childMap[c.parent_category_id] = [];
                    childMap[c.parent_category_id].push(c);
                  }
                });
                const topLevel = cats.filter(c => c.is_parent || !c.parent_category_id);
                return topLevel.map(item => {
                  if (item.is_parent) {
                    return { leadId: item.id, cats: [item, ...(childMap[item.id] || [])] };
                  }
                  return { leadId: item.id, cats: [item] };
                });
              };
              const segs = buildSegs(categories);
              const ai = segs.findIndex(s => s.cats.some(c => c.id === active.id));
              const oi = segs.findIndex(s => s.cats.some(c => c.id === over.id));
              if (ai === -1 || oi === -1 || ai === oi) return;
              const newSegs = arrayMove(segs, ai, oi);
              const newCats = newSegs.flatMap(s => s.cats);
              setLocalCategories(newCats);
              saveOrder(newCats); // persist order to sessionStorage
            }}>
          <table className="budget-table">
            <thead>
              <tr className="budget-table-head">
                <th className="col-drag" />
                <th className="col-num">#</th>
                <th className="col-category">Category</th>
                <th className="col-type">Type</th>
                {MONTHS_S.map((m, i) => <th key={i} className="col-month">{m}</th>)}
                <th className="col-total">Total</th>
              </tr>
            </thead>
            <SortableContext
              items={buildRenderList(categories, collapsedTotal).map(r => r.cat.id)}
              strategy={verticalListSortingStrategy}
            >
            <tbody>
              {buildRenderList(categories, collapsedTotal).map(({ cat, isParent, isChild, num, childCount }) => {
                if (isParent) {
                  const kids = categories.filter(c => !c.is_parent && c.parent_category_id === cat.id);
                  let typeLabel = '';
                  if (kids.length > 0) {
                    const types = new Set(kids.map(c => c.type));
                    typeLabel = types.size === 1 ? [...types][0] : 'Mixed';
                  }
                  return (
                    <TotalBudgetParentRow
                      key={cat.id}
                      cat={cat}
                      num={num}
                      childCount={childCount}
                      typeLabel={typeLabel}
                      getMonthVal={(m) => getParentMonthVal(cat.id, m)}
                      getRowTotal={() => getRowTotal(cat.id)}
                      onToggle={() => {
                        setCollapsedTotal(prev => {
                          const next = new Set(prev);
                          if (next.has(cat.id)) next.delete(cat.id); else next.add(cat.id);
                          return next;
                        });
                      }}
                      collapsed={collapsedTotal.has(cat.id)}
                    />
                  );
                }
                return (
                  <TotalBudgetRow key={cat.id} cat={cat} num={num} isChild={isChild}
                    getCellValue={getCellValue} getPrevValue={getPrevValue}
                    getRowTotal={getRowTotal} />
                );
              })}
            </tbody>
            </SortableContext>
            <tfoot>
              <tr className="budget-table-foot">
                <td colSpan={4} className="foot-label">Total</td>
                {MONTHS.map((_, i) => {
                  const month = i + 1;
                  const colTotal = getColTotal(month);
                  return (
                    <td key={i} className={`foot-cell ${colTotal < 0 ? 'negative' : colTotal > 0 ? 'positive' : ''}`}>
                      {colTotal !== 0 ? formatCurrency(colTotal) : '—'}
                    </td>
                  );
                })}
                <td className={`foot-cell foot-cell--total ${getGrandTotal() < 0 ? 'negative' : 'positive'}`}>
                  {formatCurrency(getGrandTotal())}
                </td>
              </tr>
            </tfoot>
          </table>
          </DndContext>
          {categories.length === 0 && (
            <div className="budget-empty">
              <p>No data available for {year}.</p>
            </div>
          )}
        </div>
      </div>

      {/* Export Section */}
      <div className="export-section">
        <div className="export-header">
          <div>
            <h2 className="export-title">Export to Excel</h2>
            <p className="export-desc">
              {isHeads
                ? 'Downloads an Excel file for Total Budget (Heads) — non-admin users only. This history is independent from Total Budget From.'
                : 'Downloads an Excel file for Total Budget From — all users. This history is independent from Total Budget (Heads).'}
            </p>
          </div>
          <button className="export-btn" onClick={handleExport} disabled={exporting}>
            {exporting ? (<><span className="save-spinner" style={{borderTopColor:'#fff'}} />Generating...</>) : (
              <><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2v8M5 7l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>Export to Excel</>
            )}
          </button>
        </div>
        <div className="export-history">
          <h3 className="export-history-title">Export History</h3>
          {historyLoading ? (
            <div className="skeleton" style={{ width: '100%', height: 120 }} />
          ) : exportHistory.length === 0 ? (
            <div className="export-empty">No exports yet.</div>
          ) : (
            <table className="history-table">
              <thead><tr><th>Version</th><th>Date &amp; Time</th><th>Exported By</th><th>Year</th><th>File</th><th>Download</th></tr></thead>
              <tbody>
                {exportHistory.map(record => (
                  <tr key={record.id}>
                    <td><span className="version-badge">{String(record.version).padStart(3, '0')}</span></td>
                    <td>{new Date(record.timestamp).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                    <td>{record.exported_by_name}</td>
                    <td>{record.year}</td>
                    <td className="file-name">{record.filename}</td>
                    <td>
                      <button className="download-btn" onClick={() => handleDownload(record)}>
                        <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1v7M4 5.5l2.5 2.5L9 5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/><path d="M1.5 10h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                        Download
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function TotalBudgetParentRow({ cat, num, childCount, typeLabel, getMonthVal, getRowTotal, onToggle, collapsed }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: cat.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const rowTotal = getRowTotal();
  const typeClass = typeLabel === 'Cost' ? 'cost' : typeLabel === 'Revenue' ? 'revenue' : 'mixed';

  return (
    <tr ref={setNodeRef} style={style} className="budget-row budget-row--parent">
      <td className="col-drag">
        <span className="drag-handle" {...attributes} {...listeners}>
          <svg width="12" height="16" viewBox="0 0 12 16" fill="none">
            <circle cx="4" cy="4" r="1.5" fill="currentColor"/><circle cx="8" cy="4" r="1.5" fill="currentColor"/>
            <circle cx="4" cy="8" r="1.5" fill="currentColor"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/>
            <circle cx="4" cy="12" r="1.5" fill="currentColor"/><circle cx="8" cy="12" r="1.5" fill="currentColor"/>
          </svg>
        </span>
      </td>
      <td className="col-num" style={{fontWeight:700, color:'var(--gray-600)'}}>{num}</td>
      <td className="col-category">
        <div className="cat-cell-inner parent-cell-inner">
          <span className="parent-cat-name" title={cat.name}>{cat.name}</span>
          <span className="parent-badge">group</span>
          {childCount > 0 && (
            <button className="collapse-btn collapse-btn--inline" onClick={onToggle}
              title={collapsed ? 'Expand group' : 'Collapse group'}>
              <svg width="11" height="11" viewBox="0 0 10 10" fill="none"
                style={{transform: collapsed ? 'rotate(-90deg)' : 'none', transition:'transform 150ms'}}>
                <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
        </div>
      </td>
      <td className="col-type">
        {typeLabel ? (
          <select className={`type-select type-select--${typeClass}`} value={typeLabel}
            onChange={() => {}} style={{cursor:'default', pointerEvents:'none', userSelect:'none'}}>
            <option value="Cost">Cost</option>
            <option value="Revenue">Revenue</option>
            <option value="Mixed">Mixed</option>
          </select>
        ) : (
          <span style={{display:'block', padding:'4px 8px', fontSize:11, color:'var(--gray-300)'}}>—</span>
        )}
      </td>
      {MONTHS_FULL().map((_, i) => {
        const month = i + 1;
        const val = getMonthVal(month);
        return (
          <td key={month} className={`col-month budget-cell readonly ${val < 0 ? 'negative' : val > 0 ? 'positive' : ''}`}>
            <span className="cell-value">{val !== 0 ? formatCurrency(val) : <span className="cell-empty">—</span>}</span>
          </td>
        );
      })}
      <td className={`col-total ${rowTotal < 0 ? 'negative' : rowTotal > 0 ? 'positive' : ''}`}>
        {rowTotal !== 0 ? formatCurrency(rowTotal) : '—'}
      </td>
    </tr>
  );
}

function TotalBudgetRow({ cat, num, getCellValue, getPrevValue, getRowTotal, isChild }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: cat.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const rowTotal = getRowTotal(cat.id);
  const typeClass = cat.type === 'Cost' ? 'cost' : cat.type === 'Revenue' ? 'revenue' : 'mixed';
  return (
    <tr ref={setNodeRef} style={style} className={`budget-row ${isChild ? 'budget-row--child' : ''}`}>
      <td className="col-drag">
        <span className="drag-handle" {...attributes} {...listeners}>
          <svg width="12" height="16" viewBox="0 0 12 16" fill="none">
            <circle cx="4" cy="4" r="1.5" fill="currentColor"/><circle cx="8" cy="4" r="1.5" fill="currentColor"/>
            <circle cx="4" cy="8" r="1.5" fill="currentColor"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/>
            <circle cx="4" cy="12" r="1.5" fill="currentColor"/><circle cx="8" cy="12" r="1.5" fill="currentColor"/>
          </svg>
        </span>
      </td>
      <td className="col-num" style={{fontSize: isChild ? 10.5 : 12, color: isChild ? 'var(--gray-400)' : 'var(--gray-500)'}}>{num}</td>
      <td className="col-category">
        <div className={`cat-cell-inner ${isChild ? 'cat-cell-inner--child' : ''}`}>
          {isChild && <span className="child-indent-bar" />}
          <span className={`cat-name ${isChild ? 'cat-name--child' : ''}`} title={cat.name}>{cat.name}</span>
          {cat.description && (
            <span className="cat-info-icon">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.2"/>
                <path d="M6.5 5.5v4M6.5 4h.01" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
              <span className="cat-tooltip">{cat.description}</span>
            </span>
          )}
        </div>
      </td>
      {/* type-select: same element as BudgetPage, read-only */}
      <td className="col-type">
        <select
          className={`type-select type-select--${typeClass}`}
          value={cat.type}
          onChange={() => {}}
          style={{cursor:'default', pointerEvents:'none', userSelect:'none'}}
        >
          <option value="Cost">Cost</option>
          <option value="Revenue">Revenue</option>
        </select>
      </td>
      {MONTHS_FULL().map((_, i) => {
        const month = i + 1;
        const val = getCellValue(cat.id, month);
        const prev = getPrevValue(cat.id, month);
        const { abs: chAbs, pct: chPct } = calcChange(val, prev);
        return (
          <td key={month} className={`col-month budget-cell readonly ${val < 0 ? 'negative' : val > 0 ? 'positive' : ''}`}
            title={prev !== 0 ? `Prev: ${formatCurrency(prev)} · Change: ${formatCurrencySigned(chAbs)}${chPct !== null ? ` (${formatPercent(chPct)})` : ''}` : undefined}>
            <span className="cell-value">{val !== 0 ? formatCurrency(val) : <span className="cell-empty">—</span>}</span>
          </td>
        );
      })}
      <td className={`col-total ${rowTotal < 0 ? 'negative' : rowTotal > 0 ? 'positive' : ''}`}>
        {rowTotal !== 0 ? formatCurrency(rowTotal) : '—'}
      </td>
    </tr>
  );
}



function KPICard({ label, value, prev, positive, isCosts, colorByValue, year }) {
  const v = value ?? 0;
  const p = prev ?? 0;
  const hasPrevData = p !== 0;
  const absChange = v - p;
  const pctChange = p !== 0 ? ((v - p) / Math.abs(p)) * 100 : null;
  let changeClass = 'kpi-change--zero';
  if (hasPrevData && absChange !== 0) {
    if (isCosts) changeClass = absChange < 0 ? 'kpi-change--bad' : 'kpi-change--good';
    else if (positive) changeClass = absChange > 0 ? 'kpi-change--good' : 'kpi-change--bad';
    else changeClass = absChange > 0 ? 'kpi-change--good' : 'kpi-change--bad';
  }
  let valueClass = '';
  if (colorByValue) valueClass = v > 0 ? 'kpi-value--positive' : v < 0 ? 'kpi-value--negative' : '';
  else if (positive && v > 0) valueClass = 'kpi-value--positive';
  else if (isCosts && v < 0) valueClass = 'kpi-value--negative';
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value ${valueClass}`}>{formatCurrency(v)}</div>
      {hasPrevData ? (
        <div className={`kpi-change ${changeClass}`}>
          <span>{formatCurrencySigned(absChange)}</span>
          {pctChange !== null && <span className="kpi-pct">{formatPercent(pctChange)}</span>}
          <span className="kpi-change-label">vs {(year || new Date().getFullYear()) - 1}</span>
        </div>
      ) : (
        <div className="kpi-change kpi-change--zero">
          <span className="kpi-change-label">No prior year data</span>
        </div>
      )}
    </div>
  );
}
