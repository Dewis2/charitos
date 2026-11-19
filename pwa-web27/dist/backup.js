// Business-data exports. These files deliberately exclude Auth, schema and photo files.
export const BACKUP_TABLES={
 charito_stores:['id'],charito_members:['user_id'],charito_store_members:['user_id','store_id'],
 charito_products:['id'],charito_shifts:['id'],charito_counts:['shift_id','product_id'],
 charito_transfers:['id'],charito_transfer_lines:['transfer_id','product_id'],charito_workshop_returns:['id'],
 charito_stock_movements:['id'],charito_orders:['id'],charito_cash_entries:['id'],charito_closures:['shift_id'],
 charito_bags:['id'],charito_sales:['id'],charito_sale_lines:['sale_id','product_id'],
 charito_order_advances:['id'],charito_order_history:['id']
};
const FORMAT='charito-copia-cifrada-v1',iterations=600000,limit=64*1024*1024;
const encode=new TextEncoder(),decode=new TextDecoder('utf-8',{fatal:true});
const b64=bytes=>{let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);};
const un64=s=>{if(typeof s!=='string'||s.length>limit*1.5||!/^[A-Za-z0-9+/]*={0,2}$/.test(s))throw Error('Archivo de copia inválido.');return Uint8Array.from(atob(s),c=>c.charCodeAt(0));};
const passwordCheck=p=>{if(typeof p!=='string'||[...p].length<12||p.length>1024)throw Error('La clave de la copia debe tener entre 12 y 1024 caracteres.');};
const aad=encode.encode(FORMAT);
async function key(password,salt,usage){passwordCheck(password);const raw=await crypto.subtle.importKey('raw',encode.encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations,hash:'SHA-256'},raw,{name:'AES-GCM',length:256},false,[usage]);}
export function validateCopy(copy){
 if(copy?.format!=='charito-datos-v1'||copy.project!=='example-project'||!copy.tables||!copy.counts||!Number.isFinite(Date.parse(copy.started_at))||!Number.isFinite(Date.parse(copy.finished_at)))throw Error('La copia no corresponde a Charito o está incompleta.');
 const names=Object.keys(BACKUP_TABLES);if(Object.keys(copy.tables).length!==names.length)throw Error('Faltan tablas en la copia.');
 const sets={};for(const name of names){const rows=copy.tables[name],keys=BACKUP_TABLES[name];if(!Array.isArray(rows)||rows.length!==copy.counts[name])throw Error('Conteo inválido: '+name);const ids=new Set();for(const r of rows){if(!r||typeof r!=='object'||keys.some(k=>r[k]===null||r[k]===undefined))throw Error('Registro incompleto: '+name);const id=JSON.stringify(keys.map(k=>r[k]));if(ids.has(id))throw Error('Registro duplicado: '+name);ids.add(id);}sets[name]=new Set(rows.map(r=>String(r[keys[0]])));}
 const references={charito_store_members:{user_id:'charito_members',store_id:'charito_stores'},charito_shifts:{store_id:'charito_stores'},charito_counts:{shift_id:'charito_shifts',product_id:'charito_products'},charito_transfers:{source_store_id:'charito_stores',destination_store_id:'charito_stores'},charito_transfer_lines:{transfer_id:'charito_transfers',product_id:'charito_products'},charito_stock_movements:{shift_id:'charito_shifts',product_id:'charito_products'},charito_orders:{store_id:'charito_stores'},charito_cash_entries:{store_id:'charito_stores',shift_id:'charito_shifts',sale_id:'charito_sales',order_id:'charito_orders'},charito_closures:{shift_id:'charito_shifts'},charito_bags:{shift_id:'charito_shifts'},charito_sales:{shift_id:'charito_shifts',store_id:'charito_stores'},charito_sale_lines:{sale_id:'charito_sales',product_id:'charito_products'},charito_order_advances:{order_id:'charito_orders'},charito_order_history:{order_id:'charito_orders'},charito_workshop_returns:{store_id:'charito_stores',product_id:'charito_products'}};
 for(const [name,refs]of Object.entries(references))for(const row of copy.tables[name])for(const [field,table]of Object.entries(refs))if(row[field]!=null&&!sets[table].has(String(row[field])))throw Error('Los datos cambiaron durante la copia o falta una referencia. Reintenta cuando no estén registrando operaciones.');
 return {tables:names.length,rows:names.reduce((n,k)=>n+copy.counts[k],0),finished:copy.finished_at,consistent:false};
}
export async function encryptCopy(copy,password){validateCopy(copy);const plain=encode.encode(JSON.stringify(copy));if(plain.length>limit)throw Error('La copia supera 64 MB. Usa el respaldo de PostgreSQL.');const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},await key(password,salt,'encrypt'),plain);return JSON.stringify({format:FORMAT,cipher:'AES-256-GCM',kdf:'PBKDF2-SHA-256',iterations,salt:b64(salt),iv:b64(iv),data:b64(new Uint8Array(encrypted))});}
export async function decryptCopy(text,password){
 if(text.length>limit*1.5)throw Error('Archivo demasiado grande.');let outer;try{outer=JSON.parse(text);}catch{throw Error('Archivo de copia inválido.');}
 if(outer?.format!==FORMAT||outer.cipher!=='AES-256-GCM'||outer.kdf!=='PBKDF2-SHA-256'||outer.iterations!==iterations)throw Error('Formato de copia no compatible.');
 const salt=un64(outer.salt),iv=un64(outer.iv),bytes=un64(outer.data);if(salt.length!==16||iv.length!==12||bytes.length<16||bytes.length>limit+16)throw Error('Archivo de copia inválido.');
 let copy;try{copy=JSON.parse(decode.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:aad},await key(password,salt,'decrypt'),bytes)));}catch{throw Error('Clave incorrecta o copia dañada.');}validateCopy(copy);return copy;
}
export async function collectCopy(db,guard,active,progress=()=>{}){
 const started_at=new Date().toISOString(),tables={},counts={};
 for(const [name,keys]of Object.entries(BACKUP_TABLES)){
  await guard();if(!active())throw Error('La sesión cambió. Vuelve a iniciar la copia.');const rows=[];
  for(let start=0;start<500000;start+=500){let query=db.from(name).select('*');for(const k of keys)query=query.order(k);const r=await query.range(start,start+499);if(r.error)throw Error('No se pudo copiar '+name+': '+r.error.message);if(!active())throw Error('Copia cancelada por cambio de sesión.');rows.push(...(r.data||[]));if((r.data||[]).length<500)break;if(start===499500)throw Error('Demasiados registros; usa el respaldo de PostgreSQL.');}
  tables[name]=rows;counts[name]=rows.length;progress(Object.keys(tables).length,Object.keys(BACKUP_TABLES).length);
 }
 const copy={format:'charito-datos-v1',project:'example-project',started_at,finished_at:new Date().toISOString(),consistent:false,excludes:['Auth y contraseñas','Fotos de Storage','Esquema y funciones SQL','Auditoría y controles internos'],tables,counts};validateCopy(copy);return copy;
}
