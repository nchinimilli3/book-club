// Removes provably dead declarations and merges same-context duplicate selectors across src/styles
// without changing which declaration wins anywhere. Pairs with `npm run audit:css`.
//
//   npm run css:dedupe            apply
//   npm run css:dedupe -- --dry   report only
//
// Safety rules (see README section in CSS_ARCHITECTURE.md):
// - Files are processed in real cascade order (src/styles/index.css import order).
// - A declaration is removed only if the identical selector, in the same or a broader context
//   (base ⊇ any media; max-width:900 ⊇ max-width:700), replaces it later, or sets it !important.
// - Two copies of a selector are merged only if no rule between them sets an overlapping longhand
//   at the same specificity and importance on an element both could match (class co-occurrence is
//   read from className attributes in src/**/*.tsx; dynamic classNames are treated as "could be anything").
// - Modern values (dvh, color-mix(), …) never erase an older-browser fallback.
const postcss = require('postcss');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(process.cwd(), 'src/styles');
const DRY = process.argv.includes('--dry');
const order = [...fs.readFileSync(path.join(ROOT, 'index.css'), 'utf8').matchAll(/@import '\.\/([^']+)'/g)].map(m => path.join(ROOT, m[1]));
const protectedPatterns = [/\.acrylic[-A-Za-z0-9_]*/, /\.home-acrylic[-A-Za-z0-9_]*/, /\.profile-acrylic[-A-Za-z0-9_]*/, /\.shelf-object\b/, /\.shelf-track\b/, /\.shelf-books-new\b/, /\.shelf-book[-A-Za-z0-9_]*/];
const roots = order.map(f => ({ file: f, root: postcss.parse(fs.readFileSync(f, 'utf8'), { from: f }) }));

/* ---- specificity ---- */
function splitTop(s, sep = ',') { const out = []; let depth = 0, cur = ''; for (const ch of s) { if (ch === '(' || ch === '[') depth++; if (ch === ')' || ch === ']') depth--; if (ch === sep && depth === 0) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map(x => x.trim()).filter(Boolean); }
function spec(sel) {
  let a = 0, b = 0, c = 0, s = sel;
  // functional pseudos
  s = s.replace(/:(not|is|has|matches|-webkit-any|-moz-any)\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)\)/g, (_, name, inner) => {
    const best = splitTop(inner).map(spec).sort(cmp).pop() || [0, 0, 0]; a += best[0]; b += best[1]; c += best[2]; return ' ';
  });
  s = s.replace(/:where\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)\)/g, ' ');
  s = s.replace(/:nth-[a-z-]+\([^)]*\)/g, () => { b++; return ' '; });
  s = s.replace(/\[[^\]]*\]/g, () => { b++; return ' '; });
  s = s.replace(/#[\w-]+/g, () => { a++; return ' '; });
  s = s.replace(/::[\w-]+(\([^)]*\))?/g, () => { c++; return ' '; });
  s = s.replace(/:(before|after|first-line|first-letter)\b/g, () => { c++; return ' '; });
  s = s.replace(/:[\w-]+(\([^)]*\))?/g, () => { b++; return ' '; });
  s = s.replace(/\.[\w-]+/g, () => { b++; return ' '; });
  s.split(/[\s>+~]+/).forEach(t => { if (t && t !== '*' && /^[a-zA-Z]/.test(t)) c++; });
  return [a, b, c];
}
function cmp(x, y) { return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; }
const eqSpec = (x, y) => cmp(x, y) === 0;

