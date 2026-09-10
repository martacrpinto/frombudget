import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { usePermissions } from '../hooks/usePermissions';
import { formatCurrency, formatCurrencySigned, formatPercent, calcChange, parseCurrencyInput, MONTHS_SHORT, MONTHS_FULL } from '../utils/format';
import { buildRenderList, getLeafCategories } from '../utils/hierarchy';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import './BudgetPage.css';

const MONTHS = MONTHS_FULL();
const MONTHS_S = MONTHS_SHORT();

// Validators who can approve pages
const VALIDATORS = ['user_bl', 'user_bm'];
// Page that has no submit button
const NO_SUBMIT_PAGE = 'user_bm';

// (hierarchy helpers imported from ../utils/hierarchy)

export default function BudgetPage({ userId }) {
  const { users, categories, setCategories, availableYears, setAvailableYears, currentUser, API, setSaving, setSaved, setSaveError, addNotification } = useApp();
  const perms = usePermissions();

  const user = users.find(u => u.id === userId);
  const defaultYear = availableYears.length > 0 ? availableYears[0] : 2026;
  const [year, setYear] = useState(defaultYear);
  const [entries, setEntries] = useState({});
  const [prevEntries, setPrevEntries] = useState({});
  // Collapsed state persisted in sessionStorage so refresh doesn't reset it
  const collapsedKey = `collapsed_${userId}`;
  const [collapsedParents, setCollapsedParentsRaw] = useState(() => {
    try {
      const stored = sessionStorage.getItem(collapsedKey);
      if (stored) return new Set(JSON.parse(stored));
    } catch {}
    return new Set();
  });

  const setCollapsedParents = (updater) => {
    setCollapsedParentsRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try { sessionStorage.setItem(collapsedKey, JSON.stringify([...next])); } catch {}
      return next;
    });
  };
  const [notes, setNotes] = useState({});
  const [localCatOrder, setLocalCatOrder] = useState([]); // per-user ordered categories
  const [pageStatus, setPageStatus] = useState({ status: 'draft' });
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNewYearModal, setShowNewYearModal] = useState(false);
  const [showNewCatModal, setShowNewCatModal] = useState(false);
  const [showDeleteCatModal, setShowDeleteCatModal] = useState(null);
  const [showNoteModal, setShowNoteModal] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [editingCell, setEditingCell] = useState(null);
  const [cellInputValue, setCellInputValue] = useState('');
  const saveQueue = useRef({});
  const saveTimer = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      const msg = e.detail;
      if (msg.type === 'entry_updated' && msg.userId === userId && msg.year === year) {
        setEntries(prev => {
          const updated = { ...prev };
          if (!updated[msg.categoryId]) updated[msg.categoryId] = {};
          updated[msg.categoryId] = { ...updated[msg.categoryId], [msg.month]: msg.value };
          return updated;
        });
      }
      if (msg.type === 'entries_bulk_updated' && msg.userId === userId && msg.year === year) loadData();
      // When a new category is added, only add to local order if it's for the current year
      if (msg.type === 'category_created') {
        if (!msg.year || msg.year === year) {
          setLocalCatOrder(prev => {
            if (prev.find(c => c.id === msg.category.id)) return prev;
            return [...prev, msg.category];
          });
        }
      }
      if (msg.type === 'category_deleted') {
        if (!msg.year || msg.year === year) {
          setLocalCatOrder(prev => {
            const cat = prev.find(c => c.id === msg.categoryId);
            const withoutDeleted = prev.filter(c => c.id !== msg.categoryId);
            if (cat?.is_parent) {
              // Orphan children back to root
              return withoutDeleted.map(c =>
                c.parent_category_id === msg.categoryId ? { ...c, parent_category_id: null } : c
              );
            }
            return withoutDeleted;
          });
        }
      }
      if (msg.type === 'category_parent_changed') {
        setLocalCatOrder(prev => prev.map(c => c.id === msg.categoryId ? { ...c, parent_category_id: msg.parentId } : c));
      }
      if (msg.type === 'category_collapsed') {
        setLocalCatOrder(prev => prev.map(c => c.id === msg.categoryId ? { ...c, collapsed: msg.collapsed } : c));
        setCollapsedParents(prev => {
          const next = new Set(prev);
          if (msg.collapsed) next.add(msg.categoryId);
          else next.delete(msg.categoryId);
          return next;
        });
      }
      if (msg.type === 'category_updated') {
        setLocalCatOrder(prev => prev.map(c => c.id === msg.category.id ? { ...c, ...msg.category } : c));
      }
      if (msg.type === 'page_status_changed' && msg.pageUserId === userId && msg.year === year) {
        setPageStatus(msg.status);
      }
      if (msg.type === 'comment_added' && msg.pageUserId === userId && msg.year === year) {
        // Always deduplicate by id — prevents double-add when current user posts
        setComments(prev => prev.find(c => c.id === msg.comment.id) ? prev : [...prev, msg.comment]);
      }
      if (msg.type === 'comment_deleted') {
        setComments(prev => prev.filter(c => c.id !== msg.commentId && c.parent_id !== msg.commentId));
      }
    };
    window.addEventListener('ws_message', handler);
    return () => window.removeEventListener('ws_message', handler);
  }, [userId, year]);

  const loadData = useCallback(async () => {
    if (!year) return;
    setLoading(true);
    try {
      const [budgetRes, notesRes, statusRes, commentsRes] = await Promise.all([
        API.get(`/budget/${userId}/${year}`),
        API.get(`/notes/${userId}/${year}`),
        API.get(`/pagestatus/${userId}/${year}`),
        API.get(`/comments/${userId}/${year}`),
      ]);
      setEntries(budgetRes.data.entries || {});
      setPrevEntries(budgetRes.data.previousYearEntries || {});
      const cats = budgetRes.data.categories || [];
      setLocalCatOrder(cats);
      // Only initialise collapsed state from DB if sessionStorage has nothing
      setCollapsedParents(prev => {
        const hasSession = sessionStorage.getItem(collapsedKey);
        if (!hasSession) {
          // Very first load for this user: use DB value
          return new Set(cats.filter(c => c.is_parent && c.collapsed).map(c => c.id));
        }
        // Refresh or reload: keep current state (already loaded from sessionStorage)
        return prev;
      });
      setNotes(notesRes.data || {});
      setPageStatus(statusRes.data || { status: 'draft' });
      setComments(commentsRes.data || []);
    } catch {
      addNotification('error', 'Failed to load budget data.');
    } finally {
      setLoading(false);
    }
  }, [userId, year, API]);

  useEffect(() => { loadData(); }, [loadData]);

  const queueSave = useCallback((categoryId, month, value, categoryName) => {
    saveQueue.current[`${categoryId}_${month}`] = { categoryId, month, value, categoryName };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaving();
    saveTimer.current = setTimeout(async () => {
      const queue = { ...saveQueue.current };
      saveQueue.current = {};
      const ents = Object.values(queue);
      if (!ents.length) return;
      try {
        if (ents.length === 1) {
          const e = ents[0];
          await API.put('/budget/entry', { userId, categoryId: e.categoryId, year, month: e.month, value: e.value, userName: currentUser?.name, categoryName: e.categoryName, budgetPage: user?.name, requestingUserId: currentUser?.id });
        } else {
          await API.put('/budget/entries/bulk', { entries: ents, userId, year, userName: currentUser?.name, budgetPage: user?.name, requestingUserId: currentUser?.id });
        }
        setSaved();
      } catch { setSaveError(); addNotification('error', 'Error saving changes.'); }
    }, 800);
  }, [userId, year, currentUser, user, API, setSaving, setSaved, setSaveError]);

  // Leaf categories only (non-parents) — used for all financial calculations
  const leafCats = React.useMemo(() => localCatOrder.filter(c => !c.is_parent), [localCatOrder]);

  const getCellValue = useCallback((catId, month) => {
    const raw = entries[catId]?.[month] || 0;
    const cat = localCatOrder.find(c => c.id === catId);
    if (!cat) return raw;
    if (cat.is_parent) return 0; // parent values computed separately
    return cat.type === 'Cost' ? -Math.abs(raw) : Math.abs(raw);
  }, [entries, localCatOrder]);

  // Get a parent category's computed month value (sum of children)
  const getParentMonthVal = useCallback((parentId, month) => {
    return localCatOrder
      .filter(c => !c.is_parent && c.parent_category_id === parentId)
      .reduce((sum, c) => sum + getCellValue(c.id, month), 0);
  }, [localCatOrder, getCellValue]);

  const getPrevValue = useCallback((catId, month) => {
    const raw = prevEntries[catId]?.[month] || 0;
    const cat = localCatOrder.find(c => c.id === catId);
    if (!cat) return raw;
    if (cat.is_parent) return 0;
    return cat.type === 'Cost' ? -Math.abs(raw) : Math.abs(raw);
  }, [prevEntries, localCatOrder]);

  const getRowTotal = useCallback((catId) => {
    const cat = localCatOrder.find(c => c.id === catId);
    if (cat?.is_parent) {
      // Parent = sum of children
      return localCatOrder
        .filter(c => !c.is_parent && c.parent_category_id === catId)
        .reduce((sum, c) => {
          let t = 0; for (let m = 1; m <= 12; m++) t += getCellValue(c.id, m); return sum + t;
        }, 0);
    }
    let t = 0; for (let m = 1; m <= 12; m++) t += getCellValue(catId, m); return t;
  }, [getCellValue, localCatOrder]);

  // Column totals: ONLY leaf categories (never parents — avoids double-counting)
  const getColTotal = useCallback((month) => {
    let t = 0;
    for (const cat of leafCats) t += getCellValue(cat.id, month);
    return t;
  }, [getCellValue, leafCats]);

  const getGrandTotal = useCallback(() => {
    let t = 0; for (const cat of leafCats) t += getRowTotal(cat.id); return t;
  }, [getRowTotal, leafCats]);

  // KPIs: leaf categories only — no double-counting
  const kpis = React.useMemo(() => {
    let totalBudget = 0, totalCosts = 0, totalRevenue = 0, prevBudget = 0, prevCosts = 0, prevRevenue = 0;
    for (const cat of leafCats) {
      const rowTotal = getRowTotal(cat.id);
      let prevTotal = 0; for (let m = 1; m <= 12; m++) prevTotal += getPrevValue(cat.id, m);
      totalBudget += rowTotal; prevBudget += prevTotal;
      if (cat.type === 'Cost') { totalCosts += rowTotal; prevCosts += prevTotal; }
      else { totalRevenue += rowTotal; prevRevenue += prevTotal; }
    }
    return { totalBudget, totalCosts, totalRevenue, prevBudget, prevCosts, prevRevenue };
  }, [leafCats, entries, prevEntries]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = async (event) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over || active.id === over.id) return;

    const activeCat = localCatOrder.find(c => c.id === active.id);
    if (!activeCat) return;

    // ─── Strategy: operate on "top-level segments" ───────────────────────────
    // A segment is either:
    //   - A parent group + all its children (treated as one movable block)
    //   - A standalone root category
    //
    // IMPORTANT: use the POSITION in localCatOrder array (not sort_order field)
    // because localCatOrder is already in the correct user-specific order.

    const buildSegments = (cats) => {
      // localCatOrder is already sorted correctly — preserve that order
      // Build a map of parent → children, preserving localCatOrder position
      const childMap = {};
      cats.forEach(c => {
        if (!c.is_parent && c.parent_category_id) {
          if (!childMap[c.parent_category_id]) childMap[c.parent_category_id] = [];
          childMap[c.parent_category_id].push(c);
        }
      });

      // Top-level items: parents and root categories, in localCatOrder array position order
      const topLevel = cats.filter(c => c.is_parent || !c.parent_category_id);

      return topLevel.map(item => {
        if (item.is_parent) {
          // Children in their localCatOrder position order
          const kids = childMap[item.id] || [];
          return { leadId: item.id, cats: [item, ...kids] };
        }
        return { leadId: item.id, cats: [item] };
      });
    };

    const segments = buildSegments(localCatOrder);

    // Find which segment index active.id belongs to (lead or child)
    const activeSegIdx = segments.findIndex(seg => seg.cats.some(c => c.id === active.id));
    // Find which segment index over.id belongs to
    const overSegIdx   = segments.findIndex(seg => seg.cats.some(c => c.id === over.id));

    if (activeSegIdx === -1 || overSegIdx === -1 || activeSegIdx === overSegIdx) return;

    // Move segment from activeSegIdx to overSegIdx
    const newSegments = arrayMove(segments, activeSegIdx, overSegIdx);

    // Flatten segments back to a flat category order
    const newOrder = newSegments.flatMap(seg => seg.cats);

    // Update sort_order values on the new order
    const withUpdatedSort = newOrder.map((cat, idx) => ({ ...cat, sort_order: idx + 1 }));

    setLocalCatOrder(withUpdatedSort);

    const orderPayload = withUpdatedSort.map((cat, idx) => ({ categoryId: cat.id, sort_order: idx + 1 }));
    try {
      await API.put('/budget/user-order', { userId, order: orderPayload });
    } catch { addNotification('error', 'Failed to save order.'); }
  };

  // Paste from Excel
  const handleTablePaste = async (e) => {
    if (!editingCell) return;
    const text = e.clipboardData?.getData('text');
    if (!text) return;
    const hasMultiple = text.includes('\n') || text.includes('\t');
    if (!hasMultiple) return; // single cell — let normal input handle it

    e.preventDefault();
    const rows = text.trim().split('\n').map(r => r.split('\t'));
    const catIdx = localCatOrder.findIndex(c => c.id === editingCell.catId);
    const monthStart = editingCell.month;
    const bulkEntries = [];

    for (let r = 0; r < rows.length; r++) {
      const cat = localCatOrder[catIdx + r];
      if (!cat) break;
      for (let c = 0; c < rows[r].length; c++) {
        const month = monthStart + c;
        if (month > 12) break;
        const val = parseCurrencyInput(rows[r][c]);
        bulkEntries.push({ categoryId: cat.id, month, value: val, categoryName: cat.name });
        setEntries(prev => {
          const next = { ...prev };
          if (!next[cat.id]) next[cat.id] = {};
          next[cat.id] = { ...next[cat.id], [month]: val };
          return next;
        });
      }
    }

    if (bulkEntries.length) {
      setSaving();
      try {
        await API.put('/budget/entries/bulk', { entries: bulkEntries, userId, year, userName: currentUser?.name, budgetPage: user?.name });
        setSaved();
        addNotification('success', `${bulkEntries.length} cells updated.`);
      } catch { setSaveError(); addNotification('error', 'Failed to paste data.'); }
    }
    setEditingCell(null);
  };

  const startEdit = (catId, month, currentValue) => {
    setEditingCell({ catId, month });
    setCellInputValue(currentValue === 0 ? '' : String(Math.abs(currentValue)));
  };

  const commitEdit = (catId, month, categoryName) => {
    const numVal = Math.abs(parseCurrencyInput(cellInputValue));
    setEntries(prev => {
      const next = { ...prev };
      if (!next[catId]) next[catId] = {};
      next[catId] = { ...next[catId], [month]: numVal };
      return next;
    });
    queueSave(catId, month, numVal, categoryName);
    setEditingCell(null);
    setCellInputValue('');
  };

  const handleCreateYear = async (newYear, copy) => {
    try {
      await API.post('/budget/years', { year: newYear, userId: currentUser?.id, userName: currentUser?.name });
      setAvailableYears(prev => [...new Set([...prev, newYear])].sort((a, b) => b - a));
      setYear(newYear);
      setShowNewYearModal(false);
      addNotification('success', `Budget year ${newYear} created.`);
    } catch (e) {
      if (e.response?.status === 409) addNotification('warning', 'Year already exists.');
      else addNotification('error', 'Failed to create year.');
    }
  };

  const handleCreateCategory = async (name, type, description) => {
    try {
      const res = await API.post('/categories', { name, type, description, year, userId: currentUser?.id, userName: currentUser?.name });
      setCategories(prev => prev.find(c => c.id === res.data.id) ? prev : [...prev, res.data]);
      setLocalCatOrder(prev => prev.find(c => c.id === res.data.id) ? prev : [...prev, res.data]);
      setShowNewCatModal(false);
      addNotification('success', `Category "${name}" created for ${year}.`);
    } catch (e) {
      if (e.response?.status === 409) return { error: e.response.data };
      addNotification('error', 'Failed to create category.');
    }
  };

  const handleDeleteCategory = async (catId) => {
    const catToDelete = localCatOrder.find(c => c.id === catId);
    try {
      await API.delete(`/categories/${catId}`, { data: { userId: currentUser?.id, userName: currentUser?.name, year } });

      if (catToDelete?.is_parent) {
        // When deleting a parent, orphan children back to root — keep them visible
        setLocalCatOrder(prev => {
          const withoutParent = prev.filter(c => c.id !== catId);
          // Clear parent_category_id for all children of this parent
          return withoutParent.map(c =>
            c.parent_category_id === catId ? { ...c, parent_category_id: null } : c
          );
        });
        setCategories(prev => {
          const withoutParent = prev.filter(c => c.id !== catId);
          return withoutParent.map(c =>
            c.parent_category_id === catId ? { ...c, parent_category_id: null } : c
          );
        });
      } else {
        setLocalCatOrder(prev => prev.filter(c => c.id !== catId));
        setCategories(prev => prev.filter(c => c.id !== catId));
      }

      setShowDeleteCatModal(null);
      addNotification('success', catToDelete?.is_parent ? `Group deleted. Categories moved to root.` : `Category removed from ${year}.`);
    } catch (e) {
      if (e.response?.status === 409) return e.response.data;
      addNotification('error', 'Failed to delete category.');
    }
  };

  const handleTypeChange = async (catId, newType) => {
    try {
      await API.put(`/categories/${catId}`, { type: newType, userId: currentUser?.id, userName: currentUser?.name });
      setCategories(prev => prev.map(c => c.id === catId ? { ...c, type: newType } : c));
      setLocalCatOrder(prev => prev.map(c => c.id === catId ? { ...c, type: newType } : c));
    } catch { addNotification('error', 'Failed to update type.'); }
  };

  const handleCreateParentCategory = async (name) => {
    try {
      const res = await API.post('/categories/parent', { name, year, userId: currentUser?.id, userName: currentUser?.name });
      setCategories(prev => prev.find(c => c.id === res.data.id) ? prev : [...prev, res.data]);
      setLocalCatOrder(prev => prev.find(c => c.id === res.data.id) ? prev : [...prev, res.data]);
      addNotification('success', `Parent category "${name}" created.`);
    } catch (e) {
      if (e.response?.status === 409) addNotification('warning', 'A category with that name already exists.');
      else addNotification('error', 'Failed to create parent category.');
    }
  };

  const handleMoveToParent = async (catId, parentId) => {
    try {
      const res = await API.put(`/categories/${catId}/parent`, { parentId, userId: currentUser?.id, userName: currentUser?.name });
      setLocalCatOrder(prev => prev.map(c => c.id === catId ? { ...c, parent_category_id: parentId || null } : c));
      setCategories(prev => prev.map(c => c.id === catId ? { ...c, parent_category_id: parentId || null } : c));
      // Update parent type if needed
      if (res.data) {
        // refresh the parent category's type
        const parentRes = await API.get('/categories');
        const updatedParent = parentRes.data.find(c => c.id === parentId);
        if (updatedParent) {
          setLocalCatOrder(prev => prev.map(c => c.id === parentId ? updatedParent : c));
          setCategories(prev => prev.map(c => c.id === parentId ? updatedParent : c));
        }
      }
    } catch (e) { addNotification('error', e.response?.data?.error || 'Failed to move category.'); }
  };

  const handleToggleCollapse = async (parentId) => {
    try {
      await API.put(`/categories/${parentId}/collapse`, {});
      setCollapsedParents(prev => {
        const next = new Set(prev);
        if (next.has(parentId)) next.delete(parentId);
        else next.add(parentId);
        return next;
      });
      setLocalCatOrder(prev => prev.map(c => c.id === parentId ? { ...c, collapsed: !c.collapsed } : c));
    } catch { /* silent fail — toggle is local if API fails */ }
  };

  const handleSaveNote = async (catId, note) => {
    try {
      await API.put('/notes', { userId, categoryId: catId, year, note, authorName: currentUser?.name });
      setNotes(prev => ({ ...prev, [catId]: { note, author_name: currentUser?.name, updated_at: new Date().toISOString() } }));
      setShowNoteModal(null);
    } catch { addNotification('error', 'Failed to save note.'); }
  };

  const handleSubmit = async () => {
    try {
      const res = await API.put('/pagestatus/submit', { pageUserId: userId, year, requestingUserId: currentUser?.id, requestingUserName: currentUser?.name });
      setPageStatus(res.data);
      addNotification('success', 'Page submitted for approval.');
    } catch (e) { addNotification('error', e.response?.data?.error || 'Failed to submit.'); }
  };

  const handleValidate = async () => {
    try {
      const res = await API.put('/pagestatus/validate', { pageUserId: userId, year, requestingUserId: currentUser?.id, requestingUserName: currentUser?.name });
      setPageStatus(res.data);
      addNotification('success', 'Page validated and locked.');
    } catch (e) { addNotification('error', e.response?.data?.error || 'Failed to validate.'); }
  };

  const handleUnvalidate = async () => {
    try {
      const res = await API.put('/pagestatus/unvalidate', { pageUserId: userId, year, requestingUserId: currentUser?.id, requestingUserName: currentUser?.name });
      setPageStatus(res.data);
      addNotification('success', 'Validation removed. Page unlocked.');
    } catch (e) { addNotification('error', e.response?.data?.error || 'Failed to remove validation.'); }
  };

  const handleAddComment = async (text, parentId = null) => {
    if (!text?.trim()) return;
    try {
      const res = await API.post('/comments', {
        pageUserId: userId, year,
        authorId: currentUser?.id, authorName: currentUser?.name, authorInitials: currentUser?.initials,
        comment: text, parentId,
      });
      // Add directly to state (WS will also broadcast but deduplication prevents double-add)
      setComments(prev => prev.find(c => c.id === res.data.id) ? prev : [...prev, res.data]);
    } catch { addNotification('error', 'Failed to add comment.'); }
  };

  const handleDeleteComment = async (commentId) => {
    try {
      await API.delete(`/comments/${commentId}`, { data: { requestingUserId: currentUser?.id } });
      setComments(prev => prev.filter(c => c.id !== commentId && c.parent_id !== commentId));
    } catch (e) { addNotification('error', e.response?.data?.error || 'Failed to delete comment.'); }
  };

  const handleRevert = async () => {
    try {
      const res = await API.put('/pagestatus/revert', { pageUserId: userId, year, requestingUserId: currentUser?.id, requestingUserName: currentUser?.name });
      setPageStatus(res.data);
      addNotification('success', 'Submission reverted. Page back to draft.');
    } catch (e) { addNotification('error', e.response?.data?.error || 'Failed to revert.'); }
  };

  // Derived flags
  const isValidated = pageStatus?.status === 'validated';
  const isSubmitted = pageStatus?.status === 'submitted';
  const canEditThisPage = perms.canEditPage(userId);
  const isReadOnly = isValidated || !canEditThisPage; // validated OR no permission = locked
  const canSubmit = currentUser?.id === userId && userId !== NO_SUBMIT_PAGE && !isSubmitted && !isValidated;
  const canRevert = currentUser?.id === userId && isSubmitted && !isValidated;
  const canValidate = VALIDATORS.includes(currentUser?.id) && !isValidated;
  const canUnvalidate = VALIDATORS.includes(currentUser?.id) && isValidated;

  // Check if this page is restricted for the current viewer
  // Approver pages are only visible to admins and approvers
  const isApproverPage = userId === 'user_bl' || userId === 'user_bm'; // Bianca and Benedita
  const isPageRestricted = isApproverPage && !perms.isAdmin && !perms.isApprover;

  if (loading) {
    return <div className="budget-page"><div className="budget-loading">
      <div className="skeleton" style={{ width: 200, height: 28, marginBottom: 24 }} />
      <div className="skeleton" style={{ width: '100%', height: 400 }} />
    </div></div>;
  }

  // Block restricted approver pages for non-admin/non-approver users
  if (isPageRestricted) {
    return (
      <div className="budget-page">
        <div className="no-year-block">
          <div className="no-year-icon" style={{opacity:0.4}}>
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <rect x="6" y="22" width="36" height="22" rx="3" stroke="#d0d0d0" strokeWidth="2"/>
              <path d="M14 22V16a10 10 0 0120 0v6" stroke="#d0d0d0" strokeWidth="2" strokeLinecap="round"/>
              <circle cx="24" cy="33" r="3" fill="#d0d0d0"/>
            </svg>
          </div>
          <h2 className="no-year-title">Restricted Access</h2>
          <p className="no-year-desc">
            You don't have permission to view this page.<br/>
            This section is only accessible to admin users and approvers.
          </p>
        </div>
      </div>
    );
  }

  // Block entire page if no years exist
  if (availableYears.length === 0) {
    return (
      <div className="budget-page">
        <div className="no-year-block">
          <div className="no-year-icon">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
              <rect x="4" y="8" width="32" height="28" rx="3" stroke="#d0d0d0" strokeWidth="2"/>
              <path d="M4 16h32" stroke="#d0d0d0" strokeWidth="2"/>
              <path d="M13 4v8M27 4v8" stroke="#d0d0d0" strokeWidth="2" strokeLinecap="round"/>
              <path d="M14 24h12M20 20v8" stroke="#b3946f" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>
          <h2 className="no-year-title">No budget year selected</h2>
          <p className="no-year-desc">You need to create a budget year before entering any data.</p>
          <button className="status-btn status-btn--submit" onClick={() => setShowNewYearModal(true)}>
            + Create Budget Year
          </button>
        </div>
        {showNewYearModal && <NewYearModal currentYear={new Date().getFullYear()} onClose={() => setShowNewYearModal(false)} onCreate={handleCreateYear} />}
      </div>
    );
  }

  return (
    <div className="budget-page" onPaste={handleTablePaste}>
      <div className="budget-header">
        <div className="budget-header-left">
          <h1 className="budget-title">{user?.name}</h1>
          <div className="budget-year-selector">
            <select className="year-select" value={availableYears.includes(year) ? year : ''} onChange={e => {
              const v = e.target.value;
              if (v === '__new__') { setShowNewYearModal(true); }
              else if (v) setYear(parseInt(v));
            }}>
              {availableYears.length === 0 && <option value="">No years — create one</option>}
              {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
              {perms.canCreateYears && <option value="__new__">+ New Year</option>}
            </select>
          </div>
          {/* Status badge */}
          {isValidated && <span className="page-status-badge page-status-badge--validated">✓ Validated</span>}
          {isSubmitted && !isValidated && <span className="page-status-badge page-status-badge--submitted">⏳ Submitted for Approval</span>}
        </div>
        <div className="budget-header-right">
          {canSubmit && (
            <button className="status-btn status-btn--submit" onClick={handleSubmit}>
              Submit for Approval
            </button>
          )}
          {canRevert && (
            <button className="status-btn status-btn--unvalidate" onClick={handleRevert}>
              Revert Submission
            </button>
          )}
          {canValidate && (
            <button className="status-btn status-btn--validate" onClick={handleValidate}>
              ✓ Mark as Validated
            </button>
          )}
          {canUnvalidate && (
            <button className="status-btn status-btn--unvalidate" onClick={handleUnvalidate}>
              Remove Validation
            </button>
          )}
        </div>
      </div>

      {isReadOnly && (
        <div className="readonly-notice">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="2" y="6" width="10" height="7" rx="1" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M4.5 6V4.5a2.5 2.5 0 015 0V6" stroke="currentColor" strokeWidth="1.3"/>
          </svg>
          {isValidated
            ? `This page has been validated and is locked. Only ${VALIDATORS.map(id => users.find(u => u.id === id)?.name?.split(' ')[0]).join(' or ')} can unlock it.`
            : 'You do not have permission to edit this page.'}
        </div>
      )}

      <div className="kpi-grid">
        <KPICard label="Total Budget" value={kpis.totalBudget} prev={kpis.prevBudget} year={year} colorByValue />
        <KPICard label="Total Revenue" value={kpis.totalRevenue} prev={kpis.prevRevenue} year={year} positive />
        <KPICard label="Total Costs" value={kpis.totalCosts} prev={kpis.prevCosts} year={year} isCosts />
      </div>

      <div className="budget-table-section">
        <div className="budget-table-header">
          <h2 className="budget-table-title">Budget {year}</h2>
          <div style={{display:'flex', gap:8, alignItems:'center'}}>
            {/* Hide/Unhide All groups button — only shown if groups exist */}
            {localCatOrder.some(c => c.is_parent) && (() => {
              const parentIds = localCatOrder.filter(c => c.is_parent).map(c => c.id);
              const allCollapsed = parentIds.every(id => collapsedParents.has(id));
              return (
                <button className="add-category-btn" onClick={() => {
                  if (allCollapsed) {
                    // Unhide all
                    setCollapsedParents(new Set());
                  } else {
                    // Hide all
                    setCollapsedParents(new Set(parentIds));
                  }
                }} title={allCollapsed ? 'Expand all groups' : 'Collapse all groups'}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    {allCollapsed ? (
                      // Expand icon: lines with arrows pointing outward
                      <>
                        <path d="M2 5h10M2 9h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                        <path d="M5 3l2-2 2 2M5 11l2 2 2-2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                      </>
                    ) : (
                      // Collapse icon: lines with arrows pointing inward
                      <>
                        <path d="M2 5h10M2 9h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                        <path d="M5 2l2 2 2-2M5 12l2-2 2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                      </>
                    )}
                  </svg>
                  {allCollapsed ? 'Expand All' : 'Collapse All'}
                </button>
              );
            })()}
            {canEditThisPage && !isValidated && (
              <>
                <button className="add-category-btn" onClick={() => setShowNewCatModal(true)}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  Add Category
                </button>
                <button className="add-category-btn" onClick={() => {
                  const name = window.prompt('Parent Category name:');
                  if (name?.trim()) handleCreateParentCategory(name.trim());
                }}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M1 3.5h12M1 7h12M1 10.5h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                    <circle cx="12" cy="10.5" r="2.5" fill="currentColor"/>
                    <path d="M11 10.5h2M12 9.5v2" stroke="white" strokeWidth="1.2" strokeLinecap="round"/>
                  </svg>
                  Add Group
                </button>
              </>
            )}
          </div>
        </div>

        <div className="budget-table-container">
          <DndContext sensors={sensors} collisionDetection={closestCenter}
            onDragStart={e => setActiveId(e.active.id)}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveId(null)}>
            <table className="budget-table">
              <thead>
                <tr className="budget-table-head">
                  <th className="col-drag" />
                  <th className="col-num">#</th>
                  <th className="col-category">Category</th>
                  <th className="col-type">Type</th>
                  {MONTHS_S.map((m, i) => <th key={i} className="col-month">{m}</th>)}
                  <th className="col-total">Total</th>
                  <th className="col-actions" />
                </tr>
              </thead>
              {/* SortableContext items must match EXACTLY what rows are rendered in DOM */}
              <SortableContext
                items={buildRenderList(localCatOrder, collapsedParents).map(r => r.cat.id)}
                strategy={verticalListSortingStrategy}
              >
                <tbody>
                  {buildRenderList(localCatOrder, collapsedParents).map(({ cat, isParent, isChild, parentId, num, childCount }) => {
                    if (isParent) {
                      return (
                        <ParentCategoryRow
                          key={cat.id}
                          cat={cat}
                          num={num}
                          childCount={childCount}
                          collapsed={collapsedParents.has(cat.id)}
                          onToggle={() => handleToggleCollapse(cat.id)}
                          getMonthVal={(m) => getParentMonthVal(cat.id, m)}
                          getRowTotal={() => getRowTotal(cat.id)}
                          onDelete={() => setShowDeleteCatModal(cat)}
                          isDragging={activeId === cat.id}
                          allCats={localCatOrder}
                        />
                      );
                    }
                    return (
                      <SortableRow
                        key={cat.id}
                        cat={cat}
                        num={num}
                        isChild={isChild}
                        parentId={parentId}
                        noteObj={notes[cat.id] || null}
                        getCellValue={getCellValue}
                        getPrevValue={getPrevValue}
                        getRowTotal={getRowTotal}
                        editingCell={editingCell}
                        cellInputValue={cellInputValue}
                        setCellInputValue={setCellInputValue}
                        startEdit={startEdit}
                        commitEdit={commitEdit}
                        setEditingCell={setEditingCell}
                        handleTypeChange={handleTypeChange}
                        onDelete={() => setShowDeleteCatModal(cat)}
                        onNote={() => setShowNoteModal({ catId: cat.id, catName: cat.name, currentNote: notes[cat.id]?.note || '' })}
                        isDragging={activeId === cat.id}
                        isReadOnly={isReadOnly}
                        parentCategories={localCatOrder.filter(c => c.is_parent)}
                        onMoveToParent={handleMoveToParent}
                      />
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
                    return <td key={i} className={`foot-cell ${colTotal < 0 ? 'negative' : colTotal > 0 ? 'positive' : ''}`}>
                      {colTotal !== 0 ? formatCurrency(colTotal) : '—'}
                    </td>;
                  })}
                  <td className={`foot-cell foot-cell--total ${getGrandTotal() < 0 ? 'negative' : 'positive'}`}>
                    {formatCurrency(getGrandTotal())}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </DndContext>

          {localCatOrder.length === 0 && (
            <div className="budget-empty">
              <p>No categories yet.</p>
              {canEditThisPage && !isValidated && (
                <button className="add-category-btn" onClick={() => setShowNewCatModal(true)}>+ Add Category</button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Comments section */}
      <CommentsSection
        comments={comments}
        currentUser={currentUser}
        onAdd={handleAddComment}
        onDelete={handleDeleteComment}
      />

      {showNewYearModal && <NewYearModal currentYear={year} onClose={() => setShowNewYearModal(false)} onCreate={handleCreateYear} />}
      {showNewCatModal && <NewCategoryModal categories={localCatOrder.filter(c => !c.is_parent)} onClose={() => setShowNewCatModal(false)} onCreate={handleCreateCategory} />}
      {showDeleteCatModal && <DeleteCategoryModal category={showDeleteCatModal} onClose={() => setShowDeleteCatModal(null)} onDelete={handleDeleteCategory} />}
      {showNoteModal && <NoteModal catName={showNoteModal.catName} initialNote={showNoteModal.currentNote} onClose={() => setShowNoteModal(null)} onSave={note => handleSaveNote(showNoteModal.catId, note)} />}
    </div>
  );
}

// ─── Parent Category Row (read-only subtotal) ─────────────────────────────────
function ParentCategoryRow({ cat, num, childCount, collapsed, onToggle, getMonthVal, getRowTotal, onDelete, isDragging, allCats }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: cat.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  const rowTotal = getRowTotal();

  // Derive type dynamically from children — never use stale DB value
  const children = allCats ? allCats.filter(c => !c.is_parent && c.parent_category_id === cat.id) : [];
  let typeLabel = '';
  if (children.length > 0) {
    const types = new Set(children.map(c => c.type));
    if (types.size === 1) typeLabel = [...types][0]; // all same type
    else typeLabel = 'Mixed'; // mixed
  }
  // If no children, show nothing
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
      <td className="col-num" style={{textAlign:'center', fontSize:11, fontWeight:700, color:'var(--gray-600)', verticalAlign:'middle'}}>
        {num}
      </td>
      <td className="col-category">
        {/* Fix 1: collapse arrow inline in category cell, to the right of name */}
        <div className="cat-cell-inner parent-cell-inner">
          <span className="parent-cat-name" title={cat.name}>{cat.name}</span>
          <span className="parent-badge">group</span>
          {/* Fix 5: only show if group has children. Fix 1: arrow on the right */}
          {childCount > 0 && (
            <button className="collapse-btn collapse-btn--inline" onClick={onToggle} title={collapsed ? 'Expand group' : 'Collapse group'}>
              <svg width="11" height="11" viewBox="0 0 10 10" fill="none" style={{transform: collapsed ? 'rotate(-90deg)' : 'none', transition:'transform 150ms'}}>
                <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          )}
        </div>
      </td>
      <td className="col-type">
        {/* Exact same element as regular category rows — pointer-events:none makes it read-only */}
        {typeLabel ? (
          <select
            className={`type-select type-select--${typeClass}`}
            value={typeLabel}
            onChange={() => {}} // no-op — read only
            style={{cursor:'default', pointerEvents:'none', userSelect:'none'}}
          >
            <option value="Cost">Cost</option>
            <option value="Revenue">Revenue</option>
            <option value="Mixed">Mixed</option>
          </select>
        ) : (
          /* Empty when no children */
          <span style={{display:'block', padding:'4px 8px', fontSize:11, color:'var(--gray-300)'}}>—</span>
        )}
      </td>
      {MONTHS_FULL().map((_, i) => {
        const month = i + 1;
        const val = getMonthVal(month);
        return (
          <td key={month} className={`col-month budget-cell readonly ${val < 0 ? 'negative' : val > 0 ? 'positive' : ''}`}>
            <span className="cell-value">
              {val !== 0 ? <span className={val < 0 ? 'cell-neg' : 'cell-pos'}>{formatCurrency(val)}</span> : <span className="cell-empty">—</span>}
            </span>
          </td>
        );
      })}
      <td className={`col-total ${rowTotal < 0 ? 'negative' : rowTotal > 0 ? 'positive' : ''}`}>
        {rowTotal !== 0 ? formatCurrency(rowTotal) : '—'}
      </td>
      <td className="col-actions">
        <div className="row-action-btns">
          <button className="row-delete-btn" onClick={onDelete} title="Delete group (children return to root)">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M2 3h9M5 3V2h3v1M4 3v7h5V3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── Sortable child/root row ───────────────────────────────────────────────────
function SortableRow({ cat, num, noteObj, getCellValue, getPrevValue, getRowTotal, editingCell, cellInputValue, setCellInputValue, startEdit, commitEdit, setEditingCell, handleTypeChange, onDelete, onNote, isDragging, isReadOnly, isChild, parentId, parentCategories, onMoveToParent }) {
  const noteText = noteObj?.note || '';
  const noteAuthor = noteObj?.author_name || '';
  const noteDate = noteObj?.updated_at ? new Date(noteObj.updated_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: cat.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  const rowTotal = getRowTotal(cat.id);

  const handleKeyDown = (e, month) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      commitEdit(cat.id, month, cat.name);
      const nextMonth = e.shiftKey ? month - 1 : month + 1;
      if (nextMonth >= 1 && nextMonth <= 12) setTimeout(() => startEdit(cat.id, nextMonth, getCellValue(cat.id, nextMonth)), 10);
    }
    if (e.key === 'Escape') { setEditingCell(null); setCellInputValue(''); }
  };

  return (
    <tr ref={setNodeRef} style={style} className={`budget-row ${isDragging ? 'budget-row--dragging' : ''} ${isChild ? 'budget-row--child' : ''}`}>
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
          {/* Move to parent dropdown */}
          {parentCategories && parentCategories.length > 0 && !isReadOnly && (
            <select
              className="move-to-parent-select"
              value={cat.parent_category_id || ''}
              title="Move to group"
              onChange={e => onMoveToParent(cat.id, e.target.value || null)}
            >
              <option value="">— No group —</option>
              {parentCategories.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
        </div>
      </td>
      <td className="col-type">
        <select className={`type-select type-select--${cat.type.toLowerCase()}`} value={cat.type} onChange={e => handleTypeChange(cat.id, e.target.value)}>
          <option value="Cost">Cost</option>
          <option value="Revenue">Revenue</option>
        </select>
      </td>

      {MONTHS_FULL().map((_, i) => {
        const month = i + 1;
        const isEditing = editingCell?.catId === cat.id && editingCell?.month === month;
        const cellVal = getCellValue(cat.id, month);
        const prevVal = getPrevValue(cat.id, month);
        const { abs: chAbs, pct: chPct } = calcChange(cellVal, prevVal);

        return (
          <td key={month}
            className={`col-month budget-cell ${cellVal < 0 ? 'negative' : cellVal > 0 ? 'positive' : ''} ${isEditing ? 'editing' : ''} ${isReadOnly ? 'readonly' : ''}`}
            onClick={() => !isEditing && !isReadOnly && startEdit(cat.id, month, cellVal)}>
            {isEditing ? (
              <input className="cell-input" type="text" value={cellInputValue}
                onChange={e => setCellInputValue(e.target.value)}
                onBlur={() => commitEdit(cat.id, month, cat.name)}
                onKeyDown={e => handleKeyDown(e, month)}
                autoFocus placeholder="0,00" />
            ) : (
              <span className="cell-value">
                {cellVal !== 0 ? (
                  <span className={cellVal < 0 ? 'cell-neg' : 'cell-pos'}>{formatCurrency(cellVal)}</span>
                ) : <span className="cell-empty">—</span>}
                {prevVal !== 0 && cellVal !== prevVal && <span className="prev-indicator" title={`Previous: ${formatCurrency(prevVal)}`} />}
              </span>
            )}
          </td>
        );
      })}

      <td className={`col-total ${rowTotal < 0 ? 'negative' : rowTotal > 0 ? 'positive' : ''}`}>
        {rowTotal !== 0 ? formatCurrency(rowTotal) : '—'}
      </td>

      <td className="col-actions">
        <div className="row-action-btns">
          <button
            className={`row-note-btn ${noteText ? 'has-note' : ''}`}
            onClick={onNote}
            title={noteText ? `Note by ${noteAuthor} · ${noteDate}\n\n${noteText}` : 'Add note'}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M2 2h9v7l-2 2H2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
              <path d="M4 5h5M4 7h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            {noteText && <span className="note-dot" />}
          </button>
          <button className="row-delete-btn" onClick={onDelete} title="Delete category">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M2 3h9M5 3V2h3v1M4 3v7h5V3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </td>
    </tr>
  );
}

function KPICard({ label, value, prev, positive, negative, isCosts, colorByValue, year }) {
  const v = value ?? 0;
  const p = prev ?? 0;

  // Only show variation if previous year actually had data (prev !== 0)
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
        /* Show variation only when previous year has data */
        <div className={`kpi-change ${changeClass}`}>
          <span>{formatCurrencySigned(absChange)}</span>
          {pctChange !== null && <span className="kpi-pct">{formatPercent(pctChange)}</span>}
          <span className="kpi-change-label">vs {(year || new Date().getFullYear()) - 1}</span>
        </div>
      ) : (
        /* No previous year data — show subtle label only */
        <div className="kpi-change kpi-change--zero">
          <span className="kpi-change-label">No prior year data</span>
        </div>
      )}
    </div>
  );
}

function NewYearModal({ currentYear, onClose, onCreate }) {
  const [newYear, setNewYear] = useState(currentYear + 1);
  const [copy, setCopy] = useState(true);
  return (
    <Modal title="New Budget Year" onClose={onClose}>
      <div className="modal-field">
        <label>Year</label>
        <input type="number" className="modal-input" value={newYear} onChange={e => setNewYear(parseInt(e.target.value))} min={2020} max={2060} />
      </div>
      <div className="modal-field">
        <label className="modal-checkbox-label">
          <input type="checkbox" checked={copy} onChange={e => setCopy(e.target.checked)} />
          Copy category structure from {currentYear}
        </label>
        <p className="modal-hint">Category names and types will be copied. Values will not.</p>
      </div>
      <div className="modal-actions">
        <button className="modal-btn modal-btn--secondary" onClick={onClose}>Cancel</button>
        <button className="modal-btn modal-btn--primary" onClick={() => onCreate(newYear, copy)}>Create Year</button>
      </div>
    </Modal>
  );
}

function NewCategoryModal({ categories, onClose, onCreate }) {
  const [mode, setMode] = useState('pick'); // 'pick' | 'new'
  const [selectedCat, setSelectedCat] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState('Cost');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSelectExisting = () => {
    if (!selectedCat) return;
    if (selectedCat === '__new__') { setMode('new'); return; }
    // Category already exists globally — just close (it's already in the list)
    onClose();
  };

  const handleCreate = async () => {
    if (!name.trim()) { setError('Category name is required.'); return; }
    if (!description.trim()) { setError('Description is required.'); return; }
    setLoading(true);
    const result = await onCreate(name.trim(), type, description.trim());
    if (result?.error) setError(result.error.message || 'Category already exists.');
    setLoading(false);
  };

  return (
    <Modal title={mode === 'pick' ? 'Add Category' : 'New Category'} onClose={onClose}>
      {mode === 'pick' ? (
        <>
          <div className="modal-field">
            <label>Select or create a category</label>
            <select className="modal-input" value={selectedCat} onChange={e => {
              setSelectedCat(e.target.value);
              if (e.target.value === '__new__') setMode('new');
            }} autoFocus>
              <option value="">— Select a category —</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value="__new__">+ Add New Category</option>
            </select>
          </div>
          <div className="modal-actions">
            <button className="modal-btn modal-btn--secondary" onClick={onClose}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          <div className="modal-field">
            <label>Category Name <span className="modal-required">*</span></label>
            <input type="text" className="modal-input" value={name}
              onChange={e => { setName(e.target.value); setError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder="e.g. Office Rent" autoFocus />
          </div>
          <div className="modal-field">
            <label>Description <span className="modal-required">*</span></label>
            <textarea className="modal-input modal-textarea" value={description}
              onChange={e => { setDescription(e.target.value); setError(''); }}
              placeholder="Briefly describe what is included in this category..."
              rows={3} />
            {error && <p className="modal-error">{error}</p>}
          </div>
          <div className="modal-field">
            <label>Type</label>
            <div className="modal-type-btns">
              <button className={`type-btn ${type === 'Cost' ? 'type-btn--cost active' : ''}`} onClick={() => setType('Cost')}>Cost</button>
              <button className={`type-btn ${type === 'Revenue' ? 'type-btn--revenue active' : ''}`} onClick={() => setType('Revenue')}>Revenue</button>
            </div>
          </div>
          <div className="modal-actions">
            <button className="modal-btn modal-btn--secondary" onClick={() => setMode('pick')}>Back</button>
            <button className="modal-btn modal-btn--primary" onClick={handleCreate} disabled={loading}>
              {loading ? 'Adding...' : 'Add Category'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function DeleteCategoryModal({ category, onClose, onDelete }) {
  const [loading, setLoading] = useState(false);
  const [blocked, setBlocked] = useState(''); // error message if blocked
  const handleDelete = async () => {
    setLoading(true);
    const result = await onDelete(category.id, false); // never force from UI
    if (result?.blocked || result?.message) {
      setBlocked(result.message || 'Cannot delete this category.');
    }
    setLoading(false);
  };
  return (
    <Modal title="Delete Category" onClose={onClose}>
      {blocked ? (
        <>
          <div className="modal-warning-block">
            <div className="modal-warning-icon modal-warning-icon--red">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M10 6v4M10 13h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <p className="modal-warning-title">{blocked}</p>
          </div>
          <div className="modal-actions">
            <button className="modal-btn modal-btn--secondary" onClick={onClose}>Close</button>
          </div>
        </>
      ) : (
        <>
          <p>Are you sure you want to delete <strong>"{category.name}"</strong>?</p>
          <p className="modal-hint">This will remove the category from all budget pages. If any user has values entered, deletion will be blocked.</p>
          <div className="modal-actions">
            <button className="modal-btn modal-btn--secondary" onClick={onClose}>Cancel</button>
            <button className="modal-btn modal-btn--danger" onClick={handleDelete} disabled={loading}>{loading ? 'Checking...' : 'Delete Category'}</button>
          </div>
        </>
      )}
    </Modal>
  );
}

function NoteModal({ catName, initialNote, onClose, onSave }) {
  const [note, setNote] = useState(initialNote);
  return (
    <Modal title={`Note — ${catName}`} onClose={onClose}>
      <div className="modal-field">
        <label>Comment / Note</label>
        <textarea className="modal-input modal-textarea" value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Add a comment or note for this category line..."
          rows={5} autoFocus />
      </div>
      <div className="modal-actions">
        <button className="modal-btn modal-btn--secondary" onClick={onClose}>Cancel</button>
        <button className="modal-btn modal-btn--primary" onClick={() => onSave(note)}>Save Note</button>
      </div>
    </Modal>
  );
}

function CommentsSection({ comments, currentUser, onAdd, onDelete }) {
  const [newText, setNewText] = useState('');
  const [replyTo, setReplyTo] = useState(null); // { id, authorName }
  const [replyText, setReplyText] = useState('');

  const topLevel = comments.filter(c => !c.parent_id);
  const replies = (parentId) => comments.filter(c => c.parent_id === parentId);

  const handleSubmit = () => {
    if (!newText.trim()) return;
    onAdd(newText.trim(), null);
    setNewText('');
  };

  const handleReplySubmit = (parentId) => {
    if (!replyText.trim()) return;
    onAdd(replyText.trim(), parentId);
    setReplyText('');
    setReplyTo(null);
  };

  return (
    <div className="comments-section">
      <div className="comments-header">
        <h3 className="comments-title">Comments</h3>
        <span className="comments-count">{comments.length} {comments.length === 1 ? 'comment' : 'comments'}</span>
      </div>

      {/* New comment input */}
      <div className="comment-input-row">
        <div className="comment-avatar comment-avatar--self">{currentUser?.initials}</div>
        <div className="comment-input-wrap">
          <textarea
            className="comment-textarea"
            placeholder="Add a comment..."
            value={newText}
            onChange={e => setNewText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSubmit(); }}
            rows={2}
          />
          <div className="comment-input-actions">
            <span className="comment-hint">Ctrl+Enter to post</span>
            <button className="comment-submit-btn" onClick={handleSubmit} disabled={!newText.trim()}>Post Comment</button>
          </div>
        </div>
      </div>

      {/* Comments list */}
      {topLevel.length === 0 ? (
        <div className="comments-empty">No comments yet. Be the first to add one.</div>
      ) : (
        <div className="comments-list">
          {topLevel.map(comment => (
            <div key={comment.id} className="comment-thread">
              <div className="comment-item">
                <div className="comment-avatar">{comment.author_initials}</div>
                <div className="comment-body">
                  <div className="comment-meta">
                    <span className="comment-author">{comment.author_name}</span>
                    <span className="comment-date">
                      {new Date(comment.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                  </div>
                  <p className="comment-text">{comment.comment}</p>
                  <div className="comment-actions">
                    <button className="comment-action-btn" onClick={() => { setReplyTo(comment.id); setReplyText(''); }}>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 3l5 4 5-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><path d="M1 3v6h10V3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                      Reply
                    </button>
                    {comment.author_id === currentUser?.id && (
                      <button className="comment-action-btn comment-action-btn--danger" onClick={() => onDelete(comment.id)}>Delete</button>
                    )}
                  </div>
                  {/* Reply input */}
                  {replyTo === comment.id && (
                    <div className="comment-reply-input">
                      <textarea
                        className="comment-textarea comment-textarea--small"
                        placeholder={`Reply to ${comment.author_name}...`}
                        value={replyText}
                        onChange={e => setReplyText(e.target.value)}
                        autoFocus rows={2}
                      />
                      <div className="comment-input-actions">
                        <button className="comment-action-btn" onClick={() => setReplyTo(null)}>Cancel</button>
                        <button className="comment-submit-btn comment-submit-btn--small" onClick={() => handleReplySubmit(comment.id)} disabled={!replyText.trim()}>Reply</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {/* Replies */}
              {replies(comment.id).map(reply => (
                <div key={reply.id} className="comment-item comment-item--reply">
                  <div className="comment-avatar comment-avatar--small">{reply.author_initials}</div>
                  <div className="comment-body">
                    <div className="comment-meta">
                      <span className="comment-author">{reply.author_name}</span>
                      <span className="comment-date">
                        {new Date(reply.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                      </span>
                    </div>
                    <p className="comment-text">{reply.comment}</p>
                    {reply.author_id === currentUser?.id && (
                      <div className="comment-actions">
                        <button className="comment-action-btn comment-action-btn--danger" onClick={() => onDelete(reply.id)}>Delete</button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={`modal-box animate-slideIn${wide ? ' modal-box--wide' : ''}`}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
