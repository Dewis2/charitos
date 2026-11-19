-- Charito: un turno por tienda, compartido por sus vendedores asignados.
-- Ejecutar en Supabase > SQL Editor después de los scripts 01 a 07.
begin;
do $$ begin
 if exists(select 1 from public.charito_shifts where status='open' group by store_id having count(*)>1) then
  raise exception 'Hay turnos abiertos duplicados. Revisarlos con el administrador antes de aplicar este cambio.';
 end if;
 if to_regprocedure('public.charito_operate_v2(text,jsonb,uuid)') is null then
  alter function public.charito_operate(text,jsonb,uuid) rename to charito_operate_v2;
 end if;
end $$;
create unique index if not exists charito_one_open_shift_per_store
 on public.charito_shifts(store_id) where status='open';
revoke all on function public.charito_operate_v2(text,jsonb,uuid) from public,anon,authenticated;

create or replace function public.charito_assert_shift(p_id uuid) returns public.charito_shifts
language plpgsql security definer set search_path='' as $$
declare s public.charito_shifts; begin
 select * into s from public.charito_shifts where id=p_id for update;
 if s.id is null or s.status<>'open' then raise exception 'El turno no existe o ya está cerrado. Actualiza la tienda.';end if;
 if not public.charito_can_access_store(s.store_id) then raise exception 'No tienes acceso a esta tienda.';end if;
 return s;
end $$;
revoke all on function public.charito_assert_shift(uuid) from public,anon,authenticated;

create or replace function public.charito_shift_context(p_store uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.charito_shifts;person text;can_close boolean;begin
 if not public.charito_can_access_store(p_store) then raise exception 'Tienda no autorizada.';end if;
 select * into s from public.charito_shifts where store_id=p_store and status='open';
 select display_name into person from public.charito_members where user_id=s.responsible_id;
 can_close:=s.responsible_id=auth.uid() or exists(select 1 from public.charito_members where user_id=auth.uid() and active and role in ('admin','manager'));
 return jsonb_build_object('shared_version',1,'shift',case when s.id is null then null else to_jsonb(s) end,'responsible_name',person,'can_close',coalesce(can_close,false));
end $$;
revoke all on function public.charito_shift_context(uuid) from public,anon;
grant execute on function public.charito_shift_context(uuid) to authenticated;

create or replace function public.charito_operate(p_action text,p_data jsonb,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.charito_shifts;old public.charito_requests;answer jsonb;begin
 if auth.uid() is null or not public.charito_is_member() then raise exception 'Usuario no autorizado.';end if;
 if p_request is null or p_data is null then raise exception 'Solicitud incompleta.';end if;
 perform pg_advisory_xact_lock(76301901);
 select * into old from public.charito_requests where id=p_request;
 if old.id is not null then
  if old.user_id<>auth.uid() or old.action<>p_action or old.payload<>p_data then
   -- El núcleo convierte los cobros de pedidos antiguos a la acción order_payment.
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
 elsif p_action='close_shift' then
  select * into s from public.charito_shifts where id=(p_data->>'shift_id')::uuid for update;
  if s.id is null or not public.charito_can_access_store(s.store_id) then raise exception 'Turno no autorizado.';end if;
  if s.responsible_id<>auth.uid() and not exists(select 1 from public.charito_members where user_id=auth.uid() and active and role in ('admin','manager')) then
   raise exception 'Solo el responsable del turno o un encargado puede cerrarlo. Los vendedores pueden registrar ventas y conteos.';
  end if;
 end if;
 return public.charito_operate_v2(p_action,p_data,p_request);
end $$;
revoke all on function public.charito_operate(text,jsonb,uuid) from public,anon;
grant execute on function public.charito_operate(text,jsonb,uuid) to authenticated;
update public.charito_stores set name='Tienda chica' where lower(trim(name))='tienda 2'
 and not exists(select 1 from public.charito_stores where lower(trim(name))='tienda chica');
notify pgrst,'reload schema';
commit;
select name,(select count(*) from public.charito_shifts sh where sh.store_id=st.id and sh.status='open') as turnos_abiertos
from public.charito_stores st order by name;
