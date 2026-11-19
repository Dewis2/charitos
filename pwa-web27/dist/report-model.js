// Pure report calculations. Money is kept in cents; stock in thousandths.
export const cents=value=>Math.round(Number(value||0)*100);
export const quantity=value=>Math.round(Number(value||0)*1000)/1000;
export const peruDay=value=>new Date(new Date(value).getTime()-5*3600000).toISOString().slice(0,10);
export function dayOffset(day,offset){return new Date(Date.parse(day+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10);}
export function reportPeriod(from,to){
 if(![from,to].every(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().startsWith(d)))throw Error('Selecciona fechas válidas.');
 const days=(Date.parse(to)-Date.parse(from))/86400000+1;
 if(days<1)throw Error('La fecha final debe ser igual o posterior a la inicial.');
 if(days>366)throw Error('Consulta hasta 366 días por reporte. Divide un periodo mayor en varios reportes.');
 return {from,to,days,start:from+'T00:00:00-05:00',end:dayOffset(to,1)+'T00:00:00-05:00'};
}
export function buildStock({stores,products,shifts,counts,movements,transfers=[]}){
 const latest=new Map();for(const s of shifts){const old=latest.get(s.store_id);if(!old||s.status==='open'&&old.status!=='open'||s.status===old.status&&s.opened_at>old.opened_at)latest.set(s.store_id,s);}
 const countMap=new Map(counts.map(c=>[c.shift_id+'/'+c.product_id,c]));const deltas=new Map();
 for(const m of movements){const key=m.shift_id+'/'+m.product_id;deltas.set(key,quantity((deltas.get(key)||0)+Number(m.quantity)));}
 const transit=new Map();for(const t of transfers.filter(t=>t.status==='in_transit'))for(const l of t.charito_transfer_lines||[]){const key=t.destination_store_id+'/'+l.product_id;transit.set(key,quantity((transit.get(key)||0)+Number(l.quantity)));}
 const rows=products.map(p=>({product:p,stores:stores.map(store=>{
  const s=latest.get(store.id),c=countMap.get(s?.id+'/'+p.id);let qty=null,basis='Sin registro';
  if(c&&s.status==='closed'){qty=c.closing_qty===null?null:quantity(c.closing_qty);basis=qty===null?'Sin conteo final':'Último cierre físico';}
  else if(c&&s.sales_mode==='direct'){qty=quantity(Number(c.opening_qty)+(deltas.get(s.id+'/'+p.id)||0));basis='Saldo de movimientos';}
  else if(c){qty=c.closing_qty===null?quantity(Number(c.opening_qty)+(deltas.get(s.id+'/'+p.id)||0)):quantity(c.closing_qty);basis=c.closing_qty===null?'Estimado · ventas por conteo':'Conteo físico del turno';}
  return {store,shift:s,qty,basis,estimated:!!s&&s.status==='open'&&s.sales_mode!=='direct'&&c?.closing_qty===null,incoming:transit.get(store.id+'/'+p.id)||0};
 })}));
 return {rows,latest};
}
export function summarizeSales({sales,legacy=[],stores,products,period}){
 const valid=sales.filter(s=>s.status==='completed'),voided=sales.filter(s=>s.status==='voided');
 const byStore=new Map(stores.map(s=>[s.id,{store:s,net:0,cash:0,yape:0,tickets:0,legacy:0}]));
 const days=new Map();for(let i=0;i<period.days;i++)days.set(dayOffset(period.from,i),0);
 const top=new Map(),catalog=new Map(products.map(p=>[p.id,p]));let net=0,discount=0,cash=0,yape=0,mismatch=0;
 for(const sale of valid){
  const total=cents(sale.total),off=cents(sale.discount);net+=total;discount+=off;
  let sc=0,sy=0;for(const e of sale.charito_cash_entries||[])if(e.kind==='sale_payment'){if(e.method==='cash')sc+=cents(e.amount);if(e.method==='yape')sy+=cents(e.amount);}
  cash+=sc;yape+=sy;if(sc+sy!==total)mismatch++;
  const store=byStore.get(sale.store_id);if(store){store.net+=total;store.cash+=sc;store.yape+=sy;store.tickets++;}
  const day=peruDay(sale.created_at);if(days.has(day))days.set(day,days.get(day)+total);
  for(const l of sale.charito_sale_lines||[]){const row=top.get(l.product_id)||{product:catalog.get(l.product_id)||{id:l.product_id,name:'Producto fuera del catálogo',category:'Sin categoría',unit:'unidad'},qty:0,gross:0};row.qty=quantity(row.qty+Number(l.quantity));row.gross+=Math.round(Number(l.quantity)*Number(l.unit_price)*100);top.set(l.product_id,row);}
 }
 let legacyTotal=0;for(const s of legacy){const closure=Array.isArray(s.charito_closures)?s.charito_closures[0]:s.charito_closures;if(!closure)continue;const amount=cents(closure.inventory_sales);legacyTotal+=amount;const store=byStore.get(s.store_id);if(store)store.legacy+=amount;const day=peruDay(s.closed_at);if(days.has(day))days.set(day,days.get(day)+amount);}
 return {net,discount,gross:net+discount,cash,yape,mismatch,legacyTotal,total:net+legacyTotal,tickets:valid.length,average:valid.length?Math.round(net/valid.length):null,voided: voided.length,voidedAmount:voided.reduce((n,s)=>n+cents(s.total),0),byStore:[...byStore.values()],days:[...days].map(([day,total])=>({day,total})),top:[...top.values()].sort((a,b)=>b.gross-a.gross||a.product.name.localeCompare(b.product.name,'es'))};
}
export function csv(rows){return '\ufeff'+rows.map(row=>row.map(value=>{let s=String(value??'');if(/^[\s]*[=+@-]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}).join(';')).join('\r\n');}
