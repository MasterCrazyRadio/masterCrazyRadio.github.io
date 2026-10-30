/* GUARDIAN DE PANTALLA EN TV - Master Crazy Radio
   Uso:  node verificar-tv.js
   Falla (codigo 1) si alguien quita o altera el bloqueo de pantalla completa
   en Android TV / ONN Watch / Fire TV / Smart TV.
   ORDEN DEL SER SUPERIOR: estos valores solo cambian con pedido explicito. */
const fs = require('fs');

let fallos = 0;
const ok = (t) => console.log('OK    ' + t);
const fail = (t) => { console.log('FALLA ' + t); fallos++; };

// 1. El archivo de bloqueo existe y tiene las reglas clave
if (!fs.existsSync('tv-bloqueo.css')) {
  fail('no existe tv-bloqueo.css');
} else {
  const t = fs.readFileSync('tv-bloqueo.css', 'utf8');
  const reglas = [
    ['pagina a 100% de ancho', /html\.is-tv,[\s\S]{0,120}width:\s*100%\s*!important/],
    ['sin scroll lateral', /overflow-x:\s*hidden\s*!important/],
    ['modal ocupando la ventana', /html\.is-tv \.tv-modal\s*\{[\s\S]{0,400}width:\s*100vw\s*!important/],
    ['contenido del modal al 100%', /\.modal-content\s*\{[\s\S]{0,400}width:\s*100vw\s*!important/],
    ['contenedor de video al 100%', /\.video-container\s*\{[\s\S]{0,600}height:\s*100%\s*!important/],
    ['header pegado a los bordes', /\.main-header\s*\{[\s\S]{0,300}left:\s*0\s*!important/]
  ];
  for (const [nombre, re] of reglas) {
    if (re.test(t)) ok('tv-bloqueo.css: ' + nombre);
    else fail('tv-bloqueo.css: falta ' + nombre);
  }
  // No debe tocar el transform del iframe (rompe el encuadre del video)
  if (/\.video-container iframe[\s\S]{0,300}transform/.test(t)) {
    fail('tv-bloqueo.css toca el transform del iframe (rompe el video)');
  } else {
    ok('tv-bloqueo.css: no toca el transform del iframe');
  }
}

// 2. Esta enlazado en el HTML y DESPUES de style.css
const h = fs.readFileSync('index.html', 'utf8');
const posStyle = h.indexOf('style.css?v=');
const posBloqueo = h.indexOf('tv-bloqueo.css?v=');
if (posBloqueo < 0) {
  fail('tv-bloqueo.css NO esta enlazado en index.html');
} else if (posBloqueo < posStyle) {
  fail('tv-bloqueo.css se carga ANTES de style.css (debe ir despues)');
} else {
  ok('tv-bloqueo.css enlazado despues de style.css');
}

// 3. El JS debe seguir forzando el encuadre del iframe
const j = fs.readFileSync('script.js', 'utf8');
if (/function ajustarIframeCover\(\)/.test(j) && /imp\('transform', 'none'\)/.test(j)) {
  ok('script.js: ajustarIframeCover intacto (encuadre del video)');
} else {
  fail('script.js: falta ajustarIframeCover o el reset de transform');
}

// 4. No deben existir reglas de TV que rompan el video
const css = fs.readFileSync('style.css', 'utf8');
const prohibidas = [
  ['content-visibility sobre el modal', /body\.tv-open[^{]*#tv-modal[^{]*\{[^}]*content-visibility/],
  ['contain sobre el modal', /body\.tv-open[^{]*#tv-modal[^{]*\{[^}]*contain\s*:/],
  ['translateZ sobre el iframe', /#tv-iframe[^{]*\{[^}]*translateZ/]
];
for (const [nombre, re] of prohibidas) {
  if (re.test(css)) fail('style.css: regla peligrosa presente -> ' + nombre);
  else ok('style.css: sin ' + nombre);
}

console.log(fallos === 0
  ? '\nRESULTADO: PANTALLA DE TV PROTEGIDA'
  : '\nRESULTADO: ' + fallos + ' PROBLEMAS - NO PUBLICAR');
process.exit(fallos === 0 ? 0 : 1);
