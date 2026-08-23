import fs from 'node:fs';
const must=['src/App.tsx','src/styles/global.css','supabase/migrations/001_initial.sql','worker/index.js','.env.example'];
for(const f of must){if(!fs.existsSync(f)) throw new Error(`Missing ${f}`)}
const sql=fs.readFileSync('supabase/migrations/001_initial.sql','utf8');
for(const token of ['enable row level security','club_members','book_context_items','posts','votes']) if(!sql.includes(token)) throw new Error(`Schema missing ${token}`);
console.log('BOOK CLUB smoke checks passed.');
