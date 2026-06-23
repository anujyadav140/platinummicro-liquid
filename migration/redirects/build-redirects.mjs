import { writeFileSync } from 'fs';
const BC = 'https://www.platinummicro.com/xmlsitemap.php';
const SHOP = 'https://platinum-micro.myshopify.com';

const get = async (u) => { for (let i=0;i<3;i++){ try { const r = await fetch(u); if (r.ok) return await r.text(); } catch(e){} } return ''; };
const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].replace(/&amp;/g,'&'));
const pathOf = (u) => { try { return new URL(u).pathname; } catch(e){ return u; } };
const stripSlash = (p) => p.length>1 ? p.replace(/\/+$/,'') : p;
const leaf = (p) => stripSlash(p).split('/').filter(Boolean).pop() || '';
const handleize = (s) => s.toLowerCase().trim().replace(/\.html?$/,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');

// ---- BIGCOMMERCE (old) ----
const bc = { products: [], categories: [], brands: [], pages: [] };
for (const t of ['products','categories','brands','pages']) {
  for (let pg=1; pg<=30; pg++) {
    const xml = await get(`${BC}?type=${t}&page=${pg}`);
    const ls = locs(xml).filter(u => !u.includes('xmlsitemap'));
    if (!ls.length) break;
    bc[t].push(...ls);
    if (ls.length < 50) break;
  }
}

// ---- SHOPIFY (new) ----
const idx = await get(`${SHOP}/sitemap.xml`);
const subs = locs(idx);
const shop = { products: new Set(), collections: new Set(), pages: new Set(), blogs: new Set() };
for (const s of subs) {
  const xml = await get(s);
  for (const u of locs(xml)) {
    const p = pathOf(u);
    if (p.startsWith('/products/'))      shop.products.add(leaf(p));
    else if (p.startsWith('/collections/')) shop.collections.add(leaf(p));
    else if (p.startsWith('/pages/'))    shop.pages.add(leaf(p));
    else if (p.startsWith('/blogs/'))    shop.blogs.add(leaf(p));
  }
}

// ---- MATCH ----
const rows = [['Redirect from','Redirect to']];
const unmatched = [];
let mProd=0, mCat=0, mBrand=0, mPage=0;

// products: /<slug>/ -> /products/<slug>
for (const u of bc.products) {
  const slug = leaf(pathOf(u));
  if (shop.products.has(slug)) { rows.push([`/${slug}`, `/products/${slug}`]); mProd++; }
  else unmatched.push(['product', pathOf(u)]);
}
// categories: leaf OR any ancestor segment -> /collections/<seg> (subcat falls back to parent)
for (const u of bc.categories) {
  const p = stripSlash(pathOf(u));
  const segs = p.split('/').filter(Boolean);
  let hit = '';
  for (let i = segs.length - 1; i >= 0; i--) { if (shop.collections.has(segs[i])) { hit = segs[i]; break; } }
  if (hit) { rows.push([p, `/collections/${hit}`]); mCat++; }
  else unmatched.push(['category', p, `/search?q=${segs[segs.length-1] || ''}&type=product`]);
}
// brands: /brands/Name.html -> /collections/<handle> if exists, else a brand-search suggestion
for (const u of bc.brands) {
  const p = stripSlash(pathOf(u)); const name = leaf(p).replace(/\.html?$/,''); const h = handleize(name);
  if (h && shop.collections.has(h)) { rows.push([p, `/collections/${h}`]); mBrand++; }
  else unmatched.push(['brand', p, name ? `/search?q=${name}&type=product` : '/collections']);
}
// pages: /<slug>/ -> /pages/<slug> or /collections/<slug>
for (const u of bc.pages) {
  const p = stripSlash(pathOf(u)); const lf = leaf(p);
  if (!lf) continue; // homepage
  if (shop.pages.has(lf)) { rows.push([p, `/pages/${lf}`]); mPage++; }
  else if (shop.collections.has(lf)) { rows.push([p, `/collections/${lf}`]); mPage++; }
  else unmatched.push(['page', p, `/pages/${lf}`]);
}

const csv = rows.map(r => r.map(c => /[",]/.test(c) ? `"${c.replace(/"/g,'""')}"` : c).join(',')).join('\r\n');
writeFileSync('C:/tmp/pmaudit/redirects.csv', csv);
const un = unmatched.map(r => r.join(',')).join('\r\n');
writeFileSync('C:/tmp/pmaudit/redirects_unmatched.csv', 'type,old_path,suggested_to\r\n'+un);

console.log('=========== BC → Shopify 301 REDIRECT MAP ===========');
console.log(`BC products:   ${bc.products.length}  | matched ${mProd}  (${(mProd/bc.products.length*100).toFixed(1)}%)`);
console.log(`BC categories: ${bc.categories.length}  | matched ${mCat}`);
console.log(`BC brands:     ${bc.brands.length}  | matched ${mBrand}`);
console.log(`BC pages:      ${bc.pages.length}  | matched ${mPage}`);
console.log(`Shopify: ${shop.products.size} products, ${shop.collections.size} collections, ${shop.pages.size} pages`);
console.log('-----------------------------------------------------');
console.log(`TOTAL redirects written: ${rows.length-1}`);
console.log(`Unmatched (need review): ${unmatched.length}`);
console.log('Files: redirects.csv , redirects_unmatched.csv');
console.log('\nSample redirects:');
rows.slice(1,6).forEach(r => console.log(`  ${r[0]}  ->  ${r[1]}`));
console.log('\nUnmatched sample by type:');
['product','category','brand','page'].forEach(t => { const s = unmatched.filter(x=>x[0]===t).slice(0,3); s.forEach(x=>console.log(`  [${t}] ${x[1]}`)); });
