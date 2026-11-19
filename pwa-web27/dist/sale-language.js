export const normalizeVoice=s=>String(s??'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[¡!¿?;:]/g,' ').replace(/\s+/g,' ').trim();
const small={cero:0,un:1,uno:1,una:1,dos:2,tres:3,cuatro:4,cinco:5,seis:6,siete:7,ocho:8,nueve:9,diez:10,once:11,doce:12,trece:13,catorce:14,quince:15,dieciseis:16,diecisiete:17,dieciocho:18,diecinueve:19,veinte:20,veintiun:21,veintiuno:21,veintiuna:21,veintidos:22,veintitres:23,veinticuatro:24,veinticinco:25,veintiseis:26,veintisiete:27,veintiocho:28,veintinueve:29};
const tens={treinta:30,cuarenta:40,cincuenta:50,sesenta:60,setenta:70,ochenta:80,noventa:90};
const hundreds={cien:100,ciento:100,doscientos:200,trescientos:300,cuatrocientos:400,quinientos:500,seiscientos:600,setecientos:700,ochocientos:800,novecientos:900};
export function spanishNumber(raw){
 const s=normalizeVoice(raw).replace(/[.]+$/,'').trim();if(/^\d+(?:[.,]\d+)?$/.test(s))return Number(s.replace(',','.'));
 if(s==='medio'||s==='media')return .5;
 if(s.endsWith(' y medio')){const n=spanishNumber(s.slice(0,-8));return n===null?null:n+.5;}
 const decimal=s.split(/ (?:coma|punto) /);if(decimal.length===2){const base=spanishNumber(decimal[0]),digits=decimal[1].split(' ');const tail=digits.every(d=>small[d]>=0&&small[d]<10)?digits.map(d=>small[d]).join(''):spanishNumber(decimal[1]);return base===null||tail===null?null:Number(`${base}.${tail}`);}
 if(s in small)return small[s];if(s in tens)return tens[s];if(s in hundreds)return hundreds[s];
 const words=s.split(' '),k=words.indexOf('mil');if(k>=0){const a=k===0?1:spanishNumber(words.slice(0,k).join(' ')),b=k===words.length-1?0:spanishNumber(words.slice(k+1).join(' '));return a!==null&&a>0&&a<1000&&b!==null&&b<1000?a*1000+b:null;}
 if(words[0] in hundreds){const tail=spanishNumber(words.slice(1).join(' '));return tail!==null&&tail>0&&tail<100?hundreds[words[0]]+tail:null;}
 if(words.length===3&&words[0] in tens&&words[1]==='y'&&small[words[2]]>0&&small[words[2]]<10)return tens[words[0]]+small[words[2]];
 return null;
}
function prefixNumber(words){for(let n=Math.min(9,words.length);n>0;n--){const value=spanishNumber(words.slice(0,n).join(' '));if(value!==null)return {value,length:n};}return null;}
const numberWord=s=>/^[0-9]/.test(s)||s in small||s in tens||s in hundreds||['mil','medio','media'].includes(s);
function moneyNumber(raw){const s=raw.trim().replace(/soles?$/,'').trim(),split=s.split(/(?: soles?)? con /);if(split.length===2){const a=spanishNumber(split[0]),b=spanishNumber(split[1].replace(/ centimos?$/,''));return a!==null&&b!==null&&b>=0&&b<100?a+b/100:null;}if(/ centimos?$/.test(s)){const n=spanishNumber(s.replace(/ centimos?$/,''));return n===null?null:n/100;}return spanishNumber(s);}
function amountAfter(text){const words=text.replace(/^(?:\s*(?:con|de|por|en|fue|son|soles|s\/)\b)+/,'').trim().split(/\s+/);for(let n=Math.min(16,words.length);n>0;n--){const v=moneyNumber(words.slice(0,n).join(' '));if(v!==null)return v;}return null;}
function amountBefore(text){const words=text.trim().replace(/(?:\b(?:soles?|por|con|en)\s*)+$/,'').trim().split(/\s+/);for(let n=Math.min(16,words.length);n>0;n--){const number=moneyNumber(words.slice(-n).join(' '));if(number!==null)return number;}return null;}
function mentionedAmounts(text,re){const found=[];for(const m of text.matchAll(re)){const number=amountAfter(text.slice(m.index+m[0].length))??amountBefore(text.slice(0,m.index));if(number!==null)found.push(number);}return [...new Set(found)];}
const generic=new Set(['de','del','la','el','los','las','con','torta','tortas','unidades','unidad','y','para','numero','codigo']);
function productWords(raw){return normalizeVoice(raw).replace(/[❤️♥❤]/gu,' corazon ').replace(/t\s*\/\s*h\b/g,'torta helada').replace(/\b3\s*leches?\b/g,'tres leche').replace(/\b2\s*pisos?\b/g,'dos piso').replace(/[^a-z0-9]+/g,' ').split(' ').filter(Boolean).map(w=>({rectang:'rectangular',rectangulo:'rectangular',rectangulares:'rectangular',med:'mediana',md:'mediana',mediano:'mediana',gr:'grande',grandes:'grande',v:'vainilla',leches:'leche',heladas:'helada',elada:'helada',eladas:'helada',pequeno:'pequena',pequenos:'pequena',pequenas:'pequena',boc:'bocadito',bocaditos:'bocadito',bocadito:'bocadito',pasteles:'pastel',porciones:'porcion',velas:'vela',adornos:'adorno',bebidas:'bebida',pisos:'piso',muss:'mousse'}[w]||w)).filter(w=>!generic.has(w));}
function near(a,b){if(a===b)return true;if(a.length<5||Math.abs(a.length-b.length)>1)return false;let i=0,j=0,changes=0;while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue;}if(++changes>1)return false;if(a.length>=b.length)i++;if(b.length>=a.length)j++;}return changes+(i<a.length||j<b.length?1:0)<=1;}
export function matchProducts(description,products){const terms=productWords(description);if(!terms.length)return [];
 return products.map(p=>{const words=productWords(`${p.category} ${p.name} ${p.sku}`);let fuzzy=false;for(const t of terms){if(words.includes(t))continue;if(words.some(w=>near(t,w)))fuzzy=true;else return null;}return {id:p.id,fuzzy};}).filter(Boolean).sort((a,b)=>Number(a.fuzzy)-Number(b.fuzzy));
}
function splitItems(text){const words=text.replace(/,(?!\d)/g,' y ').split(' '),parts=[],current=[];for(let i=0;i<words.length;i++){if(['y','mas'].includes(words[i])&&numberWord(words[i+1])&&current.some(w=>!numberWord(w)&&!['y','ciento','cientos','unidad','unidades','paquete','paquetes','medio'].includes(w))){parts.push(current.join(' '));current.length=0;}else current.push(words[i]);}if(current.length)parts.push(current.join(' '));return parts;}
export function quantityFor(item,product){if(item.override!==undefined)return Number(item.override);if(product.unit!=='ciento')return item.unit==='hundred'?item.amount*100:item.unit==='pack'?item.amount*50:item.amount;return item.unit==='hundred'?item.amount:item.unit==='pack'?item.amount*.5:item.amount/100;}
export function parseSale(raw,products){
 let text=normalizeVoice(raw).replace(/[.]+$/,'');const errors=[];
 if(text.length>1500)errors.push('La frase es demasiado larga. Dicta una venta a la vez.');
 if(/\b(?:pedido|adelanto|devolucion|devuelve|devolvi|anular|cancela|dolares|euros|menos)\b/.test(text))errors.push('Este dictado admite ventas de inventario en soles. Revisa la frase y usa el módulo correspondiente para pedidos o devoluciones.');
 const store=text.match(/\btienda (grande|chica)\b/)?.[0]||null;text=text.replace(/\b(?:en |de |la )*tienda (grande|chica)\b/g,'').trim();
 const end=text.search(/\b(?:yapeo|yapio|yape|pago|pagaron|efectivo|entrego|recibi|dio|billete|descuento|total)\b/);const itemsText=(end<0?text:text.slice(0,end)).replace(/^(?:vendi|venta de|venta|vende|vendimos|he vendido)\s+/,'').replace(/\s+(?:y|por|con)\s*$/,'').trim();const pay=end<0?'':text.slice(end);
 const items=splitItems(itemsText).filter(Boolean).map(phrase=>{let words=phrase.split(' '),amount=1;const categoryStart=/^(?:tres|3) leches?\b|^(?:dos|2) pisos?\b/.test(phrase),count=categoryStart?null:prefixNumber(words);if(count){amount=count.value;words=words.slice(count.length);}let unit='piece';if(['ciento','cientos'].includes(words[0])){unit='hundred';words.shift();if(words[0]==='y'&&words[1]==='medio'){amount+=.5;words=words.slice(2);}}else if(['paquete','paquetes','bolsa','bolsas'].includes(words[0])){unit='pack';words.shift();}else if(['unidad','unidades'].includes(words[0]))words.shift();const description=words.join(' ').replace(/^de\s+/,'');const candidates=matchProducts(description,products);const exact=candidates.filter(c=>!c.fuzzy);return {phrase,description,amount,unit,candidates,productId:exact.length===1?exact[0].id:null};});
 if(!items.length)errors.push('No se encontraron productos. Di, por ejemplo: vendí una torta de vainilla rectangular.');if(items.length>20)errors.push('Dicta hasta 20 productos por venta.');
 const hasYape=/\b(?:yapeo|yapio|yape)\b/.test(pay),hasCash=/\b(?:efectivo|billete|entrego|recibi|dio)\b/.test(pay)||(!hasYape&&/\b(?:pago|pagaron)\b/.test(pay));
 const yapeValues=mentionedAmounts(pay,/\b(?:yapeo|yapio|yape)\b/g),cashValues=mentionedAmounts(pay,hasYape?/\b(?:efectivo|billete|entrego|recibi|dio)\b/g:/\b(?:pago|pagaron|efectivo|billete|entrego|recibi|dio)\b/g);
 if(yapeValues.length>1||cashValues.length>1)errors.push('Se mencionaron varios importes para el mismo medio de pago. Corrige la frase.');
 if(hasYape&&!hasCash){const genericAmounts=mentionedAmounts(pay,/\b(?:pago|pagaron)\b/g);if(genericAmounts.some(n=>yapeValues.length&&n!==yapeValues[0]))errors.push('Se mencionaron importes diferentes. Especifica el efectivo y el Yape por separado.');}
 const discount=pay.match(/\bdescuento\b(.*)/),total=pay.match(/\btotal\b(.*)/);
 if(discount&&amountAfter(discount[1])===null)errors.push('No se entendió el descuento. Indica un importe en soles.');
 return {transcript:String(raw).trim(),store,items,errors,payment:{mode:hasYape&&hasCash?'mixed':hasYape?'yape':hasCash?'cash':'',received:cashValues[0]??null,yape:yapeValues[0]??null,discount:discount?amountAfter(discount[1]):0,declaredTotal:total?amountAfter(total[1]):null}};
}
export function settlePayment(total,mode,received,yape){
 const cents=v=>Math.round(Number(v)*100),t=cents(total),y=mode==='cash'?0:yape===null||yape===''?mode==='yape'?t:0:cents(yape),cash=mode==='yape'?0:Math.max(0,t-y),given=received===null||received===''?null:cents(received);
 const invalid=v=>v!==null&&v!==''&&(!Number.isFinite(Number(v))||Number(v)<0||Math.abs(Number(v)*100-cents(v))>1e-7);let error='';if(invalid(received)||invalid(yape))error='Usa importes positivos con un máximo de dos decimales.';else if(mode==='cash'&&Number(yape)>0)error='Hay un Yape indicado. Elige Yape o ambos medios de pago.';else if(mode==='yape'&&Number(received)>0)error='Hay efectivo entregado. Elige ambos medios o corrige el efectivo.';else if(!['cash','yape','mixed'].includes(mode))error='Elige el medio de pago.';else if(!Number.isFinite(t)||t<0||!Number.isFinite(y)||y<0)error='Revisa los importes.';else if(y>t)error='El Yape supera el precio de la venta. Revisa el monto; no se asume un descuento ni una devolución.';else if(mode==='yape'&&y!==t)error=`El Yape debe cubrir el total de la venta.`;else if(cash>0&&given!==null&&(!Number.isFinite(given)||given<cash))error='El efectivo entregado no alcanza para completar el pago.';
 return {cash:cash/100,yape:y/100,change:given===null||cash===0?0:Math.max(0,given-cash)/100,received:given===null?null:given/100,error};
}
export function correctSale(draft,raw,products){
 const text=normalizeVoice(raw),copy=JSON.parse(JSON.stringify(draft));
 if(/^(?:pago|pagaron|yapeo|yape|efectivo)\b/.test(text)){
  const parsed=parseSale('vendi un producto '+text,products);copy.payment=parsed.payment;copy.errors=parsed.errors;return copy;
 }
 const remove=text.match(/^(?:quita|quitar|elimina) (.+)$/),change=text.match(/^(?:cambia|cambiar)(?: (.+?))? a (.+)$/);
 if(!remove&&!change)throw Error('Di «cambia a dos», «quita la vela» o «pagó por Yape».');
 const target=(remove?.[1]||change?.[1]||'').replace(/^(?:el|la|los|las) /,'');
 const matches=target?matchProducts(target,products).map(p=>p.id):[];
 const indices=copy.items.map((item,i)=>({item,i})).filter(({item,i})=>target?matches.includes(item.productId):i===copy.items.length-1);
 if(indices.length!==1)throw Error('La corrección coincide con varios productos o ninguno. Indica el nombre completo o usa los controles.');
 const index=indices[0].i;
 if(remove){copy.items.splice(index,1);if(!copy.items.length)throw Error('La venta necesita al menos un producto.');}
 else {const qty=spanishNumber(change[2]);if(qty===null||qty<=0)throw Error('No se entendió la nueva cantidad.');copy.items[index].override=qty;}
 return copy;
}
