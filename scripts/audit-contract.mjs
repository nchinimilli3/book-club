import fs from 'node:fs';
const data=fs.readFileSync('src/lib/data.ts','utf8');
const contract=fs.readFileSync('supabase/SCHEMA_CONTRACT.md','utf8');
const tables=[...new Set([...data.matchAll(/\.from\('([^']+)'\)/g)].map(m=>m[1]))].sort();
const rpcs=[...new Set([...data.matchAll(/\.rpc\('([^']+)'/g)].map(m=>m[1]))].sort();
const missing=[...tables,...rpcs].filter(x=>!contract.includes('`'+x) && !contract.includes(x+'('));
if(missing.length) throw new Error('Schema contract missing runtime refs: '+missing.join(', '));
console.log(`Schema contract covers ${tables.length} tables and ${rpcs.length} RPCs.`);
