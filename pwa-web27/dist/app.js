import {createShiftEntry} from './shift-entry.js';
import {NAV_LABELS,renderNavigation} from './navigation.js';
import {createWorkshop} from './workshop.js';
import {canWorkshop,canReports,canView,initialView,workshopOnly,ROLE_LABELS} from './workshop-model.js';
import {createWorkDialogs} from './work-dialogs.js';
import {createDateTimePicker} from './date-time-picker.js';
import {createFiscal} from './fiscal.js';
import {createControl} from './control.js';
import {createAdminReports} from './admin-reports.js';
import {createSecurity} from './security.js';
import {createComfort} from './comfort.js';
import {storeLabel,pickStore,mergeShifts,formDrafts,restoreDrafts} from './session.js';
import {createUpgrade} from './v2.js';
import {createUsers,loginEmail,loginError,setupInstall,hasStoreAssignments} from './users.js';
const db=window.supabase.createClient('https://example-project.supabase.co','sb_publishable_REPLACE_ME',{auth:{storage:sessionStorage,storageKey:'charito-auth-v2',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
const root=document.querySelector('#app');
const currencyFormat=new Intl.NumberFormat('es-PE',{style:'currency',currency:'PEN'});
const money=n=>currencyFormat.format(Number(n||0));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=s=>new Date(s).toLocaleString('es-PE',{timeZone:'America/Lima'});
let user=null,me=null,data={},storeId='',view='inicio',preview=null,accessibleStores=[],shiftContext={},syncBusy=false,lastSync=0;
let loadQueue=Promise.resolve(),pendingLoads=0;
const load=()=>{pendingLoads++;const task=loadQueue.then(loadData).finally(()=>pendingLoads--);loadQueue=task.catch(()=>{});return task;};
const savedStore=()=>{try{return localStorage.getItem('charito-store-'+user.id);}catch{return null;}};
const rememberStore=()=>{try{localStorage.setItem('charito-store-'+user.id,storeId);}catch{}};
const canClose=()=>!!shift()&&(shiftContext.shift?.id===shift().id&&typeof shiftContext.can_close==='boolean'
  ?shiftContext.can_close:shift().responsible_id===user?.id||me?.role==='admin'||me?.role==='manager'&&accessibleStores.some(s=>s.id===storeId));
const tabs=NAV_LABELS;
const kinds={workshop_delivery:'Entrega del taller',discard:'Descarte',redecorate_out:'Envío a redecorar',redecorate_in:'Retorno del taller',portion_out:'Torta porcionada',portion_in:'Porciones obtenidas',transfer_out:'Transferencia enviada',transfer_in:'Transferencia recibida',adjustment:'Ajuste',order_delivery:'Entrega de pedido',inventory_yape:'Yape de inventario',order_payment:'Pago de pedido',expense:'Egreso',other_income:'Otro ingreso',pickup:'Retiro del encargado'};
const getProduct=id=>data.products?.find(x=>x.id===id);
const productName=id=>{const p=getProduct(id);return p?`${p.category} · ${p.name}`:'Producto';};
const storeName=id=>data.stores?.find(x=>x.id===id)?.name||'Tienda';
const shift=()=>data.shifts?.find(x=>x.store_id===storeId&&x.status==='open');
const counts=()=>data.counts?.filter(x=>x.shift_id===shift()?.id)||[];
const qtyInput=(name,value='',step='1',min='0',required=true)=>`<input name="${esc(name)}" type="number" inputmode="decimal" min="${min}" step="${step}" value="${esc(value)}" ${required?'required':''}>`;
const field=(label,input)=>input.includes("data-picker")?`<div class="field"><span class="field-label">${label}</span>${input}</div>`:`<div class="field"><label>${label}${input}</label></div>`;
const text=(name,placeholder='',required=true)=>`<input name="${name}" placeholder="${esc(placeholder)}" ${required?'required':''}>`;
const select=(name,items,blank=false)=>`<select name="${name}" ${blank?'':'required'}>${blank?'<option value="">Selecciona…</option>':''}${items.map(([id,label])=>`<option value="${esc(id)}">${esc(label)}</option>`).join('')}</select>`;
const products=(name,filter=()=>true,blank=false)=>comfort.picker(name,(data.products||[]).filter(filter),blank);
const confirmCount=label=>`<label class="check"><input type="checkbox" required><span>${label}</span></label>`;
const noShift=()=>`<div class="warn">Abre el turno en “Abrir y ver turno” para registrar operaciones en ${esc(storeName(storeId))}.</div>`;
const table=(heads,rows)=>`<div class="tablewrap"><table><thead><tr>${heads.map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(mark=>{let i=0;return mark.replace(/<td(?=[ >])/g,()=>`<td data-label="${esc(heads[i++%heads.length])}"`);}).join(''):`<tr><td colspan="${heads.length}" class="empty">Sin registros.</td></tr>`}</tbody></table></div>`;
const row=cells=>`<tr>${cells.map(x=>`<td>${x}</td>`).join('')}</tr>`;
function notice(message,error=false){const el=document.querySelector('#notice');el.className=`notice ${error?'error':''}`;el.textContent=message;clearTimeout(notice.timer);notice.timer=setTimeout(()=>{el.className='';el.textContent='';},error?9000:3000);}
const dialogs=createWorkDialogs({root,esc,state:()=>({user,me}),notice,discard:f=>comfort.discard(f)});
const dates=createDateTimePicker({root,esc});
function login(message=''){root.innerHTML=`<main class="login"><h1>Charito</h1><h2>Tiendas y caja</h2>${message?`<div class="warn">${esc(message)}</div>`:''}<form data-form="login">${field('Usuario', '<input name="email" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="Usuario o correo de acceso anterior" required>')}${field('Contraseña','<input name="password" type="password" autocomplete="current-password" required>')}<label class="check"><input type="checkbox" data-login-show-password><span>Mostrar contraseña</span></label><button>Entrar</button></form></main>`;}
async function read(name,query){const r=await query;if(r.error)throw new Error(`${name}: ${r.error.message}`);return r.data||[];}
async function readPaged(name,query){const rows=[];for(let start=0;start<100000;start+=800){const page=await read(name,query.range(start,start+799));rows.push(...page);if(page.length<800)return rows;}throw new Error(`${name}: demasiados registros para esta vista; contacta al administrador.`);}
async function loadData(){
  const owner=user?.id,requestedStore=storeId,preference=requestedStore||savedStore();
  if(!owner)throw Error('Vuelve a iniciar sesión.');
  await security.guard();
  const nextMe=(await read('Usuario',db.from('charito_members').select('*').eq('user_id',owner)))[0];
  if(!nextMe?.active)throw new Error('Este usuario no tiene acceso activo. Consulta al administrador.');
  if(workshopOnly(nextMe.role)){
    if(user?.id!==owner||storeId!==requestedStore||!security.ready)return false;
    me=nextMe;data=Object.fromEntries(['stores','products','shifts','orders','balances','transfers','returns','bags','sales','counts','movements','cash','closures'].map(k=>[k,[]]));
    accessibleStores=[];storeId='';shiftContext={};preview=null;
    if(!canView(nextMe.role,view))view=initialView(nextMe.role);
    lastSync=Date.now();return true;
  }
  const names=['stores','products','shifts','orders','balances','transfers','returns','bags','open','assigned'];
  const results=await Promise.all([
    read('Tiendas',db.from('charito_stores').select('*').eq('active',true).order('name')),
    readPaged('Productos',db.from('charito_products').select('*').eq('active',true).order('sku')),
    read('Turnos cerrados',db.from('charito_shifts').select('*').eq('status','closed').order('opened_at',{ascending:false}).limit(100)),
    readPaged('Pedidos',db.from('charito_orders').select('*,version').order('due_at').order('id')),
    readPaged('Saldos de pedidos',db.rpc('charito_order_balances').order('order_id')),
    read('Transferencias',db.from('charito_transfers').select('*,charito_transfer_lines(*)').eq('status','in_transit')),
    read('Taller',db.rpc('charito_pending_workshop')),
    read('Bolsas',db.from('charito_bags').select('*').is('received_at',null)),
    read('Turnos abiertos',db.from('charito_shifts').select('*').eq('status','open')),
    read('Tiendas asignadas',db.from('charito_store_members').select('store_id').eq('user_id',owner))
  ]);const next={};names.forEach((n,i)=>next[n]=results[i]);
  next.stores.forEach(s=>s.name=storeLabel(s.name));next.shifts=mergeShifts(next.shifts,next.open);
  const nextStores=hasStoreAssignments(nextMe.role)?next.stores.filter(s=>next.assigned.some(a=>a.store_id===s.id)):next.stores;
  if(!nextStores.length)throw new Error('No tienes una tienda activa asignada. Consulta al administrador.');
  const nextStore=pickStore(nextStores,next.shifts,owner,preference);
  const shared=await db.rpc('charito_shift_context',{p_store:nextStore}),nextContext=shared.error?{}:shared.data||{};
  if(shared.error&&!['PGRST202','42883'].includes(shared.error.code))throw new Error('No se pudo comprobar el turno compartido: '+shared.error.message);
  if(nextContext.shared_version){next.shifts=mergeShifts(next.shifts,[...next.shifts.filter(s=>s.status==='open'&&s.store_id!==nextStore),...(nextContext.shift?[nextContext.shift]:[])]);}
  if(next.shifts.filter(s=>s.store_id===nextStore&&s.status==='open').length>1)throw new Error('La tienda tiene más de un turno abierto. Un administrador debe revisar los turnos antes de operar.');
  const ids=next.shifts.map(x=>x.id),active=next.shifts.filter(x=>x.status==='open').map(x=>x.id);
  if(next.orders.some(o=>o.version===undefined))throw new Error('Falta activar la actualización: ejecuta el script 05 en Supabase.');
  [next.sales,next.counts,next.movements,next.cash,next.closures]=await Promise.all([
    active.length?readPaged('Ventas',db.from('charito_sales').select('*,charito_sale_lines(*)').in('shift_id',active).order('created_at',{ascending:false}).order('id')):[],
    active.length?readPaged('Conteos',db.from('charito_counts').select('*').in('shift_id',active).order('product_id').order('shift_id')):[],
    active.length?readPaged('Movimientos',db.from('charito_stock_movements').select('*').in('shift_id',active).order('created_at',{ascending:false}).order('id')):[],
    active.length?readPaged('Caja',db.from('charito_cash_entries').select('*').in('shift_id',active).order('created_at',{ascending:false}).order('id')):[],
    ids.length?read('Cierres',db.from('charito_closures').select('*').in('shift_id',ids)):[]
  ]);
  let nextPreview=null;const current=next.shifts.find(s=>s.store_id===nextStore&&s.status==='open'),currentCounts=next.counts.filter(c=>c.shift_id===current?.id);
  if(current&&currentCounts.length&&(current.sales_mode==='direct'&&currentCounts.some(c=>c.physical_closing_qty!=null)||currentCounts.every(c=>c.closing_qty!==null))){
    const r=await db.rpc('charito_preview_close',{p_shift:current.id});nextPreview=r.error?{error:r.error.message}:r.data;
  }
  // Publish a complete snapshot only while it still belongs to this identity/store.
  // A background read must never restore the previous account after logout.
  if(user?.id!==owner||storeId!==requestedStore||!security.ready)return false;
  delete next.members;delete next.open;delete next.assigned;
  const sameData=JSON.stringify(data)===JSON.stringify(next),changed=!sameData||JSON.stringify(me)!==JSON.stringify(nextMe)||storeId!==nextStore||JSON.stringify(shiftContext)!==JSON.stringify(nextContext)||JSON.stringify(preview)!==JSON.stringify(nextPreview);
  if(!sameData)data=next;if(!me)view=initialView(nextMe.role);me=nextMe;accessibleStores=nextStores;storeId=nextStore;shiftContext=nextContext;preview=nextPreview;rememberStore();lastSync=Date.now();return changed;
}
function countsTable(mode){const opening=mode==='opening';const entries=opening?data.products.map(p=>({product_id:p.id,opening_qty:0,closing_qty:null,price_snapshot:p.price})):counts();return table(['Producto','Precio','Inicial',opening?'Conteo de apertura':'Conteo final'],entries.map(c=>{
  const p=getProduct(c.product_id);return row([`<div class="countname">${esc(p?.name)}<small>${esc(p?.category)} · ${esc(p?.unit)}${p?.unit==='ciento'?' · 0,5 = 50 unidades':''}</small></div>`,money(c.price_snapshot),esc(c.opening_qty),qtyInput(c.product_id,opening?'':c.closing_qty??'',p?.quantity_step||1,'0',false)]);
}));}
function inicio(){const s=shift();if(!data.products.length)return `<div class="warn">Falta cargar el catálogo de productos. Ejecuta el script 04 en Supabase antes de abrir un turno.</div>`;
  if(!s)return `<div class="card"><h2>Abrir turno en ${esc(storeName(storeId))}</h2><form data-form="open_shift"><div class="fields">${field('Turno',select('label',[['Mañana','Mañana'],['Tarde','Tarde']]))}${field('Sencillo contado al iniciar',qtyInput('opening_float',200,'0.01'))}</div>${countsTable('opening')}${confirmCount('Revisé todos los productos. Los campos vacíos corresponden a cero.') }<button>Abrir turno</button></form></div>`;
  const cash=data.cash.filter(x=>x.shift_id===s.id);const yape=cash.filter(x=>x.method==='yape').reduce((a,x)=>a+Number(x.amount),0);
  return `<div class="cards"><div class="card"><small>Turno abierto</small><div class="metric">${esc(s.label)}</div><p class="muted">${date(s.opened_at)}</p></div><div class="card"><small>Fondo inicial</small><div class="metric">${money(s.opening_float)}</div></div><div class="card"><small>Yapes registrados</small><div class="metric">${money(yape)}</div></div></div><div class="grid"><div class="card"><h2>Durante el turno</h2><div class="actions"><button data-nav="movimientos">Registrar movimiento</button><button class="secondary" data-nav="caja">Registrar cobro o egreso</button></div></div><div class="card"><h2>Al terminar</h2><button data-nav="inventario">Completar conteo final</button></div></div>`;
}
function inventario(){if(!shift())return noShift();return `<div class="card"><h2>Conteo físico final</h2>${comfort.countStatus()}<form data-form="final_counts" data-id="${shift().id}">${countsTable('closing')}${confirmCount('Revisé todos los productos. Los campos vacíos corresponden a cero.')}<button>Guardar conteo final</button></form></div>`;}
function movimientos(){if(!shift())return noShift();const options=['workshop_delivery','discard','redecorate_out',...(me.role==='admin'?['adjustment']:[])];const returns=data.returns.filter(x=>x.store_id===storeId&&Number(x.quantity_sent)>Number(x.quantity_returned)+Number(x.quantity_written_off));return `<div class="grid"><div class="card"><h2>Entrada o salida</h2><form data-form="movement">${field('Movimiento',select('kind',options.map(k=>[k,kinds[k]])))}${field('Producto',products('product_id'))}${field('Cantidad',qtyInput('qty','','0.5','-100000'))}${field('Motivo o número de viaje',text('reason','Ej.: viaje 2 / producto dañado'))}<button>Registrar movimiento</button></form></div><div class="card"><h2>Cortar una torta</h2><form data-form="portion">${field('Torta entera',products('source_product_id',p=>p.can_portion))}${field('Tortas que se cortan',qtyInput('source_qty','','1','1'))}${field('Porción obtenida',products('output_product_id',p=>p.category==='Porciones'))}${field('Cantidad de porciones',qtyInput('output_qty','','1','1'))}<button>Registrar porcionado</button></form></div><div class="card full"><h2>Pendientes del taller</h2>${returns.length?returns.map(w=>`<div class="listitem"><strong>${esc(productName(w.product_id))}</strong><p>Pendiente: ${Number(w.quantity_sent)-Number(w.quantity_returned)-Number(w.quantity_written_off)} · ${esc(w.reason)}</p><form data-form="return_workshop" data-id="${w.id}"><div class="fields">${field('Cantidad',qtyInput('qty','','0.5','0.5'))}${field('Resolución',select('resolution',[['return_workshop','Retornó a la tienda'],...(me.role==='admin'?[['write_off_workshop','No retornará / baja']]:[])]))}${field('Motivo',text('reason'))}</div><button>Guardar resolución</button></form></div>`).join(''):'<p class="muted">No hay productos pendientes de retorno.</p>'}</div></div>`;}
function transferencias(){if(!shift())return noShift();const incoming=data.transfers.filter(t=>t.destination_store_id===storeId);const outgoing=data.transfers.filter(t=>t.source_store_id===storeId);return `<div class="grid"><div class="card"><h2>Enviar a otra tienda</h2><form data-form="send_transfer">${field('Destino',select('destination_store_id',data.stores.filter(x=>x.id!==storeId).map(x=>[x.id,x.name])))}${field('Producto',products('product_id'))}${field('Cantidad',qtyInput('qty','','0.5','0.5'))}${confirmCount('Confirmo que el producto salió de esta tienda.')}<button>Enviar transferencia</button></form></div><div class="card"><h2>Por recibir</h2>${incoming.length?incoming.map(t=>`<div class="listitem"><strong>Desde ${esc(storeName(t.source_store_id))}</strong><p>${t.charito_transfer_lines.map(l=>`${esc(productName(l.product_id))}: ${esc(l.quantity)}`).join('<br>')}</p><form data-form="receive_transfer" data-id="${t.id}">${confirmCount('Recibí físicamente todos los productos indicados.')}<button>Confirmar recepción</button></form></div>`).join(''):'<p class="muted">No hay transferencias pendientes.</p>'}</div><div class="card full"><h2>En tránsito desde esta tienda</h2>${outgoing.map(t=>`<p>${esc(storeName(t.destination_store_id))} · ${t.charito_transfer_lines.map(l=>`${esc(productName(l.product_id))}: ${esc(l.quantity)}`).join(', ')} · ${date(t.sent_at)}</p>`).join('')||'<p class="muted">No hay envíos pendientes.</p>'}</div></div>`;}
function pedidos(){return `<div class="grid"><div class="card"><h2>Nuevo pedido</h2><form data-form="new_order">${field('Código del contrato',text('code'))}${field('Cliente',text('customer_name'))}${field('Teléfono',text('customer_phone','',false))}${field('Fecha y hora de entrega (Perú)','<input name="due_at" type="datetime-local" required>')}${field('Precio completo',qtyInput('total','','0.01'))}${field('Descripción','<textarea name="description" required></textarea>')}<button>Crear pedido</button></form></div><div class="card"><h2>Pedidos pendientes · ambas tiendas</h2>${data.orders.map(o=>{const paid=Number(data.balances.find(b=>b.order_id===o.id)?.paid||0);return `<div class="listitem"><strong>${esc(o.code)} · ${esc(o.customer_name)}</strong><p>${esc(o.description)}</p><p class="small">${date(o.due_at)} · ${esc(storeName(o.store_id))}</p><p>Total ${money(o.total)} · Saldo <strong>${money(Number(o.total)-paid)}</strong></p>${shift()?`<button class="secondary" data-pay="${o.id}">Registrar pago</button>${Number(o.total)-paid===0?`<form data-form="deliver_order" data-id="${o.id}">${field('Producto del inventario (opcional)',products('product_id',()=>true,true))}${field('Cantidad',qtyInput('qty',1,'0.5','0.5'))}${confirmCount('Confirmo que entregué el pedido al cliente.')}<button>Marcar entregado</button></form>`:''}`:''}</div>`;}).join('')||'<p class="muted">No hay pedidos pendientes.</p>'}</div></div>`;}
function caja(){if(!shift())return noShift();const cash=data.cash.filter(x=>x.shift_id===shift().id);return `<div class="grid"><div class="card"><h2>Registrar dinero</h2><form data-form="cash">${field('Tipo',select('kind',['inventory_yape','order_payment','expense','other_income','pickup'].map(k=>[k,kinds[k]])))}${field('Medio de pago',select('method',[['yape','Yape'],['cash','Efectivo']]))}${field('Pedido (solo para pagos de pedidos)',select('order_id',data.orders.map(o=>[o.id,`${o.code} · ${o.customer_name}`]),true))}${field('Monto',qtyInput('amount','','0.01','0.01'))}${field('Concepto',text('description'))}${field('Referencia Yape o nombre de quien recoge',text('reference','',false))}<button>Registrar</button></form></div><div class="card"><h2>Movimientos del turno</h2>${table(['Concepto','Medio','Monto','Estado'],cash.map(e=>row([`${esc(kinds[e.kind])}<br><small>${esc(e.description)}</small>`,esc(e.method),money(e.amount),e.method==='yape'?(e.yape_verified?'<span class="badge">Verificado</span>':`${me.role!=='worker'?`<button data-verify="${e.id}">Verificar</button>`:'Pendiente'}`):'—'])))}</div></div>`;}
function cierre(){if(!shift())return noShift();if(!preview||preview.error)return `<div class="warn">${esc(preview?.error||'Primero completa y guarda el conteo físico final.')}</div><button data-nav="inventario">Revisar inventario final</button>`;return `<div class="grid"><div class="card"><h2>Efectivo esperado</h2>${[['Fondo inicial',preview.opening_float],['Venta por inventario',preview.sales],['Yape de inventario',-preview.inventory_yape],['Pedidos cobrados en efectivo',preview.cash_orders],['Otros ingresos',preview.other_income],['Egresos',-preview.expenses],['Retiros del encargado',-preview.pickups]].map(([l,n])=>`<div class="summaryrow"><span>${l}</span><strong>${money(n)}</strong></div>`).join('')}<div class="summaryrow total"><span>Efectivo esperado al cierre</span><strong>${money(preview.expected_cash)}</strong></div></div><div class="card"><h2>Contar y cerrar</h2><form data-form="close_shift">${field('Sencillo reservado para el siguiente turno',qtyInput('float_left',200,'0.01'))}${field('Efectivo contado para dejar en bolsa',qtyInput('bag_amount','','0.01'))}<div id="difference" class="warn">Ingresa lo contado para comparar.</div>${field('Explicación si falta o sobra','<textarea name="explanation"></textarea>')}${confirmCount('Confirmo el conteo y el efectivo. El turno quedará cerrado y bloqueado.')}<button>Cerrar turno</button></form></div></div>`;}
function historial(){const relevant=data.shifts.filter(s=>s.store_id===storeId);return `<div class="stack"><div class="card"><h2>Bolsas pendientes de recoger</h2>${data.bags.filter(b=>relevant.some(s=>s.id===b.shift_id)).map(b=>`<div class="listitem"><strong>${esc(b.label)} · ${money(b.amount)}</strong>${me.role!=='worker'?`<form data-form="receive_bag" data-id="${b.id}">${confirmCount('Confirmo que recogí esta bolsa.')}<button>Registrar recogida</button></form>`:''}</div>`).join('')||'<p class="muted">No hay bolsas pendientes.</p>'}</div><div class="card"><h2>Cierres recientes</h2>${table(['Turno','Cierre','Venta','Efectivo esperado','Diferencia'],data.closures.filter(c=>relevant.some(s=>s.id===c.shift_id)).map(c=>row([esc(relevant.find(s=>s.id===c.shift_id)?.label),date(c.created_at),money(c.inventory_sales),money(c.expected_cash),`${money(c.difference)}<br><small>${esc(c.explanation)}</small>`])))}${me.role==='admin'?'<button class="secondary" data-export>Descargar datos visibles</button>':''}</div></div>`;}
function productosView(){return `<div class="stack"><div class="card"><h2>Catálogo</h2>${comfort.catalog()}</div>${me.role==='admin'?`<div class="card"><h2>Agregar producto</h2><form data-form="product"><div class="fields">${field('Código único',text('sku'))}${field('Nombre',text('name'))}${field('Categoría',select('category',[...new Set(data.products.map(p=>p.category)),...(data.products.length?[]:['Vainilla','Tres leches','Selva negra','Heladas','Otros','Pasteles','Bocaditos','Porciones','Bebidas','Velas','Adornos'])].map(x=>[x,x])))}${field('Precio',qtyInput('price','','0.01'))}${field('Unidad',select('unit',[['unidad','Unidad'],['ciento','Ciento (paquetes de 50)']]))}</div><button>Agregar producto</button></form></div>`:''}</div>`;}
function render(){
 const menuOpen=!!root.querySelector('.shell.menu-open');dates.clear();dialogs.clear();comfort.flush();
 if(!canView(me?.role,view))view=initialView(me?.role);
 if(view==='recetas'&&!canWorkshop(me?.role))view='inicio';
 if(['stock_general','reporte_ventas'].includes(view)&&!canReports(me?.role)||view==='control'&&me?.role!=='admin')view=initialView(me?.role);
 const isReport=['stock_general','reporte_ventas','control'].includes(view),isWorkshop=!isReport&&(view==='recetas'||workshopOnly(me?.role)),isEntry=view==='elegir_turno',s=shift();
 if(!workshopOnly(me?.role)){comfort.hydrate();v2.ensureCartShift();}
 const views={elegir_turno:entry.view,inicio,ventas:v2.sales,inventario,stock_general:reports.stockView,reporte_ventas:reports.salesView,movimientos,transferencias,pedidos:v2.orders,caja,cierre,historial,productos:productosView,usuarios:users.view,seguridad:security.view,control:control.view,comprobantes:fiscal.view,recetas:workshop.view};
 const bottom=workshopOnly(me.role)?(canReports(me.role)?[['stock_general','Stock'],['reporte_ventas','Ventas'],['recetas','Recetas']]:[['recetas','Recetas'],['seguridad','Mi cuenta']]):[['ventas','Vender'],['pedidos','Pedidos'],me.role==='admin'?['stock_general','Stock']:['inventario','Conteo']];
 root.innerHTML=`${!navigator.onLine?'<div class="connection">Sin conexión. No se pueden guardar operaciones; vuelve a conectarte y actualiza.</div>':''}<div class="shell${menuOpen?' menu-open':''}"><div class="mobile-bar"><strong>Charito</strong><button type="button" class="secondary" data-menu aria-label="Abrir menú" aria-expanded="${menuOpen}">☰ Menú</button></div><aside class="sidebar" id="main-menu"><div class="brand">Charito<span class="small">’s</span></div><nav>${renderNavigation(me.role,view,esc)}</nav><div class="user"><span>${esc(me.display_name)}<br>${esc(ROLE_LABELS[me.role]||me.role)}</span><button data-logout class="secondary">Cerrar sesión</button></div></aside><main class="content"><header class="topbar">${isReport?'<strong>Administración</strong>':isWorkshop?'<strong>Taller y almacén</strong>':isEntry?'<strong>Tiendas y caja</strong>':`<div class="shift-header-context"><strong>${esc(storeName(storeId))}</strong><span class="status">${view==='comprobantes'?'Comprobantes electrónicos':s?`${esc(s.label)} · Abierto · ${esc(shiftContext.responsible_name||(s.responsible_id===user.id?me.display_name:'Responsable asignado'))}`:'Sin turno abierto'}</span></div><button type="button" class="secondary shift-context-button" data-nav="elegir_turno">Cambiar tienda / turno</button>`}<button class="secondary" data-refresh>Actualizar</button><span class="sync-status small muted" data-sync-status role="status" aria-live="polite"></span></header><div class="page-title"><h1>${tabs[view]}</h1>${isReport||isWorkshop||isEntry?'':comfort.statusHtml()}</div>${s&&!isReport&&!isWorkshop&&['inicio','cierre'].includes(view)?`<div class="shift-banner"><span><strong>${esc(storeName(storeId))} · ${esc(s.label)}</strong><small>Abierto ${date(s.opened_at)} · Responsable: ${esc(shiftContext.responsible_name||(s.responsible_id===user.id?me.display_name:'otro usuario de la tienda'))}</small></span><span class="badge">${canClose()?'Puedes cerrar este turno':'Turno compartido · cierre del responsable'}</span></div>`:''}${!isReport&&!isWorkshop&&!shiftContext.shared_version&&s&&s.responsible_id!==user.id&&me.role==='worker'?'<div class="warn">Este turno ya está abierto. Para trabajar con otros usuarios, el administrador debe aplicar la actualización 10 de Supabase. No abras otro turno.</div>':''}${!isReport&&!isWorkshop&&me.role==='admin'&&view==='inicio'?'<div class="report-shortcuts"><button data-nav="stock_general">Consultar stock sin abrir turno</button><button class="secondary" data-nav="reporte_ventas">Reporte de ventas</button></div>':''}${views[view]()}</main><nav class="bottom-nav" aria-label="Navegación principal">${bottom.map(([id,label])=>`<button type="button" data-nav="${id}" aria-current="${view===id?'page':'false'}">${label}</button>`).join('')}<button type="button" data-menu>Menú</button></nav></div>`;
 if(!isWorkshop){v2.applyFilters();comfort.afterRender();v2.afterRender();dates.mount();entry.applyLabel();}
 if(s&&s.responsible_id!==user.id&&me.role==='worker'&&!shiftContext.shared_version)root.querySelectorAll('form button[type=submit],form button:not([type]),form input,form select,form textarea').forEach(e=>e.disabled=true);
 root.querySelectorAll('.tablewrap:not(.inventory-wrap) table').forEach(t=>{const heads=[...t.querySelectorAll('thead th')].map(h=>h.textContent);t.querySelectorAll('tbody tr').forEach(tr=>[...tr.children].forEach((td,i)=>td.dataset.label=heads[i]||''));});paintSync();
}
async function operate(action,payload,form){await security.guard();if(!navigator.onLine)throw new Error('No hay conexión. Conserva el formulario y vuelve a intentar.');const serialized=JSON.stringify(payload);let request=form?.dataset.request;if(!request||form.dataset.payload!==serialized){request=crypto.randomUUID();if(form){form.dataset.request=request;form.dataset.payload=serialized;}}
 comfort.saving();const result=await db.rpc('charito_operate',{p_action:action,p_data:payload,p_request:request});if(result.error){comfort.failed();throw Object.assign(new Error(result.error.message),{code:result.error.code});}comfort.committed(form);return result.data;}
root.addEventListener('submit',async e=>{e.preventDefault();const f=e.target;const action=f.dataset.form;if(!action||f.dataset.busy)return;f.dataset.busy='1';const buttons=[...f.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);try{comfort.validate(f);dates.validate(f);comfort.flush();const x=Object.fromEntries(new FormData(f));if(action==='login'){const r=await db.auth.signInWithPassword({email:loginEmail(x.email),password:x.password});if(r.error)throw Error(loginError(r.error));user=r.data.user;f.elements.password.value='';f.elements.password.type='password';f.querySelector('[data-login-show-password]').checked=false;if(!(await security.start()))return;await load();view=initialView(me.role);render();reports.enter(view);control.enter(view);fiscal.enter(view);workshop.enter(view);return;}await security.guard();if(await workshop.submit(action,f))return;if(await fiscal.submit(action,f))return;if(await control.submit(action,f))return;if(await users.submit(action,x,f))return;if(await v2.submit(action,x,f))return;
 let a=action,p={...x,shift_id:shift()?.id};
 if(action==='open_shift'){await load();if(shift()){render();notice('Esta tienda ya tiene un turno abierto. Continúa el turno existente.');return;}p={store_id:storeId,label:x.label,opening_float:Number(x.opening_float),sales_mode:x.sales_mode||'direct',counts:data.products.map(pr=>({product_id:pr.id,qty:Number(x[pr.id]||0)}))};}
 if(action==='final_counts'){
  const s=shift();if(!s||s.id!==f.dataset.id)throw Error('El turno cambió. Abre el conteo del turno actual.');
  p={shift_id:s.id,counts:counts().map(c=>({product_id:c.product_id,qty:Number(x[c.product_id]||0)}))};
  if(x.inventory_revision) p.inventory_revision=x.inventory_revision;
 }
 if(action==='send_transfer')p={shift_id:shift().id,destination_store_id:x.destination_store_id,lines:[{product_id:x.product_id,qty:Number(x.qty)}]};
 if(action==='portion')p={shift_id:shift().id,source_product_id:x.source_product_id,source_qty:Number(x.source_qty),outputs:[{product_id:x.output_product_id,qty:Number(x.output_qty)}]};
 if(action==='return_workshop'){a=x.resolution;p={shift_id:shift().id,id:f.dataset.id,qty:Number(x.qty),reason:x.reason};}
 if(['receive_transfer','receive_bag'].includes(action))p={shift_id:shift()?.id,id:f.dataset.id};
 if(action==='new_order')p={...x,store_id:storeId,total:Number(x.total),due_at:new Date(`${x.due_at}:00-05:00`).toISOString()};
 if(action==='cash'){if(['expense','other_income','pickup'].includes(x.kind))x.method='cash';if(x.kind==='inventory_yape')x.method='yape';if(x.kind==='order_payment'&&!x.order_id)throw new Error('Selecciona el pedido al que corresponde el pago.');p={...x,shift_id:shift().id,amount:Number(x.amount),order_id:x.kind==='order_payment'?x.order_id:null};if(x.kind!=='order_payment')p.order_id=null;}
 if(action==='deliver_order'){p={id:f.dataset.id,shift_id:shift().id};if(x.product_id){p.product_id=x.product_id;p.qty=Number(x.qty);}}
 if(action==='close_shift'){
  const s=shift();if(!s||s.id!==f.dataset.id||!canClose())throw Error('Solo el responsable o un encargado asignado puede cerrar este turno.');
  if(!x.inventory_revision)delete p.inventory_revision;
 }
 if(action==='product')p={...x,step:x.unit==='ciento'?0.5:1,can_portion:['Vainilla','Tres leches','Selva negra','Heladas'].includes(x.category)};
 if(action==='edit_product'){a='product';p={id:f.dataset.id,name:x.name,category:x.category,price:Number(x.price)};}
 const operation=await operate(a,p,f);if(action==='final_counts')comfort.countsSaved();if(['open_shift','close_shift','final_counts'].includes(action))v2.clearCounts();comfort.flush();await load();
 if(action==='final_counts'&&e.submitter?.hasAttribute('data-sell-after-count'))view='ventas';
 render();notice(operation?.reused?'Esta tienda ya tenía un turno abierto. Se cargó el turno existente.':action==='close_shift'?'Turno cerrado y guardado.':action==='final_counts'?'Conteo guardado. El turno sigue abierto.':'Registro guardado.');
 }catch(err){if(err.code==='40001'&&['final_counts','close_shift'].includes(action)){try{await load();comfort.discard(f);if(action==='final_counts')v2.clearCounts();render();}catch{}}comfort.failed();notice(err.message,true);}finally{delete f.dataset.busy;buttons.forEach(b=>b.disabled=false);v2.updatePaymentView();}});
root.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;try{if(b.hasAttribute('data-menu')){const open=root.querySelector('.shell').classList.toggle('menu-open');b.setAttribute('aria-expanded',String(open));return;}if(dates.click(b))return;if(dialogs.click(b))return;if(await install.click(b))return;if(await entry.click(b))return;if(await workshop.click(b))return;if(await reports.click(b))return;if(await fiscal.click(b))return;if(await control.click(b))return;if(b.hasAttribute('data-users-refresh')){b.disabled=true;await users.refresh();render();return;}if(await users.click(b))return;if(await comfort.click(b))return;if(await v2.click(b))return;
 if(b.dataset.nav){
  if(!user||!me||!security.ready)return;
  if(!canView(me.role,b.dataset.nav))throw Error('No tienes permiso para abrir esta sección.');
  if(b.dataset.nav==='elegir_turno')entry.reset();comfort.flush();if(b.dataset.nav!=='ventas')v2.stopVoice();
  root.querySelector('.shell')?.classList.remove('menu-open');view=b.dataset.nav;render();window.scrollTo(0,0);
  // Paint the requested screen before optional network refreshes.
  requestAnimationFrame(()=>{
   reports.enter(view);control.enter(view);fiscal.enter(view);workshop.enter(view);
   if(view==='usuarios'){const owner=user.id;void users.refresh().then(()=>{if(user?.id===owner&&view==='usuarios'&&security.ready&&!dialogs.element){const drafts=formDrafts(root);render();restoreDrafts(root,drafts);}}).catch(err=>notice(err.message,true));}
   void syncSession(view==='cierre');
  });
 }
 else if(b.hasAttribute('data-logout')){comfort.flush();await db.auth.signOut();comfort.reset();user=null;storeId='';data={};shiftContext={};v2.clearCart();v2.clearCounts();users.clear();reports.clear();control.clear();fiscal.clear();workshop.clear();entry.reset();view='inicio';login();}
 else if(b.hasAttribute('data-refresh')){if(view==='recetas'){await workshop.enter(view,true);return;}if(view==='comprobantes'){await fiscal.enter(view,true);return;}if(view==='control'){await control.enter(view,true);return;}if(['stock_general','reporte_ventas'].includes(view)){await reports.refresh();return;}b.disabled=true;comfort.flush();const before=shift()?.id,drafts=formDrafts(root);await load();render();if(before===shift()?.id)restoreDrafts(root,drafts);v2.updatePaymentView();notice('Datos actualizados.');}
 else if(b.dataset.pay){await v2.detail(b.dataset.pay,'payments');}
 else if(b.dataset.verify){b.disabled=true;await operate('verify_yape',{id:b.dataset.verify},b);await load();render();notice('Yape verificado.');}
 else if(b.dataset.edit){if(me.role!=='admin')throw Error('Solo el administrador puede editar el catálogo.');const p=getProduct(b.dataset.edit);if(!p)throw Error('Producto no encontrado. Actualiza los datos.');dialogs.open({key:'product',title:`Editar ${p.name}`,body:`<form data-form="edit_product" data-id="${p.id}"><div class="fields">${field('Nombre',`<input name="name" required value="${esc(p.name)}">`)}${field('Categoría',`<input name="category" required value="${esc(p.category)}">`)}${field('Precio para próximos turnos (S/)',qtyInput('price',p.price,'0.01'))}</div><div class="work-form-actions"><button type="button" class="secondary" data-dialog-close>Cancelar</button><button>Guardar cambios</button></div></form>`});}

 else if(b.hasAttribute('data-export')){if(me?.role!=='admin')throw Error('Solo el administrador puede descargar datos.');await security.guard();const url=URL.createObjectURL(new Blob([JSON.stringify({exported_at:new Date().toISOString(),...data},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='charito-datos-visibles.json';a.click();URL.revokeObjectURL(url);}
 }catch(err){comfort.failed();notice(err.message,true);b.disabled=false;}});
root.addEventListener('change',async e=>{if(e.target.hasAttribute('data-login-show-password')){e.target.form.elements.password.type=e.target.checked?'text':'password';return;}workshop.input(e);dates.input(e);reports.input(e);control.input(e);fiscal.input(e);users.input(e);v2.input(e);comfort.input(e);if(e.target.id==='store'){if(comfort.hasCart()&&!window.confirm('Tienes una venta sin guardar. ¿Descartar esta venta y cambiar de tienda?')){e.target.value=storeId;return;}comfort.flush();v2.clearCart();storeId=e.target.value;rememberStore();try{await load();render();fiscal.enter(view,true);}catch(err){notice(err.message,true);}}const f=e.target.closest('[data-form="cash"]');if(f&&e.target.name==='kind'){const k=f.elements.kind.value;f.elements.order_id.required=k==='order_payment';if(['expense','other_income','pickup'].includes(k))f.elements.method.value='cash';if(k==='inventory_yape')f.elements.method.value='yape';f.elements.method.disabled=['expense','other_income','pickup','inventory_yape'].includes(k);}});
root.addEventListener('input',e=>{workshop.input(e);dates.input(e);reports.input(e);control.input(e);fiscal.input(e);users.input(e);v2.input(e);comfort.input(e);if(e.target.closest('[data-form="close_shift"]')){const f=e.target.closest('form');const difference=Number(f.elements.float_left.value||0)+Number(f.elements.bag_amount.value||0)-Number(preview.expected_cash);const out=document.querySelector('#difference');if(out)out.textContent=`${difference===0?'Cuadra':difference<0?'Falta':'Sobra'}: ${money(Math.abs(difference))}`;f.elements.explanation.required=difference!==0||Number(preview.stock_variance_count||0)>0;}});
window.addEventListener('offline',()=>notice('Sin conexión: no se guardarán operaciones hasta reconectar.',true));window.addEventListener('online',()=>notice('Conexión recuperada. Pulsa Actualizar cuando termines el formulario.'));
function paintSync(){const label=root.querySelector('[data-sync-status]');if(label)label.textContent=syncBusy?'Actualizando…':'';}
async function syncSession(force=false){
 if(workshopOnly(me?.role)||view==='recetas')return;
 if(!user||!me||!security.ready||syncBusy||pendingLoads||!navigator.onLine||document.hidden||root.querySelector('[data-busy]')||v2.isListening()||root.querySelector('dialog[open]'))return;
 if(!force&&(Date.now()-lastSync<15000||root.querySelector('.menu-open')))return;
 syncBusy=true;paintSync();const owner=user.id,store=storeId;
 try{
  await security.guard();const before=shift()?.id,open=await read('Turnos abiertos',db.from('charito_shifts').select('*').eq('status','open'));
  if(user?.id!==owner||storeId!==store)return;
  const fingerprint=xs=>JSON.stringify(xs.filter(s=>s.status==='open').map(s=>[s.id,s.store_id,s.responsible_id,s.inventory_revision]).sort());
  if(force||fingerprint(open)!==fingerprint(data.shifts)){
   const changed=await load();if(user?.id!==owner||storeId!==store||!security.ready)return;
   if(changed&&view!=='control'&&!root.querySelector('[data-busy]')&&!v2.isListening()){
    comfort.flush();const drafts=formDrafts(root),x=window.scrollX,y=window.scrollY;render();
    if(before===shift()?.id){restoreDrafts(root,drafts);v2.updatePaymentView();window.scrollTo(x,y);}
    else{v2.clearCounts();notice('El turno de esta tienda cambió en otro dispositivo. Se cargó el turno actual.');}
   }
  }
  lastSync=Date.now();
 }catch(err){if(user?.id===owner)notice('No se pudo sincronizar el turno. '+err.message,true);}
 finally{syncBusy=false;paintSync();}
}
window.addEventListener('focus',()=>syncSession(true));document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncSession(true);});setInterval(()=>syncSession(['ventas','cierre'].includes(view)),20000);
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
const security=createSecurity({db,root,state:()=>({user,me}),notice,render:()=>{render();reports.enter(view);control.enter(view);fiscal.enter(view);workshop.enter(view);},reload:load,esc,onSignedOut:message=>{dates.clear();dialogs.clear();comfort.reset();v2.stopVoice();v2.clearCart();v2.clearCounts();users.clear();reports.clear();control.clear();fiscal.clear();workshop.clear();entry.reset();user=null;me=null;data={};storeId='';shiftContext={};preview=null;view='inicio';login(message);}});
const install=setupInstall(root,notice);
const users=createUsers({db,dialogs,state:()=>({data,me}),esc,field,select,table,row,notice,render});
const v2=createUpgrade({db,dialogs,dates,state:()=>({data,user,me,storeId,accessibleStores,shift:shift(),preview,canClose:canClose(),shared:shiftContext.shared_version}),operate,load,render,notice,flush:()=>comfort.flush(),detailReady:()=>comfort.restoreDetail(),legacyInicio:inicio,legacyClose:cierre,h:{esc,money,date,field,text,qtyInput,select,products,confirmCount,table,row,noShift,productName}});
const comfort=createComfort({root,db,v2,esc,money,date,notice,render,load,state:()=>({data,user,me,storeId,shift:shift(),preview,canClose:canClose(),view})});
const control=createControl({db,root,state:()=>({data,user,me,view}),guard:()=>security.guard(),ready:()=>security.ready,render,notice,esc,date});
const reports=createAdminReports({db,state:()=>({data,user,me,view}),guard:()=>security.guard(),ready:()=>security.ready,render,notice,esc,money,date});
const entry=createShiftEntry({state:()=>({data,user,me,stores:accessibleStores,storeId}),esc,load,render,notice,navigate:target=>{view=target;render();window.scrollTo(0,0);},changeStore:async id=>{
 if(!accessibleStores.some(s=>s.id===id))throw Error('Tienda no autorizada.');
 if(id!==storeId&&comfort.hasCart()&&!window.confirm('¿Descartar la venta sin guardar y cambiar de tienda?'))return false;
 const owner=user?.id;comfort.flush();if(id!==storeId)v2.clearCart();storeId=id;shiftContext={};rememberStore();return owner===user?.id;
}});
const workshop=createWorkshop({db,root,dialogs,state:()=>({data,user,me,view}),guard:()=>security.guard(),ready:()=>security.ready,render,notice,esc});
const fiscal=createFiscal({db,root,dialogs,state:()=>({data,user,me,view,storeId}),guard:()=>security.guard(),ready:()=>security.ready,render,notice,esc,money,date});
countsTable=v2.countTable;
inicio=v2.dashboard;cierre=comfort.closing;
Object.assign(kinds,{sale_payment:'Cobro de venta',sale_refund:'Devolución de venta',order_refund:'Devolución de pedido'});
const cashOriginal=caja;caja=()=>{let html=cashOriginal();if(shift()?.sales_mode==='direct'){html=html.replace('<option value="inventory_yape">Yape de inventario</option>','').replace('Los Yapes de pedidos se registran como pago de pedido.','Las ventas se cobran desde la pantalla Ventas. Los Yapes de pedidos se registran como pago de pedido.');}return html;};
try{const r=await db.auth.getSession();user=r.data.session?.user;if(user){if(await security.start()){await load();view=initialView(me.role);render();reports.enter(view);control.enter(view);fiscal.enter(view);workshop.enter(view);}}else login();}catch(err){login(`No se pudo cargar el sistema: ${err.message}`);}
