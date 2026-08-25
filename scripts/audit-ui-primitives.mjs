import fs from 'node:fs';
import crypto from 'node:crypto';

const read=p=>fs.readFileSync(p,'utf8');
const required=[
  'src/components/BookRail.tsx','src/components/BookAddMenu.tsx','src/components/PageState.tsx','src/components/AppErrorBoundary.tsx','src/lib/catalog.ts'
];
for(const p of required)if(!fs.existsSync(p))throw new Error(`Missing production UI primitive: ${p}`);
const search=read('src/pages/SearchPage.tsx');
for(const name of ['BookRail','BookAddMenu','PageState'])if(!search.includes(name))throw new Error(`SearchPage must use shared ${name}`);
if(search.includes('const DiscoveryRail='))throw new Error('SearchPage contains a forked DiscoveryRail implementation.');
const lock=read('ACRYLIC_LOCK.sha256').split(/\r?\n/).filter(Boolean).map(line=>line.trim().split(/\s+/)[0]);
const files=['src/components/AcrylicBookshelf.tsx','src/components/acrylic-bookshelf.css'];
for(let i=0;i<files.length;i++){
  const hash=crypto.createHash('sha256').update(fs.readFileSync(files[i])).digest('hex');
  if(hash!==lock[i])throw new Error(`Locked acrylic file changed: ${files[i]}`);
}
console.log('Production UI primitive audit passed; acrylic lock intact.');
