-- Normalize actor fields and complete the audit trail for categories and FTEs.

create or replace function public.audit_category_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare actor text := public.current_profile_id(); actor_name text; action_name text;
begin
  select name into actor_name from public.profiles where id=actor;
  if tg_op='INSERT' then
    action_name := case when new.is_parent then 'Parent Category Created' else 'Category Created' end;
    insert into public.audit_log(id,user_id,user_name,budget_page,category_id,category_name,field,action)
      values(gen_random_uuid()::text,actor,actor_name,'Global',new.id,new.name,'Category',action_name);
    return new;
  elsif tg_op='UPDATE' then
    if old.name is distinct from new.name then
      insert into public.audit_log(id,user_id,user_name,budget_page,category_id,category_name,field,previous_value,new_value,action)
        values(gen_random_uuid()::text,actor,actor_name,'Global',new.id,new.name,'Name',old.name,new.name,'Category Renamed');
    end if;
    if old.type is distinct from new.type then
      insert into public.audit_log(id,user_id,user_name,budget_page,category_id,category_name,field,previous_value,new_value,action)
        values(gen_random_uuid()::text,actor,actor_name,'Global',new.id,new.name,'Type',old.type,new.type,'Type Changed');
    end if;
    if old.parent_category_id is distinct from new.parent_category_id then
      insert into public.audit_log(id,user_id,user_name,budget_page,category_id,category_name,field,previous_value,new_value,action)
        values(gen_random_uuid()::text,actor,actor_name,'Global',new.id,new.name,'Parent',coalesce(old.parent_category_id,'root'),coalesce(new.parent_category_id,'root'),'Category Parent Changed');
    end if;
    return new;
  else
    insert into public.audit_log(id,user_id,user_name,budget_page,category_name,field,action)
      values(gen_random_uuid()::text,actor,actor_name,'Global',old.name,'Category','Category Deleted');
    return old;
  end if;
end
$$;
drop trigger if exists categories_audit on public.categories;
create trigger categories_audit after insert or update or delete on public.categories
for each row execute function public.audit_category_change();

create or replace function public.normalize_category_actor()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op='INSERT' then new.created_by := public.current_profile_id(); end if;
  return new;
end
$$;
drop trigger if exists categories_normalize_actor on public.categories;
create trigger categories_normalize_actor before insert on public.categories
for each row execute function public.normalize_category_actor();

create or replace function public.audit_fte_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare actor text := public.current_profile_id(); actor_name text;
begin
  select name into actor_name from public.profiles where id=actor;
  if tg_op='INSERT' then
    insert into public.audit_log(id,user_id,user_name,budget_page,year,field,action,new_value)
      values(gen_random_uuid()::text,actor,actor_name,'Remuneration',new.year,'FTE','FTEs Added','1');
    return new;
  elsif tg_op='DELETE' then
    insert into public.audit_log(id,user_id,user_name,budget_page,year,field,action)
      values(gen_random_uuid()::text,actor,actor_name,'Remuneration',old.year,'FTE','FTE Removed');
    return old;
  end if;
  return new;
end
$$;
drop trigger if exists remuneration_ftes_audit on public.remuneration_ftes;
create trigger remuneration_ftes_audit after insert or delete on public.remuneration_ftes
for each row execute function public.audit_fte_change();

