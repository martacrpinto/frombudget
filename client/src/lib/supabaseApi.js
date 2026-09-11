import { supabase } from './supabase';

const ok = data => ({ data });
const fail = (error) => { const e = new Error(error?.message || String(error)); const status = error?.status || (error?.code === 'PGRST301' ? 401 : /permission|not allowed|read-only|authentication/i.test(e.message) ? 403 : 400); e.response = { data: { error: e.message }, status }; throw e; };
const unwrap = ({ data, error }) => error ? fail(error) : data;
const row = (r) => r ? { ...r, profile_picture: r.profile_picture, parent_id: r.parent_category_id } : r;
const rows = (rs) => (rs || []).map(row);
const one = (table, values, key = 'id') => supabase.from(table).upsert(values, { onConflict: key }).select().single();
const query = (table, filters = {}) => { let q = supabase.from(table).select('*'); Object.entries(filters).forEach(([k, v]) => { q = q.eq(k, v); }); return q; };

async function dashboard(params = {}) {
  const year = Number(params.year);
  let q = supabase.from('budget_entries').select('user_id,category_id,month,value,profiles(name),categories(name,is_parent,parent_category_id)').eq('year', year);
  if (params.userId) q = q.eq('user_id', params.userId);
  if (params.headsOnly === '1' || params.headsOnly === 1 || params.headsOnly === true) {
    const { data: admins, error } = await supabase.from('profile_roles').select('user_id').eq('is_admin', true);
    if (error) return fail(error);
    const ids = (admins || []).map(x => x.user_id);
    if (ids.length) q = q.not('user_id', 'in', `(${ids.join(',')})`);
  }
  const entries = rows(unwrap(await q));
  const categoryMap = {};
  const userMap = {};
  const monthMap = {};
  entries.forEach(e => {
    const value = Number(e.value || 0); const cat = e.categories || {}; const user = e.profiles || {};
    categoryMap[e.category_id] ||= { categoryId: e.category_id, name: cat.name, is_parent: cat.is_parent, total: 0, value: 0 };
    categoryMap[e.category_id].total += value; categoryMap[e.category_id].value += value;
    userMap[e.user_id] ||= { userId: e.user_id, name: user.name, total: 0, value: 0 }; userMap[e.user_id].total += value; userMap[e.user_id].value += value;
    monthMap[e.month] ||= { month: e.month, total: 0, value: 0 }; monthMap[e.month].total += value; monthMap[e.month].value += value;
  });
  return ok({ byMonth: Object.values(monthMap).sort((a,b) => a.month-b.month), byUser: Object.values(userMap), byCategory: Object.values(categoryMap), total: entries.reduce((s,e) => s + Number(e.value || 0), 0) });
}

