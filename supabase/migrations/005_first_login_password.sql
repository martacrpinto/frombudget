-- First-login password enforcement.
-- The flag is kept in auth.users.app_metadata because user_metadata is
-- writable by the browser. Only the service-role Edge Function can set or
-- clear app_metadata.

create or replace function public.current_must_change_password()
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'must_change_password')::boolean, false)
$$;

revoke all on function public.current_must_change_password() from public;
grant execute on function public.current_must_change_password() to authenticated;

-- Do not expose the profile identity to application SQL while the temporary
-- password is active. The Edge Function uses the Auth Admin API and is not
-- subject to these client-side RLS checks.
create or replace function public.current_profile_id()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when public.current_must_change_password() then null
              else (select id from public.profiles where auth_user_id = auth.uid() limit 1)
         end
$$;

revoke all on function public.current_profile_id() from public;
grant execute on function public.current_profile_id() to authenticated;

create or replace function public.current_has_permission(permission_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare p public.permissions;
begin
  if public.current_must_change_password() then return false; end if;
  if public.current_is_admin() then return true; end if;
  select * into p from public.permissions where user_id = public.current_profile_id();
  return case permission_name
    when 'can_create_years' then coalesce(p.can_create_years, false)
    when 'can_edit_all_pages' then coalesce(p.can_edit_all_pages, false)
    when 'can_add_categories' then coalesce(p.can_add_categories, false)
    when 'can_clear_data' then coalesce(p.can_clear_data, false)
    else false
  end;
end
$$;

revoke all on function public.current_has_permission(text) from public;
grant execute on function public.current_has_permission(text) to authenticated;

-- A user with a temporary password may authenticate, but cannot use the
-- budget application until the password-change action clears the flag.
create or replace function public.current_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not public.current_must_change_password()
    and coalesce((select is_admin from public.profile_roles where user_id = public.current_profile_id()), false)
$$;

create or replace function public.current_is_approver()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not public.current_must_change_password()
    and coalesce((select is_approver from public.profile_roles where user_id = public.current_profile_id()), false)
$$;

create or replace function public.can_view_page(target_user_id text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and not public.current_must_change_password()
    and (
      target_user_id = public.current_profile_id()
      or public.current_is_admin()
      or not coalesce((select is_approver from public.profile_roles where user_id = target_user_id), false)
      or public.current_is_approver()
    )
$$;

create or replace function public.can_edit_page(target_user_id text, target_year integer)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and not public.current_must_change_password()
    and not public.page_is_validated(target_user_id, target_year)
    and (
      target_user_id = public.current_profile_id()
      or public.current_has_permission('can_edit_all_pages')
    )
$$;

revoke all on function public.current_is_admin() from public;
revoke all on function public.current_is_approver() from public;
revoke all on function public.can_view_page(text) from public;
revoke all on function public.can_edit_page(text, integer) from public;
grant execute on function public.current_is_admin() to authenticated;
grant execute on function public.current_is_approver() to authenticated;
grant execute on function public.can_view_page(text) to authenticated;
grant execute on function public.can_edit_page(text, integer) to authenticated;

-- The helpers above protect all privileged paths. Restrictive policies add a
-- second, table-level boundary so a temporary-password session cannot bypass
-- the UI and read even globally visible reference data through PostgREST.
do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'profiles', 'roles', 'permissions', 'profile_roles', 'budget_years',
    'categories', 'year_categories', 'budget_entries', 'category_order',
    'row_notes', 'page_comments', 'page_status', 'audit_log',
    'remuneration_config', 'remuneration_ftes', 'export_history'
  ] loop
    execute format('drop policy if exists require_password_change_complete on public.%I', target_table);
    execute format(
      'create policy require_password_change_complete on public.%I as restrictive for all to authenticated using (not public.current_must_change_password()) with check (not public.current_must_change_password())',
      target_table
    );
  end loop;
end
$$;

drop policy if exists require_password_change_complete on storage.objects;
create policy require_password_change_complete on storage.objects
  as restrictive for all to authenticated
  using (not public.current_must_change_password())
  with check (not public.current_must_change_password());
