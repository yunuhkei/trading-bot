// Converts the three.js example modules in vendor/src into one classic script, vendor/addons.js.
// Imports from 'three' come from the global THREE; imports between addons and their exports go
// through window.THREE_ADDONS. Run: node tools/addons.js
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'vendor', 'src');
const order = ['BufferGeometryUtils', 'GLTFLoader', 'SkeletonUtils', 'CopyShader', 'LuminosityHighPassShader', 'OutputShader',
  'Pass', 'MaskPass', 'ShaderPass', 'EffectComposer', 'RenderPass', 'UnrealBloomPass', 'OutputPass'];
let out = '// three.js r160 example addons (MIT), converted for classic script loading by tools/addons.js\n(function () {\nconst ADD = (window.THREE_ADDONS = window.THREE_ADDONS || {});\n';
for (const name of order) {
  let src = fs.readFileSync(path.join(dir, name + '.js'), 'utf8');
  const exported = [];
  // import { a, b } from 'three';  (possibly multi-line)
  src = src.replace(/import\s*\{([^}]*)\}\s*from\s*['"]three['"];?/g, (m, names) => `const {${names}} = THREE;`);
  src = src.replace(/import\s*\*\s*as\s+(\w+)\s+from\s*['"]three['"];?/g, (m, n) => `const ${n} = THREE;`);
  src = src.replace(/import\s*\{([^}]*)\}\s*from\s*['"]\.{1,2}\/[^'"]+['"];?/g, (m, names) => `const {${names}} = ADD;`);
  src = src.replace(/^export\s*\{([^}]*)\};?/gm, (m, names) => { names.split(',').map((s) => s.trim()).filter(Boolean).forEach((n) => exported.push(n.split(/\s+as\s+/).pop())); return ''; });
  src = src.replace(/^export\s+(class|function|const|let|var)\s+(\w+)/gm, (m, kw, n) => { exported.push(n); return `${kw} ${n}`; });
  out += `// ---- ${name}\n(function () {\n${src}\nObject.assign(ADD, { ${exported.join(', ')} });\n})();\n`;
}
out += '})();\n';
fs.writeFileSync(path.join(__dirname, '..', 'vendor', 'addons.js'), out);
console.log('wrote vendor/addons.js', out.length, 'bytes');