/* ---- property relationships: two props are related iff their longhand sets intersect ---- */
const strip = p => p.replace(/^-(webkit|moz|ms|o)-/, '');
const sides = ['top', 'right', 'bottom', 'left'];
const SH = {
  margin: sides.map(s => 'margin-' + s), padding: sides.map(s => 'padding-' + s), inset: sides.slice(),
  'margin-inline': ['margin-left', 'margin-right'], 'margin-block': ['margin-top', 'margin-bottom'],
  'padding-inline': ['padding-left', 'padding-right'], 'padding-block': ['padding-top', 'padding-bottom'],
  'inset-inline': ['left', 'right'], 'inset-block': ['top', 'bottom'],
  'inline-size': ['width'], 'block-size': ['height'], 'min-inline-size': ['min-width'], 'min-block-size': ['min-height'], 'max-inline-size': ['max-width'], 'max-block-size': ['max-height'],
  border: sides.flatMap(s => ['width', 'style', 'color'].map(k => `border-${s}-${k}`)).concat(['border-image-source', 'border-image-slice', 'border-image-width', 'border-image-outset', 'border-image-repeat']),
  'border-width': sides.map(s => `border-${s}-width`), 'border-style': sides.map(s => `border-${s}-style`), 'border-color': sides.map(s => `border-${s}-color`),
  ...Object.fromEntries(sides.map(s => [`border-${s}`, ['width', 'style', 'color'].map(k => `border-${s}-${k}`)])),
  'border-radius': ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map(c => `border-${c}-radius`),
  'border-inline': ['left', 'right'].flatMap(s => ['width', 'style', 'color'].map(k => `border-${s}-${k}`)),
  'border-block': ['top', 'bottom'].flatMap(s => ['width', 'style', 'color'].map(k => `border-${s}-${k}`)),
  outline: ['outline-width', 'outline-style', 'outline-color'],
  background: ['background-color', 'background-image', 'background-position', 'background-size', 'background-repeat', 'background-attachment', 'background-origin', 'background-clip'],
  font: ['font-style', 'font-variant', 'font-variant-numeric', 'font-variant-caps', 'font-variant-ligatures', 'font-weight', 'font-stretch', 'font-size', 'line-height', 'font-family', 'font-kerning', 'font-size-adjust', 'font-feature-settings', 'font-optical-sizing', 'font-variation-settings'],
  'font-variant': ['font-variant-numeric', 'font-variant-caps', 'font-variant-ligatures', 'font-variant-east-asian', 'font-variant-position', 'font-variant-alternates'],
  flex: ['flex-grow', 'flex-shrink', 'flex-basis'], 'flex-flow': ['flex-direction', 'flex-wrap'],
  gap: ['row-gap', 'column-gap'], 'grid-gap': ['row-gap', 'column-gap'],
  grid: ['grid-template-rows', 'grid-template-columns', 'grid-template-areas', 'grid-auto-rows', 'grid-auto-columns', 'grid-auto-flow'],
  'grid-template': ['grid-template-rows', 'grid-template-columns', 'grid-template-areas'],
  'grid-area': ['grid-row-start', 'grid-row-end', 'grid-column-start', 'grid-column-end'],
  'grid-row': ['grid-row-start', 'grid-row-end'], 'grid-column': ['grid-column-start', 'grid-column-end'],
  'place-items': ['align-items', 'justify-items'], 'place-content': ['align-content', 'justify-content'], 'place-self': ['align-self', 'justify-self'],
  overflow: ['overflow-x', 'overflow-y'], 'overscroll-behavior': ['overscroll-behavior-x', 'overscroll-behavior-y', 'overscroll-behavior-inline', 'overscroll-behavior-block'],
  'overscroll-behavior-inline': ['overscroll-behavior-x'], 'overscroll-behavior-block': ['overscroll-behavior-y'],
  'text-decoration': ['text-decoration-line', 'text-decoration-style', 'text-decoration-color', 'text-decoration-thickness'],
  'list-style': ['list-style-type', 'list-style-position', 'list-style-image'],
  transition: ['transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay', 'transition-behavior'],
  animation: ['animation-name', 'animation-duration', 'animation-timing-function', 'animation-delay', 'animation-iteration-count', 'animation-direction', 'animation-fill-mode', 'animation-play-state'],
  'scroll-padding': sides.map(s => 'scroll-padding-' + s), 'scroll-margin': sides.map(s => 'scroll-margin-' + s),
  'white-space': ['white-space-collapse', 'text-wrap-mode'], 'text-wrap': ['text-wrap-mode', 'text-wrap-style'],
  columns: ['column-width', 'column-count'], 'column-rule': ['column-rule-width', 'column-rule-style', 'column-rule-color'],
  mask: ['mask-image', 'mask-position', 'mask-size', 'mask-repeat', 'mask-origin', 'mask-clip', 'mask-mode', 'mask-composite'],
};
function longhands(p) {
  p = strip(p);
  if (p === 'all') return null; // relates to everything
  const out = new Set([p]);
  const stack = [p];
  while (stack.length) { const x = stack.pop(); for (const l of SH[x] || []) if (!out.has(l)) { out.add(l); stack.push(l); } }
  return out;
}
function related(p, q) {
  if (p.startsWith('--') || q.startsWith('--')) return p === q;
  const a = longhands(p), b = longhands(q);
  if (!a || !b) return true;
  for (const x of a) if (b.has(x)) return true;
  return false;
}

