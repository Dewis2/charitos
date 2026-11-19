// Deploy as "charito-sfs", verify_jwt=false. No SOL/certificate credentials here.
// Only connector capability tokens issued by the verified administrator are accepted.
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.99.1';
const url=Deno.env.get('SUPABASE_URL')!;
const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const reply=(status:number,message:string)=>Response.json({error:message},{status});
Deno.serve(async req=>{
 if(req.method!=='POST')return reply(405,'Método no permitido.');
 const token=req.headers.get('x-charito-connector')||'';
 if(!/^[a-f0-9]{64}$/.test(token))return reply(401,'Conector no autorizado.');
 const length=Number(req.headers.get('content-length')||0);
 if(length>5242880)return reply(413,'Archivo demasiado grande.');
 try{
  const id=new URL(req.url).searchParams.get('document')||'',kind=new URL(req.url).searchParams.get('kind')||'';
  if(!/^[a-f0-9-]{36}$/i.test(id)||!['signed.xml','cdr.xml','representation.pdf'].includes(kind))return reply(400,'Archivo inválido.');
  const {data:scope,error}=await db.rpc('charito_sfs_agent',{p_token:token,p_action:'authorize_file',p_data:{id,kind}});
  if(error||!scope)return reply(403,'Archivo no autorizado.');
  // Stream with an actual cap; do not trust Content-Length.
  const reader=req.body?.getReader();if(!reader)return reply(400,'Archivo vacío.');
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>5242880){await reader.cancel();return reply(413,'Archivo demasiado grande.');}chunks.push(r.value);}
  if(!size)return reply(400,'Archivo vacío.');
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  const mime=kind.endsWith('.pdf')?'application/pdf':'application/xml';
  if(mime==='application/pdf'){
   if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')return reply(400,'PDF no válido.');
  }else{
   if(size>1048576)return reply(413,'XML demasiado grande.');
   const xml=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
   if(/<!\s*(DOCTYPE|ENTITY)/i.test(xml))return reply(400,'XML no permitido.');
   // The connector additionally parses XML with ElementTree and verifies CDR identity.
   if(!xml.includes(scope.reference)||!xml.includes(scope.ruc))return reply(400,'XML de otro comprobante.');
   if(kind==='cdr.xml'){
    const {error:resultError}=await db.rpc('charito_sfs_agent',{p_token:token,p_action:'result',p_data:{id,cdr_xml:xml}});
    if(resultError)return reply(400,'Constancia no válida para este comprobante.');
   }
  }
  const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
  const {data:existing,error:readError}=await db.from('charito_fiscal_files').select('sha256').eq('document_id',id).eq('kind',kind).maybeSingle();
  if(readError)return reply(503,'No se pudo consultar el archivo.');
  if(existing){if(existing.sha256!==sha)return reply(409,'Ya existe un archivo distinto. Requiere revisión.');return Response.json({saved:true,sha256:sha});}
  const uploaded=await db.storage.from('charito-fiscal').upload(scope.path,bytes,{contentType:mime,upsert:false});
  if(uploaded.error){
   // Recover an upload whose metadata insert was interrupted; never overwrite a fiscal artifact.
   const prior=await db.storage.from('charito-fiscal').download(scope.path);if(prior.error||!prior.data)return reply(503,'No se pudo archivar.');
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await prior.data.arrayBuffer()))).map(x=>x.toString(16).padStart(2,'0')).join('');
   if(digest!==sha)return reply(409,'El archivo archivado es distinto.');
  }
  const metadata=await db.from('charito_fiscal_files').upsert({document_id:id,kind,path:scope.path,sha256:sha,bytes:size},{onConflict:'document_id,kind',ignoreDuplicates:true});
  if(metadata.error)return reply(503,'Archivo guardado; vuelve a sincronizar su índice.');
  return Response.json({saved:true,sha256:sha});
 }catch{return reply(400,'No se pudo procesar el archivo.');}
});
