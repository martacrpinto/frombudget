-- Security boundary and transactional operations for Budget Solution Cloud.
-- Apply after 001_schema.sql and before exposing the project to users.

create or replace function public.current_profile_id()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from public.profiles where auth_user_id = auth.uid() limit 1
$$;

create or replace function public.current_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select is_admin from public.profile_roles where user_id = public.current_profile_id()), false)
$$;

create or replace function public.current_is_approver()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select is_approver from public.profile_roles where user_id = public.current_profile_id()), false)
$$;

create or replace function public.current_has_permission(permission_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare p public.permissions;
begin
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

create or replace function public.can_view_page(target_user_id text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and (
    target_user_id = public.current_profile_id()
    or public.current_is_admin()
    or not coalesce((select is_approver from public.profile_roles where user_id = target_user_id), false)
    or public.current_is_approver()
  )
$$;

create or replace function public.page_is_validated(target_user_id text, target_year integer)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.page_status
    where page_user_id = target_user_id and year = target_year and status = 'validated'
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
    and not public.page_is_validated(target_user_id, target_year)
    and (
      target_user_id = public.current_profile_id()
      or public.current_has_permission('can_edit_all_pages')
    )
$$;

revoke all on function public.current_profile_id() from public;
revoke all on function public.current_is_admin() from public;
revoke all on function public.current_is_approver() from public;
revoke all on function public.current_has_permission(text) from public;
revoke all on function public.can_view_page(text) from public;
revoke all on function public.page_is_validated(text, integer) from public;
revoke all on function public.can_edit_page(text, integer) from public;
grant execute on function public.current_profile_id() to authenticated;
grant execute on function public.current_is_admin() to authenticated;
grant execute on function public.current_is_approver() to authenticated;
grant execute on function public.current_has_permission(text) to authenticated;
grant execute on function public.can_view_page(text) to authenticated;
grant execute on function public.page_is_validated(text, integer) to authenticated;
grant execute on function public.can_edit_page(text, integer) to authenticated;

alter table public.profiles enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.profile_roles enable row level security;
alter table public.budget_years enable row level security;
alter table public.categories enable row level security;
alter table public.year_categories enable row level security;
alter table public.budget_entries enable row level security;
alter table public.category_order enable row level security;
alter table public.row_notes enable row level security;
alter table public.page_comments enable row level security;
alter table public.page_status enable row level security;
alter table public.audit_log enable row level security;
alter table public.remuneration_config enable row level security;
alter table public.remuneration_ftes enable row level security;
alter table public.export_history enable row level security;

create policy profiles_read_authenticated on public.profiles for select to authenticated using (true);
create policy profiles_update_self_or_admin on public.profiles for update to authenticated
  using (id = public.current_profile_id() or public.current_is_admin())
  with check (id = public.current_profile_id() or public.current_is_admin());
create policy roles_read_authenticated on public.roles for select to authenticated using (true);
create policy profile_roles_read_authenticated on public.profile_roles for select to authenticated using (true);
create policy profile_roles_admin_write on public.profile_roles for all to authenticated
  using (public.current_is_admin()) with check (public.current_is_admin());
create policy permissions_read_own_or_admin on public.permissions for select to authenticated
  using (user_id = public.current_profile_id() or public.current_is_admin());
create policy permissions_admin_write on public.permissions for all to authenticated
  using (public.current_is_admin()) with check (public.current_is_admin());

create policy years_read on public.budget_years for select to authenticated using (true);
create policy years_create on public.budget_years for insert to authenticated
  with check (public.current_has_permission('can_create_years'));
create policy years_admin_update on public.budget_years for update to authenticated
  using (public.current_is_admin()) with check (public.current_is_admin());
create policy years_admin_delete on public.budget_years for delete to authenticated using (public.current_is_admin());

create policy categories_read on public.categories for select to authenticated using (true);
create policy categories_write on public.categories for all to authenticated
  using (public.current_has_permission('can_add_categories'))
  with check (public.current_has_permission('can_add_categories'));
create policy year_categories_read on public.year_categories for select to authenticated using (true);
create policy year_categories_write on public.year_categories for all to authenticated
  using (public.current_has_permission('can_add_categories'))
  with check (public.current_has_permission('can_add_categories'));

create policy budget_entries_read on public.budget_entries for select to authenticated
  using (public.can_view_page(user_id));
create policy budget_entries_insert on public.budget_entries for insert to authenticated
  with check (public.can_edit_page(user_id, year) and updated_by = public.current_profile_id());
create policy budget_entries_update on public.budget_entries for update to authenticated
  using (public.can_edit_page(user_id, year))
  with check (public.can_edit_page(user_id, year) and updated_by = public.current_profile_id());
create policy budget_entries_delete on public.budget_entries for delete to authenticated
  using (public.can_edit_page(user_id, year));

create policy category_order_read on public.category_order for select to authenticated
  using (public.can_view_page(user_id));
create policy category_order_write on public.category_order for all to authenticated
  using (user_id = public.current_profile_id() or public.current_has_permission('can_edit_all_pages'))
  with check (user_id = public.current_profile_id() or public.current_has_permission('can_edit_all_pages'));
create policy row_notes_read on public.row_notes for select to authenticated using (public.can_view_page(user_id));
create policy row_notes_write on public.row_notes for all to authenticated
  using (public.can_edit_page(user_id, year)) with check (public.can_edit_page(user_id, year));

create policy comments_read on public.page_comments for select to authenticated using (public.can_view_page(page_user_id));
create policy comments_insert on public.page_comments for insert to authenticated
  with check (author_id = public.current_profile_id() and public.can_view_page(page_user_id));
create policy comments_delete on public.page_comments for delete to authenticated
  using (author_id = public.current_profile_id() or public.current_is_admin());
create policy page_status_read on public.page_status for select to authenticated using (public.can_view_page(page_user_id));
create policy audit_admin_read on public.audit_log for select to authenticated using (public.current_is_admin());

create policy remuneration_config_read on public.remuneration_config for select to authenticated
  using (user_id = public.current_profile_id() or public.current_is_admin());
create policy remuneration_config_write on public.remuneration_config for all to authenticated
  using (user_id = public.current_profile_id() or public.current_is_admin())
  with check (user_id = public.current_profile_id() or public.current_is_admin());
create policy remuneration_ftes_read on public.remuneration_ftes for select to authenticated
  using (user_id = public.current_profile_id() or public.current_is_admin());
create policy remuneration_ftes_write on public.remuneration_ftes for all to authenticated
  using (user_id = public.current_profile_id() or public.current_is_admin())
  with check (user_id = public.current_profile_id() or public.current_is_admin());
create policy export_history_read on public.export_history for select to authenticated
  using (export_mode = 'heads' or public.current_is_admin());
create policy export_history_insert on public.export_history for insert to authenticated
  with check (exported_by = public.current_profile_id() and (export_mode = 'heads' or public.current_is_admin()));

create or replace function public.audit_budget_entry_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare actor text := public.current_profile_id(); actor_name text; target_name text; cat_name text;
begin
  if tg_op = 'UPDATE' and old.value = new.value then return new; end if;
  select name into actor_name from public.profiles where id = actor;
  select name into target_name from public.profiles where id = coalesce(new.user_id, old.user_id);
  select name into cat_name from public.categories where id = coalesce(new.category_id, old.category_id);
  insert into public.audit_log(id,user_id,user_name,budget_page,year,category_id,category_name,field,previous_value,new_value,action)
  values (gen_random_uuid()::text, actor, actor_name, target_name, coalesce(new.year,old.year),
          coalesce(new.category_id,old.category_id), cat_name,
          (array['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])[coalesce(new.month,old.month)+1],
          case when tg_op = 'INSERT' then '0' else old.value::text end,
          case when tg_op = 'DELETE' then '0' else new.value::text end,
          case when tg_op = 'DELETE' then 'Value Cleared' else 'Value Updated' end);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;
drop trigger if exists budget_entries_audit on public.budget_entries;
create trigger budget_entries_audit after insert or update or delete on public.budget_entries
for each row execute function public.audit_budget_entry_change();

create or replace function public.save_budget_entries(p_target_user text, p_year integer, p_entries jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare actor text := public.current_profile_id(); item jsonb; changed integer := 0;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if not public.can_edit_page(p_target_user, p_year) then raise exception 'Budget page is read-only' using errcode='42501'; end if;
  if jsonb_typeof(p_entries) <> 'array' then raise exception 'Entries must be an array'; end if;
  if not exists(select 1 from public.budget_years where year=p_year) then
    if not public.current_has_permission('can_create_years') then raise exception 'Year does not exist' using errcode='42501'; end if;
    insert into public.budget_years(id,year,created_by) values(gen_random_uuid()::text,p_year,actor);
  end if;
  for item in select value from jsonb_array_elements(p_entries) loop
    insert into public.budget_entries(id,user_id,category_id,year,month,value,updated_by)
    values(gen_random_uuid()::text,p_target_user,item->>'categoryId',p_year,(item->>'month')::integer,coalesce((item->>'value')::numeric,0),actor)
    on conflict(user_id,category_id,year,month) do update
      set value=excluded.value,updated_by=actor,updated_at=timezone('utc',now());
    changed := changed + 1;
  end loop;
  return changed;
end
$$;

create or replace function public.create_budget_year(p_year integer)
returns public.budget_years
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare result public.budget_years; actor text := public.current_profile_id();
begin
  if not public.current_has_permission('can_create_years') then raise exception 'Not allowed' using errcode='42501'; end if;
  insert into public.budget_years(id,year,created_by) values(gen_random_uuid()::text,p_year,actor) returning * into result;
  insert into public.audit_log(id,user_id,user_name,budget_page,year,field,action,new_value)
    select gen_random_uuid()::text,actor,name,'Global',p_year,'Year','Year Created',p_year::text from public.profiles where id=actor;
  return result;
end
$$;

create or replace function public.save_category_order(p_target_user text, p_order jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare item jsonb; changed integer := 0;
begin
  if p_target_user <> public.current_profile_id() and not public.current_has_permission('can_edit_all_pages') then raise exception 'Not allowed' using errcode='42501'; end if;
  for item in select value from jsonb_array_elements(p_order) loop
    insert into public.category_order(user_id,category_id,sort_order)
      values(p_target_user,item->>'categoryId',(item->>'sort_order')::integer)
    on conflict(user_id,category_id) do update set sort_order=excluded.sort_order;
    changed := changed + 1;
  end loop;
  return changed;
end
$$;

create or replace function public.set_page_workflow(p_target_user text, p_year integer, p_action text)
returns public.page_status
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare actor text := public.current_profile_id(); result public.page_status; actor_name text; action_label text;
begin
  select name into actor_name from public.profiles where id=actor;
  if p_action = 'submit' then
    if actor <> p_target_user or p_target_user = 'user_bm' then raise exception 'Only the page owner can submit' using errcode='42501'; end if;
    insert into public.page_status(id,page_user_id,year,status,submitted_at,submitted_by)
      values(gen_random_uuid()::text,p_target_user,p_year,'submitted',timezone('utc',now()),actor)
    on conflict(page_user_id,year) do update set status='submitted',submitted_at=excluded.submitted_at,submitted_by=actor;
    action_label := 'Page Submitted';
  elsif p_action = 'revert' then
    if actor <> p_target_user then raise exception 'Only the page owner can revert' using errcode='42501'; end if;
    if public.page_is_validated(p_target_user,p_year) then raise exception 'Cannot revert a validated page'; end if;
    update public.page_status set status='draft',submitted_at=null,submitted_by=null where page_user_id=p_target_user and year=p_year;
    action_label := 'Submission Reverted';
  elsif p_action in ('validate','unvalidate') then
    if not public.current_is_approver() then raise exception 'Approver access required' using errcode='42501'; end if;
    insert into public.page_status(id,page_user_id,year,status,validated_at,validated_by)
      values(gen_random_uuid()::text,p_target_user,p_year,case when p_action='validate' then 'validated' else 'draft' end,
             case when p_action='validate' then timezone('utc',now()) else null end,
             case when p_action='validate' then actor else null end)
    on conflict(page_user_id,year) do update set status=excluded.status,validated_at=excluded.validated_at,validated_by=excluded.validated_by;
    action_label := case when p_action='validate' then 'Page Validated' else 'Validation Removed' end;
  else raise exception 'Invalid workflow action';
  end if;
  insert into public.audit_log(id,user_id,user_name,budget_page,year,action)
    values(gen_random_uuid()::text,actor,actor_name,p_target_user,p_year,action_label);
  select * into result from public.page_status where page_user_id=p_target_user and year=p_year;
  if not found then
    result.page_user_id := p_target_user; result.year := p_year; result.status := 'draft';
  end if;
  return result;
end
$$;

create or replace function public.clear_budget_page(p_target_user text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare actor text := public.current_profile_id(); actor_name text; target_name text;
begin
  if actor <> p_target_user and not public.current_has_permission('can_clear_data') then raise exception 'Not allowed' using errcode='42501'; end if;
  select name into actor_name from public.profiles where id=actor;
  select name into target_name from public.profiles where id=p_target_user;
  delete from public.budget_entries where user_id=p_target_user;
  delete from public.row_notes where user_id=p_target_user;
  delete from public.page_status where page_user_id=p_target_user;
  insert into public.audit_log(id,user_id,user_name,budget_page,field,action)
    values(gen_random_uuid()::text,actor,actor_name,target_name,'All Data','Page Cleared');
end
$$;

create or replace function public.system_reset()
returns void
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
begin
  if not public.current_has_permission('can_clear_data') then raise exception 'Not allowed' using errcode='42501'; end if;
  delete from public.budget_entries; delete from public.budget_years; delete from public.categories;
  delete from public.row_notes; delete from public.category_order; delete from public.page_comments;
  delete from public.page_status; delete from public.audit_log; delete from public.export_history;
  delete from storage.objects where bucket_id='exports';
end
$$;

revoke all on function public.save_budget_entries(text,integer,jsonb) from public;
revoke all on function public.create_budget_year(integer) from public;
revoke all on function public.save_category_order(text,jsonb) from public;
revoke all on function public.set_page_workflow(text,integer,text) from public;
revoke all on function public.clear_budget_page(text) from public;
revoke all on function public.system_reset() from public;
grant execute on function public.save_budget_entries(text,integer,jsonb) to authenticated;
grant execute on function public.create_budget_year(integer) to authenticated;
grant execute on function public.save_category_order(text,jsonb) to authenticated;
grant execute on function public.set_page_workflow(text,integer,text) to authenticated;
grant execute on function public.clear_budget_page(text) to authenticated;
grant execute on function public.system_reset() to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('avatars','avatars',false,5242880,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('exports','exports',false,52428800,array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']) on conflict(id) do nothing;

create policy avatars_read on storage.objects for select to authenticated using (bucket_id='avatars');
create policy avatars_insert_own on storage.objects for insert to authenticated
  with check (bucket_id='avatars' and (storage.foldername(name))[1]=public.current_profile_id());
create policy avatars_update_own on storage.objects for update to authenticated
  using (bucket_id='avatars' and (storage.foldername(name))[1]=public.current_profile_id());
create policy avatars_delete_own on storage.objects for delete to authenticated
  using (bucket_id='avatars' and ((storage.foldername(name))[1]=public.current_profile_id() or public.current_is_admin()));
create policy exports_read on storage.objects for select to authenticated using (bucket_id='exports');
create policy exports_insert on storage.objects for insert to authenticated with check (bucket_id='exports');
create policy exports_delete_admin on storage.objects for delete to authenticated using (bucket_id='exports' and public.current_is_admin());

do $$ begin
  alter publication supabase_realtime add table public.budget_entries;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.categories;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.page_comments;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.page_status;
exception when duplicate_object then null; end $$;