/* ---- can two selectors' subjects ever be the same element? ---- */
const canCoexist = require('./css-class-cooccurrence.cjs');
function subject(sel) {
  const parts = splitTop(sel.replace(/\s*([>+~])\s*/g, ' $1 '), ' ').filter(t => !/^[>+~]$/.test(t));
  const last = parts[parts.length - 1] || '';
  const bare = last.replace(/:(not|is|where|has|matches)\((?:[^()]|\([^()]*\))*\)/g, '');
  const pseudo = (bare.match(/::?(before|after|placeholder|marker|selection|first-line|first-letter|-webkit-[\w-]+|-moz-[\w-]+)\b/) || [])[1] || '';
  const tag = (bare.match(/^([a-zA-Z][\w-]*)/) || [])[1] || '';
  const classes = [...bare.matchAll(/\.([\w-]+)/g)].map(m => m[1]);
  return { pseudo, tag: tag.toLowerCase(), classes };
}
// Pairs verified by parsing the JSX (TypeScript AST) to live in disjoint subtrees, so no element matches both.
// ReadingRoom.tsx: footer.scheduled-meeting-summary is a direct child of the reading-plan section, a sibling of
// nav.reading-tabs and of the li items that hold .checkpoint-prep-panel and .checkpoint-scheduled.
const DISJOINT = [
  ['.reading-room .scheduled-meeting-summary button', '.reading-room .checkpoint-prep-panel>button'],
  ['.reading-room .scheduled-meeting-summary button', '.reading-room .reading-tabs button'],
  ['.reading-room .scheduled-meeting-summary button', '.reading-room .checkpoint-scheduled button'],
  // HomePage.tsx: <ClubProgressScene> (header.club-progress-head) renders in main, a sibling of aside.editorial-meeting;
  // the meeting h3 is a bare <h3>, and no <h3> in the codebase carries .secondary.
  ['.editorial-meeting .meeting-detail h3', '.progress-mode-bars .club-progress-head h3'],
  ['.editorial-meeting .meeting-detail h3', '.club-home .club-progress-head h3'],
  ['.editorial-meeting .meeting-detail h3', '.concierge-pile>header>.secondary'],
];
function couldOverlap(s1, s2) {
  if (DISJOINT.some(([x, y]) => (s1 === x && s2 === y) || (s1 === y && s2 === x))) return false;
  const a = subject(s1), b = subject(s2);
  if (a.pseudo !== b.pseudo) return false;
  if (a.tag && b.tag && a.tag !== b.tag) return false;
  for (const x of a.classes) for (const y of b.classes) if (!canCoexist(x, y)) return false;
  return true;
}

