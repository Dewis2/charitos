const normalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const cents=value=>{if(value===null||value===undefined||String(value).trim()==='')return null;const n=Number(value);return Number.isFinite(n)&&n>=0&&Number.isSafeInteger(Math.round(n*100))?Math.round(n*100):null;};
export function salePayments(sale,entries=[]){
 const total=cents(sale?.total);let cash=0,yape=0,valid=total!==null;
 for(const e of entries.filter(e=>e.sale_id===sale?.id&&e.kind==='sale_payment')){
  const amount=cents(e.amount);if(amount===null||!['cash','yape'].includes(e.method)){valid=false;continue;}
  if(e.method==='cash')cash+=amount;else yape+=amount;
 }
 return {cash,yape,total,valid:valid&&cash+yape===total};
}
export function deletionIssue({sale,shift,role,entries=[]}){
 if(!['admin','manager'].includes(role))return 'Solo el administrador o un encargado puede eliminar ventas.';
 if(!shift||shift.status!=='open'||shift.sales_mode!=='direct')return 'Solo se eliminan ventas de un turno abierto de ventas individuales.';
 if(!sale||sale.shift_id!==shift.id)return 'La venta no pertenece al turno de esta tienda.';
 if(sale.status!=='completed')return 'Esta venta ya fue eliminada. Actualiza la lista.';
 if(!salePayments(sale,entries).valid)return 'Los cobros no coinciden con la venta. Actualiza y revisa los registros antes de eliminarla.';
 if(!sale.charito_sale_lines?.length||sale.charito_sale_lines.some(l=>!Number.isFinite(Number(l.quantity))||Number(l.quantity)<=0))return 'No se pudo comprobar el detalle de productos. Actualiza antes de continuar.';
 return '';
}
export function deletionReason(note=''){const marker=' / Anulada: ',index=String(note).lastIndexOf(marker);return index<0?'':String(note).slice(index+marker.length);}
export function createSaleHistory(ctx){
 const {h,notice}=ctx,{esc,money,date,table,row}=h;
 let scope=null,status='completed',query='',limit=20,generation=0,opened=null;const pending=new Set();
 const state=()=>ctx.state();
 const canDelete=()=>['admin','manager'].includes(state().me?.role);
 const currentSales=()=>{const s=state();return (s.data.sales||[]).filter(x=>x.shift_id===s.shift?.id);};
 const product=id=>state().data.products.find(p=>p.id===id);
 const productName=id=>product(id)?.name||'Producto '+String(id).slice(0,8);
 function rows(){const tokens=normalize(query.trim()).split(/\s+/).filter(Boolean);return currentSales().filter(s=>(status==='all'||s.status===status)&&tokens.every(t=>normalize([s.id,s.total,...(s.charito_sale_lines||[]).map(l=>`${productName(l.product_id)} ${product(l.product_id)?.category||''}`)].join(' ')).includes(t)));}
 function productsText(sale){return (sale.charito_sale_lines||[]).slice(0,2).map(l=>`${esc(l.quantity)} × ${esc(productName(l.product_id))}`).join('<br>')+((sale.charito_sale_lines||[]).length>2?`<small>+ ${sale.charito_sale_lines.length-2} productos</small>`:'');}
 function results(){const list=rows();return `${table(['Venta / hora','Productos','Total','Estado','Acciones'],list.slice(0,limit).map(s=>row([`<strong>${esc(s.id.slice(0,8))}</strong><small class="sale-history-time">${date(s.created_at)}</small>`,productsText(s),money(s.total),`<span class="badge ${s.status==='voided'?'sale-deleted-badge':''}">${s.status==='completed'?'Vigente':'Eliminada'}</span>${s.status==='voided'&&deletionReason(s.note)?`<small class="sale-deleted-reason">${esc(deletionReason(s.note))}</small>`:''}`,`<div class="sale-row-actions"><button type="button" class="secondary" data-receipt="${esc(s.id)}">${s.status==='voided'?'Detalle':'Ticket'}</button>${s.status==='completed'?`<button type="button" class="secondary" data-fiscal-sale="${esc(s.id)}">Boleta / factura</button>`:''}${s.status==='completed'&&canDelete()?`<button type="button" class="sale-delete-button" data-sale-delete="${esc(s.id)}" aria-label="Eliminar venta ${esc(s.id.slice(0,8))}"><svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>Eliminar</button>`:''}</div>`])))}<p class="small muted">${Math.min(list.length,limit)} de ${list.length} ventas</p>${list.length>limit?'<button type="button" class="secondary" data-more-sales>Mostrar más ventas</button>':''}`;}
 function view(){const id=state().shift?.id||null;if(scope!==id){scope=id;status='completed';query='';limit=20;opened=null;}
  const all=currentSales(),deleted=all.filter(s=>s.status==='voided').length;
  return `<section class="card full sales-history"><div class="sale-history-heading"><h2>Ventas del turno</h2><span class="small muted">${all.length-deleted} vigentes${deleted?` · ${deleted} eliminadas`:''}</span></div><div class="sale-history-filters"><label>Buscar venta<input type="search" data-sale-history-query value="${esc(query)}" placeholder="Producto, importe o código" autocomplete="off"></label><label>Estado<select data-sale-history-status>${[['completed','Vigentes'],['voided','Eliminadas'],['all','Todas']].map(([id,name])=>`<option value="${id}" ${status===id?'selected':''}>${name}</option>`).join('')}</select></label></div><div data-sale-history-results>${results()}</div><div id="receipt"></div><div data-sale-delete-host></div></section>`;
 }
 function refreshResults(){const target=document.querySelector('[data-sale-history-results]');if(target)target.innerHTML=results();}
 function open(id,trigger){const {data,shift,me,user}=state(),sale=data.sales.find(s=>s.id===id),issue=deletionIssue({sale,shift,role:me?.role,entries:data.cash});if(issue)throw Error(issue);close();
  const payment=salePayments(sale,data.cash),host=document.querySelector('[data-sale-delete-host]');if(!host)throw Error('Abre Ventas para eliminar este registro.');
  const lineItems=sale.charito_sale_lines.map(l=>`<div class="summaryrow"><span>${esc(productName(l.product_id))}</span><strong>+${esc(l.quantity)} ${esc(product(l.product_id)?.unit||'')}</strong></div>`).join('');
  host.innerHTML=`<dialog class="sale-delete-dialog" aria-labelledby="sale-delete-heading"><div class="sale-delete-content"><div class="sale-delete-heading"><h2 id="sale-delete-heading">Eliminar venta ${esc(id.slice(0,8))}</h2><button type="button" class="secondary" data-sale-delete-cancel aria-label="Cerrar confirmación">×</button></div><p class="small muted">${date(sale.created_at)}</p><div class="sale-delete-total"><span>Total de la venta</span><strong>${money(sale.total)}</strong></div><details><summary>Productos que regresan al stock</summary>${lineItems}</details><div class="sale-delete-payments">${payment.cash?`<div class="summaryrow"><span>Revertir cobro en efectivo</span><strong>−${money(payment.cash/100)}</strong></div>`:''}${payment.yape?`<div class="summaryrow"><span>Revertir cobro por Yape</span><strong>−${money(payment.yape/100)}</strong></div>`:''}</div><form data-form="void_sale" data-id="${esc(id)}" data-shift="${esc(shift.id)}"><label>Tipo de eliminación<select name="deletion_kind"><option value="error">Registro erróneo o duplicado</option><option value="return">Devolución completa al cliente</option></select></label><label>Motivo<textarea name="reason" minlength="3" maxlength="500" required placeholder="Indica qué ocurrió"></textarea></label><label class="check"><input type="checkbox" name="confirmed" required><span data-sale-delete-confirmation>Este registro no corresponde a una venta válida; el stock físico y los cobros reales están conciliados.</span></label><div class="sale-delete-actions"><button type="button" class="secondary" data-sale-delete-cancel>Cancelar</button><button class="danger">Eliminar venta</button></div></form></div></dialog>`;
  const dialog=host.querySelector('dialog');opened={id,shift:shift.id,owner:user?.id,dialog,trigger};dialog.addEventListener('cancel',e=>{e.preventDefault();if(!pending.has(id))close();});dialog.showModal();dialog.querySelector('textarea').focus();
 }
 function close(){const current=opened;if(current?.dialog?.isConnected){current.dialog.close();current.dialog.remove();}opened=null;current?.trigger?.focus?.({preventScroll:true});}
 async function submit(action,x,f){if(action!=='void_sale')return false;const {data,shift,me,user}=state(),id=f.dataset.id,owner=user?.id,run=generation;
  const issue=deletionIssue({sale:data.sales.find(s=>s.id===id),shift,role:me?.role,entries:data.cash});if(issue)throw Error(issue);
  if(!opened||opened.id!==id||opened.owner!==owner||opened.shift!==shift?.id||f.dataset.shift!==shift?.id)throw Error('Vuelve a abrir la confirmación para esta venta.');
  if(!f.elements.confirmed?.checked)throw Error('Confirma el stock y los cobros antes de eliminar.');
  const reason=String(x.reason||'').trim(),type=x.deletion_kind;if(reason.length<3||reason.length>500||!['error','return'].includes(type))throw Error('Completa el tipo y un motivo de 3 a 500 caracteres.');
  if(pending.has(id))return true;pending.add(id);
  try{await ctx.operate('void_sale',{id,shift_id:shift.id,reason:(type==='error'?'Registro erróneo o duplicado: ':'Devolución completa: ')+reason},f);
   if(run!==generation||state().user?.id!==owner)return true;close();ctx.flush();
   try{await ctx.load();}catch(error){notice('La eliminación se guardó. Actualiza los datos antes de seguir operando. '+error.message,true);return true;}
   if(run!==generation||state().user?.id!==owner)return true;ctx.render();notice('Venta eliminada. Caja y stock actualizados.');return true;
  }finally{if(run===generation)pending.delete(id);}
 }
 async function click(b){if(b.hasAttribute('data-sale-delete')){open(b.dataset.saleDelete,b);return true;}if(b.hasAttribute('data-sale-delete-cancel')){if(!pending.has(opened?.id))close();return true;}if(b.hasAttribute('data-more-sales')){limit+=20;refreshResults();return true;}return false;}
 function input(e){if(e.target.hasAttribute('data-sale-history-query')){if(e.type==='input'){query=e.target.value;limit=20;refreshResults();}return true;}if(e.target.hasAttribute('data-sale-history-status')){status=e.target.value;limit=20;refreshResults();return true;}
  if(e.target.name==='deletion_kind'&&e.type==='change'&&e.target.closest('[data-form="void_sale"]')){const f=e.target.form;f.elements.confirmed.checked=false;f.querySelector('[data-sale-delete-confirmation]').textContent=e.target.value==='return'?'Todos los productos regresaron al stock y devolví el dinero por los medios indicados.':'Este registro no corresponde a una venta válida; el stock físico y los cobros reales están conciliados.';return true;}return false;
 }
 function clear(){generation++;pending.clear();close();scope=null;status='completed';query='';limit=20;}
 return {view,submit,click,input,clear};
}
