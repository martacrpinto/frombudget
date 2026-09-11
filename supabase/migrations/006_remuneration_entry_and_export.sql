-- Remuneration entry-month support and authenticated consolidated exports.

alter table public.remuneration_ftes
  add column if not exists entry_month smallint;

alter table public.remuneration_ftes
  drop constraint if exists remuneration_ftes_entry_month_check;

alter table public.remuneration_ftes
  add constraint remuneration_ftes_entry_month_check
  check (entry_month is null or entry_month between 1 and 12);

-- Reading the underlying remuneration tables remains owner/admin only. This
-- deliberately narrow function is the single authorised consolidated export
-- surface for every fully onboarded user.
create or replace function public.get_remuneration_export_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  actor text := public.current_profile_id();
  payload jsonb;
begin
  if auth.uid() is null or actor is null or public.current_must_change_password() then
    raise exception 'Authentication required' using errcode='42501';
  end if;

  select jsonb_build_object(
    'ftes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', f.id,
          'user_id', f.user_id,
          'user_name', p.name,
          'user_initials', p.initials,
          'year', f.year,
          'position', f.position,
          'role', f.role,
          'collaborator_name', f.collaborator_name,
          'annual_base_salary', f.annual_base_salary,
          'meal_allowance_day', f.meal_allowance_day,
          'indexation_pct', f.indexation_pct,
          'increase_pct', f.increase_pct,
          'entry_month', f.entry_month
        ) order by f.year, p.name, f.position, f.id
      )
      from public.remuneration_ftes f
      join public.profiles p on p.id=f.user_id
    ), '[]'::jsonb),
    'configs', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.user_id)
      from public.remuneration_config c
    ), '[]'::jsonb)
  ) into payload;

  return payload;
end
$$;

revoke all on function public.get_remuneration_export_data() from public;
grant execute on function public.get_remuneration_export_data() to authenticated;

create or replace function public.register_remuneration_export(
  p_filepath text,
  p_year integer,
  p_snapshot jsonb default '{}'::jsonb
)
returns public.export_history
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  actor text := public.current_profile_id();
  actor_name text;
  next_version integer;
  year_label text;
  result public.export_history;
begin
  if auth.uid() is null or actor is null or public.current_must_change_password() then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  if p_filepath is null or p_filepath !~ ('^remun/' || actor || '/[0-9a-fA-F-]+[.]xlsx$') then
    raise exception 'Invalid export path' using errcode='22023';
  end if;
  if not exists (
    select 1 from storage.objects where bucket_id='exports' and name=p_filepath
  ) then
    raise exception 'Export file was not uploaded' using errcode='22023';
  end if;

  select name into actor_name from public.profiles where id=actor;
  perform pg_advisory_xact_lock(hashtext('remuneration_export_version'));
  select coalesce(max(version),0)+1 into next_version
  from public.export_history where export_mode='remun';

  select nullif(string_agg(value, '-' order by value::integer), '')
  into year_label
  from jsonb_array_elements_text(coalesce(p_snapshot->'years', '[]'::jsonb));
  year_label := coalesce(year_label, p_year::text);

  insert into public.export_history(
    id, version, exported_by, exported_by_name, year,
    filename, filepath, snapshot, export_mode
  ) values (
    gen_random_uuid()::text,
    next_version,
    actor,
    actor_name,
    p_year,
    format('From_Remuneration_%s_v%s.xlsx', year_label, lpad(next_version::text,3,'0')),
    p_filepath,
    coalesce(p_snapshot, '{}'::jsonb),
    'remun'
  ) returning * into result;

  return result;
end
$$;

revoke all on function public.register_remuneration_export(text, integer, jsonb) from public;
grant execute on function public.register_remuneration_export(text, integer, jsonb) to authenticated;

drop policy if exists export_history_read on public.export_history;
create policy export_history_read on public.export_history for select to authenticated
  using (export_mode in ('heads','remun') or public.current_is_admin());

-- Direct inserts keep their previous scope. Remuneration history is created by
-- register_remuneration_export only, which derives identity from auth.uid().
drop policy if exists export_history_insert on public.export_history;
create policy export_history_insert on public.export_history for insert to authenticated
  with check (
    exported_by=public.current_profile_id()
    and (export_mode='heads' or public.current_is_admin())
  );

drop policy if exists exports_read on storage.objects;
drop policy if exists exports_insert on storage.objects;
drop policy if exists exports_delete_admin on storage.objects;
drop policy if exists exports_delete_own_remun_or_admin on storage.objects;

create policy exports_read on storage.objects for select to authenticated
using (
  bucket_id='exports'
  and ((storage.foldername(name))[1] in ('heads','remun') or public.current_is_admin())
);

create policy exports_insert on storage.objects for insert to authenticated
with check (
  bucket_id='exports'
  and (storage.foldername(name))[2]=public.current_profile_id()
  and ((storage.foldername(name))[1] in ('heads','remun') or public.current_is_admin())
);

create policy exports_delete_own_remun_or_admin on storage.objects for delete to authenticated
using (
  bucket_id='exports'
  and (
    public.current_is_admin()
    or (
      (storage.foldername(name))[1]='remun'
      and (storage.foldername(name))[2]=public.current_profile_id()
    )
  )
);
