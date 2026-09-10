import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { isSupabaseConfigured, supabase, signInWithPassword, adminUsers } from '../lib/supabase';
import { createSupabaseApi } from '../lib/supabaseApi';

const SUPABASE_API = createSupabaseApi();

const AppContext = createContext(null);

// Default admin users — will be overridden by DB roles at login
export const ADMIN_USERS = ['user_fe', 'user_bl', 'user_bm'];

export function AppProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [users, setUsers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [availableYears, setAvailableYears] = useState([]);
  const [activeUsers, setActiveUsers] = useState({});
  const [saveStatus, setSaveStatus] = useState('idle');
  const [notifications, setNotifications] = useState([]);
  const [userPermissions, setUserPermissions] = useState(null);
  const [currentUserRoles, setCurrentUserRoles] = useState({ is_admin: false, is_approver: false });
  const presenceRef = useRef(null);
  const realtimeRef = useRef(null);
  const saveTimerRef = useRef(null);
  const activeApi = SUPABASE_API;

  const loadData = useCallback(async () => {
    const [usersRes, catsRes, yearsRes] = await Promise.all([
      activeApi.get('/users'),
      activeApi.get('/categories'),
      activeApi.get('/budget/years'),
    ]);
    const loadedUsers = usersRes.data || [];
    setUsers(loadedUsers);
    const cats = (catsRes.data || []).filter((c, i, arr) => arr.findIndex(x => x.id === c.id) === i);
    setCategories(cats);
    setAvailableYears(yearsRes.data || []);
    return loadedUsers;
  }, [activeApi]);

  // Supabase Auth persists the session in the browser and restores it on reload.
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return undefined;
    let mounted = true;
    const hydrate = async (session) => {
      if (!mounted) return;
      if (!session?.user) { setCurrentUser(null); return; }
      const metadata = session.user.user_metadata || {};
      let loadedUsers = users;
      try { loadedUsers = await loadData(); } catch (error) { console.error('Failed to load application data', error); }
      const matching = loadedUsers.find(u => u.auth_user_id === session.user.id || u.id === metadata.legacy_id || u.id === metadata.user_id || u.email === session.user.email);
      const user = matching || { id: metadata.legacy_id || session.user.id, name: metadata.name || session.user.email, initials: (metadata.name || session.user.email || '?').slice(0, 2).toUpperCase(), email: session.user.email };
      setCurrentUser(user);
      try { const perms = await activeApi.get(`/permissions/${user.id}`); setUserPermissions(Array.isArray(perms.data) ? perms.data[0] : perms.data); } catch (_) { /* RLS may deny non-admin detail */ }
      try { const roleRows = await activeApi.get('/usermgmt'); const role = (roleRows.data || []).find(u => u.id === user.id); if (role) setCurrentUserRoles({ is_admin: !!role.is_admin, is_approver: !!role.is_approver }); } catch (_) { /* keep safe defaults */ }
      if (user.id) connectPresence(user.id, 'Dashboard');
    };
    supabase.auth.getSession().then(({ data }) => hydrate(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => hydrate(session));
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, [loadData]);

  const connectPresence = useCallback(async (userId, page) => {
    if (!supabase) return;
    if (presenceRef.current) await supabase.removeChannel(presenceRef.current);
    const channel = supabase.channel('budget-presence', { config: { presence: { key: String(userId) } } });
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState();
      const active = {};
      Object.entries(state).forEach(([key, entries]) => { const latest = entries[entries.length - 1]; active[key] = { page: latest?.page || page, active: true }; });
      setActiveUsers(active);
    });
    await channel.subscribe(async status => { if (status === 'SUBSCRIBED') await channel.track({ userId, page, online_at: new Date().toISOString() }); });
    presenceRef.current = channel;
  }, []);

  const handleWsMessage = useCallback((msg) => {
    switch(msg.type) {
      case 'user_active':
        setActiveUsers(prev => ({ ...prev, [msg.userId]: { page: msg.page, active: true } }));
        break;
      case 'user_inactive':
        setActiveUsers(prev => { const n = {...prev}; delete n[msg.userId]; return n; });
        break;
      case 'category_created':
      case 'category_updated':
        setCategories(prev => {
          const exists = prev.find(c => c.id === msg.category.id);
          if (exists) return prev.map(c => c.id === msg.category.id ? msg.category : c);
          const next = [...prev, msg.category].sort((a,b) => a.sort_order - b.sort_order);
          // Deduplicate by id just in case
          return next.filter((c, i, arr) => arr.findIndex(x => x.id === c.id) === i);
        });
        break;
      case 'categories_reordered':
        setCategories(msg.categories);
        break;
      case 'category_deleted':
        setCategories(prev => prev.filter(c => c.id !== msg.categoryId));
        break;
      case 'year_created':
        setAvailableYears(prev => [...new Set([...prev, msg.year])].sort((a,b) => b-a));
        break;
      case 'user_updated':
        setUsers(prev => prev.map(u => u.id === msg.userId ? { ...u, profile_picture: msg.profile_picture } : u));
        if (currentUser?.id === msg.userId) {
          setCurrentUser(prev => ({ ...prev, profile_picture: msg.profile_picture }));
        }
        break;
      case 'user_added':
        setUsers(prev => prev.find(u => u.id === msg.user.id) ? prev : [...prev, msg.user]);
        break;
      case 'user_deleted':
        setUsers(prev => prev.filter(u => u.id !== msg.userId));
        break;
      case 'user_renamed':
        setUsers(prev => prev.map(u => u.id === msg.userId ? { ...u, name: msg.name, initials: msg.initials } : u));
        if (currentUser?.id === msg.userId) {
          setCurrentUser(prev => ({ ...prev, name: msg.name, initials: msg.initials }));
        }
        break;
      case 'user_roles_updated':
        // If roles changed for the current user, update their cached roles immediately
        if (currentUser?.id === msg.userId) {
          setCurrentUserRoles({ is_admin: !!msg.is_admin, is_approver: !!msg.is_approver });
        }
        break;
      default: break;
    }
    // Dispatch custom event for page-level listeners
    window.dispatchEvent(new CustomEvent('ws_message', { detail: msg }));
  }, [currentUser]);

  // Translate Supabase Postgres changes into the existing page-level event contract.
  useEffect(() => {
    if (!supabase || !currentUser) return undefined;
    if (realtimeRef.current) supabase.removeChannel(realtimeRef.current);

    const emit = (message) => handleWsMessage(message);
    const channel = supabase
      .channel('budget-data')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'budget_entries' }, payload => {
        const value = payload.new?.id ? payload.new : payload.old;
        emit({ type: 'entry_updated', userId: value.user_id, year: value.year, categoryId: value.category_id, month: value.month, value: Number(payload.new?.value || 0) });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, payload => {
        if (payload.eventType === 'DELETE') emit({ type: 'category_deleted', categoryId: payload.old.id });
        else emit({ type: payload.eventType === 'INSERT' ? 'category_created' : 'category_updated', category: { ...payload.new, parent_id: payload.new.parent_category_id } });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'page_comments' }, payload => {
        if (payload.eventType === 'DELETE') emit({ type: 'comment_deleted', commentId: payload.old.id });
        else emit({ type: 'comment_added', pageUserId: payload.new.page_user_id, year: payload.new.year, comment: payload.new });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'page_status' }, payload => {
        const value = payload.new?.page_user_id ? payload.new : payload.old;
        emit({ type: 'page_status_changed', pageUserId: value.page_user_id, year: value.year, status: payload.new?.status || 'draft' });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'export_history' }, payload => {
        emit({ type: 'export_created', exportMode: payload.new.export_mode });
      })
      .subscribe();

    realtimeRef.current = channel;
    return () => {
      if (realtimeRef.current === channel) realtimeRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [currentUser, handleWsMessage]);

  // Notifications
  const addNotification = useCallback((type, message, duration = 3000) => {
    const id = Date.now() + Math.random();
    setNotifications(prev => [...prev, { id, type, message }]);
    if (duration > 0) {
      setTimeout(() => {
        setNotifications(prev => prev.filter(n => n.id !== id));
      }, duration);
    }
    return id;
  }, []);

  const removeNotification = useCallback((id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  // Login — refresh users list and load permissions
  const login = useCallback(async (userIdOrEmail, password) => {
    if (isSupabaseConfigured) {
      const { data, error } = await signInWithPassword(userIdOrEmail, password);
      if (error) throw error;
      const metadata = data.user?.user_metadata || {};
      const loadedUsers = await loadData();
      const user = loadedUsers.find(u => u.auth_user_id === data.user?.id || u.id === metadata.legacy_id || u.id === metadata.user_id || u.email === data.user?.email) || { id: metadata.legacy_id || data.user?.id, name: metadata.name || data.user?.email, initials: (metadata.name || data.user?.email || '?').slice(0, 2).toUpperCase(), email: data.user?.email };
      setCurrentUser(user);
      try { const roleRows = await activeApi.get('/usermgmt'); const role = (roleRows.data || []).find(u => u.id === user.id); if (role) { setCurrentUserRoles({ is_admin: !!role.is_admin, is_approver: !!role.is_approver }); setUserPermissions(role); } } catch (_) { /* safe defaults */ }
      await connectPresence(user.id, 'Dashboard');
      addNotification('success', `Welcome back, ${user.name.split(' ')[0]}.`);
      return user;
    }
    throw new Error('Supabase is not configured');
  }, [loadData, connectPresence, addNotification, activeApi]);

  // Logout
  const logout = useCallback(() => {
    if (presenceRef.current && supabase) supabase.removeChannel(presenceRef.current);
    if (realtimeRef.current && supabase) supabase.removeChannel(realtimeRef.current);
    if (supabase) supabase.auth.signOut();
    setCurrentUser(null);
    setActiveUsers({});
  }, []);

  // Autosave helpers
  const setSaving = useCallback(() => {
    setSaveStatus('saving');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  const setSaved = useCallback(() => {
    setSaveStatus('saved');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000);
  }, []);

  const setSaveError = useCallback(() => {
    setSaveStatus('error');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => setSaveStatus('idle'), 4000);
  }, []);

  // API helpers
  const refreshCategories = useCallback(async () => {
    const res = await activeApi.get('/categories');
    setCategories(res.data);
  }, [activeApi]);

  const refreshYears = useCallback(async () => {
    const res = await activeApi.get('/budget/years');
    setAvailableYears(res.data);
  }, [activeApi]);

  const notifyPageChange = useCallback((page) => {
    if (presenceRef.current && currentUser?.id) presenceRef.current.track({ userId: currentUser.id, page, online_at: new Date().toISOString() });
  }, [currentUser]);

  return (
    <AppContext.Provider value={{
      currentUser, setCurrentUser,
      users, setUsers,
      categories, setCategories,
      availableYears, setAvailableYears,
      activeUsers,
      saveStatus, setSaving, setSaved, setSaveError,
      notifications, addNotification, removeNotification,
      login, logout,
      refreshCategories, refreshYears,
      notifyPageChange,
      userPermissions, setUserPermissions,
      currentUserRoles, setCurrentUserRoles,
      API: activeApi
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

export default AppContext;
