-- Gestión de usuarios. Ejecutar una vez en SQL Editor, después de 07 y 10.
begin;
create table if not exists public.charito_user_audit(
 id uuid primary key default gen_random_uuid(), actor_id uuid not null,
 target_id uuid not null, action text not null, created_at timestamptz not null default now(),
 details jsonb not null default '{}'::jsonb
);
alter table public.charito_user_audit enable row level security;
create policy charito_user_audit_admin on public.charito_user_audit for select to authenticated
 using(public.charito_is_admin());
grant select on public.charito_user_audit to authenticated;
create function public.charito_manage_user(p_actor uuid,p_user uuid,p_action text,
 p_name text default null,p_active boolean default null,p_stores uuid[] default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare target public.charito_members; assigned uuid[];
begin
 perform pg_advisory_xact_lock(76301901);
 if not exists(select 1 from public.charito_members where user_id=p_actor and active and role='admin')
 then raise exception 'Solo un administrador activo puede gestionar usuarios.';end if;
 select * into target from public.charito_members where user_id=p_user for update;
 if target.user_id is null then raise exception 'Usuario no encontrado.';end if;
 if p_action='reset_password' then
  insert into public.charito_user_audit(actor_id,target_id,action) values(p_actor,p_user,'password_reset_requested');
  return p_user;
 end if;
 if p_action<>'update' then raise exception 'Acción inválida.';end if;
 if p_name is null or length(trim(p_name)) not between 2 and 80 or p_active is null
 then raise exception 'Indica un nombre válido y el estado del usuario.';end if;
 if p_actor=p_user and not p_active then raise exception 'No puedes desactivar tu propia cuenta.';end if;
 if target.role='admin' and not p_active and not exists(
 select 1 from public.charito_members where role='admin' and active and user_id<>p_user)
 then raise exception 'Debe quedar un administrador activo.';end if;
 assigned:=case when target.role='worker' then p_stores else array(select id from public.charito_stores where active) end;
 if target.role='worker' and p_active and coalesce(cardinality(assigned),0)=0
 then raise exception 'Asigna al menos una tienda al vendedor.';end if;
 if exists(select 1 from unnest(assigned) a(id) where id is null or not exists(
 select 1 from public.charito_stores s where s.id=a.id and s.active)) then raise exception 'Tienda inválida.';end if;
 if exists(select 1 from public.charito_shifts s where s.responsible_id=p_user and s.status='open'
 and (not p_active or not (s.store_id=any(coalesce(assigned,'{}'::uuid[])))))
 then raise exception 'Primero cierra los turnos a cargo de esta persona.';end if;
 update public.charito_members set display_name=trim(p_name),active=p_active where user_id=p_user;
 delete from public.charito_store_members where user_id=p_user;
 insert into public.charito_store_members(user_id,store_id) select p_user,id from (select distinct unnest(assigned) id) a;
 insert into public.charito_user_audit(actor_id,target_id,action,details)
 values(p_actor,p_user,'update',jsonb_build_object('name',trim(p_name),'active',p_active,'stores',assigned));
 return p_user;
end $$;
revoke all on function public.charito_manage_user(uuid,uuid,text,text,boolean,uuid[]) from public,anon,authenticated;
grant execute on function public.charito_manage_user(uuid,uuid,text,text,boolean,uuid[]) to service_role;
commit;
select 'Gestión habilitada. Ahora actualiza la función charito-users con el archivo 12.' as resultado;
