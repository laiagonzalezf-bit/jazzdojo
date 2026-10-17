// Builds JazzDojo:
//   docs/index.html     full web app for GitHub Pages (installable, offline via service worker)
//   artifact/index.html page fragment for publishing as a Claude artifact (same app, no service worker)
// Both inline the bundled JS and copy public/ (samples, fonts, icons) next to the page.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = p => path.join(root, p);

const js = (await build({ entryPoints: [r('src/app.js')], bundle: true, format: 'iife', target: ['safari15', 'chrome100'], write: false, minify: true, legalComments: 'none' })).outputFiles[0].text;
let tpl = fs.readFileSync(r('src/index.html'), 'utf8');
tpl = tpl.replace(/\{\{svg:(\w+)\}\}/g, (_, name) => {
  const svg = fs.readFileSync(r(`public/icons/${name}.svg`), 'utf8');
  return svg.replace('<svg ', `<svg class="${name === 'enso' ? 'mark' : 'word'}" aria-hidden="true" `);
});
const [head, rest] = tpl.split('<!--BODY-->');
// function replacement: the bundle may contain `$'` or `$&`, which a replacement string would expand
const body = rest.replace('<!--SCRIPT-->', () => `<script>${js.replace(/<\/script/g, '<\\/script')}</script>`);
const headPart = head.replace('<!--HEAD-->', '');

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f), d = path.join(dst, f);
    if (fs.statSync(s).isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}
function listFiles(dir, base = dir) {
  return fs.readdirSync(dir).flatMap(f => { const p = path.join(dir, f); return fs.statSync(p).isDirectory() ? listFiles(p, base) : [path.relative(base, p)]; });
}

// GitHub Pages
fs.rmSync(r('docs'), { recursive: true, force: true });
copyDir(r('public'), r('docs'));
const full = `<!doctype html>
<html lang="ca" data-jd-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#17140F">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="JazzDojo">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="icons/icon-180.png">
${headPart}
</head>
<body>
${body}
</body>
</html>
`;
fs.writeFileSync(r('docs/index.html'), full);
// safety net: the inlined script must still parse after templating
new vm.Script(full.slice(full.indexOf('<script>') + 8, full.lastIndexOf('</script>')));
const version = Date.now().toString(36);
const files = ['./', 'index.html', ...listFiles(r('docs')).filter(f => !/^sw\.js$|\.txt$|logo|belt/.test(f))];
fs.writeFileSync(r('docs/sw.js'), fs.readFileSync(r('public/sw.js'), 'utf8').replace('__VERSION__', version).replace('__FILES__', JSON.stringify(files)));
fs.writeFileSync(r('docs/.nojekyll'), '');

// Claude artifact (fragment; the host adds doctype/head/body)
fs.rmSync(r('artifact'), { recursive: true, force: true });
copyDir(r('public'), r('artifact'));
fs.rmSync(r('artifact/sw.js'));
fs.writeFileSync(r('artifact/index.html'), `${headPart}\n${body}`);
console.log(`built docs/ and artifact/ (${(js.length / 1024).toFixed(0)} KB JS, ${files.length} cached files)`);
