-- Charito: recetas del taller. Ejecutar después de 13, 19 y 20.
-- Las seis recetas se incorporan como provisionales. No modifica stock, caja ni turnos.
begin;

alter table public.charito_members drop constraint if exists charito_members_role_check;
alter table public.charito_members add constraint charito_members_role_check
 check(role in ('admin','manager','worker','owner','warehouse','baker'));

-- Los roles del taller no heredan las políticas ni las operaciones de las tiendas.
create or replace function public.charito_is_member() returns boolean
language sql stable security definer set search_path='' as $$
 select public.charito_session_valid() and public.charito_mfa_satisfied()
 and exists(select 1 from public.charito_members where user_id=auth.uid()
  and active and role in ('admin','manager','worker'))
$$;
-- Gerencia consulta ambas tiendas sin adquirir permiso de operar sus cajas.
create or replace function public.charito_can_report() returns boolean
language sql stable security definer set search_path='' as $$
 select public.charito_session_valid() and public.charito_mfa_satisfied()
 and exists(select 1 from public.charito_members where user_id=auth.uid() and active and role in ('admin','owner'))
$$;
revoke all on function public.charito_can_report() from public,anon;
grant execute on function public.charito_can_report() to authenticated,service_role;
create or replace function public.charito_security_status() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('version',2,'active',coalesce(m.active,false),'role',m.role,
 'session_valid',public.charito_session_valid(),
 'mfa_required',coalesce(m.role='admin',false) or exists(select 1 from auth.mfa_factors f
   where f.user_id=auth.uid() and f.status='verified'),
 'ready',public.charito_session_valid() and public.charito_mfa_satisfied(),
 'can_manage_users',public.charito_is_admin(),'can_view_reports',public.charito_can_report(),'session_hours',12,'idle_minutes',60)
 from (select 1) stub left join public.charito_members m on m.user_id=auth.uid()
$$;
create or replace function public.charito_workshop_can(p_permission text default 'read') returns boolean
language sql stable security definer set search_path='' as $$
 select public.charito_session_valid() and public.charito_mfa_satisfied() and exists(
  select 1 from public.charito_members m where m.user_id=auth.uid() and m.active and
  case p_permission when 'read' then m.role in ('admin','owner','warehouse','baker')
   when 'edit' then m.role in ('admin','owner','baker')
   when 'approve' then m.role in ('admin','owner') else false end)
$$;
revoke all on function public.charito_workshop_can(text) from public,anon;
grant execute on function public.charito_workshop_can(text) to authenticated,service_role;

do $reports$
declare t text;
begin
 foreach t in array array['charito_stores','charito_products','charito_shifts','charito_counts',
 'charito_stock_movements','charito_transfers','charito_transfer_lines','charito_sales',
 'charito_sale_lines','charito_cash_entries','charito_closures'] loop
  execute format('drop policy if exists charito_report_read on public.%I',t);
  execute format('create policy charito_report_read on public.%I for select to authenticated using(public.charito_can_report())',t);
  execute format('grant select on public.%I to authenticated',t);
 end loop;
end $reports$;

