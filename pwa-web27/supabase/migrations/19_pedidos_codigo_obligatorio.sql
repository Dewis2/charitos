-- Charito: código obligatorio para nuevos pedidos. Ejecutar después de 13.
-- Conserva pedidos, códigos históricos, adelantos, turnos y permisos existentes.
begin;
do $$begin
 if to_regprocedure('public.charito_operate_before_order_code(text,jsonb,uuid)') is null then
  if to_regprocedure('public.charito_operate(text,jsonb,uuid)') is null then
   raise exception 'Primero instala las operaciones y la seguridad de Charito.';
  end if;
  alter function public.charito_operate(text,jsonb,uuid) rename to charito_operate_before_order_code;
 end if;
end$$;
revoke all on function public.charito_operate_before_order_code(text,jsonb,uuid) from public,anon,authenticated;
create or replace function public.charito_operate(p_action text,p_data jsonb,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare order_code text;begin
 if auth.uid() is null or not public.charito_is_member() then
  raise exception 'Usuario no autorizado.' using errcode='42501';
 end if;
 if p_action='new_order' then
  order_code:=trim(p_data->>'code');
  if jsonb_typeof(p_data->'code') is distinct from 'string' or order_code is null or order_code='' then
   raise exception 'El código del pedido es obligatorio.' using errcode='22023';
  end if;
  if length(order_code)>80 then raise exception 'El código admite hasta 80 caracteres.' using errcode='22023';end if;
  p_data:=jsonb_set(p_data,'{code}',to_jsonb(order_code));
 end if;
 return public.charito_operate_before_order_code(p_action,p_data,p_request);
end$$;
revoke all on function public.charito_operate(text,jsonb,uuid) from public,anon;
grant execute on function public.charito_operate(text,jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
