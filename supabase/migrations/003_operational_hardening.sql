-- Hardening fixes identified during independent review.

-- Direct role writes are disabled. Role mutations go through the admin-users
-- Edge Function, whose server-only client bypasses RLS after checking the actor.
drop policy if exists profile_roles_admin_write on public.profile_roles;

-- Explicit grants: RLS still decides which rows are available.
revoke all on all tables in schema public from anon;
grant select on public.profiles, public.roles, public.profile_roles, public.permissions,
  public.budget_years, public.categories, public.year_categories, public.budget_entries,
  public.category_order, public.row_notes, public.page_comments, public.page_status,
  public.audit_log, public.remuneration_config, public.remuneration_ftes, public.export_history
  to authenticated;
grant update(profile_picture) on public.profiles to authenticated;
grant update on public.permissions to authenticated;
grant insert, update, delete on public.categories, public.year_categories, public.budget_entries,
  public.category_order, public.row_notes, public.page_comments,
  public.remuneration_config, public.remuneration_ftes, public.export_history to authenticated;
grant insert, update, delete on public.budget_years to authenticated;
revoke insert, update, delete on public.audit_log, public.roles, public.profile_roles, public.page_status from authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Comments cannot forge author identity fields.
create or replace function public.normalize_comment_author()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare actor public.profiles;
begin
  select * into actor from public.profiles where id=public.current_profile_id();
  if actor.id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  new.author_id := actor.id;
  new.author_name := actor.name;
  new.author_initials := actor.initials;
  return new;
end
$$;
drop trigger if exists page_comments_normalize_author on public.page_comments;
create trigger page_comments_normalize_author before insert on public.page_comments
for each row execute function public.normalize_comment_author();

-- Validate every budget item before the upsert to produce deterministic errors
-- and prevent values for categories not enabled in the selected year.
create or replace function public.save_budget_entries(p_target_user text, p_year integer, p_entries jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare actor text := public.current_profile_id(); item jsonb; changed integer := 0; item_month integer; item_category text;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not public.can_edit_page(p_target_user,p_year) then raise exception 'Budget page is read-only' using errcode='42501'; end if;
  if jsonb_typeof(p_entries) <> 'array' then raise exception 'Entries must be an array'; end if;
  if not exists(select 1 from public.budget_years where year=p_year) then
    if not public.current_has_permission('can_create_years') then raise exception 'Year does not exist' using errcode='42501'; end if;
    insert into public.budget_years(id,year,created_by) values(gen_random_uuid()::text,p_year,actor);
  end if;
  for item in select value from jsonb_array_elements(p_entries) loop
    item_month := (item->>'month')::integer;
    item_category := item->>'categoryId';
    if item_month not between 1 and 12 then raise exception 'Month must be between 1 and 12'; end if;
    if not exists(select 1 from public.year_categories where year=p_year and category_id=item_category) then
      raise exception 'Category % is not enabled for year %', item_category, p_year;
    end if;
    insert into public.budget_entries(id,user_id,category_id,year,month,value,updated_by)
    values(gen_random_uuid()::text,p_target_user,item_category,p_year,item_month,coalesce((item->>'value')::numeric,0),actor)
    on conflict(user_id,category_id,year,month) do update
      set value=excluded.value,updated_by=actor,updated_at=timezone('utc',now());
    changed := changed+1;
  end loop;
  return changed;
end
$$;

-- A global reset really clears all business data, including remuneration,
-- before deleting referenced years.
create or replace function public.system_reset()
returns void
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
begin
  if not public.current_has_permission('can_clear_data') then raise exception 'Not allowed' using errcode='42501'; end if;
  delete from public.remuneration_ftes;
  delete from public.remuneration_config;
  delete from public.budget_entries;
  delete from public.row_notes;
  delete from public.category_order;
  delete from public.page_comments;
  delete from public.page_status;
  delete from public.export_history;
  delete from public.year_categories;
  delete from public.categories;
  delete from public.budget_years;
  delete from public.audit_log;
end
$$;

-- Storage paths use `<mode>/<profile-id>/<filename>`. Heads exports are visible
-- to all signed-in users; From exports are visible only to administrators.
drop policy if exists exports_read on storage.objects;
drop policy if exists exports_insert on storage.objects;
drop policy if exists exports_delete_admin on storage.objects;
create policy exports_read on storage.objects for select to authenticated
using (
  bucket_id='exports' and (
    (storage.foldername(name))[1]='heads'
    or public.current_is_admin()
  )
);
create policy exports_insert on storage.objects for insert to authenticated
with check (
  bucket_id='exports'
  and (storage.foldername(name))[2]=public.current_profile_id()
  and ((storage.foldername(name))[1]='heads' or public.current_is_admin())
);
create policy exports_delete_admin on storage.objects for delete to authenticated
using (bucket_id='exports' and public.current_is_admin());