export function createSupabaseApi() {
  if (!supabase) return null;
  return {
    async get(path, config = {}) {
      const [raw, queryPart] = path.split('?'); const parts = raw.split('/').filter(Boolean); const params = config.params || Object.fromEntries(new URLSearchParams(queryPart || ''));
      try {
        if (raw === '/users') {
          const profiles = unwrap(await supabase.from('profiles').select('*,profile_roles(is_admin,is_approver)').order('name')) || [];
          return ok(rows(profiles).map(profile => {
            const role = Array.isArray(profile.profile_roles) ? profile.profile_roles[0] : profile.profile_roles;
            const { profile_roles: _profileRoles, ...publicProfile } = profile;
            return { ...publicProfile, is_admin: !!role?.is_admin, is_approver: !!role?.is_approver };
          }));
        }
        if (raw === '/categories') return ok(rows(unwrap(await query('categories').order('sort_order'))));
        if (raw === '/budget/years') return ok((unwrap(await supabase.from('budget_years').select('year').order('year', { ascending: false })) || []).map(x => x.year));
        if (parts[0] === 'budget' && parts[1] === 'total' && parts.length === 3) return dashboard({ ...params, year: Number(parts[2]) });
        if (parts[0] === 'budget' && parts[1] === 'total-heads' && parts.length === 3) return dashboard({ ...params, year: Number(parts[2]), headsOnly: true });
        if (parts[0] === 'budget' && parts.length === 3) {
          const uid = parts[1]; const year = Number(parts[2]);
          const [er, cr, or, yr] = await Promise.all([query('budget_entries', { user_id: uid, year }), supabase.from('categories').select('*,year_categories!inner(year)').eq('year_categories.year', year), query('category_order', { user_id: uid }), query('budget_years', { year })]);
          const entries = {}; (unwrap(await er) || []).forEach(e => { entries[e.category_id] ||= {}; entries[e.category_id][e.month] = Number(e.value); });
          const order = unwrap(await or) || []; const categories = rows(unwrap(await cr) || []).sort((a,b) => (order.find(x=>x.category_id===a.id)?.sort_order ?? a.sort_order) - (order.find(x=>x.category_id===b.id)?.sort_order ?? b.sort_order));
          const prev = await query('budget_entries', { user_id: uid, year: year - 1 }); const previousYearEntries = {}; (unwrap(await prev) || []).forEach(e => { previousYearEntries[e.category_id] ||= {}; previousYearEntries[e.category_id][e.month] = Number(e.value); });
          return ok({ entries, previousYearEntries, categories, year });
        }
        if (parts[0] === 'notes') { const rs = unwrap(await query('row_notes', { user_id: parts[1], year: Number(parts[2]) })); return ok(Object.fromEntries((rs || []).map(n => [n.category_id, row(n)]))); }
        if (parts[0] === 'pagestatus') return ok(row((unwrap(await query('page_status', { page_user_id: parts[1], year: Number(parts[2]) })) || [])[0] || { status: 'draft' }));
        if (parts[0] === 'comments') return ok(rows(unwrap(await query('page_comments', { page_user_id: parts[1], year: Number(parts[2]) }).order('created_at'))));
        if (parts[0] === 'permissions') { const q = parts[1] ? query('permissions', { user_id: parts[1] }) : supabase.from('permissions').select('*'); return ok(rows(unwrap(await q))); }
        if (parts[0] === 'usermgmt') { const [p, r, ps] = await Promise.all([supabase.from('profiles').select('*').order('name'), supabase.from('profile_roles').select('*'), supabase.from('permissions').select('*')]); const roles = unwrap(r) || []; const perms = unwrap(ps) || []; return ok(rows(unwrap(p) || []).map(u => ({ ...u, ...(roles.find(x=>x.user_id===u.id) || {}), ...(perms.find(x=>x.user_id===u.id) || {}) }))); }
        if (parts[0] === 'remuneration') {
          if (parts[1] === 'config') return ok(row((unwrap(await query('remuneration_config', { user_id: parts[2] })) || [])[0] || {}));
          if (parts[1] === 'ftes') return ok(rows(unwrap(await query('remuneration_ftes', { user_id: parts[2], year: Number(parts[3]) }))));
          if (parts[1] === 'ftes-all') {
            const result = unwrap(await supabase.from('remuneration_ftes').select('*,profiles(name,initials)').eq('year', Number(parts[2])).order('position'));
            return ok(rows(result).map(item => ({ ...item, user_name:item.profiles?.name, user_initials:item.profiles?.initials })));
          }
        }
        if (parts[0] === 'dashboard') return dashboard(params);
        if (parts[0] === 'audit') { let q = supabase.from('audit_log').select('*', { count: 'exact' }).order('timestamp', { ascending: false }); if (params.action) q=q.eq('action',params.action); if(params.page) q=q.range((Number(params.page)-1)*Number(params.limit||100), Number(params.page)*Number(params.limit||100)-1); const result=await q; const data=unwrap(result); return ok({ rows: rows(data), total: result.count || 0 }); }
        if (parts[0] === 'export' && parts[1] === 'history') return ok(rows(unwrap(await supabase.from('export_history').select('*').eq('export_mode', params.mode || 'from').order('timestamp', { ascending: false }))));
        return fail({ message: `Supabase API route not implemented: GET ${path}` });
      } catch (e) { throw e; }
    },
    async post(path, body = {}) { return this.put(path, body, 'POST'); },
    async put(path, body = {}, method = 'PUT') {
      const parts = path.split('/').filter(Boolean);
      if (parts[0] === 'budget' && parts[1] === 'entry') return ok(unwrap(await supabase.rpc('save_budget_entries', { p_target_user: body.userId, p_year: body.year, p_entries: [{ categoryId: body.categoryId, month: body.month, value: body.value }] })));
      if (parts[0] === 'budget' && parts[1] === 'entries') return ok(unwrap(await supabase.rpc('save_budget_entries', { p_target_user: body.userId, p_year: body.year, p_entries: body.entries })));
      if (parts[0] === 'budget' && parts[1] === 'user-order') return ok(unwrap(await supabase.rpc('save_category_order', { p_target_user: body.userId, p_order: body.order })));
      if (parts[0] === 'budget' && parts[1] === 'years') return ok(row(unwrap(await supabase.rpc('create_budget_year', { p_year: body.year }))));
      if (parts[0] === 'pagestatus') return ok(row(unwrap(await supabase.rpc('set_page_workflow', { p_target_user: body.pageUserId, p_year: body.year, p_action: parts[1] }))));
      if (parts[0] === 'categories' && parts[1] === 'parent') return ok(row(unwrap(await one('categories', { id: crypto.randomUUID(), name: body.name, type: 'Mixed', created_by: body.userId, is_parent: true }))));
      if (parts[0] === 'categories' && parts[2] === 'parent') return ok(row(unwrap(await supabase.from('categories').update({ parent_category_id: body.parentId }).eq('id', parts[1]).select().single())));
      if (parts[0] === 'categories' && parts[1] && parts.length === 2) return ok(row(unwrap(await supabase.from('categories').update(body).eq('id', parts[1]).select().single())));
      if (parts[0] === 'notes') return ok(row(unwrap(await one('row_notes', { id: crypto.randomUUID(), user_id: body.userId, category_id: body.categoryId, year: body.year, note: body.note, author_name: body.authorName }, 'user_id,category_id,year'))));
      if (parts[0] === 'comments') return ok(row(unwrap(await one('page_comments', { id: crypto.randomUUID(), page_user_id: body.pageUserId, year: body.year, author_id: body.authorId, author_name: body.authorName, author_initials: body.authorInitials, comment: body.comment, parent_id: body.parentId }))));
      if (parts[0] === 'remuneration' && parts[1] === 'config') {
        const allowed = ['monthly_payments','iht_rate','meal_allowance_days','holiday_allowance_month','christmas_allowance_month'];
        const values = Object.fromEntries(allowed.filter(key => body[key] !== undefined).map(key => [key,body[key]]));
        return ok(row(unwrap(await one('remuneration_config', { ...values, user_id:parts[2], id:body.id || crypto.randomUUID() }, 'user_id'))));
      }
      if (parts[0] === 'remuneration' && parts[1] === 'ftes') {
        if (method === 'POST' && body.count !== undefined) {
          const userId = parts[2]; const year = Number(body.year); const count = Math.min(Math.max(Number(body.count) || 1,1),100);
          const existing = unwrap(await supabase.from('remuneration_ftes').select('position').eq('user_id',userId).eq('year',year));
          if ((existing?.length || 0) + count > 100) return fail({ message:'Cannot exceed 100 FTEs.' });
          const start = Math.max(0, ...(existing || []).map(item => Number(item.position) || 0)) + 1;
          const values = Array.from({length:count}, (_,index) => ({ id:crypto.randomUUID(), user_id:userId, year, position:start+index }));
          return ok(rows(unwrap(await supabase.from('remuneration_ftes').insert(values).select())));
        }
        const allowed = ['role','collaborator_name','annual_base_salary','meal_allowance_day','indexation_pct','increase_pct','entry_month'];
        const values = Object.fromEntries(allowed.filter(key => body[key] !== undefined).map(key => [key,body[key]]));
        return ok(row(unwrap(await supabase.from('remuneration_ftes').update(values).eq('id',parts[2]).select().single())));
      }
      if (parts[0] === 'export') return ok(row(unwrap(await one('export_history', body))));
      return fail({ message: `Supabase API route not implemented: ${method} ${path}` });
    },
    async delete(path, config = {}) {
      const parts = path.split('/').filter(Boolean); const body = config.data || {};
      if (parts[0] === 'budget' && parts[1] === 'clear') return ok(unwrap(await supabase.rpc('clear_budget_page', { p_target_user: parts[2] })));
      if (path === '/budget/system-reset') return ok(unwrap(await supabase.rpc('system_reset')));
      const table = parts[0] === 'comments' ? 'page_comments' : parts[0] === 'categories' ? 'categories' : parts[0] === 'usermgmt' ? 'profiles' : parts[0] === 'remuneration' && parts[1] === 'ftes' ? 'remuneration_ftes' : null;
      if (parts[0] === 'remuneration' && parts[1] === 'reset') return ok(unwrap(await supabase.from('remuneration_ftes').delete().eq('user_id', parts[2]).eq('year', Number(parts[3]))));
      if (table) return ok(unwrap(await supabase.from(table).delete().eq('id', parts[parts.length - 1])));
      return fail({ message: `Supabase API route not implemented: DELETE ${path}` });
    },
  };
}
