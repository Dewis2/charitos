begin;
select pg_advisory_xact_lock(76301901);

alter table public.charito_shifts
 add column if not exists inventory_revision bigint not null default 0,
 add column if not exists final_counted_at timestamptz;
alter table public.charito_counts
 add column if not exists physical_closing_qty numeric,
 add column if not exists closing_movement_delta numeric not null default 0;

-- A complete count on an already open direct-sales shift is still valid.
with saved as (
 select s.id from public.charito_shifts s
 where s.status='open' and s.sales_mode='direct' and s.final_counted_at is null
  and not exists(select 1 from public.charito_counts c where c.shift_id=s.id and c.closing_qty is null)
), imported as (
 update public.charito_counts c set physical_closing_qty=c.closing_qty
 where c.shift_id in (select id from saved) and c.physical_closing_qty is null
 returning c.shift_id
)
update public.charito_shifts s set final_counted_at=(
 select max(r.created_at) from public.charito_requests r
 where r.action='final_counts' and r.payload->>'shift_id'=s.id::text
)
where s.id in (select shift_id from imported);

create schema if not exists charito_private;
revoke all on schema charito_private from public,anon,authenticated;

create or replace function charito_private.roll_forward_count() returns trigger
language plpgsql set search_path='' as $$
declare s public.charito_shifts;
begin
 update public.charito_shifts
 set inventory_revision=inventory_revision+1
 where id=new.shift_id and status='open' returning * into s;
 if s.sales_mode='direct' then
  update public.charito_counts c
  set closing_movement_delta=c.closing_movement_delta+new.quantity,
      closing_qty=case when c.physical_closing_qty+c.closing_movement_delta+new.quantity>=0
                       then c.physical_closing_qty+c.closing_movement_delta+new.quantity end
  where c.shift_id=new.shift_id and c.product_id=new.product_id and c.physical_closing_qty is not null;
 end if;
 return new;
end $$;
revoke all on function charito_private.roll_forward_count() from public,anon,authenticated;
drop trigger if exists charito_roll_forward_count on public.charito_stock_movements;
create trigger charito_roll_forward_count after insert on public.charito_stock_movements
for each row execute function charito_private.roll_forward_count();

