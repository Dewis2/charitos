import {FISCAL_STATUS,fiscalReference,customerIssue,fiscalReadiness} from './fiscal-model.js';
export function createFiscal(ctx){
 const {db,dialogs,esc,money,date,notice}=ctx;
 let home=null,scope='',owner='',generation=0,loading=false,missing=false,error='',query='',status='',pageBefore=null,trail=[],searchTimer,productQuery='',lastDetail=null,loadedAt=0;
 const state=()=>ctx.state(),admin=()=>state().me?.role==='admin';
 const same=(who,store,run)=>state().user?.id===who&&state().storeId===store&&run===generation&&ctx.ready();
 const label=(text,input)=>`<label>${text}${input}</label>`;
 const htmlInput=(name,value='',extra='')=>`<input name="${name}" value="${esc(value)}" ${extra}>`;
 const choice=(name,options,value)=>`<select name="${name}">${options.map(([id,title])=>`<option value="${id}" ${id===value?'selected':''}>${title}</option>`).join('')}</select>`;
 const badge=d=>`<span class="fiscal-status fiscal-${esc(d.status)}">${esc(FISCAL_STATUS[d.status]||d.status)}</span>`;
 function clear(){generation++;home=null;scope='';owner='';loading=false;missing=false;error='';query='';status='';trail=[];pageBefore=null;lastDetail=null;productQuery='';clearTimeout(searchTimer);}
 async function rpc(name,args){await ctx.guard();const r=await db.rpc(name,args);if(r.error){const e=new Error(r.error.code==='PGRST202'||r.error.code==='42883'?'Falta instalar la actualización 20 de comprobantes en Supabase.':r.error.message);e.missing=['PGRST202','42883'].includes(r.error.code);throw e;}return r.data;}
 async function enter(view,force=false){
  if(view!=='comprobantes'||!ctx.ready())return;
  const s=state();if(scope!==s.storeId||owner!==s.user?.id){clear();scope=s.storeId;owner=s.user?.id;}
  if(loading||home&&!force&&Date.now()-loadedAt<15000)return;loading=true;error='';const run=generation,who=owner,store=scope;
  if(!dialogs.element)ctx.render();
  try{const data=await rpc('charito_fiscal_home',{p_store:store,p_query:query,p_status:status,p_before:pageBefore?.time||null,p_before_id:pageBefore?.id||null});if(same(who,store,run)){home=data;missing=false;loadedAt=Date.now();}}
  catch(e){if(same(who,store,run)){error=e.message;missing=!!e.missing;}}
  finally{if(same(who,store,run)){loading=false;if(state().view==='comprobantes'&&!dialogs.element)ctx.render();}}
 }
 function view(){
  if(scope!==state().storeId||owner!==state().user?.id)return '<section class="card"><p role="status">Cargando comprobantes…</p></section>';
  if(!home)return `<section class="card fiscal-empty"><h2>${missing?'Módulo pendiente de activar':'Comprobantes electrónicos'}</h2><p role="status">${esc(error||'Cargando…')}</p>${!loading?'<button type="button" class="secondary" data-fiscal-refresh>Volver a comprobar</button>':''}</section>`;
  const ready=fiscalReadiness(home),a=home.connector,docs=(home.documents||[]).slice(0,50);
  return `<div class="fiscal-page"><section class="card fiscal-overview"><div><span class="fiscal-eyebrow">Facturador SUNAT · RUC ${esc(home.company.ruc)}</span><p class="small muted">Precios con IGV incluido</p></div><div class="fiscal-overview-actions"><span class="fiscal-status ${ready?'fiscal-needs_review':'fiscal-accepted'}">${esc(ready||'Listo para emitir')}</span>${admin()?'<button type="button" class="secondary" data-fiscal-config>Configurar</button>':''}</div></section>
   ${error?`<p class="warn" role="alert">${esc(error)}</p>`:''}
   <section class="card"><div class="fiscal-section-title"><h2>Comprobantes</h2><span class="small muted">${a?.last_seen_at?'PC sincronizada '+date(a.last_seen_at):'PC sin sincronizar'}</span></div><form class="fiscal-filters" data-form="fiscal_search">${label('Buscar',htmlInput('query',query,'type="search" placeholder="Serie, cliente, documento o venta" maxlength="100"'))}${label('Estado',choice('status',[['','Todos'],...Object.entries(FISCAL_STATUS)],status))}<button type="submit" class="secondary">Buscar</button></form>
   <div class="fiscal-document-list">${docs.length?docs.map(d=>`<article class="fiscal-row"><div><strong>${esc(fiscalReference(d))}</strong><small>${d.doc_type==='03'?'Boleta':'Factura'} · ${date(d.created_at)}</small></div><div class="fiscal-row-customer">${esc(d.customer_name)}<small>${esc(d.customer_number==='-'?'':d.customer_number)}</small></div><div>${badge(d)}</div><strong class="fiscal-amount">${money(d.total)}</strong><button type="button" class="secondary" data-fiscal-detail="${d.id}">Ver</button></article>`).join(''):'<p class="empty">No hay comprobantes para esta búsqueda.</p>'}</div>
   <div class="fiscal-pagination">${trail.length?'<button type="button" class="secondary" data-fiscal-prev>Anterior</button>':''}${home.documents.length>50?'<button type="button" class="secondary" data-fiscal-next>Siguiente</button>':''}</div></section>
   <section class="card"><div class="fiscal-section-title"><h2>Ventas de hoy sin comprobante</h2><span class="small muted">${home.sales.length}${home.sales.length===50?'+':''}</span></div><div class="fiscal-sale-list">${home.sales.length?home.sales.map(s=>`<div class="fiscal-row"><span><strong>Venta ${esc(s.id.slice(0,8))}</strong><small>${date(s.created_at)}</small></span><strong>${money(s.total)}</strong><button type="button" class="secondary" data-fiscal-sale="${s.id}" ${ready?'disabled':''}>Emitir</button></div>`).join(''):'<p class="empty">Sin ventas pendientes de hoy.</p>'}</div></section></div>`;
 }
 async function issue(saleId){
  const s=state(),who=s.user?.id,store=s.storeId,run=generation;
  const h=await rpc('charito_fiscal_home',{p_store:store});if(!same(who,store,run))return;
  home=h;scope=store;owner=who;
  const existing=h.documents.find(d=>d.sale_id===saleId);if(existing){await detail(existing.id);return;}
  const sale=h.sales.find(x=>x.id===saleId)||s.data.sales?.find(x=>x.id===saleId);
  if(!sale)throw Error('No se encontró una venta de hoy disponible para emitir.');
  const unavailable=fiscalReadiness(h);if(unavailable)throw Error(unavailable+'. El administrador debe revisar la configuración SFS.');
  const lines=s.data.sales?.find(x=>x.id===saleId)?.charito_sale_lines||[];
  const incomplete=lines.find(l=>!h.profiles.some(p=>p.product_id===l.product_id&&p.confirmed));
  if(incomplete)throw Error('Falta revisar los impuestos de un producto de esta venta. Abre Comprobantes → Configurar → Productos.');
  dialogs.open({key:'fiscal-issue',title:'Emitir comprobante',body:`<form data-form="fiscal_issue" data-id="${esc(saleId)}" data-store="${esc(store)}" data-request="${crypto.randomUUID()}"><div class="fiscal-issue-total"><span>Venta ${esc(saleId.slice(0,8))}<small>Total con IGV</small></span><strong>${money(sale.total)}</strong></div><div class="fields">${label('Comprobante',choice('kind',[['03','Boleta electrónica'],['01','Factura electrónica']],'03'))}${label('Documento del cliente',choice('customer_type',[['0','Sin documento'],['1','DNI'],['6','RUC']],Number(sale.total)>700?'1':'0'))}</div><div data-fiscal-identity ${Number(sale.total)<=700?'hidden':''}><div class="fields">${label('Número',htmlInput('customer_number','','inputmode="numeric" maxlength="11" autocomplete="off"'))}${label('Nombre o razón social',htmlInput('customer_name','','maxlength="250" autocomplete="off"'))}</div></div><div class="work-form-actions"><button type="button" class="secondary" data-dialog-close>Cancelar</button><button>Emitir ${money(sale.total)}</button></div></form>`});
  const f=dialogs.element.querySelector('form');f.dataset.total=sale.total;syncIdentity(f);
 }
 function syncIdentity(f){if(!f)return;const invoice=f.elements.kind.value==='01',select=f.elements.customer_type;
  if(invoice)select.value='6';for(const o of select.options)o.disabled=invoice&&o.value!=='6'||Number(f.dataset.total)>700&&o.value==='0';
  const anonymous=select.value==='0',host=f.querySelector('[data-fiscal-identity]');host.hidden=anonymous;
  f.elements.customer_number.required=!anonymous;f.elements.customer_name.required=!anonymous;f.elements.customer_number.maxLength=select.value==='1'?8:11;
 }
 async function detail(id){
  const s=state(),who=s.user?.id,store=s.storeId,run=generation;
  const token=dialogs.open({key:'fiscal-detail',title:'Detalle del comprobante',body:'<p role="status">Cargando…</p>'});
  const d=await rpc('charito_fiscal_detail',{p_id:id});if(!same(who,store,run)||!dialogs.is('fiscal-detail'))return;
  lastDetail=d;const v=d.snapshot;
  const files=(d.files||[]).map(f=>`<button type="button" class="secondary" data-fiscal-file="${esc(f.kind)}">${({'signed.xml':'XML firmado','cdr.xml':'Constancia CDR','representation.pdf':'PDF de SFS'})[f.kind]}</button>`).join('');
  const body=`<div class="fiscal-detail"><div class="fiscal-section-title"><div><h3>${esc(fiscalReference(d))}</h3><p>${d.doc_type==='03'?'Boleta de venta electrónica':'Factura electrónica'}</p></div>${badge(d)}</div><p>${esc(v.customer.name)}<br><span class="small muted">${esc(v.customer.number==='-'?'':v.customer.number)}</span></p><div class="fiscal-line-items">${v.lines.map(l=>`<div class="summaryrow"><span>${esc(l.quantity)} ${esc(l.unit)} × ${esc(l.description)}</span><strong>${money(l.gross)}</strong></div>`).join('')}</div><div class="fiscal-totals"><div class="summaryrow"><span>Valor de venta</span><span>${money(d.base)}</span></div><div class="summaryrow"><span>IGV</span><span>${money(d.igv)}</span></div><div class="summaryrow total"><strong>Total</strong><strong>${money(d.total)}</strong></div></div>${d.response_description?`<p class="${d.status==='accepted'?'small muted':'warn'}">${esc(d.response_code||'')} ${esc(d.response_description)}</p>`:''}${d.status==='exported'?'':''}<div class="actions">${files}${d.cdr_xml&&!d.files?.some(f=>f.kind==='cdr.xml')?'<button type="button" class="secondary" data-fiscal-cdr>Descargar CDR</button>':''}${admin()&&['queued','blocked'].includes(d.status)?'<button type="button" class="danger" data-fiscal-cancel>Cancelar solicitud sin exportar</button>':''}</div></div>`;
  dialogs.update('fiscal-detail',body,token);
 }
 function productResults(){const products=state().data.products||[],tokens=productQuery.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').split(/\s+/).filter(Boolean);
  const matched=products.filter(p=>tokens.every(t=>(p.sku+' '+p.category+' '+p.name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').includes(t))).slice(0,8);
  return matched.map(p=>{const mapping=home.profiles.find(m=>m.product_id===p.id);return `<button type="button" class="fiscal-product-result secondary" data-fiscal-product="${p.id}"><span><strong>${esc(p.name)}</strong><small>${esc(p.category)} · ${esc(p.sku)}</small></span><span>${mapping?.confirmed?'Revisado':'Pendiente'}</span></button>`;}).join('')||'<p class="empty">No se encontraron productos.</p>';
 }
 function configuration(){if(!admin())throw Error('Solo el administrador configura comprobantes.');
  const s=home.store,c=home.company,a=home.connector;
  dialogs.open({key:'fiscal-config',title:'Configuración de comprobantes',wide:true,body:`<div class="fiscal-settings"><div class="fiscal-config-options"><button type="button" class="secondary" data-fiscal-company>Empresa e impuestos<span>${esc(c.legal_name)}</span></button><button type="button" class="secondary" data-fiscal-store>Series y establecimiento<span>${esc(state().data.stores.find(x=>x.id===scope)?.name||'Tienda')} · ${esc(s.establishment_code||'Código pendiente')}</span></button><button type="button" class="secondary" data-fiscal-connector>Conectar la PC de esta tienda<span>${a?.last_seen_at?'Última conexión: '+date(a.last_seen_at):'Sin conexión registrada'}</span></button>${a?.active?'<button type="button" class="secondary" data-fiscal-revoke>Revocar acceso del conector</button>':''}</div><section><h3>Impuestos y unidad de los productos</h3><label>Buscar producto<input type="search" data-fiscal-product-search value="${esc(productQuery)}" placeholder="Nombre, categoría o código" autocomplete="off"></label><div class="fiscal-product-results" data-fiscal-product-results>${productResults()}</div></section></div>`});
 }
 function companyForm(){const c=home.company;dialogs.open({key:'fiscal-company',title:'Empresa e impuestos',body:`<form data-form="fiscal_company">${label('RUC',htmlInput('ruc',c.ruc,'disabled'))}${label('Razón social',htmlInput('legal_name',c.legal_name,'required maxlength="150"'))}${label('Dirección fiscal',htmlInput('address',c.address,'required maxlength="250"'))}<div class="fields">${label('Ubigeo fiscal',htmlInput('ubigeo',c.ubigeo,'required inputmode="numeric" pattern="[0-9]{6}" maxlength="6"'))}${label('Tasa de IGV (%)',htmlInput('igv_rate',c.igv_rate??'','required type="number" min="0.01" max="30" step="0.01" placeholder="Confirmar con contabilidad"'))}</div><p class="small muted">Los precios del catálogo ya incluyen IGV.</p><label class="check"><input type="checkbox" name="eligibility_confirmed" ${c.eligibility_confirmed?'checked':''}><span>Confirmé en SOL que este RUC puede usar SEE-SFS.</span></label><label class="check"><input type="checkbox" name="enabled" ${c.enabled?'checked':''}><span>Activar emisión real. Verifiqué SFS, certificado, series e impuestos mediante pruebas previas.</span></label><div class="work-form-actions"><button type="button" class="secondary" data-fiscal-config>Volver</button><button>Guardar</button></div></form>`});}
 function storeForm(){const s=home.store;dialogs.open({key:'fiscal-store',title:'Series de esta tienda',body:`<form data-form="fiscal_store" data-store="${esc(scope)}">${label('Código del establecimiento SUNAT',htmlInput('establishment_code',s.establishment_code||'','pattern="[0-9]{4}" maxlength="4" inputmode="numeric" placeholder="Confirmar en Ficha RUC"'))}<div class="fields">${label('Serie de boletas',htmlInput('boleta_series',s.boleta_series||'','pattern="B[A-Z0-9]{3}" maxlength="4" placeholder="B…" autocapitalize="characters"'))}${label('Último número utilizado',htmlInput('boleta_last',s.boleta_last,'type="number" min="0" max="99999998" step="1" required'))}${label('Serie de facturas',htmlInput('factura_series',s.factura_series||'','pattern="F[A-Z0-9]{3}" maxlength="4" placeholder="F…" autocapitalize="characters"'))}${label('Último número utilizado',htmlInput('factura_last',s.factura_last,'type="number" min="0" max="99999998" step="1" required'))}</div><label class="check"><input type="checkbox" name="verified" ${s.verified?'checked':''}><span>Contrasté establecimiento, series y números con SUNAT. Esta PC usa SFS de producción.</span></label><div class="work-form-actions"><button type="button" class="secondary" data-fiscal-config>Volver</button><button>Guardar</button></div></form>`});}
 function productForm(id){const p=state().data.products.find(p=>p.id===id);if(!p)throw Error('Producto no disponible.');const m=home.profiles.find(m=>m.product_id===id)||{};
  dialogs.open({key:'fiscal-product',title:p.name,body:`<form data-form="fiscal_product" data-id="${p.id}">${label('Tratamiento tributario',choice('affectation',[['','Selecciona y verifica'],['10','Gravado con IGV'],['20','Exonerado'],['30','Inafecto']],m.affectation||''))}${label('Unidad fiscal',choice('unit_code',[['NIU','Unidad (NIU)'],['KGM','Kilogramo (KGM)'],['LTR','Litro (LTR)']],m.unit_code||'NIU'))}${label('Unidades fiscales por cada '+esc(p.unit),htmlInput('multiplier',m.multiplier??(p.unit==='ciento'?100:1),'type="number" min="0.001" max="1000" step="0.001" required'))}${p.unit==='ciento'?'<p class="small muted">1 ciento = 100 unidades. Medio ciento se emitirá como 50 unidades.</p>':''}<div class="work-form-actions"><button type="button" class="secondary" data-fiscal-config>Volver</button><button>Guardar revisión</button></div></form>`});
 }
 async function download(name,contents,mime){
  if(window.AndroidHost?.saveDocument&&mime==='application/json'){const e=window.AndroidHost.saveDocument(contents,name,mime);if(e)throw Error(e);return;}
  if(window.AndroidHost?.saveBinary){const bytes=typeof contents==='string'?new TextEncoder().encode(contents):new Uint8Array(await contents.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));const e=window.AndroidHost.saveBinary(btoa(binary),name,mime);if(e)throw Error(e);return;}
  const blob=contents instanceof Blob?contents:new Blob([contents],{type:mime}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
 }
 async function submit(action,f){if(!action.startsWith('fiscal_'))return false;const x=Object.fromEntries(new FormData(f)),who=state().user?.id,store=state().storeId,run=generation;
  if(action==='fiscal_search'){query=x.query.trim();status=x.status;trail=[];pageBefore=null;await enter('comprobantes',true);return true;}
  if(action==='fiscal_issue'){
   if(f.dataset.store!==store)throw Error('La tienda cambió. Vuelve a abrir la emisión.');
   const problem=customerIssue(x.kind,x.customer_type,x.customer_number.trim(),x.customer_name.trim(),f.dataset.total);if(problem)throw Error(problem);
   const d=await rpc('charito_fiscal_create',{p_sale:f.dataset.id,p_kind:x.kind,p_customer:{type:x.customer_type,number:x.customer_number.trim(),name:x.customer_name.trim()},p_request:f.dataset.request});
   if(!same(who,store,run))return true;dialogs.close();home=null;notice(`Comprobante ${fiscalReference(d)} en cola de SFS.`);if(state().view==='comprobantes')await enter('comprobantes',true);return true;
  }
  if(!admin())throw Error('Solo el administrador puede configurar comprobantes.');
  let operation,payload;
  if(action==='fiscal_company'){operation='company';payload={...x,enabled:f.elements.enabled.checked,eligibility_confirmed:f.elements.eligibility_confirmed.checked};}
  else if(action==='fiscal_store'){operation='store';payload={...x,store_id:f.dataset.store,verified:f.elements.verified.checked};}
  else if(action==='fiscal_product'){if(!x.affectation)throw Error('Selecciona el tratamiento tributario.');operation='product';payload={...x,product_id:f.dataset.id};}
  else if(action==='fiscal_cancel'){
   await rpc('charito_fiscal_cancel',{p_id:f.dataset.id,p_reason:x.reason.trim()});if(same(who,store,run)){dialogs.close();home=null;await enter('comprobantes',true);notice('Solicitud cancelada. El correlativo no se reutilizará.');}return true;
  }else return false;
  await rpc('charito_fiscal_admin',{p_action:operation,p_data:payload});if(!same(who,store,run))return true;
  dialogs.close();home=null;await enter('comprobantes',true);notice('Configuración guardada.');return true;
 }
 async function click(b){
  if(![...b.attributes].some(a=>a.name.startsWith('data-fiscal-')))return false;
  if(b.disabled)return true;
  const who=state().user?.id,store=state().storeId,run=generation;b.disabled=true;
  try{
   if(b.hasAttribute('data-fiscal-refresh')){await enter('comprobantes',true);return true;}
   if(b.hasAttribute('data-fiscal-sale')){await issue(b.dataset.fiscalSale);return true;}
   if(scope!==store||owner!==who)throw Error('La tienda cambió. Espera a que se actualicen sus comprobantes.');
   if(b.hasAttribute('data-fiscal-detail')){await detail(b.dataset.fiscalDetail);return true;}
   if(b.hasAttribute('data-fiscal-next')){trail.push(pageBefore);pageBefore={time:home.documents[49].created_at,id:home.documents[49].id};await enter('comprobantes',true);return true;}
   if(b.hasAttribute('data-fiscal-prev')){pageBefore=trail.pop()??null;await enter('comprobantes',true);return true;}
   if(b.hasAttribute('data-fiscal-file')){
    const currentDetail=lastDetail,f=currentDetail?.files.find(f=>f.kind===b.dataset.fiscalFile);if(!f)throw Error('Archivo no disponible.');await ctx.guard();
    const r=await db.storage.from('charito-fiscal').createSignedUrl(f.path,60);if(r.error)throw Error(r.error.message);
    const response=await fetch(r.data.signedUrl);if(!response.ok)throw Error('No se pudo descargar el archivo.');const blob=await response.blob();
    if(same(who,store,run))await download(fiscalReference(currentDetail)+'-'+f.kind,blob,f.kind.endsWith('.pdf')?'application/pdf':'application/xml');return true;
   }
   if(b.hasAttribute('data-fiscal-cdr')){if(lastDetail?.cdr_xml)await download(fiscalReference(lastDetail)+'-cdr.xml',lastDetail.cdr_xml,'application/xml');return true;}
   if(!admin())throw Error('Configuración exclusiva del administrador.');
   if(b.hasAttribute('data-fiscal-config')){if(!home)throw Error('Actualiza el módulo.');configuration();}
   else if(b.hasAttribute('data-fiscal-company'))companyForm();
   else if(b.hasAttribute('data-fiscal-store'))storeForm();
   else if(b.hasAttribute('data-fiscal-product'))productForm(b.dataset.fiscalProduct);
   else if(b.hasAttribute('data-fiscal-connector')){
    if(home.connector?.active&&!window.confirm('¿Reemplazar la conexión de esta tienda? El acceso anterior dejará de funcionar.'))return true;
    const result=await rpc('charito_fiscal_admin',{p_action:'connector',p_data:{store_id:scope}});if(!same(who,store,run))return true;
    const contents=JSON.stringify({schema:1,url:db.supabaseUrl,public_key:db.supabaseKey,store_id:scope,store_name:state().data.stores.find(s=>s.id===scope)?.name,...result},null,2);
    await download('charito-sfs-conexion.json',contents,'application/json');dialogs.close();home=null;await enter('comprobantes',true);notice('Conexión descargada. Ábrela en el conector de la PC de esta tienda.');
   }else if(b.hasAttribute('data-fiscal-revoke')){
    if(!window.confirm('¿Revocar el acceso de la PC de esta tienda?'))return true;
    await rpc('charito_fiscal_admin',{p_action:'revoke_connector',p_data:{store_id:scope}});if(same(who,store,run)){dialogs.close();home=null;await enter('comprobantes',true);notice('Conector revocado.');}
   }else if(b.hasAttribute('data-fiscal-cancel'))dialogs.open({key:'fiscal-cancel',title:'Cancelar solicitud sin exportar',body:`<form data-form="fiscal_cancel" data-id="${esc(lastDetail.id)}">${label('Motivo','<textarea name="reason" required minlength="5" maxlength="300"></textarea>')}<p class="small muted">El número quedará reservado y no se reutilizará. Revisa con contabilidad su regularización.</p><div class="work-form-actions"><button type="button" class="secondary" data-dialog-close>Volver</button><button class="danger">Cancelar solicitud</button></div></form>`});
   return true;
  }finally{if(b.isConnected)b.disabled=false;}
 }
 function input(e){
  const f=e.target.closest('[data-form="fiscal_issue"]');if(f&&e.type==='change'&&['kind','customer_type'].includes(e.target.name))syncIdentity(f);
  if(e.target.hasAttribute('data-fiscal-product-search')&&e.type==='input'){productQuery=e.target.value;const target=dialogs.element?.querySelector('[data-fiscal-product-results]');if(target)target.innerHTML=productResults();}
 }
 setInterval(()=>{if(state().view==='comprobantes'&&ctx.ready()&&navigator.onLine&&!document.hidden&&!dialogs.element&&!ctx.root.querySelector('[data-busy],input:focus,select:focus,textarea:focus'))void enter('comprobantes',true);},20000);
 return {view,enter,clear,click,input,submit};
}
