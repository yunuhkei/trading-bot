// Bundles index.html + js/*.js into one self-contained page: dist/index.html.
// The 3D engine loads from jsDelivr, falling back to unpkg, and the game starts only once it is there.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const order = ['core', 'world', 'body', 'skin', 'actors', 'traffic', 'arsenal', 'gunplay', 'range', 'story', 'main'];
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
// three.js addons (model loader, post-processing) and the character model, embedded so the page needs no other files
const addons = fs.readFileSync(path.join(root, 'vendor', 'addons.js'), 'utf8');
const models = 'window.__MODELS = { soldier: "' + fs.readFileSync(path.join(root, 'models', 'Soldier.glb')).toString('base64') + '" };\n';
const code = addons + '\n' + models + order.map((n) => `// ---- js/${n}.js\n` + fs.readFileSync(path.join(root, 'js', n + '.js'), 'utf8')).join('\n');
const loader = `<script>
window.__showErr = function (msg) {
  var el = document.getElementById('err');
  if (el) { el.hidden = false; el.textContent = msg; }
  var l = document.getElementById('loading'); if (l) l.textContent = msg;
};
window.addEventListener('error', function (e) { window.__showErr('Something broke: ' + (e.message || e)); });
window.__startGame = function () {
${code}
};
(function () {
  var srcs = ['https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js', 'https://unpkg.com/three@0.160.0/build/three.min.js'];
  function load(i) {
    if (i >= srcs.length) { window.__showErr('Could not load the 3D engine. Check your connection and reload.'); return; }
    var s = document.createElement('script');
    s.src = srcs[i];
    s.onload = function () { if (window.THREE) window.__startGame(); else load(i + 1); };
    s.onerror = function () { load(i + 1); };
    document.head.appendChild(s);
  }
  load(0);
})();
</script>`;
const start = html.indexOf('<script src="https://cdn.jsdelivr.net');
const end = html.lastIndexOf('</script>') + '</script>'.length;
if (start < 0) throw new Error('script tags not found');
html = html.slice(0, start) + loader + html.slice(end);
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'index.html'), html);
console.log('wrote dist/index.html', html.length, 'bytes');
