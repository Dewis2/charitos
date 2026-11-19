export const SECURITY={idleMs:60*60*1000,maxMs:12*60*60*1000,minPassword:12};
export const passwordValid=value=>typeof value==='string'&&[...value].length>=SECURITY.minPassword&&new TextEncoder().encode(value).length<=72;
export function securityIssue(error,httpStatus=0){
 const raw=String(error?.code||''),code=/^[A-Z0-9_]{2,24}$/.test(raw)?raw:'',http=Number(httpStatus||error?.status||0),suffix=code?` Código ${code}.`:http?` HTTP ${http}.`:'';
 if(['PGRST202','42883'].includes(code))return {kind:'setup',message:'No se encuentra la función de seguridad en el servidor. El administrador debe revisar la actualización 13.'+suffix};
 if(http===401||['PGRST301','PGRST303','28000'].includes(code))return {kind:'session',renew:true,message:'No se pudo validar la sesión. Sal y vuelve a entrar; el turno de la tienda permanece abierto.'+suffix};
 if(http===403||code==='42501')return {kind:'permission',message:'El servidor denegó la comprobación de acceso. Si persiste al volver a entrar, el administrador debe revisar los permisos.'+suffix};
 if(http===429)return {kind:'temporary',retry:true,message:'Hay demasiadas solicitudes. Espera unos segundos y pulsa Actualizar.'+suffix};
 if(http>=500||['57014','53300','57P01'].includes(code))return {kind:'temporary',retry:true,message:'El servidor no respondió a tiempo. Conserva el formulario y pulsa Actualizar en unos segundos.'+suffix};
 if(!http&&!code||/failed to fetch|network|timeout|load failed|fetch failed/i.test(String(error?.message||'')))return {kind:'connection',retry:true,message:'No se pudo conectar para comprobar el acceso. Revisa Internet y pulsa Actualizar.'};
 return {kind:'server',message:'No se pudo comprobar el acceso. Pulsa Actualizar; si persiste, comunica este código al administrador.'+suffix};
}
export function clearPrivateStorage(storage,userId){
 if(!storage)return;
 for(let i=storage.length-1;i>=0;i--){const k=storage.key(i)||'';
  if(k==='charito-auth-v2'||k.startsWith('sb-')&&k.endsWith('-auth-token')||k.startsWith('charito-draft-v1/')&&(!userId||k.includes('/'+userId+'/')))storage.removeItem(k);
 }
}
export function createSecurity({db,root,state,notice,render,reload,onSignedOut,esc}){
 let status=null,enrollment=null,lastActivity=Date.now(),loggingOut=false,checking=null,generation=0,lastFailure='',lastSuccess=0;
 // No conservar la sesión anterior en almacenamiento persistente del equipo compartido.
 for(let i=localStorage.length-1;i>=0;i--){const k=localStorage.key(i)||'';if(k.startsWith('sb-')&&k.endsWith('-auth-token'))localStorage.removeItem(k);}
 async function check(){
  if(checking)return checking;
  const currentGeneration=generation;
  checking=(async()=>{let r;
   for(let attempt=0;attempt<2;attempt++){
    try{r=await db.rpc('charito_security_status');}catch(error){r={error};}
    if(currentGeneration!==generation)throw Error('La sesión cambió. Vuelve a entrar.');
    if(!r.error)break;
    const issue=securityIssue(r.error,r.status);
    if(attempt===0&&issue.renew){
     let renewed;try{renewed=await db.auth.refreshSession();}catch{}
     if(currentGeneration!==generation)throw Error('La sesión cambió. Vuelve a entrar.');
     if(!renewed?.error&&renewed?.data?.session)continue;
    }else if(attempt===0&&issue.retry&&navigator.onLine!==false){await new Promise(resolve=>setTimeout(resolve,300));if(currentGeneration!==generation)throw Error('La sesión cambió. Vuelve a entrar.');continue;}
    lastFailure=issue.message;paintCheck();const failure=Error(issue.message);failure.kind=issue.kind;throw failure;
   }
   status=r.data;if(!status?.session_valid){await logout('Tu acceso venció o fue revocado. Vuelve a entrar.');throw Error('Tu acceso venció o fue revocado. Vuelve a entrar.');}
   lastFailure='';lastSuccess=Date.now();paintCheck();
   return !!status.ready;
  })();try{return await checking;}finally{checking=null;}
 }
 async function start(){lastActivity=Date.now();const ready=await check();if(!ready)gate();return ready;}
 function checkMessage(){return lastFailure||(lastSuccess?`${status?.ready?'Acceso verificado':'Conexión verificada; completa el segundo factor'} · ${new Date(lastSuccess).toLocaleTimeString('es-PE',{timeZone:'America/Lima'})}`:'Todavía no se ha comprobado el acceso.');}
 function paintCheck(){const el=root.querySelector('[data-security-check-result]');if(el)el.textContent=checkMessage();}
 function gate(message=''){
  root.innerHTML=`<main class="login security-gate"><h1>Verificación de seguridad</h1><p>${status?.role==='admin'?'El administrador necesita un segundo factor para acceder a caja y gestionar usuarios.':'Ingresa el código de tu aplicación autenticadora.'}</p>${message?`<div class="warn">${esc(message)}</div>`:''}<div data-mfa-setup></div><form data-form="security_verify"><label>Código de 6 dígitos<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label><button>Verificar y entrar</button></form><button type="button" class="secondary" data-security-enroll>Configurar autenticador</button><button type="button" class="secondary" data-security-logout>Salir</button><p class="small muted">Usa una app autenticadora en tu teléfono personal. Si pierdes ese acceso, la recuperación se realiza desde Supabase por el propietario; no hay un código compartido de emergencia.</p></main>`;
 }
 async function enroll(){
  const list=await db.auth.mfa.listFactors();if(list.error)throw Error('No se pudo consultar el segundo factor.');
  if(list.data.totp?.some(f=>f.status==='verified'))throw Error('Ya tienes un autenticador. Ingresa su código para continuar.');
  if(enrollment)return showEnrollment();
  for(const f of list.data.all||[]){if(f.factor_type==='totp'&&f.status!=='verified')await db.auth.mfa.unenroll({factorId:f.id});}
  const r=await db.auth.mfa.enroll({factorType:'totp',friendlyName:'Charito'});
  if(r.error)throw Error('No se pudo activar TOTP. Revisa que esté habilitado en Supabase.');
  enrollment=r.data;showEnrollment();
 }
 function showEnrollment(){
  const box=root.querySelector('[data-mfa-setup]');if(!box||!enrollment)return;
  const img=document.createElement('img');img.alt='Código QR para configurar tu autenticador';img.className='mfa-qr';
  const qr=enrollment.totp.qr_code;
  img.src=qr.startsWith('data:image/svg+xml')?qr:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(qr);
  box.replaceChildren(img);const p=document.createElement('p');p.textContent='Escanea este QR en tu app autenticadora y escribe el código. No compartas ni fotografíes la clave.';box.append(p);
 }
 async function verify(code){
  if(!/^\d{6}$/.test(code))throw Error('Ingresa los seis dígitos.');
  const factors=await db.auth.mfa.listFactors();if(factors.error)throw Error('No se pudo consultar el autenticador.');
  const factor=enrollment||(factors.data.totp||[]).find(f=>f.status==='verified');
  if(!factor)throw Error('Primero configura tu aplicación autenticadora.');
  const r=await db.auth.mfa.challengeAndVerify({factorId:factor.id,code});
  if(r.error)throw Error('El código no es válido o venció. Prueba el siguiente código.');
  enrollment=null;lastActivity=Date.now();if(!(await check()))throw Error('No se completó la verificación.');
  await reload();render();
 }
 async function logout(reason='Sesión cerrada. El turno de la tienda continúa abierto.'){
  if(loggingOut)return;loggingOut=true;generation++;checking=null;const id=state().user?.id;
  // La revocación SQL protege incluso frente a JWT todavía no expirados.
  let revoked=false;try{const r=await db.rpc('charito_security_logout');revoked=!r.error;}catch{}
  try{await db.auth.signOut({scope:'local'});}catch{}
  enrollment=null;status=null;lastFailure='';lastSuccess=0;clearPrivateStorage(sessionStorage,id);clearPrivateStorage(localStorage,id);
  onSignedOut(reason+(revoked?'':' No se confirmó la revocación en el servidor; el acceso anterior sigue sujeto al límite de 12 horas.'));
  loggingOut=false;
 }
 async function guard(){if(loggingOut||Date.now()-lastActivity>=SECURITY.idleMs){void logout('Sesión cerrada por inactividad. El turno permanece abierto.');throw Error('Vuelve a iniciar sesión.');}if(!(await check())){gate();throw Error('Completa la verificación de seguridad.');}}
 function view(){return `<div class="card security-controls"><h2>Mi acceso</h2><p class="security-status"><span class="badge">${status?.ready?'Verificado':'Pendiente'}</span><span class="badge">${status?.mfa_required?'Segundo factor activo':'Segundo factor opcional'}</span></p><p class="small" data-security-check-result role="status">${esc(checkMessage())}</p><div><button type="button" class="secondary" data-security-check>Comprobar acceso</button></div><details><summary>Autenticador</summary><button type="button" data-security-enroll>Configurar autenticador</button><div data-mfa-setup></div><form data-form="security_verify"><label>Código de 6 dígitos<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label><button>Verificar código</button></form></details><details><summary>Cambiar contraseña</summary><form data-form="security_password"><label>Contraseña actual<input name="current_password" type="password" autocomplete="current-password" required></label><label>Nueva contraseña de al menos 12 caracteres<input name="password" type="password" minlength="12" autocomplete="new-password" required></label><label>Repetir contraseña<input name="repeat_password" type="password" minlength="12" autocomplete="new-password" required></label><button>Cambiar y cerrar otras sesiones</button></form></details><span class="session-limits">Inactividad: 1 h · sesión: 12 h</span></div>`;}

 root.addEventListener('submit',async e=>{const action=e.target.dataset.form;if(!action?.startsWith('security_'))return;e.preventDefault();e.stopImmediatePropagation();const form=e.target,button=form.querySelector('button');button.disabled=true;
  try{const values=Object.fromEntries(new FormData(form));if(action==='security_verify'){await verify(values.code);}else if(action==='security_password'){
   if(!passwordValid(values.password)||values.password!==values.repeat_password)throw Error('La nueva frase debe coincidir y tener al menos 12 caracteres, hasta 72 bytes.');
   const current=await db.auth.getUser();if(current.error||!current.data.user)throw Error('Vuelve a iniciar sesión.');
   // Comprueba la contraseña sin sustituir la sesión MFA de esta ventana.
   const verifier=window.supabase.createClient(db.supabaseUrl,db.supabaseKey,{auth:{persistSession:false,autoRefreshToken:false}});
   const proof=await verifier.auth.signInWithPassword({email:current.data.user.email,password:values.current_password});
   if(proof.error)throw Error('La contraseña actual no es correcta.');
   await verifier.auth.signOut({scope:'local'});
   const changed=await db.auth.updateUser({password:values.password,current_password:values.current_password});
   if(changed.error)throw Error('No se pudo cambiar la contraseña. Revisa los requisitos de Supabase.');
   await db.auth.signOut({scope:'others'});form.reset();notice('Contraseña actualizada. Las otras sesiones de Auth se cerraron; sus JWT se rechazan al comprobar su sesión.');
  }}catch(error){notice(error.message,true);}finally{button.disabled=false;}
 },true);
 root.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;
  if(!b.hasAttribute('data-security-enroll')&&!b.hasAttribute('data-security-logout')&&!b.hasAttribute('data-logout')&&!b.hasAttribute('data-security-check'))return;
  e.preventDefault();e.stopImmediatePropagation();b.disabled=true;
  try{if(b.hasAttribute('data-security-check')){if(await check())notice('Conexión y acceso verificados.');else gate();}else if(b.hasAttribute('data-security-enroll'))await enroll();else await logout();}catch(error){notice(error.message,true);}finally{b.disabled=false;}
 },true);
 const activity=()=>{if(state().user&&Date.now()-lastActivity>=SECURITY.idleMs){void logout('Sesión cerrada por inactividad. Vuelve a entrar; el turno sigue abierto.');return;}lastActivity=Date.now();};
 for(const event of ['pointerdown','keydown','input','touchstart'])document.addEventListener(event,activity,{capture:true,passive:true});
 const checkIdle=()=>{if(state().user&&Date.now()-lastActivity>=SECURITY.idleMs)void logout('Sesión cerrada por inactividad. El turno de la tienda sigue abierto.');};
 setInterval(checkIdle,15000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkIdle();});
 db.auth.onAuthStateChange((event,session)=>{
  // No llamar APIs de Auth dentro del callback de Auth (evita bloqueos de refresco).
  if(event==='SIGNED_OUT'&&!loggingOut){generation++;enrollment=null;status=null;lastFailure='';lastSuccess=0;checking=null;setTimeout(()=>{clearPrivateStorage(sessionStorage,state().user?.id);onSignedOut('Vuelve a iniciar sesión. El turno permanece abierto.');},0);}
  if(session&&state().user&&session.user.id!==state().user.id)setTimeout(()=>logout('La identidad cambió. Vuelve a entrar con tu usuario.'),0);
 });
 return {start,guard,check,gate,view,logout,get ready(){return !!status?.ready&&!loggingOut&&Date.now()-lastActivity<SECURITY.idleMs;}};
}
