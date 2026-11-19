export const FISCAL_STATUS={queued:'En cola',preparing:'Preparando',blocked:'Sin exportar · revisar',exported:'En SFS · pendiente de respuesta',accepted:'Aceptado por SUNAT',rejected:'Rechazado por SUNAT',needs_review:'Requiere revisión',cancelled:'Solicitud cancelada'};
export const fiscalReference=d=>`${d.series}-${String(d.number).padStart(8,'0')}`;
export function validRuc(value){if(!/^\d{11}$/.test(value))return false;const weights=[5,4,3,2,7,6,5,4,3,2];return (11-weights.reduce((n,w,i)=>n+w*Number(value[i]),0)%11)%10===Number(value[10]);}
export function customerIssue(kind,type,number,name,total){
 if(!['01','03'].includes(kind))return 'Selecciona boleta o factura.';
 if(type==='0')return kind==='01'||Number(total)>700?'Este comprobante requiere identificar al cliente.':'';
 if(type==='1'&&(kind==='01'||!/^\d{8}$/.test(number)))return 'Usa un DNI de 8 dígitos; una factura requiere RUC.';
 if(type==='6'&&!validRuc(number))return 'Revisa los 11 dígitos del RUC.';
 if(!['1','6'].includes(type))return 'Selecciona un tipo de documento.';
 if(name.trim().length<3||name.trim().length>250)return 'Completa el nombre o razón social.';
 return '';
}
export function fiscalReadiness(home,now=Date.now()){
 const c=home?.company,s=home?.store,a=home?.connector;
 if(!c?.enabled||!c?.eligibility_confirmed||!s?.verified)return 'Configuración pendiente';
 if(!a?.active||Date.parse(a.expires_at)<=now)return 'Conector pendiente';
 if(!a.last_seen_at||now-Date.parse(a.last_seen_at)>180000)return 'PC desconectada';
 return '';
}