create or replace function public.charito_can_access_store(p_store uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select public.charito_is_member() and exists(
  select 1 from public.charito_members m join public.charito_stores s on s.id=p_store
  where m.user_id=auth.uid() and m.active and (m.role='admin' or exists(
   select 1 from public.charito_store_members sm where sm.user_id=m.user_id and sm.store_id=s.id)))
$$;

-- Keep the deployed operation bodies and apply only the narrowly scoped changes.
do $patch$
declare f regprocedure; ddl text; before_text text; after_text text;
begin
 foreach f in array array['public.charito_operate_v1(text,jsonb,uuid)'::regprocedure,
                          'public.charito_operate_v2(text,jsonb,uuid)'::regprocedure] loop
  ddl:=pg_get_functiondef(f);
  if f::text like '%charito_operate_v1(%' then
   before_text:='and received_at is null returning id into ident;';
   after_text:='and received_at is null and exists (select 1 from public.charito_shifts h'
     ||' where h.id=charito_bags.shift_id and public.charito_can_access_store(h.store_id)) returning id into ident;';
   if strpos(ddl,after_text)=0 then
    if strpos(ddl,before_text)=0 then raise exception 'Revisa la versión de recepción de bolsas.';end if;
    ddl:=replace(ddl,before_text,after_text);
   end if;
  else
   before_text:='j:=public.charito_preview_close((p_data->>''shift_id'')::uuid);';
   after_text:=before_text||$guard$
  if p_data ? 'reviewed_expected_cash'
     and (p_data->>'reviewed_expected_cash')::numeric is distinct from (j->>'expected_cash')::numeric then
   raise exception 'La caja cambió en otro dispositivo. Revisa el nuevo importe antes de cerrar.' using errcode='40001';
  end if;
$guard$;
   if strpos(ddl,'reviewed_expected_cash')=0 then
    if strpos(ddl,before_text)=0 then raise exception 'Revisa la versión del cierre.';end if;
    ddl:=replace(ddl,before_text,after_text);
   end if;
   before_text:='if p_action=''cancel_order'' then';
   if strpos(ddl,'Tienda no autorizada para anular el pedido.')=0 then
    if strpos(ddl,before_text)=0 then raise exception 'Revisa la versión de anulación de pedidos.';end if;
    ddl:=replace(ddl,before_text,before_text||$guard$
    if not public.charito_can_access_store(o.store_id) then
     raise exception 'Tienda no autorizada para anular el pedido.' using errcode='42501';
    end if;$guard$);
   end if;
  end if;
  before_text:='update public.charito_counts set closing_qty=null where shift_id=s.id;';
  after_text:='update public.charito_counts set closing_qty=null where shift_id=s.id and s.sales_mode=''count'';';
  if strpos(ddl,before_text)=0 and strpos(ddl,after_text)=0 then raise exception 'Revisa la versión de conteo en %.',f;end if;
  execute replace(ddl,before_text,after_text);
 end loop;

 ddl:=pg_get_functiondef('public.charito_preview_close(uuid)'::regprocedure);
 before_text:='if not exists(select 1 from public.charito_counts where shift_id=p_shift)';
 if strpos(ddl,'physical_closing_qty')=0 then
  if strpos(ddl,before_text)=0 then raise exception 'Revisa la versión de previsualización del cierre.';end if;
  execute replace(ddl,before_text,$guard$if exists(select 1 from public.charito_counts c where c.shift_id=p_shift
     and c.physical_closing_qty+c.closing_movement_delta<0) then
  raise exception 'Un movimiento dejó un saldo negativo sobre el conteo guardado. Revisa los productos marcados antes de cerrar.';
 end if;
 $guard$||before_text);
 end if;

 foreach f in array array['public.charito_register_user(uuid,uuid,text,text,text,uuid[])'::regprocedure,
                          'public.charito_manage_user(uuid,uuid,text,text,boolean,uuid[])'::regprocedure,
                          'public.charito_set_user_role(uuid,text,uuid[])'::regprocedure] loop
  ddl:=pg_get_functiondef(f);
  if strpos(ddl,'Asigna al menos una tienda a este perfil.')=0 then
   if strpos(ddl,'Asigna al menos una tienda al vendedor.')=0 then raise exception 'Revisa la versión de usuarios en %.',f;end if;
   ddl:=replace(ddl,'p_role=''worker''','p_role in (''worker'',''manager'')');
   ddl:=replace(ddl,'target.role=''worker''','target.role in (''worker'',''manager'')');
   ddl:=replace(ddl,'p_role in (''admin'',''manager'')','p_role=''admin''');
   ddl:=replace(ddl,'target.role in (''admin'',''manager'')','target.role=''admin''');
   ddl:=replace(ddl,'Asigna al menos una tienda al vendedor.','Asigna al menos una tienda a este perfil.');
   before_text:='where responsible_id=p_user and status=''open'')';
   after_text:='where responsible_id=p_user and status=''open'' and not (store_id=any(assigned)))';
   ddl:=replace(ddl,before_text,after_text);
   execute ddl;
  end if;
 end loop;
end
$patch$;

create or replace function public.charito_operate_before_security(p_action text,p_data jsonb,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.charito_shifts;old public.charito_requests;answer jsonb;
begin
 if auth.uid() is null or not public.charito_is_member() then raise exception 'Usuario no autorizado.';end if;
 if p_request is null or p_data is null then raise exception 'Solicitud incompleta.';end if;
 perform pg_advisory_xact_lock(76301901);
 select * into old from public.charito_requests where id=p_request;
 if old.id is not null then
  if old.user_id<>auth.uid() or old.action<>p_action or old.payload<>p_data then
   -- Preserve idempotency for older clients that send order payments through cash.
   return public.charito_operate_v2(p_action,p_data,p_request);
  end if;
  return old.result;
 end if;
 if p_action='open_shift' then
  if not public.charito_can_access_store((p_data->>'store_id')::uuid) then raise exception 'Tienda no autorizada.';end if;
  select * into s from public.charito_shifts where store_id=(p_data->>'store_id')::uuid and status='open' for update;
  if s.id is not null then
   answer:=jsonb_build_object('id',s.id,'reused',true,'message','Esta tienda ya tiene un turno abierto. Se continúa el turno existente.');
   insert into public.charito_requests(id,user_id,action,payload,result) values(p_request,auth.uid(),p_action,p_data,answer);
   return answer;
  end if;
 elsif p_action in ('final_counts','close_shift') then
  s:=public.charito_assert_shift((p_data->>'shift_id')::uuid);
  if p_action='close_shift' and s.responsible_id<>auth.uid() and not exists(
   select 1 from public.charito_members where user_id=auth.uid() and active and role in ('admin','manager')) then
   raise exception 'Solo el responsable del turno o un encargado asignado a esta tienda puede cerrarlo.' using errcode='42501';
  end if;
  if p_data ? 'inventory_revision' and (p_data->>'inventory_revision')::bigint is distinct from s.inventory_revision then
   raise exception 'El inventario cambió en otro dispositivo. Revisa los datos actualizados y vuelve a confirmar.' using errcode='40001';
  end if;
 end if;
 answer:=public.charito_operate_v2(p_action,p_data,p_request);
 if p_action='final_counts' then
  update public.charito_counts set physical_closing_qty=closing_qty,closing_movement_delta=0
  where shift_id=s.id and s.sales_mode='direct';
  update public.charito_shifts set final_counted_at=clock_timestamp(),inventory_revision=inventory_revision+1 where id=s.id;
 end if;
 return answer;
end $$;
revoke all on function public.charito_operate_before_security(text,jsonb,uuid) from public,anon,authenticated;

notify pgrst,'reload schema';
commit;