create table if not exists public.charito_recipes(
 id uuid primary key default gen_random_uuid(),seed_key text unique,
 name text not null check(length(trim(name)) between 2 and 120),
 status text not null default 'draft' check(status in ('draft','approved','archived')),
 output_qty numeric check(output_qty>0 and output_qty<=1000000000 and output_qty<>'NaN'::numeric),
 output_unit text not null default '' check(length(output_unit)<=80),
 yield_confirmed boolean not null default false,
 notes text not null default '' check(length(notes)<=2000),
 version integer not null default 1 check(version>0),
 created_by uuid references public.charito_members(user_id),
 updated_by uuid references public.charito_members(user_id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.charito_recipe_ingredients(
 id uuid primary key default gen_random_uuid(),recipe_id uuid not null references public.charito_recipes(id),
 position integer not null check(position between 1 and 100),
 name text not null check(length(trim(name)) between 1 and 120),
 quantity numeric not null check(quantity>0 and quantity<=1000000000 and quantity<>'NaN'::numeric),
 unit text not null check(unit in ('g','kg','mL','L','unidad','tarro')),
 confirmed boolean not null default false,
 note text not null default '' check(length(note)<=400),unique(recipe_id,position)
);
create table if not exists public.charito_recipe_audit(
 id uuid primary key default gen_random_uuid(),recipe_id uuid not null references public.charito_recipes(id),
 actor_id uuid not null references public.charito_members(user_id),action text not null,
 before_data jsonb,after_data jsonb,created_at timestamptz not null default now()
);
create table if not exists public.charito_recipe_requests(
 id uuid primary key,actor_id uuid not null references public.charito_members(user_id),
 action text not null,payload jsonb not null,result jsonb not null,created_at timestamptz not null default now()
);
alter table public.charito_recipes enable row level security;
alter table public.charito_recipe_ingredients enable row level security;
alter table public.charito_recipe_audit enable row level security;
alter table public.charito_recipe_requests enable row level security;
revoke all on public.charito_recipes,public.charito_recipe_ingredients,public.charito_recipe_audit,public.charito_recipe_requests from public,anon,authenticated;
grant select on public.charito_recipes,public.charito_recipe_ingredients,public.charito_recipe_audit to authenticated;
grant select,insert,update,delete on public.charito_recipes,public.charito_recipe_ingredients,public.charito_recipe_audit,public.charito_recipe_requests to service_role;
drop policy if exists charito_recipes_read on public.charito_recipes;
create policy charito_recipes_read on public.charito_recipes for select to authenticated using(public.charito_workshop_can('read'));
drop policy if exists charito_recipe_ingredients_read on public.charito_recipe_ingredients;
create policy charito_recipe_ingredients_read on public.charito_recipe_ingredients for select to authenticated using(public.charito_workshop_can('read'));
drop policy if exists charito_recipe_audit_read on public.charito_recipe_audit;
create policy charito_recipe_audit_read on public.charito_recipe_audit for select to authenticated using(public.charito_workshop_can('approve'));

create or replace function public.charito_recipes_list() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.charito_workshop_can('read') then raise exception 'No tienes acceso al taller.' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('ingredients',
  coalesce((select jsonb_agg(to_jsonb(i) order by i.position) from public.charito_recipe_ingredients i where i.recipe_id=r.id),'[]'::jsonb))
  order by lower(r.name),r.id) from public.charito_recipes r),'[]'::jsonb);
end $$;
revoke all on function public.charito_recipes_list() from public,anon;
grant execute on function public.charito_recipes_list() to authenticated;