/* ---- rule index in true cascade order ---- */
function ctxOf(rule) { const parts = []; let p = rule.parent; while (p && p.type !== 'root') { if (p.type === 'atrule') parts.push(`@${p.name} ${p.params}`); p = p.parent; } return parts.reverse().join('|') || 'base'; }
function inKeyframes(rule) { let p = rule.parent; while (p && p.type !== 'root') { if (p.type === 'atrule' && /keyframes$/i.test(p.name)) return true; p = p.parent; } return false; }
function index() {
  const list = [];
  for (const { root } of roots) root.walkRules(r => { if (!inKeyframes(r)) list.push(r); });
  list.forEach((r, i) => { r.__i = i; });
  return list;
}
const decls = r => r.nodes.filter(n => n.type === 'decl');
const MODERN = /\b\d*\.?\d+(dvh|svh|lvh|dvw|svw|lvw|cqw|cqh|cqi|cqb)\b|color-mix\(|oklch\(|oklab\(|\blch\(|light-dark\(|\bsubgrid\b/i;
/** later decl b fully replaces earlier decl a (same prop, importance >=, and b isn't a modern value a might be the fallback for) */
const covers = (b, a) => { if (b === a) return true; if (a.startsWith('--') || b.startsWith('--')) return false; const lb = longhands(b), la = longhands(a); return !!lb && !!la && [...la].every(x => lb.has(x)) && strip(a) === a && strip(b) === b; };
// b replaces a, unless b uses a modern value that a (a plain value) is the older-browser fallback for
const overrides = (b, a) => covers(b.prop, a.prop) && (b.important || !a.important) && (!MODERN.test(b.value) || MODERN.test(a.value));

/** Does moving `moved` declarations (with selector specificity sp) across the rules strictly between i and j change any winner? */
function conflicts(list, i, j, moved, sp, selector, resetBy = []) {
  const found = [];
  const residual = m => { const l = longhands(m.prop); if (!l) return null; const out = new Set(l); for (const b of resetBy) if ((b.important || !m.important) && !MODERN.test(b.value)) { const lb = longhands(b.prop); if (lb) lb.forEach(x => out.delete(x)); } return out; };
  for (let k = i + 1; k < j; k++) {
    const r = list[k];
    for (const d of decls(r)) {
      const hits = moved.filter(m => { if (Boolean(m.important) !== Boolean(d.important)) return false; if (m.prop.startsWith('--') || d.prop.startsWith('--')) return m.prop === d.prop; const res = residual(m), ld = longhands(d.prop); if (!res || !ld) return true; for (const x of ld) if (res.has(x)) return true; return false; });
      if (!hits.length) continue;
      const ov = r.selectors.filter(s => eqSpec(spec(s), sp) && couldOverlap(s, selector)); if (ov.length) found.push(`${ov.join(',').slice(0, 70)} { ${d.prop} } vs ${hits.map(h => h.prop).join(',')}`);
    }
  }
  return found.length ? [...new Set(found)].join('\n          ') : null;
}

/** Split `selector` out of a multi-selector rule into its own adjacent rule (cascade-neutral). */
function isolate(rule, selector) {
  if (rule.selectors.length === 1) return rule;
  const clone = rule.clone({ selector });
  rule.selectors = rule.selectors.filter(s => s !== selector);
  rule.after(clone);
  return clone;
}

/** context `outer` is active whenever context `inner` is (base ⊇ everything; max-width:900 ⊇ max-width:700; min-width:600 ⊇ min-width:960) */
function ctxCovers(outer, inner) {
  if (outer === 'base' || outer === inner) return true;
  const mo = outer.match(/^@media \((max|min)-width:\s*(\d+)px\)$/), mi = inner.match(/^@media \((max|min)-width:\s*(\d+)px\)$/);
  if (!mo || !mi || mo[1] !== mi[1]) return false;
  return mo[1] === 'max' ? +mo[2] >= +mi[2] : +mo[2] <= +mi[2];
}
/* ---- dead declarations: a later rule with the identical selector, in the same or a broader
   context, sets the same property with >= importance (and isn't a modern-value fallback case) ---- */
let dead = 0;
const touchedFiles = new Set();
{
  const list = index();
  const bySel = new Map();
  for (const r of list) for (const s of r.selectors) { if (!bySel.has(s)) bySel.set(s, []); bySel.get(s).push(r); }
  for (const r of list) {
    if (r.selectors.some(s => protectedPatterns.some(re => re.test(s)))) continue;
    const ctx = ctxOf(r);
    for (const d of decls(r)) {
      // every selector in the list must be overridden for the decl to be dead
      const allDead = r.selectors.every(s => (bySel.get(s) || []).some(R => R !== r && ctxCovers(ctxOf(R), ctx) && decls(R).some(b =>
        (R.__i > r.__i && overrides(b, d)) ||                                   // a later identical rule replaces it
        (b.important && !d.important && covers(b.prop, d.prop) && (!MODERN.test(b.value) || MODERN.test(d.value))) // !important beats it regardless of order
      )));
      if (allDead) { d.remove(); dead++; touchedFiles.add(r.root().source.input.file); }
    }
    if (!r.nodes.some(n => n.type === 'decl')) { const parent = r.parent; r.remove(); if (parent && parent.type === 'atrule' && !parent.nodes.length) parent.remove(); }
  }
}
console.log(`removed ${dead} dead declaration(s)`);

let merged = 0, skipped = new Map(), guard = 0;
while (guard++ < 5000) {
  const list = index();
  const groups = new Map();
  for (const r of list) for (const s of r.selectors) {
    const key = ctxOf(r) + '||' + s;
    if (protectedPatterns.some(re => re.test(s))) continue;
    if (skipped.has(key)) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const dup = [...groups].find(([, rs]) => rs.length > 1);
  if (!dup) break;
  const [key, rs] = dup;
  const selector = key.split('||').slice(1).join('||');
  let A = rs[0], B = rs[1];
  const sp = spec(selector);
  // decide on decl sets first (using current rules)
  const aDecls = decls(A), bDecls = decls(B);
  const kept = aDecls.filter(a => !bDecls.some(b => overrides(b, a)));
  const lateReason = conflicts(list, A.__i, B.__i, kept, sp, selector, bDecls);       // merge at B: A's kept decls move later
  const earlyReason = conflicts(list, A.__i, B.__i, bDecls, sp, selector);    // merge at A: B's decls move earlier
  if (lateReason && earlyReason) { skipped.set(key, lateReason + '\n        early: ' + earlyReason); continue; }
  const fileOf = r => r.root().source.input.file;
  touchedFiles.add(fileOf(A)); touchedFiles.add(fileOf(B));
  A = isolate(A, selector); B = isolate(B, selector);
  const keptNodes = decls(A).filter(a => !decls(B).some(b => overrides(b, a)));
  if (!lateReason) {
    // final = kept A decls, then B decls, at B's position
    B.prepend(...keptNodes.map(n => n.clone()));
    const parent = A.parent; A.remove(); if (parent && parent.type === 'atrule' && !parent.nodes.length) parent.remove();
  } else {
    // final at A's position: kept A decls then B decls
    A.removeAll(); A.append(...keptNodes.map(n => n.clone()), ...decls(B).map(n => n.clone()));
    const parent = B.parent; B.remove(); if (parent && parent.type === 'atrule' && !parent.nodes.length) parent.remove();
  }
  merged++;
}
console.log(`merged ${merged} duplicate occurrence(s); ${skipped.size} group(s) left because a same-specificity rule in between sets a related property`);
for (const [k, why] of skipped) console.log('  skip', k.slice(0, 90), '\n       ', why);
if (!DRY) for (const { file, root } of roots) if (touchedFiles.has(file)) fs.writeFileSync(file, root.toString());
console.log('files touched:', [...touchedFiles].map(f => path.relative(ROOT, f)).join(', '));
