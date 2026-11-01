// Which CSS classes can appear together on one element, read from className attributes in src/**/*.tsx.
// Used by css-dedupe.cjs. Conservative: dynamic classNames (`${someVar}`) are treated as able to hold any class.
const fs = require('fs'), path = require('path');
function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : /\.(tsx|ts)$/.test(e.name) ? [path.join(dir, e.name)] : []); }
function grab(src, i) { // returns attribute expression text starting at src[i] which is '"' or '{'
  const open = src[i];
  if (open === '"' || open === "'") { const j = src.indexOf(open, i + 1); return JSON.stringify(src.slice(i + 1, j)); }
  let depth = 0, j = i;
  for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}') { depth--; if (!depth) break; } }
  return src.slice(i + 1, j);
}
const attrs = [];
for (const f of files(path.resolve(process.cwd(), 'src'))) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/className=(["'{])/g)) attrs.push(grab(src, m.index + 'className='.length));
  // classList.add/toggle('x') — runtime additions: treat as universal
  for (const m of src.matchAll(/classList\.(?:add|toggle)\(\s*['"]([\w-]+)['"]/g)) attrs.push('${universal} ' + m[1]);
}
const universal = new Set(), prefixes = [], groups = [];
for (const a of attrs) {
  // string-literal contents only (quotes / template text); dynamic ${...} pieces noted
  // condition (which may itself contain quoted strings) followed by literal-only branches
  const LITERAL_ONLY = /^\s*(?:[^`'"?&]|'[^']*'|"[^"]*"|&(?!&))*?(\?\s*(['"])[^'"]*\2\s*:\s*(['"])[^'"]*\3|&&\s*(['"])[^'"]*\4)\s*$/;
  const expanded = a.replace(/\$\{([^{}]*)\}/g, (m, expr) => LITERAL_ONLY.test(expr) ? ' ' + [...expr.matchAll(/'([^']*)'|"([^"]*)"/g)].map(x => x[1] ?? x[2]).join(' ') + ' ' : m);
  const lits = [...expanded.matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)].map(m => m[1] ?? m[2] ?? m[3]);
  const text = lits.length ? lits.join(' ') : expanded;
  const hasWholeDynamic = /(^|\s)\$\{[^}]*\}(\s|$)/.test(expanded.match(/`([^`]*)`/)?.[1] ?? '') || /\$\{\s*(className|props\.className|cls|klass|extra)\b/.test(a) || /^[\w.]+$/.test(a.trim()) || /\b(className|props\.className)\b/.test(a.replace(/className=/g, ''));
  const tokens = new Set();
  for (const t of text.replace(/\$\{[^}]*\}/g, m => ' ' ).split(/\s+/)) if (/^-?[_a-zA-Z][\w-]*$/.test(t)) tokens.add(t);
  for (const m of text.matchAll(/([\w-]+-)\$\{/g)) prefixes.push({ prefix: m[1], with: tokens });
  if (hasWholeDynamic) tokens.forEach(t => universal.add(t));
  groups.push(tokens);
}
const allSource = files(path.resolve(process.cwd(), 'src')).map(f => fs.readFileSync(f, 'utf8')).join('\n') + fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
const concatPrefixes = [...allSource.matchAll(/['"`]([a-z][\w-]*-)['"`]\s*\+/g)].map(m => m[1]);
function present(c) {
  if (new RegExp('(^|[^\\w-])' + c.replace(/[-]/g, '\\-') + '($|[^\\w-])').test(allSource)) return true;
  if (prefixes.some(p => c.startsWith(p.prefix)) || concatPrefixes.some(p => c.startsWith(p))) return true;
  return false;
}
const pair = new Map();
for (const g of groups) for (const x of g) { if (!pair.has(x)) pair.set(x, new Set()); for (const y of g) pair.get(x).add(y); }
for (const { prefix, with: w } of prefixes) for (const x of w) { if (!pair.has(x)) pair.set(x, new Set()); pair.get(x).add('PREFIX:' + prefix); }
module.exports = function canCoexist(a, b) {
  if (!present(a) || !present(b)) return false; // a class no source ever renders can't be on any element
  if (a === b) return true;
  if (universal.has(a) || universal.has(b)) return true;
  const known = c => pair.has(c) || prefixes.some(p => c.startsWith(p.prefix));
  if (!known(a) || !known(b)) return true; // class not found statically: assume it can coexist
  const pa = pair.get(a) || new Set(), pb = pair.get(b) || new Set();
  if (pa.has(b) || pb.has(a)) return true;
  const viaPrefix = (x, px) => [...px].some(t => t.startsWith('PREFIX:') && x.startsWith(t.slice(7)));
  if (viaPrefix(b, pa) || viaPrefix(a, pb)) return true;
  // a dynamically-prefixed class (e.g. tone-rose) can sit next to anything in its attribute
  for (const p of prefixes) { if (a.startsWith(p.prefix) && p.with.has(b)) return true; if (b.startsWith(p.prefix) && p.with.has(a)) return true; }
  return false;
};
module.exports.stats = { attrs: attrs.length, universal: universal.size, prefixes: prefixes.length };