create or replace function public.charito_recipe_write(p_action text,p_id uuid,p_version integer,p_data jsonb,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.charito_recipes;old_request public.charito_recipe_requests;
 payload jsonb;before_state jsonb;after_state jsonb;answer jsonb;i jsonb;n integer:=0;
begin
 if not public.charito_workshop_can(case when p_action='save' then 'edit' else 'approve' end)
 then raise exception 'No tienes permisos para esta operación del taller.' using errcode='42501';end if;
 if p_request is null or p_action is null or p_action not in ('save','approve','archive')
 or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>100000
 then raise exception 'Solicitud de receta inválida.' using errcode='22023';end if;
 payload:=jsonb_build_object('id',p_id,'version',p_version,'data',p_data);
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,26));
 select * into old_request from public.charito_recipe_requests where id=p_request;
 if found then
  if old_request.actor_id<>auth.uid() or old_request.action<>p_action or old_request.payload<>payload
  then raise exception 'Esta solicitud ya corresponde a otra operación.' using errcode='22023';end if;
  return old_request.result;
 end if;
 if p_id is not null then
  select * into r from public.charito_recipes where id=p_id for update;
  if not found then raise exception 'Receta no encontrada.' using errcode='22023';end if;
  if p_version is null or r.version<>p_version then raise exception 'Otra persona modificó la receta. Actualiza la lista antes de guardar.' using errcode='40001';end if;
  before_state:=to_jsonb(r)||jsonb_build_object('ingredients',(select jsonb_agg(to_jsonb(x) order by position) from public.charito_recipe_ingredients x where recipe_id=p_id));
  if r.status='archived' then raise exception 'La receta está archivada.' using errcode='22023';end if;
 elsif p_action<>'save' then raise exception 'Selecciona una receta existente.' using errcode='22023';
 end if;
 if p_action='save' then
  if jsonb_typeof(p_data->'name') is distinct from 'string' or length(trim(p_data->>'name')) not between 2 and 120
   or jsonb_typeof(p_data->'ingredients') is distinct from 'array'
  then raise exception 'Revisa el nombre y los ingredientes.' using errcode='22023';end if;
  if jsonb_array_length(p_data->'ingredients') not between 1 and 100
   or length(coalesce(p_data->>'notes',''))>2000 or length(coalesce(p_data->>'output_unit',''))>80
   or jsonb_typeof(p_data->'yield_confirmed') is distinct from 'boolean'
  then raise exception 'Revisa los datos de la receta.' using errcode='22023';end if;
  if p_data->'output_qty' is not null and p_data->'output_qty'<>'null'::jsonb then
   if jsonb_typeof(p_data->'output_qty')<>'number' or (p_data->>'output_qty')::numeric<=0 or (p_data->>'output_qty')::numeric>1000000000
   then raise exception 'Rendimiento inválido.' using errcode='22023';end if;
  end if;
  if (p_data->>'yield_confirmed')::boolean and (p_data->'output_qty' is null or p_data->'output_qty'='null'::jsonb or trim(coalesce(p_data->>'output_unit',''))='')
  then raise exception 'Para confirmar el rendimiento indica cantidad y presentación.' using errcode='22023';end if;
  for i in select value from jsonb_array_elements(p_data->'ingredients') loop
   if jsonb_typeof(i)<>'object' or jsonb_typeof(i->'name') is distinct from 'string' or length(trim(i->>'name')) not between 1 and 120
    or jsonb_typeof(i->'quantity') is distinct from 'number' or (i->>'quantity')::numeric<=0 or (i->>'quantity')::numeric>1000000000
    or i->>'unit' is null or i->>'unit' not in ('g','kg','mL','L','unidad','tarro')
    or jsonb_typeof(i->'confirmed') is distinct from 'boolean' or length(coalesce(i->>'note',''))>400
   then raise exception 'Revisa el nombre, cantidad y unidad de cada ingrediente.' using errcode='22023';end if;
  end loop;
  if p_id is null then
   insert into public.charito_recipes(name,created_by,updated_by) values(trim(p_data->>'name'),auth.uid(),auth.uid()) returning * into r;
  end if;
  update public.charito_recipes set name=trim(p_data->>'name'),status='draft',notes=coalesce(p_data->>'notes',''),
   output_qty=(p_data->>'output_qty')::numeric,output_unit=trim(coalesce(p_data->>'output_unit','')),
   yield_confirmed=(p_data->>'yield_confirmed')::boolean,version=case when p_id is null then 1 else version+1 end,
   updated_by=auth.uid(),updated_at=clock_timestamp() where id=r.id returning * into r;
  delete from public.charito_recipe_ingredients where recipe_id=r.id;
  for i in select value from jsonb_array_elements(p_data->'ingredients') loop
   n:=n+1;
   insert into public.charito_recipe_ingredients(recipe_id,position,name,quantity,unit,confirmed,note)
   values(r.id,n,trim(i->>'name'),(i->>'quantity')::numeric,i->>'unit',(i->>'confirmed')::boolean,coalesce(i->>'note',''));
  end loop;
 elsif p_action='approve' then
  if r.status<>'draft' or not r.yield_confirmed or r.output_qty is null or trim(r.output_unit)=''
   or not exists(select 1 from public.charito_recipe_ingredients where recipe_id=r.id)
   or exists(select 1 from public.charito_recipe_ingredients where recipe_id=r.id and not confirmed)
  then raise exception 'Confirma los ingredientes y el rendimiento antes de validar la receta.' using errcode='22023';end if;
  update public.charito_recipes set status='approved',version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=r.id returning * into r;
 else
  update public.charito_recipes set status='archived',version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=r.id returning * into r;
 end if;
 after_state:=to_jsonb(r)||jsonb_build_object('ingredients',(select jsonb_agg(to_jsonb(x) order by position) from public.charito_recipe_ingredients x where recipe_id=r.id));
 insert into public.charito_recipe_audit(recipe_id,actor_id,action,before_data,after_data) values(r.id,auth.uid(),p_action,before_state,after_state);
 answer:=jsonb_build_object('id',r.id,'version',r.version,'status',r.status);
 insert into public.charito_recipe_requests(id,actor_id,action,payload,result) values(p_request,auth.uid(),p_action,payload,answer);
 return answer;
