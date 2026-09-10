import ExcelJS from 'exceljs';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const safeName = (name) => String(name || 'User').replace(/[\\/*?:\[\]]/g, '').slice(0, 20);
const signed = (value, category) => category?.type === 'Cost' ? -Math.abs(Number(value || 0)) : Math.abs(Number(value || 0));
const orderedCategories = (categories) => {
  const byParent = {}; categories.forEach(c => { if (c.parent_category_id) (byParent[c.parent_category_id] ||= []).push(c); });
  const top = categories.filter(c => c.is_parent || !c.parent_category_id);
  const sort = xs => xs.slice().sort((a,b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.id).localeCompare(String(b.id)));
  return sort(top).flatMap(c => c.is_parent ? [c, ...sort(byParent[c.id] || [])] : [c]);
};
const applyStyle = (row, parent) => { row.font = { bold: parent, color: parent ? 'FFFFFF' : '1F2937' }; if (parent) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '334155' } }; };

function addSheet(workbook, name, categories, entries) {
  const sheet = workbook.addWorksheet(name.slice(0, 31));
  sheet.addRow(['Category', 'Type', ...MONTHS, 'Total']);
  sheet.getRow(1).font = { bold: true, color: 'FFFFFF' }; sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0F766E' } }; sheet.freezePanes = 'C2';
  const ordered = orderedCategories(categories); const leaves = categories.filter(c => !c.is_parent); const value = (cat, month) => signed(entries[cat.id]?.[month] || 0, cat);
  ordered.forEach(cat => { const kids = categories.filter(c => !c.is_parent && c.parent_category_id === cat.id); const target = cat.is_parent ? kids : [cat]; const vals = MONTHS.map((_, i) => target.reduce((s,k) => s + value(k, i + 1), 0)); const row = sheet.addRow([cat.name, cat.is_parent ? 'Group' : cat.type, ...vals, vals.reduce((s,v) => s + v, 0)]); applyStyle(row, cat.is_parent); });
  const totals = MONTHS.map((_, i) => leaves.reduce((s,c) => s + value(c, i + 1), 0)); const totalRow = sheet.addRow(['Total', '', ...totals, totals.reduce((s,v) => s + v, 0)]); totalRow.font = { bold: true }; totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'D1FAE5' } };
  sheet.columns.forEach((col, i) => { col.width = i === 0 ? 30 : i === 1 ? 12 : 14; });
  for (let r = 2; r <= sheet.rowCount; r++) for (let c = 3; c <= 15; c++) sheet.getRow(r).getCell(c).numFmt = '#,##0.00;[Red]-#,##0.00';
  return sheet;
}

export async function exportWorkbook({ supabase, currentUser, years, headsOnly = false }) {
  if (!supabase || !currentUser?.id) throw new Error('Supabase session is required');
  const selectedYears = [...new Set((years || []).map(Number))].sort((a,b) => a-b);
  const [{ data: profiles, error: pe }, { data: categories, error: ce }, { data: entries, error: ee }, { data: roles, error: re }] = await Promise.all([
    supabase.from('profiles').select('id,name'), supabase.from('categories').select('*').order('sort_order'), supabase.from('budget_entries').select('user_id,category_id,year,month,value'), supabase.from('profile_roles').select('user_id,is_approver')
  ]);
  if (pe || ce || ee || re) throw (pe || ce || ee || re);
  const approvers = new Set((roles || []).filter(r => r.is_approver).map(r => r.user_id));
  const users = (profiles || []).filter(u => !headsOnly || !approvers.has(u.id));
  const by = {}; (entries || []).forEach(e => { if (!selectedYears.includes(Number(e.year))) return; (((by[e.user_id] ||= {})[e.year] ||= {})[e.category_id] ||= {})[e.month] = e.value; });
  const workbook = new ExcelJS.Workbook(); workbook.creator = currentUser.name || 'Budget Solution';
  selectedYears.forEach(year => { users.forEach(u => addSheet(workbook, `${safeName(u.name)} ${year}`, categories || [], by[u.id]?.[year] || {})); const aggregate = {}; users.forEach(u => Object.entries(by[u.id]?.[year] || {}).forEach(([cat, months]) => Object.entries(months).forEach(([m,v]) => { (aggregate[cat] ||= {})[m] = Number((aggregate[cat] || {})[m] || 0) + Number(v || 0); }))); addSheet(workbook, `Total ${year}`, categories || [], aggregate); });
  const filename = `budget-${headsOnly ? 'heads' : 'from'}-${new Date().toISOString().replace(/[:.]/g, '-')}.xlsx`; const blob = new Blob([await workbook.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }); const path = `${headsOnly ? 'heads' : 'from'}/${currentUser.id}/${filename}`;
  const { error: uploadError } = await supabase.storage.from('exports').upload(path, blob, { upsert: true, contentType: blob.type }); if (uploadError) throw uploadError;
  const { data: urlData, error: urlError } = await supabase.storage.from('exports').createSignedUrl(path, 3600); if (urlError) throw urlError;
  const { data: record, error: insertError } = await supabase.from('export_history').insert({ version: Date.now(), exported_by: currentUser.id, exported_by_name: currentUser.name, year: selectedYears[selectedYears.length - 1], filename, filepath: path, snapshot: { years: selectedYears, headsOnly }, export_mode: headsOnly ? 'heads' : 'from' }).select().single(); if (insertError) throw insertError;
  return { filename, path, url: urlData.signedUrl, record };
}

export async function getExportHistory(supabase, mode) { const { data, error } = await supabase.from('export_history').select('*').eq('export_mode', mode).order('timestamp', { ascending: false }); if (error) throw error; return data || []; }
export async function getExportSignedUrl(supabase, filepath) { const { data, error } = await supabase.storage.from('exports').createSignedUrl(filepath, 3600); if (error) throw error; return data.signedUrl; }
