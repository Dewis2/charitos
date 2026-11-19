-- Charito 1.6.0. Ejecutar después de 01..07, 09, 10 y 11.
-- Conserva turnos, inventario, pedidos y caja. No cambia contraseñas.
-- MFA TOTP obligatorio para admin; también se respeta MFA voluntario de otros roles.
begin;

alter table public.charito_members add column if not exists sessions_valid_after timestamptz;
create table if not exists public.charito_revoked_sessions(
 session_id uuid primary key, user_id uuid not null, revoked_at timestamptz not null default now()
);
create table if not exists public.charito_security_audit(
 id bigint generated always as identity primary key, actor_id uuid,
 entity text not null, entity_id text, action text not null,
 before_fields jsonb, after_fields jsonb, created_at timestamptz not null default now()
);
alter table public.charito_revoked_sessions enable row level security;
alter table public.charito_security_audit enable row level security;
revoke all on public.charito_revoked_sessions,public.charito_security_audit from public,anon,authenticated;
grant select on public.charito_security_audit to authenticated;

create or replace function public.charito_session_valid() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.charito_members m join auth.sessions s on s.user_id=m.user_id
  where m.user_id=auth.uid() and m.active
   and s.id::text=auth.jwt()->>'session_id'
   and s.created_at>now()-interval '12 hours'
   and (m.sessions_valid_after is null or s.created_at>m.sessions_valid_after)
   and not exists(select 1 from public.charito_revoked_sessions r where r.session_id=s.id)
 )
$$;
create or replace function public.charito_mfa_satisfied() returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(auth.jwt()->>'aal','aal1')='aal2' or (
  not exists(select 1 from public.charito_members where user_id=auth.uid() and role='admin')
  and not exists(select 1 from auth.mfa_factors where user_id=auth.uid() and status='verified')
 )
$$;
create or replace function public.charito_is_member() returns boolean
language sql stable security definer set search_path='' as $$
 select public.charito_session_valid() and public.charito_mfa_satisfied()
$$;
create or replace function public.charito_is_admin() returns boolean
language sql stable security definer set search_path='' as $$
 select public.charito_is_member() and exists(select 1 from public.charito_members
 where user_id=auth.uid() and active and role='admin')
