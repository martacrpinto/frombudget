import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { formatCurrency, formatCurrencySigned, formatPercent, MONTHS_SHORT } from '../utils/format';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend, Filler
} from 'chart.js';
import { Bar, Line, Doughnut } from 'react-chartjs-2';
import './Dashboard.css';

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Title, Tooltip, Legend, Filler);

const MONTHS_S = MONTHS_SHORT();
const QUARTERS  = ['Q1','Q2','Q3','Q4'];
const PALETTE   = ['#1a1a1a','#5d8378','#b3946f','#6e6158','#29321e','#392527'];
const COST_CLR  = 'rgba(178,34,34,0.82)';
const REV_CLR   = 'rgba(46,125,50,0.82)';
const GREY_CLR  = 'rgba(180,180,180,0.55)';

function tt() {
  return { backgroundColor:'#fff', titleColor:'#111', bodyColor:'#555', borderColor:'#e8e8e8', borderWidth:1, padding:12, cornerRadius:8, displayColors:true, boxWidth:10, boxHeight:10 };
}

function fmtC(v) { return formatCurrency(Math.abs(v ?? 0)); }

// mode: 'from' = all users (Dashboard From), 'heads' = non-admin users only (Dashboard Heads)
export default function Dashboard({ mode = 'from' }) {
  const isHeads = mode === 'heads';
  const { users, categories, availableYears, API, addNotification } = useApp();
  // In Heads mode, only show non-admin users in the User filter
  // (admin users are excluded from data server-side)
  const [data,         setData]         = useState(null);
  const [prevData,     setPrevData]     = useState(null);
  const [allYearsData, setAllYearsData] = useState({});
  const [loading,      setLoading]      = useState(true);

  // ── Filters ──
  const [filterUser,       setFilterUser]       = useState('');
  const [filterCategories, setFilterCategories] = useState([]); // array of ids
  const [filterGroup,      setFilterGroup]      = useState('');
  const [filterYear,       setFilterYear]       = useState(availableYears[0] || new Date().getFullYear());
  const [filterMonth,      setFilterMonth]      = useState('');
  const [showCatDropdown,  setShowCatDropdown]  = useState(false);
  const [userChartMode,    setUserChartMode]    = useState('Total');
  const [monthChartMode,   setMonthChartMode]   = useState('Total');
  const [timeView,         setTimeView]         = useState('monthly');
  const [showPrevYearTime, setShowPrevYearTime] = useState(false); // prev year line on time chart
  const [showPrevYearUser, setShowPrevYearUser] = useState(false); // prev year bars on user chart
  const catDropRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    const h = (e) => { if (catDropRef.current && !catDropRef.current.contains(e.target)) setShowCatDropdown(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const hasFilters = filterUser || filterCategories.length > 0 || filterGroup || filterMonth;
  const clearFilters = () => { setFilterUser(''); setFilterCategories([]); setFilterGroup(''); setFilterMonth(''); };

  // Derived lists
  const leafCats   = useMemo(() => categories.filter((c,i,a) => !c.is_parent && a.findIndex(x=>x.id===c.id)===i), [categories]);
  const groupCats  = useMemo(() => categories.filter((c,i,a) =>  c.is_parent && a.findIndex(x=>x.id===c.id)===i), [categories]);


  // ── Load data from server — server does ALL filtering ──
  const loadData = useCallback(async () => {
    if (!filterYear) return;
    setLoading(true);
    try {
      const params = { year: filterYear };
      if (isHeads) params.headsOnly = '1'; // pass heads filter to server
      if (filterUser)                params.userId      = filterUser;
      if (filterGroup)               params.groupId     = filterGroup;
      else if (filterCategories.length === 1) params.categoryId  = filterCategories[0];
      else if (filterCategories.length >  1) params.categoryIds = filterCategories.join(',');

      const prevParams = {
        year: filterYear - 1,
        ...(isHeads ? { headsOnly: '1' } : {}),
        ...(filterUser ? { userId: filterUser } : {}),
        ...(filterGroup ? { groupId: filterGroup } : {}),
        ...(filterCategories.length === 1 ? { categoryId: filterCategories[0] } : {}),
        ...(filterCategories.length >  1 ? { categoryIds: filterCategories.join(',') } : {}),
      };

      const [res, prevRes] = await Promise.all([
        API.get('/dashboard', { params }),
        API.get('/dashboard', { params: prevParams }),
      ]);
      setData(res.data);
      setPrevData(prevRes.data);

      // Annual view data — no cat filter for annual overview
      const allData = {};
      await Promise.all(availableYears.map(async y => {
        try {
          const p = {
            year: y,
            ...(isHeads ? { headsOnly: '1' } : {}),
            ...(filterUser ? { userId: filterUser } : {}),
          };
          const r = await API.get('/dashboard', { params: p });
          allData[y] = r.data;
        } catch {}
      }));
      setAllYearsData(allData);

    } catch { addNotification('error', 'Failed to load dashboard.'); }
    finally { setLoading(false); }
  }, [filterYear, filterUser, filterCategories, filterGroup, API, availableYears]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    const h = (e) => {
      const msg = e.detail;
      if (['entry_updated','entries_bulk_updated','category_created','category_deleted','category_updated'].includes(msg.type)) loadData();
    };
    window.addEventListener('ws_message', h);
    return () => window.removeEventListener('ws_message', h);
  }, [loadData]);

  // ── KPIs — derived from server-filtered currentTotals / prevYearTotals ──────
  // Fix: server already filters; just sum up what it returns
  const kpis = useMemo(() => {
    if (!data) return null;
    let revenue = 0, costs = 0, prevRevenue = 0, prevCosts = 0;

    // Apply month filter locally (server doesn't filter by month for totals)
    if (filterMonth) {
      const mf = parseInt(filterMonth);
      for (const item of (data.byMonth || [])) {
        if (item.month !== mf) continue;
        if (item.type === 'Revenue') revenue += Math.abs(parseFloat(item.total) || 0);
        else costs -= Math.abs(parseFloat(item.total) || 0);
      }
      prevRevenue = 0; prevCosts = 0; // no prev comparison for single-month
    } else {
      for (const t of (data.currentTotals || [])) {
        if (t.type === 'Revenue') revenue += Math.abs(parseFloat(t.total) || 0);
        else costs -= Math.abs(parseFloat(t.total) || 0);
      }
      for (const t of (data.prevYearTotals || [])) {
        if (t.type === 'Revenue') prevRevenue += Math.abs(parseFloat(t.total) || 0);
        else prevCosts -= Math.abs(parseFloat(t.total) || 0);
      }
    }
    return { revenue, costs, totalBudget: revenue + costs, prevRevenue, prevCosts, prevBudget: prevRevenue + prevCosts };
  }, [data, filterMonth]);

  // ── Monthly map (for time series) — server already filtered ──────────────
  const monthlyMap = useMemo(() => {
    if (!data) return {};
    const map = {};
    for (let m = 1; m <= 12; m++) map[m] = { revenue:0, costs:0 };
    for (const item of (data.byMonth || [])) {
      const m = item.month;
      if (!map[m]) continue;
      if (item.type === 'Revenue') map[m].revenue += Math.abs(parseFloat(item.total) || 0);
      else map[m].costs += Math.abs(parseFloat(item.total) || 0);
    }
    return map;
  }, [data]);

  const quarterlyData = useMemo(() => QUARTERS.map((q, qi) => {
    const months = [qi*3+1, qi*3+2, qi*3+3];
    return {
      label: q,
      revenue: months.reduce((s,m) => s + (monthlyMap[m]?.revenue || 0), 0),
      costs:   months.reduce((s,m) => s + (monthlyMap[m]?.costs   || 0), 0),
    };
  }), [monthlyMap]);

  // ── Budget by User — always all users, highlight selected ─────────────────
  const userChartData = useMemo(() => {
    if (!data) return null;
    const userMap = {};
    for (const u of users) userMap[u.id] = { name: u.name, revenue:0, costs:0 };
    for (const item of (data.byUser || [])) {
      if (!userMap[item.id]) continue;
      if (item.type === 'Revenue') userMap[item.id].revenue += Math.abs(parseFloat(item.total) || 0);
      else userMap[item.id].costs += Math.abs(parseFloat(item.total) || 0);
    }

    // Prev year user data
    const prevUserMap = {};
    if (showPrevYearUser && prevData) {
      for (const u of users) prevUserMap[u.id] = { revenue:0, costs:0 };
      for (const item of (prevData.byUser || [])) {
        if (!prevUserMap[item.id]) continue;
        if (item.type === 'Revenue') prevUserMap[item.id].revenue += Math.abs(parseFloat(item.total) || 0);
        else prevUserMap[item.id].costs += Math.abs(parseFloat(item.total) || 0);
      }
    }

    const list = Object.entries(userMap).map(([id, val]) => ({ id, ...val }));
    const getVal = (u, map) => userChartMode === 'Revenue' ? (map[u.id]?.revenue||0) : userChartMode === 'Costs' ? (map[u.id]?.costs||0) : (map[u.id]?.revenue||0) + (map[u.id]?.costs||0);

    const datasets = [{
      label: String(filterYear),
      data: list.map(u => getVal(u, userMap)),
      backgroundColor: list.map((u, i) => {
        const base = PALETTE[i % PALETTE.length];
        if (!filterUser) return base + 'cc';
        return u.id === filterUser ? base : base + '33';
      }),
      borderColor: list.map((u, i) => {
        const base = PALETTE[i % PALETTE.length];
        return !filterUser || u.id === filterUser ? base : base + '33';
      }),
      borderWidth: list.map(u => filterUser && u.id === filterUser ? 2 : 1),
      borderRadius: 5, borderSkipped: false,
      categoryPercentage: showPrevYearUser ? 0.8 : 0.85,
      barPercentage: showPrevYearUser ? 0.55 : 0.7,
    }];

    if (showPrevYearUser && Object.keys(prevUserMap).length > 0) {
      datasets.push({
        label: String(filterYear - 1),
        data: list.map(u => getVal(u, prevUserMap)),
        backgroundColor: PALETTE.map(c => c + '44'),
        borderColor: PALETTE.map(c => c + '88'),
        borderWidth: 1,
        borderRadius: 5, borderSkipped: false,
        categoryPercentage: 0.8, barPercentage: 0.55,
      });
    }

    return { labels: list.map(u => u.name), datasets };
  }, [data, prevData, users, userChartMode, filterUser, filterYear, showPrevYearUser]);

  // ── Prev year monthly map (for time chart prev year line) ─────────────────
  const prevMonthlyMap = useMemo(() => {
    if (!prevData) return {};
    const map = {};
    for (let m = 1; m <= 12; m++) map[m] = { revenue:0, costs:0 };
    for (const item of (prevData.byMonth || [])) {
      const m = item.month;
      if (!map[m]) continue;
      if (item.type === 'Revenue') map[m].revenue += Math.abs(parseFloat(item.total) || 0);
      else map[m].costs += Math.abs(parseFloat(item.total) || 0);
    }
    return map;
  }, [prevData]);

  const prevQuarterlyData = useMemo(() => QUARTERS.map((q, qi) => {
    const months = [qi*3+1, qi*3+2, qi*3+3];
    return {
      revenue: months.reduce((s,m) => s + (prevMonthlyMap[m]?.revenue || 0), 0),
      costs:   months.reduce((s,m) => s + (prevMonthlyMap[m]?.costs   || 0), 0),
    };
  }), [prevMonthlyMap]);

  // ── Time series ───────────────────────────────────────────────────────────
  const timeChartData = useMemo(() => {
    if (timeView === 'annual') {
      const years = availableYears.slice().sort((a,b) => a-b);
      const getYearVal = (y) => {
        const d = allYearsData[y] || (y === filterYear ? data : null);
        if (!d) return 0;
        let rev = 0, cost = 0;
        for (const t of (d.currentTotals || [])) {
          if (t.type === 'Revenue') rev  += Math.abs(parseFloat(t.total) || 0);
          else                      cost += Math.abs(parseFloat(t.total) || 0);
        }
        if (monthChartMode === 'Revenue') return rev;
        if (monthChartMode === 'Costs')   return cost;
        return rev - cost;
      };
      const color = monthChartMode === 'Costs' ? '#b22222' : monthChartMode === 'Revenue' ? '#2e7d32' : '#000000';
      return {
        labels: years.map(String),
        datasets: [{ label: monthChartMode, data: years.map(getYearVal),
          backgroundColor: years.map(y => y === filterYear ? color : color+'55'),
          borderColor: color, borderWidth:1, borderRadius:5 }]
      };
    }

    const isQ = timeView === 'quarterly';
    const labels = isQ ? QUARTERS : MONTHS_S;
    const getVal = (map, qArr, mode) => {
      if (isQ) {
        return qArr.map(q => mode==='Revenue' ? q.revenue : mode==='Costs' ? q.costs : q.revenue - q.costs);
      }
      return [1,2,3,4,5,6,7,8,9,10,11,12].map(m =>
        mode==='Revenue' ? (map[m]?.revenue||0) : mode==='Costs' ? (map[m]?.costs||0) : (map[m]?.revenue||0)-(map[m]?.costs||0)
      );
    };

    const color = monthChartMode === 'Costs' ? '#b22222' : monthChartMode === 'Revenue' ? '#2e7d32' : '#000000';
    const values = getVal(monthlyMap, quarterlyData, monthChartMode);

    const datasets = [{
      label: String(filterYear),
      data: values, borderColor: color, backgroundColor: color+'12',
      fill:true, tension:0.4, pointRadius:4, pointHoverRadius:7,
      pointBackgroundColor:'#fff', pointBorderColor:color, pointBorderWidth:2
    }];

    if (showPrevYearTime && prevData) {
      const prevColor = '#b3946f'; // warm sand — distinct prev year colour
      const prevValues = getVal(prevMonthlyMap, prevQuarterlyData, monthChartMode);
      datasets.push({
        label: String(filterYear - 1),
        data: prevValues, borderColor: prevColor, backgroundColor: prevColor+'18',
        fill: false, tension:0.4, pointRadius:3, pointHoverRadius:6,
        pointBackgroundColor:'#fff', pointBorderColor: prevColor, pointBorderWidth:1.5,
        borderDash: [5, 3],
      });
    }

    return { labels, datasets };
  }, [monthlyMap, quarterlyData, prevMonthlyMap, prevQuarterlyData, timeView, monthChartMode, allYearsData, availableYears, filterYear, data, prevData, showPrevYearTime]);

  // ── Category chart (leaf only) — previous year bars only when prev has data ──
  const catChartData = useMemo(() => {
    if (!data) return null;
    const currMap = {}, prevMap = {};

    for (const c of (data.byCategory || []).filter(c => !c.is_parent)) {
      currMap[c.id] = { name: c.name, type: c.type, total: Math.abs(parseFloat(c.total) || 0) };
    }
    if (prevData) {
      for (const c of (prevData.byCategory || []).filter(c => !c.is_parent)) {
        const v = Math.abs(parseFloat(c.total) || 0);
        if (v > 0) prevMap[c.id] = v;
      }
    }

    const sorted = Object.values(currMap).sort((a,b) => b.total - a.total).slice(0, 15);
    if (sorted.length === 0) return null;

    // Only include previous year dataset if at least one category has prev data
    const hasPrevData = sorted.some(c => (prevMap[c.id] || 0) > 0);

    const datasets = [
      {
        label: String(filterYear),
        data: sorted.map(c => c.total),
        backgroundColor: sorted.map(c => c.type === 'Cost' ? COST_CLR : REV_CLR),
        borderRadius:4, borderSkipped:false,
        categoryPercentage: hasPrevData ? 0.7 : 0.85,
        barPercentage: hasPrevData ? 0.6 : 0.7,
      },
    ];

    if (hasPrevData) {
      datasets.push({
        label: String(filterYear - 1),
        data: sorted.map(c => prevMap[c.id] || 0),
        backgroundColor: GREY_CLR,
        borderRadius:4, borderSkipped:false,
        categoryPercentage: 0.7, barPercentage: 0.6,
      });
    }

    return { labels: sorted.map(c => c.name), datasets };
  }, [data, prevData, filterYear]);

  // ── Revenue vs Costs doughnut ─────────────────────────────────────────────
  const doughnutData = useMemo(() => {
    if (!kpis) return null;
    if (Math.abs(kpis.revenue) < 0.01 && Math.abs(kpis.costs) < 0.01) return null;
    return {
      labels: ['Revenue','Costs'],
      datasets: [{ data: [Math.abs(kpis.revenue), Math.abs(kpis.costs)],
        backgroundColor: [REV_CLR, COST_CLR], borderWidth:3, borderColor:'#ffffff', hoverOffset:6 }]
    };
  }, [kpis]);

  // ── Weight doughnuts (groups + top categories) ────────────────────────────
  const groupWeightData = useMemo(() => {
    if (!data || groupCats.length === 0) return null;
    const childMap = {};
    categories.forEach(c => {
      if (!c.is_parent && c.parent_category_id) {
        if (!childMap[c.parent_category_id]) childMap[c.parent_category_id] = [];
        childMap[c.parent_category_id].push(c.id);
      }
    });
    const groups = groupCats.map(p => {
      const childIds = childMap[p.id] || [];
      const total = (data.byCategory || [])
        .filter(c => childIds.includes(c.id))
        .reduce((s,c) => s + Math.abs(parseFloat(c.total)||0), 0);
      return { name: p.name, total };
    }).filter(g => g.total > 0);
    if (groups.length === 0) return null;
    return {
      labels: groups.map(g => g.name),
      datasets: [{ data: groups.map(g => g.total), backgroundColor: PALETTE.map(c=>c+'cc'), borderWidth:2, borderColor:'#fff', hoverOffset:6 }]
    };
  }, [data, groupCats, categories]);

  // Weight by Category — horizontal bar chart (handles many categories better than doughnut)
  const catWeightData = useMemo(() => {
    if (!data) return null;
    const cats = (data.byCategory || [])
      .filter(c => !c.is_parent)
      .map(c => ({ name: c.name, type: c.type, total: Math.abs(parseFloat(c.total)||0) }))
      .filter(c => c.total > 0)
      .sort((a,b) => b.total - a.total)
      .slice(0, 12);
    if (cats.length === 0) return null;
    return {
      labels: cats.map(c => c.name),
      datasets: [{
        data: cats.map(c => c.total),
        backgroundColor: cats.map(c => c.type === 'Cost' ? COST_CLR : REV_CLR),
        borderRadius: 3, borderSkipped: false,
      }]
    };
  }, [data]);

  // ── Chart options ──────────────────────────────────────────────────────────
  const scY = { grid:{color:'#f0f0f0',drawBorder:false}, border:{display:false}, beginAtZero:true, ticks:{font:{size:11},color:'#a0a0a0',maxTicksLimit:5,callback:v=>formatCurrency(v)} };
  const scX = { grid:{display:false}, border:{display:false}, ticks:{font:{size:11},color:'#707070',maxRotation:35} };
  const cbL = ctx => ` ${ctx.dataset.label?ctx.dataset.label+': ':''}${formatCurrency(ctx.parsed.y??ctx.parsed.x??ctx.raw)}`;

  const barOpts     = { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false},tooltip:{...tt(),callbacks:{label:cbL}}}, scales:{x:scX,y:scY} };
  const lineOpts    = { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false},tooltip:{...tt(),callbacks:{label:cbL}}}, scales:{x:scX,y:scY} };
  const annualOpts  = { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false},tooltip:{...tt(),callbacks:{label:cbL}}}, scales:{x:scX,y:scY} };
  const hBarOpts = (hasPrevYear, totalSum) => ({
    responsive:true, maintainAspectRatio:false, indexAxis:'y',
    plugins:{
      legend:{
        display: hasPrevYear, position:'top',
        labels:{font:{size:11},padding:12,usePointStyle:true,pointStyle:'rect'}
      },
      tooltip:{...tt(),callbacks:{
        label: ctx => {
          const val = ctx.parsed.x;
          const pct = totalSum > 0 ? ((val/totalSum)*100).toFixed(1) : 0;
          return ` ${ctx.dataset.label}: ${formatCurrency(val)} (${pct}%)`;
        }
      }}
    },
    scales:{
      x:{...scY,beginAtZero:true},
      y:{grid:{display:false},border:{display:false},ticks:{font:{size:11},color:'#505050'}}
    }
  });
  const pieOpts = (title) => ({
    responsive:true, maintainAspectRatio:false,
    plugins:{
      title:{display:!!title, text:title, font:{size:12,weight:'600'}, color:'#383838', padding:{bottom:8}},
      legend:{
        position:'bottom',
        labels:{
          font:{size:10}, padding:10, usePointStyle:true, boxWidth:10,
          generateLabels: (chart) => {
            const ds = chart.data.datasets[0];
            const sum = ds.data.reduce((a,b)=>a+b,0);
            return chart.data.labels.map((label,i) => ({
              text: `${label}: ${((ds.data[i]/sum)*100).toFixed(1)}%`,
              fillStyle: ds.backgroundColor[i], strokeStyle:'#fff', lineWidth:1, index:i,
            }));
          }
        }
      },
      tooltip:{...tt(),callbacks:{label:ctx=>{
        const sum = ctx.dataset.data.reduce((a,b)=>a+b,0);
        return ` ${ctx.label}: ${formatCurrency(ctx.raw)} (${sum>0?((ctx.raw/sum)*100).toFixed(1):0}%)`;
      }}}
    },
    cutout:'50%',
  });
  // Doughnut: no Net in center, show % in legend
  const doughnutOpts = {
    responsive:true, maintainAspectRatio:false,
    plugins:{
      legend:{
        position:'bottom',
        labels:{font:{size:11},padding:14,usePointStyle:true,
          generateLabels:(chart)=>{
            const ds = chart.data.datasets[0];
            const sum = ds.data.reduce((a,b)=>a+b,0);
            return chart.data.labels.map((label,i)=>({
              text:`${label}: ${formatCurrency(ds.data[i])} (${sum>0?((ds.data[i]/sum)*100).toFixed(1):0}%)`,
              fillStyle:ds.backgroundColor[i], strokeStyle:'#fff', lineWidth:2, index:i,
            }));
          }
        }
      },
      tooltip:{...tt(),callbacks:{label:ctx=>{
        const sum = ctx.dataset.data.reduce((a,b)=>a+b,0);
        return ` ${ctx.label}: ${formatCurrency(ctx.raw)} (${sum>0?((ctx.raw/sum)*100).toFixed(1):0}%)`;
      }}}
    },
    cutout:'55%', layout:{padding:{top:10,bottom:0}}
  };

  if (loading && !data) return (
    <div className="dashboard">
      <div className="dashboard-loading">
        <div className="kpi-grid dash-kpi-grid" style={{marginBottom:20}}>
          {[0,1,2].map(i=><div key={i} className="skeleton" style={{height:100}}/>)}
        </div>
        <div className="skeleton" style={{height:260,marginBottom:16}}/>
        <div className="skeleton" style={{height:260}}/>
      </div>
    </div>
  );

  return (
    <div className="dashboard">
      {/* Heads mode indicator */}
      {isHeads && (
        <div style={{
          background:'#fafaf8', border:'1px solid #e8e8e8', borderRadius:8,
          padding:'10px 16px', fontSize:12.5, color:'#6e6158', display:'flex',
          alignItems:'center', gap:8, marginBottom:0,
        }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M2 12c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          <span><strong>Dashboard Heads</strong> — showing data for non-admin budget pages only (Carlota, Francisco Camacho, Pedro Coelho + any new non-admin pages)</span>
        </div>
      )}

      {/* ── Filters ── */}
      <div className="dashboard-filters">

        {/* User */}
        <div className="filter-group">
          <label>User</label>
          <select className="dash-select" value={filterUser} onChange={e=>setFilterUser(e.target.value)}>
            <option value="">All Users</option>
            {users.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>

        {/* Category — multi-select dropdown with checkboxes, same visual style */}
        <div className="filter-group">
          <label>Category {filterCategories.length > 0 && <span className="filter-count-badge">{filterCategories.length}</span>}</label>
          <div className="cat-multiselect" ref={catDropRef}>
            <button
              className="dash-select cat-multiselect-trigger"
              onClick={() => setShowCatDropdown(v=>!v)}
              type="button"
            >
              {filterCategories.length === 0
                ? 'All Categories'
                : filterCategories.length === 1
                  ? leafCats.find(c=>c.id===filterCategories[0])?.name || 'Selected'
                  : `${filterCategories.length} categories`
              }
            </button>
            {showCatDropdown && (
              <div className="cat-multiselect-dropdown">
                <div className="cat-multiselect-search-row">
                  <button className="cat-multiselect-clear" onClick={()=>setFilterCategories([])}>Clear all</button>
                </div>
                {leafCats.map(c => (
                  <label key={c.id} className="cat-multiselect-option">
                    <input
                      type="checkbox"
                      checked={filterCategories.includes(c.id)}
                      onChange={e => {
                        setFilterCategories(prev =>
                          e.target.checked ? [...prev, c.id] : prev.filter(id=>id!==c.id)
                        );
                      }}
                    />
                    <span>{c.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Group filter — only if groups exist */}
        {groupCats.length > 0 && (
          <div className="filter-group">
            <label>Group</label>
            <select className="dash-select" value={filterGroup} onChange={e=>{setFilterGroup(e.target.value);setFilterCategories([]);}}>
              <option value="">All Groups</option>
              {groupCats.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
        )}

        {/* Year */}
        <div className="filter-group">
          <label>Year</label>
          <select className="dash-select" value={filterYear} onChange={e=>setFilterYear(parseInt(e.target.value))}>
            {availableYears.map(y=><option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        {/* Month */}
        <div className="filter-group">
          <label>Month</label>
          <select className="dash-select" value={filterMonth} onChange={e=>setFilterMonth(e.target.value)}>
            <option value="">All Months</option>
            {MONTHS_S.map((m,i)=><option key={i+1} value={i+1}>{m}</option>)}
          </select>
        </div>

        {hasFilters && (
          <button className="dash-clear-btn" onClick={clearFilters} title="Clear all filters">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M2 2l9 9M11 2L2 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            Clear
          </button>
        )}
      </div>

      {/* ── KPIs ── */}
      <div className="kpi-grid dash-kpi-grid">
        <DashKPI label="Total Budget"  value={kpis?.totalBudget} prev={kpis?.prevBudget}   year={filterYear} colorByValue />
        <DashKPI label="Total Revenue" value={kpis?.revenue}     prev={kpis?.prevRevenue}  year={filterYear} positive />
        <DashKPI label="Total Costs"   value={kpis?.costs}       prev={kpis?.prevCosts}    year={filterYear} isCosts />
      </div>

      {/* ── Row 1: Budget by User + Doughnut ── */}
      <div className="charts-row charts-row--3-1">
        <div className="chart-card">
          <div className="chart-header">
            <h3>Budget by User {filterUser && <span className="chart-header-note">· highlighted</span>}</h3>
            <div style={{display:'flex', alignItems:'center', gap:8}}>
              <ChartTabs tabs={['Total','Revenue','Costs']} active={userChartMode} onChange={setUserChartMode}/>
              {/* Fix 6: prev year toggle */}
              <button
                className={`chart-tab ${showPrevYearUser?'active':''}`}
                onClick={() => setShowPrevYearUser(v=>!v)}
                title={showPrevYearUser ? `Hide ${filterYear-1}` : `Show ${filterYear-1}`}
                style={{fontSize:11}}
              >
                vs {filterYear-1}
              </button>
            </div>
          </div>
          <div className="chart-body">
            {userChartData ? <Bar data={userChartData} options={{
              ...barOpts,
              plugins:{...barOpts.plugins, legend:{display: showPrevYearUser, position:'top', labels:{font:{size:11},padding:10,usePointStyle:true,pointStyle:'rect'}}}
            }}/> : <EmptyChart/>}
          </div>
        </div>

        {/* Fix 3: Doughnut — no Net center, % in legend */}
        <div className="chart-card">
          <div className="chart-header"><h3>Revenue vs Costs</h3></div>
          <div className="chart-body chart-body--doughnut">
            {doughnutData ? (
              <Doughnut data={doughnutData} options={doughnutOpts}/>
            ) : <EmptyChart label="No data"/>}
          </div>
        </div>
      </div>

      {/* ── Row 2: Time series ── */}
      <div className="chart-card chart-card--full">
        <div className="chart-header">
          <h3>Budget Over Time</h3>
          <div className="chart-header-right">
            <ChartTabs tabs={['Total','Revenue','Costs']} active={monthChartMode} onChange={setMonthChartMode}/>
            <div className="chart-tabs chart-tabs--view">
              {['monthly','quarterly','annual'].map(v=>(
                <button key={v} className={`chart-tab ${timeView===v?'active':''}`} onClick={()=>setTimeView(v)}>
                  {v.charAt(0).toUpperCase()+v.slice(1)}
                </button>
              ))}
              {/* Fix 5: prev year toggle — only for monthly/quarterly */}
              {timeView !== 'annual' && (
                <button
                  className={`chart-tab ${showPrevYearTime?'active':''}`}
                  onClick={() => setShowPrevYearTime(v=>!v)}
                  style={{fontSize:11}}
                  title={showPrevYearTime ? `Hide ${filterYear-1}` : `Compare with ${filterYear-1}`}
                >
                  vs {filterYear-1}
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="chart-body chart-body--lg">
          {timeChartData ? (
            timeView==='annual'
              ? <Bar data={timeChartData} options={annualOpts}/>
              : <Line data={timeChartData} options={{
                  ...lineOpts,
                  plugins:{...lineOpts.plugins, legend:{display: showPrevYearTime, position:'top', labels:{font:{size:11},padding:10,usePointStyle:true}}}
                }}/>
          ) : <EmptyChart/>}
        </div>
        {timeView==='annual' && <div className="chart-note">Darker bar = selected year ({filterYear})</div>}
      </div>

      {/* ── Row 3: Weight by Group — shown inline with time series if space allows ── */}
      {groupWeightData && (
        <div className="chart-card chart-card--full">
          <div className="chart-header">
            <h3>Budget Weight by Group</h3>
            <span style={{fontSize:11.5,color:'var(--gray-400)'}}>Relative weight of each category group</span>
          </div>
          <div style={{display:'flex', gap:0, alignItems:'stretch', minHeight:220}}>
            {/* Doughnut — fixed width */}
            <div style={{width:280, flexShrink:0, padding:'12px 0 12px 12px'}}>
              <Doughnut data={groupWeightData} options={pieOpts('')}/>
            </div>
            {/* Breakdown table — fills remaining space */}
            <div style={{flex:1, padding:'16px 20px', display:'flex', flexDirection:'column', justifyContent:'center', gap:8, minWidth:0}}>
              {groupWeightData.labels.map((label, i) => {
                const val = groupWeightData.datasets[0].data[i];
                const total = groupWeightData.datasets[0].data.reduce((a,b)=>a+b,0);
                const pct = total > 0 ? ((val/total)*100).toFixed(1) : 0;
                const color = groupWeightData.datasets[0].backgroundColor[i];
                return (
                  <div key={i} style={{display:'flex', alignItems:'center', gap:10}}>
                    <span style={{width:10,height:10,borderRadius:2,background:color,flexShrink:0}}/>
                    <span style={{flex:1,fontSize:12.5,color:'var(--gray-700)',fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{label}</span>
                    <span style={{fontSize:12,color:'var(--gray-500)',fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{formatCurrency(val)}</span>
                    <span style={{fontSize:11,color:'var(--gray-400)',minWidth:40,textAlign:'right'}}>{pct}%</span>
                    {/* Bar */}
                    <div style={{width:80,height:6,background:'var(--gray-100)',borderRadius:3,overflow:'hidden',flexShrink:0}}>
                      <div style={{height:'100%',width:`${pct}%`,background:color,borderRadius:3}}/>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Row 4: Budget by Category — Fix 4: % in tooltip ── */}
      {(() => {
        const totalSum = catChartData?.datasets?.[0]?.data?.reduce((a,b)=>a+b,0) || 0;
        const hasPrev  = catChartData?.datasets?.length > 1;
        return (
          <div className="chart-card chart-card--full">
            <div className="chart-header">
              <h3>Budget by Category</h3>
              <div className="chart-legend-inline">
                <span className="legend-dot" style={{background:REV_CLR}}/> Revenue
                <span className="legend-dot" style={{background:COST_CLR}}/> Costs
                {hasPrev && (
                  <>
                    <span className="legend-separator"/>
                    <span className="legend-dot" style={{background:GREY_CLR}}/> {filterYear-1}
                  </>
                )}
                <span className="legend-separator"/>
                <span style={{fontSize:11,color:'var(--gray-400)'}}>Hover for %</span>
              </div>
            </div>
            <div className="chart-body chart-body--tall">
              {catChartData && catChartData.labels.length > 0
                ? <Bar data={catChartData} options={hBarOpts(hasPrev, totalSum)}/>
                : <EmptyChart label="No category data."/>}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── KPI Card — only show variation when prev year has actual data ───────────
function DashKPI({ label, value, prev, positive, isCosts, colorByValue, year }) {
  const v = value ?? 0;
  const p = prev  ?? 0;
  // Fix: only show change row when previous year had actual non-zero data
  const hasPrevData = p !== 0;
  const rawChange  = v - p;
  const pctChange  = p !== 0 ? ((v - p) / Math.abs(p)) * 100 : null;

  let displayChange = null, changeClass = 'kpi-change--zero';

  if (hasPrevData && rawChange !== 0) {
    if (isCosts) {
      const up = rawChange < 0; // more negative = costs grew
      const amt = Math.abs(rawChange);
      displayChange = up
        ? `+${formatCurrency(amt).replace('(','').replace(')','')}`
        : `−${formatCurrency(amt).replace('(','').replace(')','')}`;
      changeClass = up ? 'kpi-change--bad' : 'kpi-change--good';
    } else {
      displayChange = rawChange > 0 ? `+${formatCurrency(rawChange)}` : formatCurrency(rawChange);
      changeClass = rawChange > 0 ? 'kpi-change--good' : 'kpi-change--bad';
    }
  }

  const displayPct = hasPrevData && rawChange !== 0 && pctChange !== null
    ? (isCosts
        ? `${((Math.abs(rawChange)/Math.abs(p))*100*(rawChange<0?1:-1)).toFixed(1)}%`
        : `${pctChange>0?'+':''}${pctChange.toFixed(1)}%`)
    : null;

  let valueClass = '';
  if (colorByValue)       valueClass = v > 0 ? 'kpi-value--positive' : v < 0 ? 'kpi-value--negative' : '';
  else if (positive&&v>0) valueClass = 'kpi-value--positive';
  else if (isCosts&&v<0)  valueClass = 'kpi-value--negative';

  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value ${valueClass}`}>{formatCurrency(v)}</div>
      {hasPrevData && displayChange ? (
        <div className={`kpi-change ${changeClass}`}>
          <span>{displayChange}</span>
          {displayPct && <span className="kpi-pct">{displayPct}</span>}
          <span className="kpi-change-label">vs {(year||new Date().getFullYear())-1}</span>
        </div>
      ) : (
        <div className="kpi-change kpi-change--zero">
          <span className="kpi-change-label">{hasPrevData ? 'No change' : 'No prior year data'}</span>
        </div>
      )}
    </div>
  );
}

function ChartTabs({ tabs, active, onChange }) {
  return (
    <div className="chart-tabs">
      {tabs.map(t=><button key={t} className={`chart-tab ${active===t?'active':''}`} onClick={()=>onChange(t)}>{t}</button>)}
    </div>
  );
}

function EmptyChart({ label='No data available.' }) {
  return <div className="chart-empty">{label}</div>;
}
