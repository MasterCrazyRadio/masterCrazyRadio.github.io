/* GUARDIAN DE TEXTOS - Master Crazy Radio
   Uso:  node verificar-textos.js
   Si encuentra letras/signos raros, termina con codigo 1 (falla) y no se debe publicar.
   Revisa: index.html, script.js, style.css, robots.txt, sitemap.xml */
const fs = require('fs');

const ARCHIVOS = ['index.html', 'script.js', 'style.css', 'robots.txt', 'sitemap.xml'];
const RAROS = /[\u00C3\u00C2\u01DF\u0143\u0192\u201A\u201E\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2122\u0161\u203A\u0153\u017E\u0178\uFFFD]/;

const CLAVE = [
  'La Casa Oficial de La Cumbiaaa!!',
  'Master Crazy',
  'Contáctanos',
  'Nombre',
  'Email',
  'Teléfono',
  'Mensaje',
  'Escribe tu mensaje aquí',
  'Pide una canción',
  'Enviar por WhatsApp',
  '¿Pantalla negra? Abrir aquí',
  'Top ',
  'de la semana',
  'Nadie Te Extraña',
  '¿Con Quién Se Queda el Perro?',
  'Grupo Frontera'
];

let fallos = 0;

for (const archivo of ARCHIVOS) {
  if (!fs.existsSync(archivo)) continue;
  const t = fs.readFileSync(archivo, 'utf8');

  // 1) simbolos de codificacion rota
  const marcas = t.match(RAROS);
  const n = marcas ? marcas.length : 0;
  console.log((n === 0 ? 'OK    ' : 'FALLA ') + archivo + ': ' + n + ' simbolos de codificacion rota');
  if (n > 0) fallos++;

  // 2) texto visible y atributos (solo HTML)
  if (archivo === 'index.html') {
    const sinScripts = t.replace(/<script[\s\S]*?<\/script>/g, '');
    let visibles = 0;
    const re = />([^<>]{2,})</g; let m;
    while ((m = re.exec(sinScripts)) !== null) {
      if (RAROS.test(m[1])) { visibles++; if (visibles <= 5) console.log('      texto: ' + m[1].trim().slice(0, 60)); }
    }
    const reA = /(alt|placeholder|title|content|aria-label)="([^"]{2,})"/g;
    let attrs = 0;
    while ((m = reA.exec(t)) !== null) {
      if (RAROS.test(m[2])) { attrs++; if (attrs <= 5) console.log('      atributo ' + m[1] + ': ' + m[2].slice(0, 60)); }
    }
    console.log('      texto visible con problemas: ' + visibles + ' | atributos: ' + attrs);
    if (visibles > 0 || attrs > 0) fallos++;

    // 3) JSON-LD valido
    const bloques = t.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || [];
    bloques.forEach((b, i) => {
      try { JSON.parse(b.replace(/<\/?script[^>]*>/g, '')); }
      catch (e) { console.log('      FALLA JSON-LD bloque ' + (i + 1) + ': ' + e.message.slice(0, 60)); fallos++; }
    });

    // 4) textos clave presentes
    for (const p of CLAVE) {
      if (!t.includes(p)) { console.log('      FALTA texto clave: ' + p); fallos++; }
    }
  }
}

console.log(fallos === 0 ? '\nRESULTADO: TODO LIMPIO' : '\nRESULTADO: ' + fallos + ' PROBLEMAS - NO PUBLICAR');
process.exit(fallos === 0 ? 0 : 1);
