function parseMagicProductText(rawText) {
  if (!rawText || !rawText.trim()) return null;
  let text = rawText.trim();
  text = text.replace(/^[\d#\*\-\.\)\•\>\s]+/, '').trim();
  let name = '', desc = '', price = '', sizes = [], flavors = '', extras = '';
  
  // 1. Explicit Sizes
  const sizesMatch = text.match(/(?:tamaños?|variaciones?|porciones?):?\s*([^-\n]+)/i);
  if (sizesMatch) {
    const rawSizes = sizesMatch[1].trim();
    rawSizes.split(/,|\//).forEach(item => {
      const trimmed = item.trim();
      const pMatch = trimmed.match(/(\d+(?:[.,]\d+)?)\s*(?:k|cop|usd|\$)?$/i);
      let sPrice = '', sName = trimmed;
      if (pMatch) {
        sPrice = pMatch[1].replace(/[.,]/g, '');
        sName = trimmed.replace(pMatch[0], '').trim();
      }
      if (sName) sizes.push({ name: sName, price: sPrice });
    });
    text = text.replace(sizesMatch[0], '').trim();
  }
  
  // 2. Explicit Flavors
  const flavorsMatch = text.match(/(?:sabores?|variantes?):?\s*([^-\n]+)/i);
  if (flavorsMatch) {
    flavors = flavorsMatch[1].trim();
    text = text.replace(flavorsMatch[0], '').trim();
  }
  
  // 3. Explicit Extras
  const extrasMatch = text.match(/(?:adicionales?|extras?|toppings?):?\s*([^-\n]+)/i);
  if (extrasMatch) {
    extras = extrasMatch[1].trim();
    text = text.replace(extrasMatch[0], '').trim();
  }
  
  // 4. Extract price: Check end of line/string first, or explicit $ / COP / USD tags
  const endPriceRegex = /(?:^|\s*[-–—|:,]\s*|\s+)(?:precio\s*:?\s*)?(?:\$|usd|cop)?\s*(\d{1,3}(?:[.,]\d{3})+|\d+)\s*(?:cop|usd|\$|k|mil)?\.?\s*$/i;
  const taggedPriceRegex = /(?:precio|valor|cuesta|vale|\$|cop|usd)\s*:?\s*(\d{1,3}(?:[.,]\d{3})+|\d+)\s*(?:cop|usd|\$|k|mil)?/i;
  
  let priceMatch = text.match(endPriceRegex) || text.match(taggedPriceRegex);
  if (priceMatch) {
    let rawP = priceMatch[1].replace(/[.,]/g, '');
    if (priceMatch[0].toLowerCase().includes('k') || priceMatch[0].toLowerCase().includes('mil')) {
      if (parseInt(rawP, 10) < 1000) rawP = String(parseInt(rawP, 10) * 1000);
    }
    price = rawP;
    text = text.substring(0, priceMatch.index) + text.substring(priceMatch.index + priceMatch[0].length);
    text = text.trim().replace(/[-–—|:,.\s]+$/, '').trim();
  }
  
  // 5. Split remaining text into Name and Description
  let parts = text.split(/\s*[-–—|:]\s*|\n+/).map(p => p.trim().replace(/^[-–—|:,.\s]+|[-–—|:,.\s]+$/g, '')).filter(p => p.length > 0);
  
  if (parts.length === 1) {
    const dotSplit = parts[0].split(/\.\s+/);
    if (dotSplit.length > 1 && dotSplit[0].length < 35 && dotSplit[1].length > 5) {
      name = dotSplit[0].trim();
      desc = dotSplit.slice(1).join('. ').trim();
    } else {
      name = parts[0];
    }
  } else if (parts.length === 2) {
    name = parts[0];
    if (!price && /^\d+$/.test(parts[1].replace(/[^\d]/g, '')) && !/[a-zA-Z]/.test(parts[1])) {
      price = parts[1].replace(/[^\d]/g, '');
    } else {
      desc = parts[1];
    }
  } else if (parts.length >= 3) {
    name = parts[0];
    if (!price && /^\d+$/.test(parts[parts.length - 1].replace(/[^\d]/g, '')) && !/[a-zA-Z]/.test(parts[parts.length - 1])) {
      price = parts[parts.length - 1].replace(/[^\d]/g, '');
      desc = parts.slice(1, -1).join(' - ');
    } else {
      desc = parts.slice(1).join(' - ');
    }
  }
  
  if (name) name = name.replace(/[-–—|:,.\s]+$/, '').trim();
  if (desc) desc = desc.replace(/[-–—|:,.\s]+$/, '').trim();
  return { name, desc, price, sizes, flavors, extras };
}

console.log('Test 1 (Pepito con cm y 25000.):', parseMagicProductText('Pepito Especial - pan de 40 cm, chuleta, chorizo ahumado, tocineta y vegetales, lomito. - 25000.'));
console.log('Test 2 (Pizza con tamaños y adicional):', parseMagicProductText('Pizza Pepperoni - 15 - Tamaños: Pequeña 10, Grande 20 - Adicionales: Tocineta 2'));
console.log('Test 3 (Hamburguesa con 200g y COP):', parseMagicProductText('Hamburguesa Monster: Doble carne 200g, queso cheddar, tocineta, salsa tártara. $18.000 COP'));
console.log('Test 4 (Perro con salto de línea):', parseMagicProductText('Perro Caliente Especial\nSalchicha alemana de 15 cm, queso fundido, papas trituradas\n12000'));
console.log('Test 5 (Pepito 40cm con $25.000):', parseMagicProductText('Pepito Mixto 40cm - carne, pollo, chuleta, queso - $25.000'));
