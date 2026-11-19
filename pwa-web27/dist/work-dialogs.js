export function createWorkDialogs({root,esc,state,notice,discard}){
 let current=null,sequence=0;
 const owner=()=>state().user?.id;
 function is(key){return !!current&&current.key===key&&current.owner===owner()&&current.dialog.isConnected;}
 function busy(){return !!current?.dialog.querySelector('[data-busy],[data-preparing]');}
 function close(force=true){const c=current;if(!c)return true;if(!force){if(busy()){notice('Espera a que termine el guardado.');return false;}if(c.confirmDiscard&&c.dirty&&!window.confirm('¿Descartar los cambios sin guardar?'))return false;}
  current=null;c.dialog.querySelectorAll('form[data-form]').forEach(f=>discard?.(f));c.dialog.close();c.dialog.remove();c.onClose?.({discarded:!force&&c.dirty,dialog:c.dialog});document.body.classList.remove('has-work-dialog');if(c.trigger?.isConnected)c.trigger.focus?.({preventScroll:true});window.scrollTo(c.scroll.x,c.scroll.y);return true;
 }
 function open({key,title,body='',wide=false,onClose,confirmDiscard=true,trigger=document.activeElement,focus='input:not([type=hidden]),textarea,select'}){
  close(true);const dialog=document.createElement('dialog');dialog.className='work-dialog'+(wide?' work-dialog-wide':'');dialog.dataset.workDialog=key;
  dialog.innerHTML=`<header class="work-dialog-header"><h2 id="work-dialog-title">${esc(title)}</h2><button type="button" class="secondary" data-dialog-close aria-label="Cerrar ventana">×</button></header><div class="work-dialog-body">${body}</div>`;dialog.setAttribute('aria-labelledby','work-dialog-title');
  current={key,dialog,owner:owner(),onClose,confirmDiscard,trigger,scroll:{x:window.scrollX,y:window.scrollY},dirty:false,sequence:++sequence};root.append(dialog);
  dialog.addEventListener('cancel',e=>{e.preventDefault();close(false);});dialog.addEventListener('input',()=>{if(current?.dialog===dialog)current.dirty=true;});dialog.addEventListener('change',()=>{if(current?.dialog===dialog)current.dirty=true;});
  document.body.classList.add('has-work-dialog');dialog.showModal();(dialog.querySelector(focus)||dialog.querySelector('button')).focus({preventScroll:true});return current.sequence;
 }
 function update(key,body,token){if(!is(key)||token!==undefined&&current.sequence!==token)return false;current.dialog.querySelector('.work-dialog-body').innerHTML=body;current.dirty=false;return true;}
 function click(button){if(!button.hasAttribute('data-dialog-close'))return false;close(false);return true;}
 function clean(){if(current)current.dirty=false;}
 function clear(){sequence++;close(true);}
 return {open,update,close,is,click,clean,clear,busy,get element(){return current?.dialog||null;},get key(){return current?.key||null;}};
}
