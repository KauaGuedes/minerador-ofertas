// Gera o minerador.js que o app da VK carrega: mesma tela da prévia, isolada num shadow DOM.
// Uso: node visual/app-build.mjs <saida.js>
import fs from 'node:fs';
const t = fs.readFileSync(new URL('./template.html', import.meta.url), 'utf8');
const css0 = t.match(/<style>([\s\S]*?)<\/style>/)[1];
const markup = t.slice(t.indexOf('</style>') + 8, t.indexOf('<script id="dados"')).trim();
const script = t.match(/<script>\n([\s\S]*?)<\/script>\s*$/)[1];

// tokens do :root viram tokens do contêiner; o tema vem do app (escuro/claro)
let css = css0
  .replace(/@media \(prefers-color-scheme: light\)\{ :root:not\(\[data-theme="dark"\]\)\{[\s\S]*?\}\}\n/, '')
  .replace(/@media \(prefers-color-scheme: light\)\{ :root:not\(\[data-theme="dark"\]\) \.vk img\{[^}]*\} \}\n/, '')
  .replace(/:root\[data-theme="light"\]/g, '.mnr[data-theme="light"]')
  .replace(/^:root\{/m, '.mnr{')
  .replace('html,body{overflow-x:hidden}', '')
  .replace(/^body\{/m, '.mnr{')
  + `
:host{display:block}
[hidden]{display:none!important}
.mnr{padding:0!important;font-size:14px}
.mnr .top>div:first-child{display:none}
.mnr .top{justify-content:flex-end}
.mnr .tools{position:static;margin-inline:0;border:1px solid var(--edge);border-radius:20px;background:var(--raise);backdrop-filter:none}

.mnr .loading{padding:60px 16px;text-align:center;color:var(--soft)}
`;

const js = `/* Minerador de ofertas da VK (gerado por minerador-ofertas/visual/app-build.mjs; não editar aqui) */
(function(){
const CSS = ${JSON.stringify(css)};
const HTML = ${JSON.stringify(markup)};
function iniciar(ROOT_, D_, STORE_){
  window.__MNR_ROOT = ROOT_; window.__MNR_DATA = D_; window.__MNR_STORE = STORE_;
${script}
}
let host = null, carregando = null, iniciado = false;
async function dados(opts){
  if (!opts.load) throw new Error('Minerador sem fonte de dados.');
  return opts.load();
}
window.MineradorMount = function(slot, opts){
  opts = opts || {};
  if (!host) {
    host = document.createElement('div'); host.className = 'mnr-host';
    const sr = host.attachShadow({ mode: 'open' });
    sr.innerHTML = '<style>' + CSS + '</style><div class="mnr" data-theme="dark"><div class="loading">Carregando as ofertas mineradas…</div></div>';
  }
  const sr = host.shadowRoot, box = sr.querySelector('.mnr');
  box.setAttribute('data-theme', opts.theme === 'light' ? 'light' : 'dark');
  if (host.parentNode !== slot) slot.appendChild(host);
  if (!iniciado && !carregando) {
    carregando = dados(opts).then(D => {
      box.innerHTML = HTML; iniciado = true;
      iniciar(sr, D, opts.store);
    }).catch(e => { box.innerHTML = '<div class="loading">' + String(e.message || e) + '</div>'; setTimeout(() => { carregando = null; }, 60000); });
  }
};
})();
`;
fs.writeFileSync(process.argv[2], js);
console.log('ok', (js.length / 1024).toFixed(0) + 'KB');
