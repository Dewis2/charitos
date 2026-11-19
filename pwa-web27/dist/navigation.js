import {canWorkshop,workshopOnly,canView} from './workshop-model.js';
const items={
 elegir_turno:['Elegir tienda y turno','M3 10l4-6h10l4 6 M4 10v11h16V10 M9 21v-7h6v7'],
 recetas:['Recetas del taller','M4 3h16v18H4z M8 7h8 M8 11h8 M8 15h5'],
 inicio:['Abrir y ver turno','M4 4h16v16H4z M8 2v4 M16 2v4 M4 9h16'],
 ventas:['Cobrar ventas','M3 4h3l2 11h10l3-8H7 M10 20h.01 M18 20h.01'],
 pedidos:['Pedidos y adelantos','M6 3h12v18H6z M9 7h6 M9 11h6 M9 15h4'],
 comprobantes:['Boletas y facturas','M6 3h12v18l-3-2-3 2-3-2-3 2V3 M9 7h6 M9 11h6 M9 15h4'],
 caja:['Egresos, cobros y retiros','M3 6h18v14H3z M3 10h18 M16 15h2 M6 3v3'],
 inventario:['Contar productos','M4 5h16v16H4z M8 2v6 M16 2v6 M8 12h3 M8 16h3 M15 12h2 M15 16h2'],
 movimientos:['Entradas, descartes y cortes','M12 3v18 M3 12h18 M7 7l5-4 5 4 M7 17l5 4 5-4'],
 transferencias:['Enviar y recibir productos','M3 7h17l-4-4 M21 17H4l4 4'],
 productos:['Catálogo y precios','M4 3h16v18H4z M8 7h8 M8 11h8 M8 15h5'],
 cierre:['Cuadrar y cerrar caja','M5 4h14v17H5z M8 1v6 M16 1v6 M8 14l3 3 5-6'],
 historial:['Cierres y entrega de bolsas','M4 6h16v15H4z M8 3h8 M8 10h8 M8 14h8 M8 18h4'],
 stock_general:['Stock de ambas tiendas','M3 10l4-6h10l4 6 M4 10v11h16V10 M9 21v-7h6v7 M2 10h20'],
 reporte_ventas:['Reportes de ventas','M4 21V3 M4 21h17 M8 17V11 M13 17V7 M18 17V4'],
 usuarios:['Usuarios y permisos','M16 20v-3a4 4 0 0 0-8 0v3 M8 6a4 4 0 1 0 8 0 4 4 0 0 0-8 0 M20 10v6 M17 13h6'],
 control:['Auditoría y copias','M12 2l8 4v6c0 5-8 10-8 10S4 17 4 12V6z M8 12l3 3 5-6'],
 seguridad:['Mi acceso y contraseña','M6 10h12v11H6z M8 10V6a4 4 0 0 1 8 0v4 M12 14v3']
};
export const NAV_LABELS=Object.fromEntries(Object.entries(items).map(([id,[label]])=>[id,label]));
const groups=[['Atención y caja',['elegir_turno','inicio','ventas','comprobantes','pedidos','caja']],['Productos y tiendas',['inventario','movimientos','transferencias','productos']],['Cierre del turno',['cierre','historial']],['Administración',['stock_general','reporte_ventas','usuarios','control']],['Taller y almacén',['recetas']],['Mi cuenta',['seguridad']]];
export function renderNavigation(role,active,esc){return groups.map(([label,ids])=>{const visible=ids.filter(id=>canView(role,id));return visible.length?`<section class="nav-group"><h3>${label}</h3><div class="nav-items">${visible.map(id=>`<button type="button" data-nav="${id}" class="${active===id?'active':''}" ${active===id?'aria-current="page"':''}><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${items[id][1]}"/></svg><span>${esc(items[id][0])}</span></button>`).join('')}</div></section>`:'';}).join('');}
