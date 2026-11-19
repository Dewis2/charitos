export const ROLE_LABELS={admin:'Administrador',manager:'Encargado de tienda',worker:'Vendedor',owner:'Gerente',warehouse:'Almacenero',baker:'Quequero'};
export const WORKSHOP_ROLES=['admin','owner','warehouse','baker'];
export const SHOP_ROLES=['admin','manager','worker'];
export const canWorkshop=role=>WORKSHOP_ROLES.includes(role);
export const canReports=role=>['admin','owner'].includes(role);
export const workshopOnly=role=>canWorkshop(role)&&!SHOP_ROLES.includes(role);
export const initialView=role=>canReports(role)?'stock_general':workshopOnly(role)?'recetas':'elegir_turno';
export const canView= (role,view)=>view==='recetas'?canWorkshop(role):['stock_general','reporte_ventas'].includes(view)?canReports(role):['usuarios','control'].includes(view)?role==='admin':workshopOnly(role)?view==='seguridad':true;
export const canEditRecipes=role=>['admin','owner','baker'].includes(role);
export const canApproveRecipes=role=>['admin','owner'].includes(role);
export const UNITS=['g','kg','mL','L','unidad','tarro'];
export function scaleIngredients(ingredients,batches){
 const factor=Number(batches);
 if(!Number.isFinite(factor)||factor<0.001||factor>1000)throw Error('Indica entre 0,001 y 1.000 tandas.');
 return ingredients.map(item=>{const quantity=Number(item.quantity);if(!Number.isFinite(quantity)||quantity<=0)throw Error('La receta contiene una cantidad inválida.');return {...item,required:Math.round(quantity*factor*1000000)/1000000};});
}
export function recipePayload(form){
 const number=value=>value===''?null:Number(value);
 const ingredients=[...form.querySelectorAll('[data-recipe-line]')].map(line=>({
  name:line.querySelector('[data-ingredient-name]').value.trim(),quantity:number(line.querySelector('[data-ingredient-qty]').value),unit:line.querySelector('[data-ingredient-unit]').value,
  confirmed:line.querySelector('[data-ingredient-confirmed]').checked,note:line.querySelector('[data-ingredient-note]').value.trim()
 }));
 if(!ingredients.length||ingredients.length>100)throw Error('Agrega entre 1 y 100 ingredientes.');
 for(const item of ingredients){if(!item.name||!Number.isFinite(item.quantity)||item.quantity<=0||item.quantity>1000000000||!UNITS.includes(item.unit))throw Error('Revisa el nombre, la cantidad y la unidad de cada ingrediente.');}
 const outputQty=number(form.elements.output_qty.value);
 if(outputQty!==null&&(!Number.isFinite(outputQty)||outputQty<=0||outputQty>1000000000))throw Error('Revisa el rendimiento por tanda.');
 return {name:form.elements.name.value.trim(),notes:form.elements.notes.value.trim(),output_qty:outputQty,output_unit:form.elements.output_unit.value.trim(),yield_confirmed:form.elements.yield_confirmed.checked,ingredients};
}
