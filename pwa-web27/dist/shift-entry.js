export function createShiftEntry({state,esc,changeStore,load,render,navigate,notice}){
 let stage='stores',picked='',pendingLabel='',generation=0;
 const allowed=()=>state().stores||[];
 const openFor=id=>(state().data.shifts||[]).find(s=>s.store_id===id&&s.status==='open');
 const labels=['Mañana','Tarde'];
 function view(){const current=allowed().find(s=>s.id===picked);if(stage==='turns'&&!current){stage='stores';picked='';}
  if(stage==='stores')return `<section class="shift-entry"><div class="shift-entry-heading"><h2>Elige una tienda</h2></div><div class="shift-store-grid">${allowed().map(s=>{const active=openFor(s.id);return `<button type="button" class="shift-store-card" data-shift-store="${esc(s.id)}"><span class="shift-store-name">${esc(s.name)}</span><span class="shift-store-status">${active?`${esc(active.label)} · Abierto`:'Sin turno abierto'}</span><span class="shift-store-link">Elegir tienda <span aria-hidden="true">→</span></span></button>`;}).join('')}</div></section>`;
  const active=openFor(current.id);return `<section class="shift-entry"><div class="shift-entry-heading"><button type="button" class="secondary" data-shift-back>← Tiendas</button><h2>${esc(current.name)}</h2></div><h3>Elige el turno</h3>${active?`<div class="shift-active-choice"><span class="badge">Turno abierto</span><h2>${esc(active.label)}</h2><button type="button" data-shift-continue="${esc(active.id)}">Entrar al turno</button></div><div class="shift-next-options">${labels.filter(l=>l!==active.label).map(l=>`<button type="button" class="secondary" disabled>${l}</button>`).join('')}<span>El siguiente turno se abre al cerrar el actual.</span></div>`:`<div class="shift-store-grid">${labels.map(l=>`<button type="button" class="shift-store-card" data-shift-label="${l}"><span class="shift-store-name">${l}</span><span class="shift-store-link">Preparar apertura <span aria-hidden="true">→</span></span></button>`).join('')}</div>`}</section>`;
 }
 async function click(button){const d=button.dataset,owner=state().user?.id,token=generation;
  const live=()=>!!owner&&owner===state().user?.id&&token===generation;
  if('shiftBack'in d){stage='stores';picked='';render();return true;}
  if(d.shiftStore){if(!allowed().some(s=>s.id===d.shiftStore))throw Error('Tienda no autorizada.');button.disabled=true;try{if(!await changeStore(d.shiftStore)||!live())return true;picked=d.shiftStore;stage='turns';render();}finally{button.disabled=false;}return true;}
  if(d.shiftContinue){button.disabled=true;try{await load();if(!live())return true;const active=openFor(picked);if(!active||active.id!==d.shiftContinue){render();notice('El turno cambió. Revisa la selección.',true);return true;}pendingLabel='';navigate('ventas');}finally{button.disabled=false;}return true;}
  if(d.shiftLabel){if(!labels.includes(d.shiftLabel))throw Error('Turno inválido.');button.disabled=true;try{await load();if(!live())return true;if(openFor(picked)){render();notice('Esta tienda ya tiene un turno abierto.');return true;}pendingLabel=d.shiftLabel;navigate('inicio');}finally{button.disabled=false;}return true;}
  return false;
 }
 function reset(){generation++;stage='stores';picked='';pendingLabel='';}
 function applyLabel(){if(!pendingLabel)return;const form=document.querySelector('[data-form="open_shift"]');if(form?.elements.label)form.elements.label.value=pendingLabel;}
 return {view,click,reset,applyLabel};
}
