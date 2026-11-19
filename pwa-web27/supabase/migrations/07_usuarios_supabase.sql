-- Ejecutar una vez. No crea contraseñas ni modifica usuarios existentes.
begin;
alter table public.charito_members add column username text unique
 check(username is null or username ~ '^[a-z0-9][a-z0-9._-]{2,29}$');

create function public.charito_list_users() returns table(
 user_id uuid,display_name text,username text,role text,active boolean,stores jsonb)
language plpgsql security definer set search_path='' as $$
begin
 if not public.charito_is_admin() then raise exception 'Solo el administrador puede consultar usuarios.';end if;
 return query select m.user_id,m.display_name,m.username,m.role,m.active,
 coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name) order by s.name)
 from public.charito_store_members sm join public.charito_stores s on s.id=sm.store_id
 where sm.user_id=m.user_id),'[]'::jsonb)
 from public.charito_members m order by m.display_name,m.user_id;
end $$;
revoke all on function public.charito_list_users() from public,anon;
grant execute on function public.charito_list_users() to authenticated;

-- Solo el servidor puede completar el alta. Nunca se invoca desde el navegador.
create function public.charito_register_user(p_actor uuid,p_user uuid,p_name text,
 p_username text,p_role text,p_stores uuid[]) returns uuid
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(76301901);
 if not exists(select 1 from public.charito_members where user_id=p_actor and active and role='admin')
 then raise exception 'Solo el administrador puede crear usuarios.';end if;
 if p_username is null or p_username !~ '^[a-z0-9][a-z0-9._-]{2,29}$'
 then raise exception 'Usuario inválido: usa entre 3 y 30 letras minúsculas, números, punto, guion o guion bajo.';end if;
 if p_name is null or length(trim(p_name)) not between 2 and 80
 then raise exception 'Indica el nombre de la persona (2 a 80 caracteres).';end if;
 if p_role is null or p_role not in ('worker','manager','admin') then raise exception 'Rol inválido.';end if;
 if not exists(select 1 from auth.users where id=p_user
 and email=p_username||'@usuarios.charito.invalid' and email_confirmed_at is not null)
 then raise exception 'La cuenta de acceso no coincide con el usuario.';end if;
 if p_role='worker' and coalesce(cardinality(p_stores),0)=0 then raise exception 'Asigna al menos una tienda al vendedor.';end if;
 if exists(select 1 from unnest(p_stores) t(id) where not exists(
 select 1 from public.charito_stores s where s.id=t.id and s.active)) then raise exception 'Tienda inválida o inactiva.';end if;
 insert into public.charito_members(user_id,display_name,username,role,active)
 values(p_user,trim(p_name),p_username,p_role,true);
 if p_role='worker' then
 insert into public.charito_store_members(user_id,store_id) select p_user,id from (select distinct unnest(p_stores) id) t;
 else
 insert into public.charito_store_members(user_id,store_id) select p_user,id from public.charito_stores where active;
 end if;
 return p_user;
end $$;
revoke all on function public.charito_register_user(uuid,uuid,text,text,text,uuid[]) from public,anon,authenticated;
grant execute on function public.charito_register_user(uuid,uuid,text,text,text,uuid[]) to service_role;
grant usage on schema public to service_role;
grant select on table public.charito_members, public.charito_stores to service_role;
commit;
select 'Usuarios con nombre habilitados. Falta desplegar charito-users en Edge Functions.' as resultado;