$$;
create or replace function public.charito_can_access_store(p_store uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select public.charito_is_member() and exists(select 1 from public.charito_members m
 where m.user_id=auth.uid() and m.active and (m.role in ('admin','manager') or exists(
  select 1 from public.charito_store_members sm where sm.user_id=m.user_id and sm.store_id=p_store)))
$$;

create or replace function public.charito_security_status() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('version',1,'active',coalesce(m.active,false),'role',m.role,
 'session_valid',public.charito_session_valid(),
 'mfa_required',coalesce(m.role='admin',false) or exists(
  select 1 from auth.mfa_factors f where f.user_id=auth.uid() and f.status='verified'),
 'ready',public.charito_is_member(),'can_manage_users',public.charito_is_admin(),
 'session_hours',12,'idle_minutes',15)
 from (select 1) stub left join public.charito_members m on m.user_id=auth.uid()
$$;
create or replace function public.charito_security_logout() returns void
language plpgsql security definer set search_path='' as $$
declare sid uuid; begin
 if auth.uid() is null then raise exception 'Inicia sesión.' using errcode='42501';end if;
 sid:=nullif(auth.jwt()->>'session_id','')::uuid;
 if sid is not null then
  insert into public.charito_revoked_sessions(session_id,user_id) values(sid,auth.uid()) on conflict do nothing;
  insert into public.charito_security_audit(actor_id,entity,entity_id,action)
  values(auth.uid(),'session',sid::text,'logout');
 end if;
end $$;

create or replace function public.charito_security_revoke_user(p_actor uuid,p_user uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.charito_members where user_id=p_actor and active and role='admin')
 then raise exception 'Administrador no autorizado.' using errcode='42501';end if;
 if p_reason not in ('password_reset','access_changed') then raise exception 'Motivo inválido.';end if;
 update public.charito_members set sessions_valid_after=clock_timestamp() where user_id=p_user;
 insert into public.charito_security_audit(actor_id,entity,entity_id,action)
 values(p_actor,'member',p_user::text,p_reason);
end $$;
revoke all on function public.charito_security_revoke_user(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.charito_security_revoke_user(uuid,uuid,text) to service_role;

-- Limita las operaciones administrativas por actor, no las ventas de los trabajadores.
create table if not exists public.charito_security_rate(
 actor_id uuid not null, bucket timestamptz not null, requests integer not null,
 primary key(actor_id,bucket)
);
alter table public.charito_security_rate enable row level security;
revoke all on public.charito_security_rate from public,anon,authenticated;
create or replace function public.charito_security_admin_limit(p_actor uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare n integer; b timestamptz:=to_timestamp(floor(extract(epoch from now())/300)*300);begin
 if not exists(select 1 from public.charito_members where user_id=p_actor and active and role='admin')
 then return false;end if;
 insert into public.charito_security_rate values(p_actor,b,1)
 on conflict(actor_id,bucket) do update set requests=public.charito_security_rate.requests+1
 returning requests into n;
 delete from public.charito_security_rate where bucket<now()-interval '1 day';
 return n<=20;
end $$;
revoke all on function public.charito_security_admin_limit(uuid) from public,anon,authenticated;
grant execute on function public.charito_security_admin_limit(uuid) to service_role;

-- Valida valores numéricos incluso en llamadas REST directas; bloquea NaN/Infinity.
create or replace function public.charito_validate_payload(p jsonb,depth integer default 0) returns void
language plpgsql security definer set search_path='' as $$
declare r record; v jsonb; n numeric;
begin
 if depth>8 then raise exception 'Solicitud demasiado anidada.';end if;
 if jsonb_typeof(p)='object' then
  for r in select * from jsonb_each(p) loop
   if r.key=any(array['amount','total','price','opening_float','float_left','bag_amount','cash','yape',
    'discount','qty','quantity','source_qty','output_qty','step','opening_qty','closing_qty']) and r.value<>'null'::jsonb then
    if jsonb_typeof(r.value) not in ('number','string') or length(r.value#>>'{}')>32
     or (jsonb_typeof(r.value)='string' and (r.value#>>'{}')!~'^-?[0-9]+([.][0-9]+)?$')
    then raise exception 'Cantidad o importe inválido.' using errcode='22023';end if;
    n:=(r.value#>>'{}')::numeric;
    if n='NaN'::numeric or abs(n)>1000000000 then
     raise exception 'Cantidad o importe fuera de rango.' using errcode='22023';end if;
   end if;
   if jsonb_typeof(r.value) in ('object','array') then perform public.charito_validate_payload(r.value,depth+1);end if;
  end loop;
 elsif jsonb_typeof(p)='array' then
  if jsonb_array_length(p)>10000 then raise exception 'Demasiados registros.';end if;
  for v in select value from jsonb_array_elements(p) loop perform public.charito_validate_payload(v,depth+1);end loop;
 end if;
end $$;
revoke all on function public.charito_validate_payload(jsonb,integer) from public,anon,authenticated;

do $$begin
 if to_regprocedure('public.charito_operate_before_security(text,jsonb,uuid)') is null then
  alter function public.charito_operate(text,jsonb,uuid) rename to charito_operate_before_security;
 end if;
end $$;
revoke all on function public.charito_operate_before_security(text,jsonb,uuid) from public,anon,authenticated;
create or replace function public.charito_operate(p_action text,p_data jsonb,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not public.charito_is_member() then raise exception 'Sesión no autorizada. Inicia sesión y verifica el segundo factor si corresponde.' using errcode='42501';end if;
 if p_action is null or p_action<>all(array['open_shift','product','receive_bag','new_order','verify_yape',
  'final_counts','movement','return_workshop','write_off_workshop','portion','send_transfer','receive_transfer',
  'cash','deliver_order','close_shift','edit_order','cancel_order','order_payment','order_refund','historical_advance','sale','void_sale'])
 then raise exception 'Operación no permitida.' using errcode='22023';end if;
 if p_request is null or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>524288
 then raise exception 'Solicitud inválida o demasiado grande.' using errcode='22023';end if;
 perform public.charito_validate_payload(p_data);
 if p_action='cash' and (p_data->>'kind' is null or p_data->>'kind'<>all(
  array['inventory_yape','expense','other_income','pickup','order_payment'])) then
  raise exception 'Usa la operación autorizada para pagos o devoluciones.' using errcode='42501';
 end if;
 return public.charito_operate_before_security(p_action,p_data,p_request);
end $$;
revoke all on function public.charito_operate(text,jsonb,uuid) from public,anon;
grant execute on function public.charito_operate(text,jsonb,uuid) to authenticated;

-- Defensa adicional para valores no finitos en TODAS las columnas numeric del negocio.
do $$declare r record; constraint_name text;begin
 for r in select c.table_name,c.column_name from information_schema.columns c
 where c.table_schema='public' and c.table_name like 'charito_%' and c.data_type='numeric' loop
  constraint_name:='finite_'||r.column_name;
  if not exists(select 1 from pg_constraint where conrelid=format('public.%I',r.table_name)::regclass and conname=constraint_name) then
   execute format('alter table public.%I add constraint %I check (%I is null or (%I<>''NaN''::numeric and abs(%I)<>''Infinity''::numeric))',
    r.table_name,constraint_name,r.column_name,r.column_name,r.column_name);
  end if;
 end loop;
end $$;

-- Auditoría mínima, sin contraseña, token, teléfono, nombre, descripción ni frase de voz.
create or replace function public.charito_audit_fields(p jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(p)
 where key=any(array['id','user_id','store_id','shift_id','product_id','order_id','sale_id','status',
 'total','amount','method','kind','quantity','opening_float','expected_cash','difference','bag_amount','float_left',
 'active','role','version','responsible_id'])
$$;
create or replace function public.charito_capture_audit() returns trigger
language plpgsql security definer set search_path='' as $$
declare oldj jsonb:=case when TG_OP='INSERT' then '{}'::jsonb else to_jsonb(old) end;
 newj jsonb:=case when TG_OP='DELETE' then '{}'::jsonb else to_jsonb(new) end;begin
 insert into public.charito_security_audit(actor_id,entity,entity_id,action,before_fields,after_fields)
 values(auth.uid(),TG_TABLE_NAME,coalesce(newj->>'id',newj->>'user_id',newj->>'shift_id',oldj->>'id',oldj->>'user_id',oldj->>'shift_id'),
 TG_OP,public.charito_audit_fields(oldj),public.charito_audit_fields(newj));
 return case when TG_OP='DELETE' then old else new end;
end $$;
revoke all on function public.charito_capture_audit() from public,anon,authenticated;
revoke all on function public.charito_audit_fields(jsonb) from public,anon,authenticated;
do $$declare t text;begin
 foreach t in array array['charito_sales','charito_cash_entries','charito_orders','charito_shifts',
 'charito_stock_movements','charito_closures','charito_members','charito_store_members'] loop
  execute format('drop trigger if exists charito_security_audit_trigger on public.%I',t);
  execute format('create trigger charito_security_audit_trigger after insert or update or delete on public.%I for each row execute function public.charito_capture_audit()',t);
 end loop;
end $$;
drop policy if exists charito_security_audit_read on public.charito_security_audit;
create policy charito_security_audit_read on public.charito_security_audit for select to authenticated using(public.charito_is_admin());

-- La fila propia sigue legible para el enrolamiento inicial; no concede escritura.
-- Los helpers no permiten eludir sesión, MFA ni rol.
do $$declare f text;begin
 foreach f in array array['charito_session_valid()','charito_mfa_satisfied()','charito_security_status()',
 'charito_security_logout()','charito_is_member()','charito_is_admin()','charito_can_access_store(uuid)'] loop
  execute 'revoke all on function public.'||f||' from public,anon';
  execute 'grant execute on function public.'||f||' to authenticated';
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
select 'Seguridad SQL habilitada. Actualiza charito-users y entra con la app 1.6.0; admin debe activar TOTP.' as resultado;
