import fs from 'node:fs';
import postcss from 'postcss';

const cssPath = 'src/styles/system.css';
const css = fs.readFileSync(cssPath, 'utf8');
const root = postcss.parse(css, { from: cssPath });
const lines = css.split(/\r?\n/).length;
const importantCount = (css.match(/!important/g) || []).length;
const mediaCounts = new Map();
const selectorCounts = new Map();
const protectedPatterns = [
  /\.acrylic[-A-Za-z0-9_]*/,
  /\.home-acrylic[-A-Za-z0-9_]*/,
  /\.profile-acrylic[-A-Za-z0-9_]*/,
  /\.shelf-object\b/,
  /\.shelf-track\b/,
  /\.shelf-books-new\b/,
  /\.shelf-book[-A-Za-z0-9_]*/
];
const componentNeedles = [
  'sticker-tray',
  'sticker-tray-grid',
  'reading-cover-story',
  'reading-copy',
  'reading-art',
  'book-hero',
  'progress-race',
  'meeting',
  'search',
  'profile'
];
const componentHits = new Map(componentNeedles.map(name => [name, []]));
const protectedHits = [];

root.walkAtRules('media', atRule => {
  mediaCounts.set(atRule.params, (mediaCounts.get(atRule.params) || 0) + 1);
});

root.walkRules(rule => {
  const selectors = rule.selector.split(',').map(selector => selector.trim()).filter(Boolean);
  const parentMedia = rule.parent?.type === 'atrule' && rule.parent.name === 'media'
    ? rule.parent.params
    : 'base';
  for (const selector of selectors) {
    selectorCounts.set(selector, (selectorCounts.get(selector) || 0) + 1);
    for (const [needle, hits] of componentHits) {
      if (selector.includes(needle)) {
        hits.push({ selector, line: rule.source?.start?.line, media: parentMedia });
      }
    }
    if (protectedPatterns.some(pattern => pattern.test(selector))) {
      protectedHits.push({ selector, line: rule.source?.start?.line, media: parentMedia });
    }
  }
});

const duplicatedSelectors = [...selectorCounts.entries()]
  .filter(([, count]) => count > 1)
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
const feedbackFinalLine = css.slice(0, css.indexOf('feedback-final.css')).split(/\r?\n/).length;
const laterProtectedHits = protectedHits.filter(hit => hit.line > feedbackFinalLine);

console.log('CSS architecture audit');
console.log(`- ${cssPath}`);
console.log(`- ${lines.toLocaleString()} lines`);
console.log(`- ${Buffer.byteLength(css).toLocaleString()} bytes`);
console.log(`- ${importantCount.toLocaleString()} !important tokens`);
console.log(`- ${mediaCounts.size} unique media queries across ${[...mediaCounts.values()].reduce((sum, count) => sum + count, 0)} blocks`);
console.log(`- ${duplicatedSelectors.length.toLocaleString()} duplicated selector strings`);
console.log(`- feedback-final starts near line ${feedbackFinalLine.toLocaleString()}`);
console.log(`- ${laterProtectedHits.length} protected acrylic/shelf selector occurrences appear after feedback-final`);

console.log('\nMost repeated selectors:');
for (const [selector, count] of duplicatedSelectors.slice(0, 12)) {
  console.log(`- ${count}x ${selector}`);
}

console.log('\nMost repeated media queries:');
for (const [query, count] of [...mediaCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12)) {
  console.log(`- ${count}x @media ${query}`);
}

console.log('\nComponent selector occurrences:');
for (const [needle, hits] of componentHits) {
  const latest = hits.at(-1);
  const suffix = latest ? `; latest line ${latest.line} (${latest.media})` : '';
  console.log(`- ${needle}: ${hits.length}${suffix}`);
}

if (laterProtectedHits.length) {
  console.log('\nProtected selectors after feedback-final (do not refactor until explicitly unlocked):');
  for (const hit of laterProtectedHits.slice(0, 20)) {
    console.log(`- line ${hit.line}: ${hit.selector} [${hit.media}]`);
  }
  if (laterProtectedHits.length > 20) console.log(`- ...${laterProtectedHits.length - 20} more`);
}
