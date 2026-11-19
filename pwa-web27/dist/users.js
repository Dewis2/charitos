import {ROLE_LABELS,workshopOnly} from './workshop-model.js';
import {storeLabel} from './session.js';
export const hasStoreAssignments=role=>role==='worker'||role==='manager';
export const loginEmail=value=>{
 const normalized=String(value||'').trim().toLowerCase();
 if(normalized.includes('@'))return normalized;
 if(!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(normalized))throw Error('Escribe tu usuario sin espacios, o tu correo de acceso anterior.');
 return normalized+'@usuarios.charito.invalid';
};
export function loginError(error){
 if(error.status===429)return 'Demasiados intentos. Espera un momento y vuelve a intentar.';
 if(error.name==='AuthRetryableFetchError'||error.status===0||error.status>=500||!navigator.onLine)
  return 'No se pudo conectar con Charito. Revisa Internet y vuelve a intentar.';
 if(error.code==='user_banned')return 'Esta cuenta está suspendida. Consulta al administrador.';
 if(error.code==='email_not_confirmed')return 'La cuenta está pendiente de confirmación. Consulta al administrador.';
 return 'Usuario o contraseña incorrectos. Revisa los datos o pide al administrador que restablezca la contraseña.';
}

export function createUsers({db,state,esc,field,select,table,row,notice,render,dialogs}){
 let users=[],error='',loaded=false,editing=null;
 const roles={worker:ROLE_LABELS.worker,manager:ROLE_LABELS.manager,admin:ROLE_LABELS.admin,owner:ROLE_LABELS.owner,warehouse:ROLE_LABELS.warehouse,baker:ROLE_LABELS.baker};
 async function refresh(){
  if(state().me?.role!=='admin')throw Error('Solo el administrador puede consultar usuarios.');
  const owner=state().me.user_id,result=await db.rpc('charito_list_users');
  if(state().me?.role!=='admin'||state().me.user_id!==owner)return;
  loaded=true;
  if(result.error){error='Falta activar la gestión de usuarios: ejecuta el script 07 y despliega la función charito-users en Supabase.';users=[];return;}
  error='';users=result.data||[];users.forEach(u=>(u.stores||[]).forEach(s=>s.name=storeLabel(s.name)));
 }
 function view(){
  if(state().me?.role!=='admin')return '<div class="warn">Solo el administrador puede gestionar usuarios.</div>';
  return `<div class="grid"><div class="card"><h2>Crear usuario</h2>${error?`<div class="warn">${esc(error)}</div>`:''}<form data-form="create_user">${field('Nombre de la persona','<input name="name" autocomplete="off" minlength="2" maxlength="80" placeholder="María López" required>')}${field('Usuario para entrar','<input name="username" autocomplete="off" autocapitalize="none" spellcheck="false" title="3 a 30 caracteres, sin espacios ni tildes" pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{2,29}" minlength="3" maxlength="30" placeholder="maria" required>')}${field('Contraseña (mínimo 12 caracteres)','<input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="72" required>')}<label class="check"><input type="checkbox" data-show-password><span>Mostrar contraseña</span></label>${field('Rol',select('role',Object.entries(roles)))}<div id="user-stores"><h3>Tiendas asignadas</h3>${state().data.stores.map(s=>`<label class="check"><input type="checkbox" name="stores" value="${esc(s.id)}"><span>${esc(s.name)}</span></label>`).join('')}</div><p id="user-all-stores" class="small muted" hidden>Este rol tiene acceso a ambas tiendas.</p><button ${error?'disabled':''}>Crear usuario</button></form></div><div class="card"><h2>Usuarios registrados</h2><button class="secondary" data-users-refresh>Actualizar lista</button>${!loaded?'<p class="muted">Consultando usuarios…</p>':table(['Nombre','Usuario','Rol','Tiendas','Estado','Acciones'],users.map(u=>row([esc(u.display_name),esc(u.username||'Acceso anterior por correo'),esc(roles[u.role]||u.role),esc((u.stores||[]).map(s=>s.name).join(', ')),u.active?'Activo':'Inactivo',`<button type="button" class="secondary" data-user-edit="${u.user_id}">Gestionar</button>`])))}</div></div>`;
 }
 function editor(){const u=users.find(u=>u.user_id===editing);if(!u)return '';return `<div class="user-editor"><h3>Gestionar ${esc(u.display_name)}</h3><form data-form="update_user" data-id="${u.user_id}">${field('Nombre',`<input name="name" value="${esc(u.display_name)}" minlength="2" maxlength="80" required>`)}<p>Rol: ${esc(roles[u.role])}</p><label class="check"><input name="active" type="checkbox" ${u.active?'checked':''}><span>Usuario activo</span></label>${hasStoreAssignments(u.role)?state().data.stores.map(s=>`<label class="check"><input type="checkbox" name="stores" value="${s.id}" ${u.stores.some(a=>a.id===s.id)?'checked':''}><span>${esc(s.name)}</span></label>`).join(''):workshopOnly(u.role)?'':'<p>Este rol accede a ambas tiendas.</p>'}<button>Guardar acceso y tiendas</button></form><details><summary>Asignar nueva contraseña</summary><form data-form="reset_password" data-id="${u.user_id}">${field('Nueva contraseña','<input name="password" type="password" minlength="12" maxlength="72" autocomplete="new-password" required>')}${field('Repetir nueva contraseña','<input name="repeat_password" type="password" minlength="12" maxlength="72" autocomplete="new-password" required>')}<label class="check"><input type="checkbox" required><span>Asignar esta contraseña a ${esc(u.display_name)}.</span></label><button>Cambiar contraseña</button></form></details>${u.user_id!==state().me.user_id?`<details><summary>Cambiar rol</summary><form data-form="set_user_role" data-id="${u.user_id}">${field('Nuevo rol',`<select name="new_role">${Object.entries(roles).map(([id,label])=>`<option value="${id}" ${id===u.role?'selected':''}>${esc(label)}</option>`).join('')}</select>`)}<div data-role-stores ${hasStoreAssignments(u.role)?'':'hidden'}>${state().data.stores.map(s=>`<label class="check"><input type="checkbox" name="role_stores" value="${s.id}" ${u.stores.some(a=>a.id===s.id)?'checked':''}><span>${esc(s.name)}</span></label>`).join('')}</div><button>Guardar rol y cerrar sus sesiones</button></form></details>`:''}<button type="button" class="secondary" data-user-edit="">Cerrar</button></div>`;}
 async function click(b){if(!b.hasAttribute('data-user-edit'))return false;if(!b.dataset.userEdit){dialogs.close(false);return true;}editing=b.dataset.userEdit;dialogs.open({key:'user',title:'Gestionar usuario',body:editor(),onClose:()=>{editing=null;}});return true;}

 async function submit(action,x,form){
  if(['update_user','reset_password'].includes(action)){
   if(state().me?.role!=='admin')throw Error('Solo el administrador puede gestionar usuarios.');
   if(action==='reset_password'&&x.password!==x.repeat_password)throw Error('Las contraseñas no coinciden.');
   const body=action==='reset_password'?{action:'reset_password',id:form.dataset.id,password:x.password}:{action:'update',id:form.dataset.id,name:x.name,active:form.elements.active.checked,stores:new FormData(form).getAll('stores')};
   const r=await db.functions.invoke('charito-users',{body});if(r.error){let message='Actualiza la función charito-users y ejecuta el script 11 en Supabase.';try{message=(await r.error.context.json())?.error||message;}catch{}throw Error(message);}if(r.data?.error)throw Error(r.data.error);if(!r.data?.user?.id)throw Error('La función no confirmó el cambio. Actualiza charito-users con el archivo 12.');
   if(action==='reset_password'){form.elements.password.value='';form.elements.repeat_password.value='';}editing=null;dialogs.close(true);await refresh();render();notice(action==='reset_password'?'Nueva contraseña guardada.':'Acceso y tiendas actualizados.');return true;
  }
  if(action==='set_user_role'){
   if(state().me?.role!=='admin')throw Error('Solo el administrador puede cambiar roles.');
   const stores=hasStoreAssignments(x.new_role)?new FormData(form).getAll('role_stores'):[];
   if(hasStoreAssignments(x.new_role)&&!stores.length)throw Error('Selecciona al menos una tienda.');
   const result=await db.rpc('charito_set_user_role',{p_user:form.dataset.id,p_role:x.new_role,p_stores:stores});
   if(result.error)throw Error(result.error.message);dialogs.close(true);await refresh();render();notice('Rol actualizado. La persona debe volver a entrar.');return true;
  }
  if(action!=='create_user')return false;
  if(state().me?.role!=='admin')throw Error('Solo el administrador puede crear usuarios.');
  const stores=hasStoreAssignments(x.role)?new FormData(form).getAll('stores'):[];
  if(hasStoreAssignments(x.role)&&!stores.length)throw Error('Selecciona al menos una tienda.');
  const result=await db.functions.invoke('charito-users',{body:{name:x.name,username:x.username,password:x.password,role:x.role,stores}});
  if(result.error){let message='No se pudo crear el usuario. Comprueba que la función charito-users esté desplegada en Supabase y actualiza la lista antes de reintentar.';
   try{const payload=await result.error.context?.json();if(payload?.error)message=payload.error;}catch{}
   throw Error(message);
  }
  if(result.data?.error)throw Error(result.data.error);
  if(!result.data?.user?.id)throw Error('Respuesta incompleta. Actualiza la lista antes de reintentar.');
  const username=result.data.user.username;
  form.elements.password.value='';
  await refresh();render();notice(`Usuario ${username} creado. Puede entrar con su usuario y contraseña.`);return true;
 }
 function input(e){const form=e.target.closest('[data-form="create_user"]');if(!form){const roleForm=e.target.closest('[data-form="set_user_role"]');if(roleForm&&e.target.name==='new_role')roleForm.querySelector('[data-role-stores]').hidden=!hasStoreAssignments(e.target.value);return;}
  if(e.target.hasAttribute('data-show-password'))form.elements.password.type=e.target.checked?'text':'password';
  if(e.target.name==='role'){const assigned=hasStoreAssignments(e.target.value);form.querySelector('#user-stores').hidden=!assigned;form.querySelector('#user-all-stores').hidden=assigned||workshopOnly(e.target.value);}
 }
 return {view,refresh,submit,input,click,clear:()=>{users=[];loaded=false;error='';editing=null;}};
}

