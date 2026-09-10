import { useApp } from '../context/AppContext';

export function usePermissions() {
  const { currentUser, userPermissions, currentUserRoles } = useApp();

  const userId = currentUser?.id;
  // Use DB-driven roles (from usermgmt endpoint fetched at login)
  const isAdmin = !!(currentUserRoles?.is_admin);
  const isApprover = !!(currentUserRoles?.is_approver);

  const perms = {
    isAdmin,
    isApprover,
    // Can create/delete years
    canCreateYears: isAdmin || (userPermissions?.can_create_years === 1),
    // Can edit any user's budget page
    canEditAllPages: isAdmin || (userPermissions?.can_edit_all_pages === 1),
    // Can add/manage categories
    canAddCategories: isAdmin || (userPermissions?.can_add_categories === 1),
    // Can clear data / system reset
    canClearData: isAdmin || (userPermissions?.can_clear_data === 1),
    // Can clear own page
    canClearOwnPage: true,
    // Can manage permissions (admin only via Manage Users panel)
    canManagePermissions: isAdmin,
    // Can manage users (admin only)
    canManageUsers: isAdmin,
    // Can validate/approve pages
    canValidate: isApprover,
    // Can edit a specific page
    canEditPage: (pageUserId) => {
      if (isAdmin) return true;
      if (pageUserId === userId) return true;
      return userPermissions?.can_edit_all_pages === 1;
    },
  };

  return perms;
}
