// Keep the category sequence shown by the sales catalogue (SKU order).
// Sorting copies avoids reordering shared application data or saved counts.
const compareText=new Intl.Collator('es',{numeric:true,sensitivity:'base'}).compare;
export function categoryOrder(products){
 const ordered=[...products].sort((a,b)=>Number(a.active===false)-Number(b.active===false)||compareText(a.sku||'',b.sku||'')||compareText(a.id||'',b.id||''));
 return [...new Set(ordered.map(p=>p.category||''))];
}
export function sortProducts(items,catalog,{product=item=>item,price=item=>product(item)?.price}={}){
 const ranks=new Map(categoryOrder(catalog).map((category,i)=>[category,i]));
 return [...items].sort((a,b)=>{
  const p=product(a)||{},q=product(b)||{},left=ranks.get(p.category||'')??Infinity,right=ranks.get(q.category||'')??Infinity;
  const category=left===right?compareText(p.category||'',q.category||''):left-right;
  const aPrice=Number(price(a)),bPrice=Number(price(b));
  return category||(Number.isFinite(bPrice)?bPrice:0)-(Number.isFinite(aPrice)?aPrice:0)||compareText(p.name||'',q.name||'')||compareText(p.sku||'',q.sku||'')||compareText(p.id||'',q.id||'');
 });
}
