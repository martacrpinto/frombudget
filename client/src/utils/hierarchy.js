// ─── Hierarchy helpers for Parent/Child categories ────────────────────────────

/**
 * Build a flat ordered render list with hierarchical numbering.
 * CRITICAL: respects the array position of `cats` — does NOT re-sort by sort_order.
 * The caller is responsible for passing cats in the correct display order.
 *
 * Parents: 1, 2, 3...
 * Children of parent 2: 2.1, 2.2...
 * Root non-parent categories continue the integer sequence.
 */
export function buildRenderList(cats, collapsedSet = new Set()) {
  // Build children map — preserve insertion order (= localCatOrder position)
  const childMap = {};
  cats.forEach(c => {
    if (!c.is_parent && c.parent_category_id) {
      if (!childMap[c.parent_category_id]) childMap[c.parent_category_id] = [];
      childMap[c.parent_category_id].push(c);
    }
  });

  // Top-level items: parents + root categories, in their localCatOrder position
  // Do NOT sort — the array position IS the order
  const topLevel = cats.filter(c => c.is_parent || !c.parent_category_id);

  const result = [];
  let topNum = 0;

  for (const item of topLevel) {
    topNum++;
    if (item.is_parent) {
      // Children in localCatOrder position order (no sort)
      const kids = childMap[item.id] || [];
      result.push({ cat: item, isParent: true, isChild: false, parentId: null, num: String(topNum), childCount: kids.length });
      if (!collapsedSet.has(item.id)) {
        kids.forEach((kid, ki) => {
          result.push({ cat: kid, isParent: false, isChild: true, parentId: item.id, num: `${topNum}.${ki + 1}`, childCount: 0 });
        });
      }
    } else {
      result.push({ cat: item, isParent: false, isChild: false, parentId: null, num: String(topNum), childCount: 0 });
    }
  }
  return result;
}

/**
 * Get only leaf (non-parent) categories — used for all financial calculations.
 * Never double-counts parents.
 */
export function getLeafCategories(cats) {
  return cats.filter(c => !c.is_parent);
}