end $$;
revoke all on function public.charito_recipe_write(text,uuid,integer,jsonb,uuid) from public,anon;
grant execute on function public.charito_recipe_write(text,uuid,integer,jsonb,uuid) to authenticated;

-- Alta por servidor: los perfiles del taller no reciben asignaciones de tienda.
create or replace function public.charito_register_user(p_actor uuid,p_user uuid,p_name text,p_username text,p_role text,p_stores uuid[]) returns uuid
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(76301901);
 if not exists(select 1 from public.charito_members where user_id=p_actor and active and role='admin') then raise exception 'Administrador no autorizado.';end if;
 if p_username is null or p_username !~ '^[a-z0-9][a-z0-9._-]{2,29}$' or p_name is null or length(trim(p_name)) not between 2 and 80
  or p_role is null or p_role not in ('admin','manager','worker','owner','warehouse','baker') then raise exception 'Datos de usuario inválidos.';end if;
 if not exists(select 1 from auth.users where id=p_user and email=p_username||'@usuarios.charito.invalid' and email_confirmed_at is not null) then raise exception 'La cuenta de acceso no coincide con el usuario.';end if;
 if p_role='worker' and coalesce(cardinality(p_stores),0)=0 then raise exception 'Asigna al menos una tienda al vendedor.';end if;
 if exists(select 1 from unnest(p_stores) t(id) where id is null or not exists(select 1 from public.charito_stores s where s.id=t.id and s.active)) then raise exception 'Tienda inválida o inactiva.';end if;
 if p_role in ('owner','warehouse','baker') and coalesce(cardinality(p_stores),0)>0 then raise exception 'Los perfiles del taller no se asignan a tiendas.';end if;
 insert into public.charito_members(user_id,display_name,username,role,active) values(p_user,trim(p_name),p_username,p_role,true);
 if p_role='worker' then insert into public.charito_store_members select p_user,id from (select distinct unnest(p_stores) id) t;
 elsif p_role in ('admin','manager') then insert into public.charito_store_members select p_user,id from public.charito_stores where active;end if;
 return p_user;
end $$;

