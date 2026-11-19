// Desplegar en Supabase Edge Functions como charito-users.
// Este archivo nunca se sirve como parte del sitio estático.
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

const baseHeaders = {
 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
 'Access-Control-Allow-Methods': 'POST, OPTIONS',
 'Cache-Control': 'no-store',
};
const passwordOK=(value:unknown)=>typeof value==='string' && [...value].length>=12 && new TextEncoder().encode(value).length<=72;

Deno.serve(async (req:Request)=>{
 const origin=req.headers.get('Origin');
 const allowed=(Deno.env.get('CHARITO_ALLOWED_ORIGINS')||'https://charito.example.com,https://appassets.androidplatform.net').split(',').map(s=>s.trim());
 const headers={...baseHeaders,Vary:'Origin',...(origin&&allowed.includes(origin)?{'Access-Control-Allow-Origin':origin}:{})};
 const reply=(status:number,body:unknown)=>Response.json(body,{status,headers});
 if(origin&&!allowed.includes(origin))return reply(403,{error:'Origen no permitido.'});
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return reply(405,{error:'Método no permitido.'});
 const url=Deno.env.get('SUPABASE_URL');
 const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!url||!key)return reply(503,{error:'Falta la configuración del servidor.'});
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const token=req.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1];
 if(!token)return reply(401,{error:'Inicia sesión.'});
 // Validación del JWT contra Auth y comprobación adicional del rol activo.
 const verified=await db.auth.getUser(token);
 if(verified.error||!verified.data.user)return reply(401,{error:'La sesión venció. Vuelve a entrar.'});
 const actor=verified.data.user.id;
 // PostgREST verifica la firma del JWT y el RPC comprueba sesión, revocación y MFA.
 // La clave privilegiada nunca se acepta desde el navegador ni el cuerpo.
 const publicKey=Deno.env.get('SUPABASE_ANON_KEY');
 if(!publicKey)return reply(503,{error:'Falta la configuración pública del servidor.'});
 const caller=createClient(url,publicKey,{global:{headers:{Authorization:'Bearer '+token}},auth:{persistSession:false,autoRefreshToken:false}});
 const security=await caller.rpc('charito_security_status');
 if(security.error)return reply(503,{error:'Activa la actualización 13 de seguridad en Supabase.'});
 if(!security.data?.session_valid)return reply(401,{error:'La sesión venció o fue revocada. Vuelve a entrar.'});
 if(!security.data?.can_manage_users)return reply(403,{error:'Solo un administrador activo con segundo factor puede gestionar usuarios.'});
 const member=await db.from('charito_members').select('role,active').eq('user_id',actor).maybeSingle();
 if(member.error)return reply(503,{error:'No se pudieron verificar los permisos.'});
 if(!member.data?.active||member.data.role!=='admin')return reply(403,{error:'Solo el administrador puede gestionar usuarios.'});
 const limit=await db.rpc('charito_security_admin_limit',{p_actor:actor});
 if(limit.error)return reply(503,{error:'No se pudo comprobar el límite de solicitudes.'});
 if(!limit.data)return reply(429,{error:'Demasiados cambios de usuarios. Espera cinco minutos.'});
 try{
  // Cota en streaming para no cargar cuerpos arbitrariamente grandes en memoria.
  const reader=req.body?.getReader();const chunks:Uint8Array[]=[];let size=0;
  if(reader){for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>4096){await reader.cancel();return reply(413,{error:'Solicitud demasiado grande.'});}chunks.push(part.value);}}
  const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.byteLength;}
  const raw=new TextDecoder().decode(bytes);
  const body=JSON.parse(raw);
  if(!body||Array.isArray(body)||typeof body!=='object')return reply(400,{error:'Solicitud inválida.'});
  if(body.action==='update'||body.action==='reset_password'){
   if(typeof body.id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id))return reply(400,{error:'Usuario inválido.'});
   if(body.action==='reset_password'&&!passwordOK(body.password))return reply(400,{error:'Usa una frase de al menos 12 caracteres, hasta 72 bytes.'});
   if(body.action==='update'&&(typeof body.name!=='string'||typeof body.active!=='boolean'||!Array.isArray(body.stores)||body.stores.length>100||body.stores.some((id:unknown)=>typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))))return reply(400,{error:'Revisa el nombre, estado y tiendas.'});
   const permitted=await db.rpc('charito_manage_user',{p_actor:actor,p_user:body.id,p_action:body.action,...(body.action==='update'?{p_name:body.name,p_active:body.active,p_stores:body.stores}:{})});
   if(permitted.error)return reply(400,{error:permitted.error.code==='PGRST202'?'Ejecuta la actualización 11 de gestión de usuarios.':permitted.error.message});
   if(body.action==='reset_password'){
    const changed=await db.auth.admin.updateUserById(body.id,{password:body.password});
    if(changed.error)return reply(400,{error:'Supabase rechazó la nueva contraseña. Revisa los requisitos de contraseña y reintenta.'});
   }
   const revoked=await db.rpc('charito_security_revoke_user',{p_actor:actor,p_user:body.id,p_reason:body.action==='reset_password'?'password_reset':'access_changed'});
   if(revoked.error)return reply(503,{error:'El cambio se guardó, pero falta revocar las sesiones anteriores. Revisa la actualización 13 antes de continuar.'});
   return reply(200,{user:{id:body.id},action:body.action});
  }
  if(body.action&&body.action!=='create')return reply(400,{error:'Acción inválida.'});
  const username=typeof body.username==='string'?body.username.trim().toLowerCase():'';
  const name=typeof body.name==='string'?body.name.trim():'';
  const password=typeof body.password==='string'?body.password:'';
  const role=body.role;
  const stores=Array.isArray(body.stores)?[...new Set(body.stores)]:[];
  if(!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(username))return reply(400,{error:'Usuario: entre 3 y 30 letras, números, punto, guion o guion bajo, sin espacios.'});
  if(name.length<2||name.length>80)return reply(400,{error:'Nombre: entre 2 y 80 caracteres.'});
  if(!passwordOK(password))return reply(400,{error:'Usa una frase de al menos 12 caracteres, hasta 72 bytes.'});
  if(!['worker','manager','admin','owner','warehouse','baker'].includes(role))return reply(400,{error:'Rol inválido.'});
  if(stores.length>100||stores.some(id=>typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))return reply(400,{error:'Tiendas inválidas.'});
  if(['owner','warehouse','baker'].includes(role)&&stores.length)return reply(400,{error:'Los perfiles del taller no se asignan a tiendas.'});
  if(['worker','manager'].includes(role)&&!stores.length)return reply(400,{error:'Asigna al menos una tienda a este perfil.'});
  if(stores.length){const s=await db.from('charito_stores').select('id').in('id',stores).eq('active',true);if(s.error)return reply(503,{error:'No se pudieron comprobar las tiendas.'});if(s.data.length!==stores.length)return reply(400,{error:'Tienda inválida o inactiva.'});}
  const existing=await db.from('charito_members').select('user_id').eq('username',username).maybeSingle();
  if(existing.error)return reply(503,{error:'Ejecuta primero el script 07 de usuarios.'});
  if(existing.data)return reply(409,{error:'Ese usuario ya existe. Elige otro nombre de usuario.'});
  const created=await db.auth.admin.createUser({email:username+'@usuarios.charito.invalid',password,email_confirm:true,user_metadata:{name}});
  if(created.error){const duplicate=['email_exists','user_already_exists'].includes(created.error.code||'');return reply(duplicate?409:400,{error:duplicate?'Ese usuario ya existe.':created.error.code==='weak_password'?'Supabase rechazó la contraseña. Revisa sus requisitos de contraseña.':'No se pudo crear la cuenta. Revisa el nombre de usuario y los requisitos de contraseña en Supabase.'});}
  const id=created.data.user.id;
  const registered=await db.rpc('charito_register_user',{p_actor:actor,p_user:id,p_name:name,p_username:username,p_role:role,p_stores:stores});
  if(registered.error){
   const cleanup=await db.auth.admin.deleteUser(id);
   if(cleanup.error)return reply(503,{error:'La cuenta quedó incompleta. Revisa Authentication antes de reintentar; no cambies a otro usuario.'});
   return reply(400,{error:'No se guardaron los permisos. Revisa el script 07, el rol y las tiendas y vuelve a intentar.'});
  }
  return reply(201,{user:{id,username,name,role}});
 }catch{return reply(400,{error:'No se pudo completar la solicitud. Actualiza la lista de usuarios antes de reintentar.'});}
});
