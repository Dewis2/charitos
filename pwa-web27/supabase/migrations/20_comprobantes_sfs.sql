-- Charito: boletas/facturas de ventas individuales mediante SFS 2.5.
-- Ejecutar después de 19. No activa la emisión ni altera ventas, caja o stock.
begin;
create table if not exists public.charito_fiscal_company(
 id boolean primary key default true check(id),
 ruc text not null default '00000000000' check(ruc='00000000000'),
 legal_name text not null default 'INVERSIONES VINCULA E.I.R.L.',
 address text not null default '', ubigeo text not null default '',
 prices_include_vat boolean not null default true check(prices_include_vat),
 igv_rate numeric(5,2), eligibility_confirmed boolean not null default false,
 enabled boolean not null default false, updated_at timestamptz not null default now(),
 check(igv_rate is null or igv_rate>0 and igv_rate<=30 and igv_rate<>'NaN'::numeric)
);
insert into public.charito_fiscal_company(id) values(true) on conflict do nothing;
create table if not exists public.charito_fiscal_stores(
 store_id uuid primary key references public.charito_stores,
 establishment_code text check(establishment_code ~ '^[0-9]{4}$'),
 boleta_series text unique check(boleta_series ~ '^B[A-Z0-9]{3}$'),
 factura_series text unique check(factura_series ~ '^F[A-Z0-9]{3}$'),
 boleta_last integer not null default 0 check(boleta_last between 0 and 99999998),
 factura_last integer not null default 0 check(factura_last between 0 and 99999998),
 verified boolean not null default false, updated_at timestamptz not null default now()
);
insert into public.charito_fiscal_stores(store_id) select id from public.charito_stores on conflict do nothing;
create table if not exists public.charito_fiscal_products(
 product_id uuid primary key references public.charito_products,
 affectation text not null check(affectation in ('10','20','30')),
 unit_code text not null default 'NIU' check(unit_code in ('NIU','KGM','LTR')),
 multiplier numeric(12,3) not null default 1 check(multiplier>0 and multiplier<=1000 and multiplier<>'NaN'::numeric),
 confirmed boolean not null default false, updated_at timestamptz not null default now()
);
create table if not exists public.charito_sfs_connectors(
 id uuid primary key default gen_random_uuid(), store_id uuid not null unique references public.charito_stores,
 token_hash bytea not null unique, active boolean not null default true,
 expires_at timestamptz not null default now()+interval '180 days',
 created_by uuid not null references public.charito_members(user_id),
 last_seen_at timestamptz, version text, created_at timestamptz not null default now()
);
create table if not exists public.charito_fiscal_documents(
 id uuid primary key default gen_random_uuid(), sale_id uuid not null unique references public.charito_sales,
 store_id uuid not null references public.charito_stores,
 request_id uuid not null unique, doc_type text not null check(doc_type in ('01','03')),
 series text not null check(series ~ '^[FB][A-Z0-9]{3}$'), number integer not null check(number between 1 and 99999999),
 status text not null default 'queued' check(status in ('queued','preparing','blocked','exported','accepted','rejected','needs_review','cancelled')),
 total numeric(12,2) not null, igv numeric(12,2) not null, base numeric(12,2) not null,
 customer_name text not null, customer_number text not null, snapshot jsonb not null,
 connector_id uuid references public.charito_sfs_connectors, lease_id uuid, lease_until timestamptz,
 exported_at timestamptz, response_code text, response_description text, cdr_xml text,
 created_by uuid not null references public.charito_members(user_id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(doc_type,series,number),check(total>0 and total<>'NaN'::numeric and igv>=0 and base>0 and base+igv=total)
);
create index if not exists charito_fiscal_documents_store_time on public.charito_fiscal_documents(store_id,created_at desc,id);
create index if not exists charito_fiscal_documents_pending on public.charito_fiscal_documents(store_id,status) where status in ('queued','preparing','exported','needs_review');
create table if not exists public.charito_fiscal_files(
 document_id uuid not null references public.charito_fiscal_documents,
 kind text not null check(kind in ('signed.xml','cdr.xml','representation.pdf')),
 path text not null, sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 bytes integer not null check(bytes between 1 and 5242880), created_at timestamptz not null default now(),
 primary key(document_id,kind)
);
-- New tables deliberately expose no direct writes or anonymous reads.
do $$ declare t text; begin
 foreach t in array array['charito_fiscal_company','charito_fiscal_stores','charito_fiscal_products','charito_sfs_connectors','charito_fiscal_documents','charito_fiscal_files'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;

create or replace function public.charito_fiscal_valid_ruc(p_ruc text) returns boolean
language plpgsql immutable set search_path='' as $$
declare weights integer[]:=array[5,4,3,2,7,6,5,4,3,2]; n integer:=0;i integer; digit integer;
begin
 if p_ruc is null or p_ruc !~ '^[0-9]{11}$' then return false;end if;
 for i in 1..10 loop n:=n+substr(p_ruc,i,1)::integer*weights[i];end loop;
 digit:=(11-n%11)%10;return digit=substr(p_ruc,11,1)::integer;
end $$;

create or replace function public.charito_fiscal_admin(p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.charito_fiscal_company; s public.charito_fiscal_stores; k uuid; tok text; result jsonb; p jsonb;
begin
 if not public.charito_is_admin() then raise exception 'Solo el administrador con acceso verificado puede configurar comprobantes.' using errcode='42501';end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>32000 then raise exception 'Configuración inválida.';end if;
 if p_action='company' then
  update public.charito_fiscal_company set legal_name=trim(p_data->>'legal_name'),address=trim(p_data->>'address'),ubigeo=trim(p_data->>'ubigeo'),
   igv_rate=nullif(p_data->>'igv_rate','')::numeric,eligibility_confirmed=coalesce((p_data->>'eligibility_confirmed')::boolean,false),
   enabled=coalesce((p_data->>'enabled')::boolean,false),updated_at=now() where id returning * into c;
  if length(c.legal_name) not between 3 and 150 or length(c.address)>250 or c.ubigeo<>'' and c.ubigeo !~ '^[0-9]{6}$' then raise exception 'Revisa la razón social, dirección y ubigeo.';end if;
  if c.enabled and (not c.eligibility_confirmed or c.igv_rate is null or length(c.address)<5 or c.ubigeo !~ '^[0-9]{6}$') then raise exception 'Confirma la habilitación de SEE-SFS, dirección fiscal, ubigeo y tasa de IGV antes de activar.';end if;
  result:=jsonb_build_object('saved',true);
 elsif p_action='store' then
  k:=(p_data->>'store_id')::uuid;
  select * into s from public.charito_fiscal_stores where store_id=k for update;
  if not found then raise exception 'Tienda no encontrada.';end if;
  if exists(select 1 from public.charito_fiscal_documents where store_id=k) and
   (s.boleta_series is distinct from nullif(upper(trim(p_data->>'boleta_series')),'') or s.factura_series is distinct from nullif(upper(trim(p_data->>'factura_series')),'') or s.establishment_code is distinct from nullif(trim(p_data->>'establishment_code'),'')) then
   raise exception 'La tienda ya tiene comprobantes. Sus series y establecimiento requieren una migración controlada.';
  end if;
  if coalesce((p_data->>'boleta_last')::integer,0)<s.boleta_last or coalesce((p_data->>'factura_last')::integer,0)<s.factura_last then raise exception 'No puedes reducir un correlativo ya reservado.';end if;
  update public.charito_fiscal_stores set establishment_code=nullif(trim(p_data->>'establishment_code'),''),
   boleta_series=nullif(upper(trim(p_data->>'boleta_series')),''),factura_series=nullif(upper(trim(p_data->>'factura_series')),''),
   boleta_last=coalesce((p_data->>'boleta_last')::integer,0),factura_last=coalesce((p_data->>'factura_last')::integer,0),
   verified=coalesce((p_data->>'verified')::boolean,false),updated_at=now() where store_id=k returning * into s;
  if s.verified and (s.establishment_code is null or s.boleta_series is null or s.factura_series is null) then raise exception 'Falta establecimiento o series.';end if;
  result:=jsonb_build_object('saved',true);
 elsif p_action='product' then
  k:=(p_data->>'product_id')::uuid;
  insert into public.charito_fiscal_products(product_id,affectation,unit_code,multiplier,confirmed)
   values(k,p_data->>'affectation',p_data->>'unit_code',(p_data->>'multiplier')::numeric,true)
   on conflict(product_id) do update set affectation=excluded.affectation,unit_code=excluded.unit_code,multiplier=excluded.multiplier,confirmed=true,updated_at=now();
  result:=jsonb_build_object('saved',true);
 elsif p_action='connector' then
  k:=(p_data->>'store_id')::uuid;
  tok:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  insert into public.charito_sfs_connectors(store_id,token_hash,created_by)
   values(k,sha256(convert_to(tok,'UTF8')),auth.uid())
   on conflict(store_id) do update set token_hash=excluded.token_hash,active=true,expires_at=now()+interval '180 days',last_seen_at=null,created_by=auth.uid()
   returning jsonb_build_object('connector_id',id,'store_id',store_id,'expires_at',expires_at) into result;
  result:=result||jsonb_build_object('token',tok);
 elsif p_action='revoke_connector' then
  update public.charito_sfs_connectors set active=false where store_id=(p_data->>'store_id')::uuid;
  result:=jsonb_build_object('revoked',true);
 else raise exception 'Acción de configuración no válida.';end if;
 -- Never record connector tokens or customer documents in the audit log.
 insert into public.charito_security_audit(actor_id,entity,entity_id,action,after_fields)
 values(auth.uid(),'fiscal_config',coalesce(k::text,'company'),p_action,jsonb_build_object('changed',true));
 return result;
end $$;

drop function if exists public.charito_fiscal_home(uuid,text,text,timestamptz);
create or replace function public.charito_fiscal_home(p_store uuid,p_query text default '',p_status text default '',p_before timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare out_docs jsonb; out_sales jsonb; q text:=left(coalesce(p_query,''),100);
begin
 if not public.charito_can_access_store(p_store) then raise exception 'No tienes acceso a esta tienda.' using errcode='42501';end if;
 select coalesce(jsonb_agg(x order by x.created_at desc,x.id desc),'[]') into out_docs from (
  select id,sale_id,store_id,doc_type,series,number,status,total,igv,base,customer_name,customer_number,created_at,exported_at,response_code,response_description
  from public.charito_fiscal_documents where store_id=p_store and (coalesce(p_status,'')='' or status=p_status)
   and (p_before is null or created_at<p_before or created_at=p_before and p_before_id is not null and id<p_before_id)
   and (q='' or position(lower(q) in lower(series||'-'||number||' '||series||'-'||lpad(number::text,8,'0')||' '||customer_name||' '||customer_number||' '||sale_id::text))>0)
  order by created_at desc,id desc limit 51
 ) x;
 select coalesce(jsonb_agg(x order by x.created_at desc),'[]') into out_sales from (
  select s.id,s.total,s.created_at from public.charito_sales s where s.store_id=p_store and s.status='completed'
   and (s.created_at at time zone 'America/Lima')::date=(now() at time zone 'America/Lima')::date
   and not exists(select 1 from public.charito_fiscal_documents d where d.sale_id=s.id) order by s.created_at desc limit 50
 ) x;
 return jsonb_build_object('version',1,'company',(select to_jsonb(c) from public.charito_fiscal_company c),
  'store',(select to_jsonb(s) from public.charito_fiscal_stores s where store_id=p_store),
  'profiles',(select coalesce(jsonb_agg(p),'[]') from public.charito_fiscal_products p),
  'connector',(select jsonb_build_object('id',id,'active',active,'last_seen_at',last_seen_at,'expires_at',expires_at,'version',version) from public.charito_sfs_connectors where store_id=p_store),
  'documents',out_docs,'sales',out_sales);
end $$;

create or replace function public.charito_fiscal_create(p_sale uuid,p_kind text,p_customer jsonb,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sale public.charito_sales; c public.charito_fiscal_company; st public.charito_fiscal_stores;
 old public.charito_fiscal_documents; l record; mapping public.charito_fiscal_products;
 lines jsonb:='[]'; taxes jsonb:='{}'; snapshot jsonb; customer jsonb; id_new uuid:=gen_random_uuid();
 series_new text; num integer; raw_total numeric:=0; gross numeric; previous_gross numeric:=0; allocated numeric:=0;
 reduction numeric; net numeric; base_line numeric; tax_line numeric; sum_base numeric:=0; sum_tax numeric:=0; rate numeric;
 doc_number text; doc_name text; doc_kind text; emit_at timestamptz:=now(); profile_qty numeric;
begin
 if not public.charito_is_member() then raise exception 'Vuelve a iniciar sesión.' using errcode='42501';end if;
 select * into sale from public.charito_sales where id=p_sale for update;
 if not found or not public.charito_can_access_store(sale.store_id) then raise exception 'Venta no disponible.' using errcode='42501';end if;
 select * into old from public.charito_fiscal_documents where sale_id=p_sale;
 if found then
  if old.request_id=p_request then return jsonb_build_object('id',old.id,'series',old.series,'number',old.number,'reused',true);end if;
  raise exception 'Esta venta ya tiene el comprobante %-% (%). No se emitió otro.',old.series,old.number,old.status;
 end if;
 if p_request is null or p_kind not in ('01','03') then raise exception 'Selecciona boleta o factura.';end if;
 if sale.status<>'completed' or sale.total<=0 then raise exception 'Solo se emiten comprobantes de ventas vigentes con total mayor a cero.';end if;
 if (sale.created_at at time zone 'America/Lima')::date<>(emit_at at time zone 'America/Lima')::date then raise exception 'Esta venta es de otro día. Requiere revisión contable antes de emitir.';end if;
 select * into c from public.charito_fiscal_company where id for share;
 select * into st from public.charito_fiscal_stores where store_id=sale.store_id for update;
 if not c.enabled or not c.eligibility_confirmed or c.igv_rate is null or not st.verified then raise exception 'La emisión SFS de esta tienda todavía no está activada.';end if;
 if not exists(select 1 from public.charito_sfs_connectors where store_id=sale.store_id and active and expires_at>now() and last_seen_at>now()-interval '3 minutes') then raise exception 'El conector SFS de esta tienda está desconectado. Enciende y revisa su PC.';end if;
 if (select coalesce(sum(amount),0) from public.charito_cash_entries where sale_id=p_sale and kind='sale_payment')<>sale.total then raise exception 'Los cobros no coinciden con la venta.';end if;
 if p_customer is null or jsonb_typeof(p_customer)<>'object' or octet_length(p_customer::text)>2000 then raise exception 'Datos del cliente inválidos.';end if;
 doc_kind:=coalesce(p_customer->>'type','0');doc_number:=trim(coalesce(p_customer->>'number',''));doc_name:=trim(coalesce(p_customer->>'name',''));
 if doc_kind='0' then
  if p_kind='01' or sale.total>700 then raise exception 'Identifica al cliente con DNI o RUC para este comprobante.';end if;
  doc_number:='-';doc_name:='CLIENTES VARIOS';
 elsif doc_kind='1' then
  if p_kind='01' or doc_number !~ '^[0-9]{8}$' then raise exception 'El DNI debe tener 8 dígitos; una factura requiere RUC.';end if;
 elsif doc_kind='6' then
  if not public.charito_fiscal_valid_ruc(doc_number) then raise exception 'El RUC no es válido.';end if;
 else raise exception 'Selecciona DNI, RUC o cliente sin documento.';end if;
 if length(doc_name) not between 3 and 250 or doc_name ~ '[\x00-\x1f|]' then raise exception 'Completa el nombre o razón social del cliente.';end if;
 customer:=jsonb_build_object('type',doc_kind,'number',doc_number,'name',doc_name);
 select sum(round(quantity*unit_price,2)) into raw_total from public.charito_sale_lines where sale_id=p_sale;
 if raw_total is null or raw_total-sale.discount<>sale.total then raise exception 'El detalle de la venta no coincide con su total.';end if;
 for l in select sl.*,p.name,p.category,p.sku,p.unit from public.charito_sale_lines sl join public.charito_products p on p.id=sl.product_id where sale_id=p_sale order by sl.product_id loop
  select * into mapping from public.charito_fiscal_products where product_id=l.product_id;
  if not found or not mapping.confirmed then raise exception 'Falta revisar el tratamiento tributario de: %.',l.name;end if;
  if length(l.sku)>30 or length(l.name)>400 or (l.sku||l.name) ~ '[\x00-\x1f|]' then raise exception 'Revisa el código o nombre del producto %.',l.name;end if;
  if l.unit='ciento' and (mapping.unit_code<>'NIU' or mapping.multiplier<>100) then raise exception 'Los bocaditos por ciento deben convertirse a 100 unidades fiscales.';end if;
  gross:=round(l.quantity*l.unit_price,2);previous_gross:=previous_gross+gross;
  reduction:=round(sale.discount*previous_gross/raw_total,2)-allocated;allocated:=allocated+reduction;net:=gross-reduction;
  if net<=0 then raise exception 'Las líneas gratuitas o totalmente descontadas requieren tratamiento tributario especial.';end if;
  rate:=case when mapping.affectation='10' then c.igv_rate else 0 end;
  base_line:=round(net/(1+rate/100),2);tax_line:=net-base_line;
  profile_qty:=l.quantity*mapping.multiplier;
  if mapping.unit_code='NIU' and profile_qty<>trunc(profile_qty) then raise exception 'La unidad fiscal de % requiere cantidades enteras.',l.name;end if;
  lines:=lines||jsonb_build_array(jsonb_build_object('product_id',l.product_id,'code',l.sku,'description',l.category||' · '||l.name,
   'quantity',profile_qty,'unit',mapping.unit_code,'affectation',mapping.affectation,'rate',rate,'gross',net,'base',base_line,'igv',tax_line,
   'unit_value',round(base_line/profile_qty,10),'unit_price',round(net/profile_qty,10),'original_gross',gross,'discount',reduction));
  sum_base:=sum_base+base_line;sum_tax:=sum_tax+tax_line;
 end loop;
 if jsonb_array_length(lines)>100 or sum_base+sum_tax<>sale.total then raise exception 'No se pudo conciliar el detalle tributario.';end if;
 if p_kind='03' then
  num:=st.boleta_last+1;series_new:=st.boleta_series;update public.charito_fiscal_stores set boleta_last=num where store_id=st.store_id;
 else num:=st.factura_last+1;series_new:=st.factura_series;update public.charito_fiscal_stores set factura_last=num where store_id=st.store_id;end if;
 if series_new is null then raise exception 'Falta la serie de este tipo de comprobante.';end if;
 snapshot:=jsonb_build_object('schema',1,'ruc',c.ruc,'legal_name',c.legal_name,'address',c.address,'ubigeo',c.ubigeo,
  'establishment_code',st.establishment_code,'type',p_kind,'series',series_new,'number',num,'currency','PEN',
  'emission_date',to_char(emit_at at time zone 'America/Lima','YYYY-MM-DD'),'emission_time',to_char(emit_at at time zone 'America/Lima','HH24:MI:SS'),
  'customer',customer,'lines',lines,'base',sum_base,'igv',sum_tax,'total',sale.total,'sale_discount',sale.discount,'prices_include_vat',true);
 insert into public.charito_fiscal_documents(id,sale_id,store_id,request_id,doc_type,series,number,total,igv,base,customer_name,customer_number,snapshot,created_by)
 values(id_new,sale.id,sale.store_id,p_request,p_kind,series_new,num,sale.total,sum_tax,sum_base,doc_name,doc_number,snapshot,auth.uid());
 insert into public.charito_security_audit(actor_id,entity,entity_id,action,after_fields)
 values(auth.uid(),'fiscal_document',id_new::text,'queued',jsonb_build_object('sale_id',sale.id,'series',series_new,'number',num,'total',sale.total));
 return jsonb_build_object('id',id_new,'series',series_new,'number',num,'status','queued');
end $$;

create or replace function public.charito_fiscal_detail(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare d public.charito_fiscal_documents;
begin
 select * into d from public.charito_fiscal_documents where id=p_id;
 if not found or not public.charito_can_access_store(d.store_id) then raise exception 'Comprobante no disponible.' using errcode='42501';end if;
 return (to_jsonb(d)-array['lease_id','lease_until','connector_id','request_id'])||jsonb_build_object('files',
 (select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'path',path,'sha256',sha256,'bytes',bytes)),'[]') from public.charito_fiscal_files where document_id=d.id));
end $$;

create or replace function public.charito_fiscal_cancel(p_id uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare d public.charito_fiscal_documents;
begin
 if not public.charito_is_admin() then raise exception 'Solo el administrador puede cancelar una solicitud sin exportar.' using errcode='42501';end if;
 if length(trim(p_reason)) not between 5 and 300 then raise exception 'Indica el motivo de cancelación.';end if;
 select * into d from public.charito_fiscal_documents where id=p_id for update;
 if not found or d.status not in ('queued','blocked') or d.exported_at is not null then raise exception 'El comprobante ya entró al proceso SFS; requiere revisión fiscal.';end if;
 update public.charito_fiscal_documents set status='cancelled',response_description=trim(p_reason),updated_at=now() where id=d.id;
 insert into public.charito_security_audit(actor_id,entity,entity_id,action,after_fields) values(auth.uid(),'fiscal_document',p_id::text,'cancelled',jsonb_build_object('reason',trim(p_reason)));
end $$;

create or replace function public.charito_sfs_agent(p_token text,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.charito_sfs_connectors; d public.charito_fiscal_documents; j jsonb; x xml; code text; ref text; recipient text; description text; current_lease uuid; k text;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Conector no autorizado.' using errcode='42501';end if;
 select * into a from public.charito_sfs_connectors where token_hash=sha256(convert_to(p_token,'UTF8')) and active and expires_at>now();
 if not found then raise exception 'Conector no autorizado.' using errcode='42501';end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>180000 then raise exception 'Solicitud demasiado grande o inválida.';end if;
 update public.charito_sfs_connectors set last_seen_at=now(),version=left(coalesce(p_data->>'version',version),40) where id=a.id;
 if p_action='heartbeat' then return jsonb_build_object('store_id',a.store_id,'ruc','00000000000');end if;
 if p_action='poll' then
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'snapshot',snapshot,'status',status,'exported_at',exported_at)),'[]') into j
   from (select * from public.charito_fiscal_documents where store_id=a.store_id and connector_id=a.id and exported_at is not null and status in ('exported','needs_review') order by created_at limit 100) q;
  select * into d from public.charito_fiscal_documents where store_id=a.store_id
   and (status='queued' or status='preparing' and lease_until<now())
   and exists(select 1 from public.charito_fiscal_company where enabled)
   and exists(select 1 from public.charito_fiscal_stores where store_id=a.store_id and verified)
   order by created_at for update skip locked limit 1;
  if found then
   current_lease:=gen_random_uuid();update public.charito_fiscal_documents set status='preparing',connector_id=a.id,lease_id=current_lease,lease_until=now()+interval '5 minutes',updated_at=now() where id=d.id;
  end if;
  return jsonb_build_object('store_id',a.store_id,'ruc','00000000000','pending',j,'job',case when d.id is null then null else jsonb_build_object('id',d.id,'snapshot',d.snapshot,'lease',current_lease) end);
 end if;
 select * into d from public.charito_fiscal_documents where id=(p_data->>'id')::uuid and store_id=a.store_id and connector_id=a.id for update;
 if not found then raise exception 'Comprobante no asignado a este conector.' using errcode='42501';end if;
 if p_action='preparation_error' then
  if d.status<>'preparing' or d.lease_id is distinct from (p_data->>'lease')::uuid then raise exception 'Reserva no vigente.';end if;
  update public.charito_fiscal_documents set status='blocked',response_description=left(p_data->>'message',1000),updated_at=now() where id=d.id;
  return jsonb_build_object('saved',true);
 elsif p_action='export' then
  if d.status='exported' and d.lease_id=(p_data->>'lease')::uuid then return jsonb_build_object('exported',true);end if;
  if d.status<>'preparing' or d.lease_id is distinct from (p_data->>'lease')::uuid or d.lease_until<=now() then raise exception 'La reserva de exportación caducó. Vuelve a sincronizar.';end if;
  if not exists(select 1 from public.charito_fiscal_company where enabled) or not exists(select 1 from public.charito_fiscal_stores where store_id=a.store_id and verified) then raise exception 'La emisión fue desactivada por el administrador.';end if;
  update public.charito_fiscal_documents set status='exported',exported_at=now(),updated_at=now() where id=d.id;
  return jsonb_build_object('exported',true);
 elsif p_action='result' then
  if d.status not in ('exported','needs_review','accepted','rejected') then raise exception 'El comprobante aún no se exportó.';end if;
  k:=p_data->>'cdr_xml';
  if k is null or octet_length(k)>128000 or k ~* '<!\s*(DOCTYPE|ENTITY)' then raise exception 'Constancia XML no válida.';end if;
  x:=xmlparse(document k);
  code:=(xpath('string(/*[local-name()="ApplicationResponse"]/*[local-name()="DocumentResponse"]/*[local-name()="Response"]/*[local-name()="ResponseCode"])',x))[1]::text;
  ref:=(xpath('string(/*[local-name()="ApplicationResponse"]/*[local-name()="DocumentResponse"]/*[local-name()="DocumentReference"]/*[local-name()="ID"])',x))[1]::text;
  recipient:=(xpath('string(/*[local-name()="ApplicationResponse"]/*[local-name()="ReceiverParty"]/*[local-name()="PartyIdentification"]/*[local-name()="ID"])',x))[1]::text;
  description:=(xpath('string(/*[local-name()="ApplicationResponse"]/*[local-name()="DocumentResponse"]/*[local-name()="Response"]/*[local-name()="Description"])',x))[1]::text;
  if ref<>d.series||'-'||d.number or recipient<>'00000000000' or code !~ '^[0-9]{1,5}$' then raise exception 'La constancia no corresponde al comprobante o al RUC.';end if;
  if d.cdr_xml is not null and d.cdr_xml<>k then raise exception 'Ya existe una constancia distinta. Requiere revisión.';end if;
  update public.charito_fiscal_documents set status=case when code='0' then 'accepted' when code::integer between 2000 and 3999 then 'rejected' else 'needs_review' end,
   response_code=code,response_description=left(description,1000),cdr_xml=k,updated_at=now() where id=d.id;
  insert into public.charito_security_audit(actor_id,entity,entity_id,action,after_fields)
   values(a.created_by,'fiscal_document',d.id::text,'sfs_cdr',jsonb_build_object('code',code,'connector_id',a.id));
  return jsonb_build_object('saved',true,'accepted',code='0');
 elsif p_action='review' then
  if d.status in ('exported','needs_review') then update public.charito_fiscal_documents set status='needs_review',response_description=left(p_data->>'message',1000),updated_at=now() where id=d.id;end if;
  return jsonb_build_object('saved',true);
 elsif p_action='authorize_file' then
  if d.status not in ('exported','accepted','rejected','needs_review') or p_data->>'kind' not in ('signed.xml','cdr.xml','representation.pdf') then raise exception 'Archivo no autorizado.';end if;
  return jsonb_build_object('store_id',d.store_id,'document_id',d.id,'ruc','00000000000','reference',d.series||'-'||d.number,'path',d.store_id||'/'||d.id||'/'||(p_data->>'kind'));
 else raise exception 'Acción del conector no válida.';end if;
end $$;

create or replace function public.charito_fiscal_protect_sale() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.charito_fiscal_documents where sale_id=old.id and status<>'cancelled') then
  raise exception 'La venta tiene un comprobante fiscal en proceso o emitido. No se puede eliminar; revisa la nota de crédito o regularización fiscal con el administrador.';
 end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
drop trigger if exists charito_fiscal_protect_sale on public.charito_sales;
create trigger charito_fiscal_protect_sale before update or delete on public.charito_sales for each row execute function public.charito_fiscal_protect_sale();

-- Private XML/CDR/PDF storage. Only the server-side charito-sfs function uploads.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('charito-fiscal','charito-fiscal',false,5242880,array['application/xml','application/pdf']) on conflict(id) do nothing;
drop policy if exists charito_fiscal_files_read on storage.objects;
create policy charito_fiscal_files_read on storage.objects for select to authenticated using(
 bucket_id='charito-fiscal' and exists(select 1 from public.charito_stores s where s.id::text=split_part(name,'/',1) and public.charito_can_access_store(s.id))
);
-- Keep uploaded-file metadata writable only from the Edge Function service role.
grant usage on schema public to authenticated,anon,service_role;
revoke all on function public.charito_fiscal_valid_ruc(text),public.charito_fiscal_admin(text,jsonb),public.charito_fiscal_home(uuid,text,text,timestamptz,uuid),public.charito_fiscal_create(uuid,text,jsonb,uuid),public.charito_fiscal_detail(uuid),public.charito_fiscal_cancel(uuid,text),public.charito_sfs_agent(text,text,jsonb),public.charito_fiscal_protect_sale() from public,anon,authenticated;
grant execute on function public.charito_fiscal_admin(text,jsonb),public.charito_fiscal_home(uuid,text,text,timestamptz,uuid),public.charito_fiscal_create(uuid,text,jsonb,uuid),public.charito_fiscal_detail(uuid),public.charito_fiscal_cancel(uuid,text) to authenticated;
-- Connector capabilities are scoped by a revocable, 244-bit random token, never a service key.
grant execute on function public.charito_sfs_agent(text,text,jsonb) to anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
select 'Módulo SFS instalado. Emisión desactivada hasta configurar y verificar.' as resultado;