create or replace function public.charito_manage_user(p_actor uuid,p_user uuid,p_action text,p_name text default null,p_active boolean default null,p_stores uuid[] default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare target public.charito_members;assigned uuid[];
begin
 perform pg_advisory_xact_lock(76301901);
 if not exists(select 1 from public.charito_members where user_id=p_actor and active and role='admin') then raise exception 'Administrador no autorizado.';end if;
 select * into target from public.charito_members where user_id=p_user for update;
 if target.user_id is null then raise exception 'Usuario no encontrado.';end if;
 if p_action='reset_password' then insert into public.charito_user_audit(actor_id,target_id,action) values(p_actor,p_user,'password_reset_requested');return p_user;end if;
 if p_action<>'update' or p_name is null or length(trim(p_name)) not between 2 and 80 or p_active is null then raise exception 'Datos de usuario inválidos.';end if;
 if p_actor=p_user and not p_active then raise exception 'No puedes desactivar tu propia cuenta.';end if;
 if target.role='admin' and not p_active and not exists(select 1 from public.charito_members where role='admin' and active and user_id<>p_user) then raise exception 'Debe quedar un administrador activo.';end if;
 assigned:=case when target.role='worker' then coalesce(p_stores,'{}'::uuid[]) when target.role in ('admin','manager') then array(select id from public.charito_stores where active) else '{}'::uuid[] end;
 if target.role='worker' and p_active and cardinality(assigned)=0 then raise exception 'Asigna al menos una tienda al vendedor.';end if;
 if exists(select 1 from unnest(assigned) a(id) where id is null or not exists(select 1 from public.charito_stores s where s.id=a.id and s.active)) then raise exception 'Tienda inválida.';end if;
 if exists(select 1 from public.charito_shifts s where s.responsible_id=p_user and s.status='open' and (not p_active or not(s.store_id=any(assigned)))) then raise exception 'Primero cierra los turnos a cargo de esta persona.';end if;
 update public.charito_members set display_name=trim(p_name),active=p_active where user_id=p_user;
 delete from public.charito_store_members where user_id=p_user;
 insert into public.charito_store_members select p_user,id from (select distinct unnest(assigned) id) a;
 insert into public.charito_user_audit(actor_id,target_id,action,details) values(p_actor,p_user,'update',jsonb_build_object('name',trim(p_name),'active',p_active,'stores',assigned));
 return p_user;
end $$;
revoke all on function public.charito_register_user(uuid,uuid,text,text,text,uuid[]),public.charito_manage_user(uuid,uuid,text,text,boolean,uuid[]) from public,anon,authenticated;
grant execute on function public.charito_register_user(uuid,uuid,text,text,text,uuid[]),public.charito_manage_user(uuid,uuid,text,text,boolean,uuid[]) to service_role;

create or replace function public.charito_set_user_role(p_user uuid,p_role text,p_stores uuid[] default '{}') returns void
language plpgsql security definer set search_path='' as $$
declare target public.charito_members;assigned uuid[];
begin
 if not public.charito_is_admin() then raise exception 'Solo el administrador puede cambiar roles.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(76301901);
 select * into target from public.charito_members where user_id=p_user for update;
 if not found or p_role is null or p_role not in ('admin','manager','worker','owner','warehouse','baker') then raise exception 'Usuario o rol inválido.' using errcode='22023';end if;
 if p_user=auth.uid() then raise exception 'Cambia el rol de otra persona, no el de tu propia cuenta.' using errcode='42501';end if;
 if target.role='admin' and p_role<>'admin' and not exists(select 1 from public.charito_members where role='admin' and active and user_id<>p_user) then raise exception 'Debe quedar un administrador activo.';end if;
 assigned:=case when p_role='worker' then coalesce(p_stores,'{}'::uuid[]) when p_role in ('admin','manager') then array(select id from public.charito_stores where active) else '{}'::uuid[] end;
 if p_role='worker' and cardinality(assigned)=0 then raise exception 'Asigna al menos una tienda al vendedor.';end if;
 if exists(select 1 from unnest(assigned) a(id) where id is null or not exists(select 1 from public.charito_stores s where s.id=a.id and s.active)) then raise exception 'Tienda inválida.';end if;
 if exists(select 1 from public.charito_shifts where responsible_id=p_user and status='open') then raise exception 'Primero cierra los turnos a cargo de esta persona.';end if;
 update public.charito_members set role=p_role,sessions_valid_after=clock_timestamp() where user_id=p_user;
 delete from public.charito_store_members where user_id=p_user;
 insert into public.charito_store_members select p_user,id from (select distinct unnest(assigned) id) a;
 insert into public.charito_user_audit(actor_id,target_id,action,details) values(auth.uid(),p_user,'role_changed',jsonb_build_object('before',target.role,'after',p_role,'stores',assigned));
end $$;
revoke all on function public.charito_set_user_role(uuid,text,uuid[]) from public,anon;
grant execute on function public.charito_set_user_role(uuid,text,uuid[]) to authenticated;

-- El catálogo inicia vacío. Las recetas se registran en la aplicación.
notify pgrst,'reload schema';
commit;
select name,status,version,(select count(*) from public.charito_recipe_ingredients i where i.recipe_id=r.id) as ingredientes from public.charito_recipes r order by name;
