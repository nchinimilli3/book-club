import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

const stylesRoot='src/styles';
const cssFiles=[];
function walk(dir){
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory())walk(full);
    else if(entry.isFile()&&entry.name.endsWith('.css')&&entry.name!=='index.css')cssFiles.push(full);
  }
}
walk(stylesRoot);
cssFiles.sort();
const css=cssFiles.map(file=>fs.readFileSync(file,'utf8')).join('\n');
const root=postcss.parse(css,{from:'split-css-bundle'});
const importantCount=(css.match(/!important/g)||[]).length;
const selectorCounts=new Map();
const selectorContextCounts=new Map();
const mediaCounts=new Map();
const protectedPatterns=[/\.acrylic[-A-Za-z0-9_]*/,/\.home-acrylic[-A-Za-z0-9_]*/,/\.profile-acrylic[-A-Za-z0-9_]*/,/\.shelf-object\b/,/\.shelf-track\b/,/\.shelf-books-new\b/,/\.shelf-book[-A-Za-z0-9_]*/];
function context(rule){const parts=[];let p=rule.parent;while(p&&p.type!=='root'){if(p.type==='atrule')parts.push(`@${p.name} ${p.params}`);p=p.parent}return parts.reverse().join('|')||'base'}
function inKeyframes(rule){let p=rule.parent;while(p&&p.type!=='root'){if(p.type==='atrule'&&/keyframes$/i.test(p.name))return true;p=p.parent}return false}
root.walkAtRules('media',at=>mediaCounts.set(at.params,(mediaCounts.get(at.params)||0)+1));
root.walkRules(rule=>{for(const selector of rule.selectors||[rule.selector]){selectorCounts.set(selector,(selectorCounts.get(selector)||0)+1);if(!inKeyframes(rule)){const key=`${context(rule)}||${selector}`;selectorContextCounts.set(key,(selectorContextCounts.get(key)||0)+1)}}});
const repeated=[...selectorCounts].filter(([,n])=>n>1);
const sameContext=[...selectorContextCounts].filter(([,n])=>n>1);
const nonProtected=sameContext.filter(([key])=>!protectedPatterns.some(re=>re.test(key.split('||').slice(1).join('||'))));
console.log('CSS architecture audit');
console.log(`- ${cssFiles.length} owned CSS files under ${stylesRoot}`);
console.log(`- ${cssFiles.reduce((n,f)=>n+fs.readFileSync(f,'utf8').split(/\r?\n/).length,0).toLocaleString()} total lines`);
console.log(`- ${Buffer.byteLength(css).toLocaleString()} total CSS bytes`);
console.log(`- ${importantCount.toLocaleString()} !important tokens`);
console.log(`- ${mediaCounts.size} unique media queries across ${[...mediaCounts.values()].reduce((a,b)=>a+b,0)} blocks`);
console.log(`- ${repeated.length.toLocaleString()} selector strings reused across base/responsive contexts`);
console.log(`- ${sameContext.length.toLocaleString()} same-context duplicate selector groups`);
console.log(`- ${nonProtected.length.toLocaleString()} same-context duplicates outside protected acrylic/shelf CSS`);
console.log('\nLargest CSS owners:');
for(const file of cssFiles.map(file=>({file,bytes:fs.statSync(file).size})).sort((a,b)=>b.bytes-a.bytes).slice(0,10))console.log(`- ${file.file}: ${file.bytes.toLocaleString()} bytes`);
if(nonProtected.length){console.error('\nUnexpected non-protected duplicate selector contexts remain.');process.exitCode=1}
