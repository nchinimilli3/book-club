import fs from 'node:fs';import path from 'node:path';import ts from 'typescript';
const root=path.resolve(process.cwd());
const src=path.join(root,'src');
const files=[];function walk(d){for(const n of fs.readdirSync(d)){const p=path.join(d,n),st=fs.statSync(p);if(st.isDirectory())walk(p);else if(/\.(tsx|ts)$/.test(n))files.push(p)}}walk(src);
const failures=[],warnings=[];
const text=files.map(f=>fs.readFileSync(f,'utf8')).join('\n');
for(const [label,re] of [['demo runtime',/demoClubs|demoBooks|demoMembers/],['hardcoded Rebecca',/\bREBECCA\b|\bRebecca\b/],['hardcoded Sunday Readers',/Sunday Readers/],['unfinished copy',/Not wired|Coming soon|TODO:|FIXME:/],['blocking alert',/\balert\s*\(/],['dead hash link',/href=["']#["']/]])if(re.test(text))failures.push(label);
const allowedLiteralRoutes=new Set(['/','/clubs','/search','/me','/me/settings','/notifications']);
for(const f of files.filter(x=>x.endsWith('.tsx'))){
 const code=fs.readFileSync(f,'utf8');const sf=ts.createSourceFile(f,code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 function visit(n){
  if(ts.isJsxElement(n)||ts.isJsxSelfClosingElement(n)){
    const opening=ts.isJsxElement(n)?n.openingElement:n;const tag=opening.tagName.getText(sf);
    if(tag==='button'){
      const attrs=opening.attributes.properties.filter(ts.isJsxAttribute);const names=new Set(attrs.map(a=>a.name.getText(sf)));
      const hasAction=names.has('onClick')||names.has('onPointerDown')||names.has('onMouseDown')||attrs.some(a=>a.name.getText(sf)==='type'&&a.initializer?.getText(sf).includes('submit'));
      if(!hasAction){const pos=sf.getLineAndCharacterOfPosition(opening.pos);failures.push(`button without action: ${path.relative(root,f)}:${pos.line+1}`)}
    }
  }
  if(ts.isCallExpression(n)&&ts.isIdentifier(n.expression)&&['nav','navigate'].includes(n.expression.text)&&n.arguments.length){
    const a=n.arguments[0];if(ts.isStringLiteral(a)&&!allowedLiteralRoutes.has(a.text)&&!a.text.startsWith('/clubs/'))warnings.push(`unknown literal route ${a.text} in ${path.relative(root,f)}`)
  }
  ts.forEachChild(n,visit)
 }visit(sf)
}
const data=fs.readFileSync(path.join(src,'lib/data.ts'),'utf8');const sql=fs.readFileSync(path.join(root,'supabase/migrations/009_FINAL_RELEASE.sql'),'utf8');
const rpcs=[...data.matchAll(/\.rpc\('([^']+)'/g)].map(m=>m[1]);for(const rpc of new Set(rpcs)){if(!new RegExp(`function\\s+public\\.${rpc.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')}\\s*\\(`,'i').test(sql))failures.push(`RPC used by frontend missing from 009: ${rpc}`)}
const stickerFile=fs.readFileSync(path.join(src,'lib/stickers.tsx'),'utf8');for(const m of stickerFile.matchAll(/src:\s*['"]([^'"]+)['"]/g)){if(!m[1].startsWith('/'))continue;const p=path.join(root,'public',m[1].replace(/^\//,''));if(!fs.existsSync(p))failures.push(`missing sticker asset: ${m[1]}`)}
const dollars=(sql.match(/\$\$/g)||[]).length;if(dollars%2)failures.push('009 has unbalanced $$ delimiters');
const begin=(sql.match(/\bbegin;/gi)||[]).length,commit=(sql.match(/\bcommit;/gi)||[]).length;if(commit!==1)warnings.push(`009 contains ${commit} commit statements`);
console.log(`Release audit: ${files.length} source files, ${new Set(rpcs).size} RPC contracts.`);for(const w of warnings)console.log('WARN',w);if(failures.length){for(const x of failures)console.error('FAIL',x);process.exit(1)}console.log('PASS static button/route/runtime/RPC/sticker checks');