export function setupInstall(root,notice){
 let prompt=null;
 const installed=()=>window.matchMedia('(display-mode: standalone)').matches;
 const sync=()=>root.querySelectorAll('[data-install]').forEach(b=>{b.textContent=installed()?'Charito instalado':prompt?'Instalar Charito':'Cómo instalar Charito';});
 window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();prompt=e;sync();});
 window.addEventListener('appinstalled',()=>{prompt=null;sync();notice('Charito instalado. Ábrelo desde su icono.');});
 const help=()=>`<details class="install-help"><summary>Instalar en Android</summary><p>Abre Charito directamente en Chrome. Pulsa ⋮ → Instalar aplicación, o Añadir a pantalla de inicio → Instalar. Después ábrelo desde el icono Charito para usarlo sin la barra de direcciones.</p><p class="small muted">Si solo ofrece crear un acceso directo y sigue mostrando la barra, todavía no se ha instalado como aplicación. Requiere conexión para guardar datos.</p></details><button class="secondary" type="button" data-install>${installed()?'Charito instalado':prompt?'Instalar Charito':'Cómo instalar Charito'}</button>`;
 const click=async b=>{if(!b.hasAttribute('data-install'))return false;if(installed()){notice('Ya estás usando Charito como aplicación instalada.');return true;}if(prompt){const current=prompt;prompt=null;await current.prompt();await current.userChoice;sync();return true;}root.querySelector('.install-help')?.setAttribute('open','');notice('En Chrome: ⋮ → Instalar aplicación. Después abre el icono Charito.');return true;};
 return {help,click,sync};
}
