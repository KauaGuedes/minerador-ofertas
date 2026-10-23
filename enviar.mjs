// Manda as ofertas (data/painel.json) e as capas pro banco do app da VK, pela função /api/minerador-sync.
// Sem chave guardada: usa a identificação que o GitHub Actions gera a cada execução (OIDC, permissão id-token: write).
import fs from 'node:fs';

const DESTINO = 'https://vkcompanyy.netlify.app/api/minerador-sync';
const raiz = new URL('./', import.meta.url);
const painelTxt = fs.readFileSync(new URL('data/painel.json', raiz), 'utf8');
const painel = JSON.parse(painelTxt);

async function identidade() {
  const { ACTIONS_ID_TOKEN_REQUEST_URL: url, ACTIONS_ID_TOKEN_REQUEST_TOKEN: tok } = process.env;
  if (!url || !tok) throw new Error('Sem identificação do GitHub (rode dentro do GitHub Actions com id-token: write)');
  const r = await fetch(url + '&audience=vk-minerador', { headers: { Authorization: 'Bearer ' + tok } });
  return (await r.json()).value;
}

async function enviar(corpo) {
  const r = await fetch(DESTINO, {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + await identidade() },
    body: JSON.stringify(corpo),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`Função respondeu ${r.status}: ${t}`);
  return JSON.parse(t);
}

// 1) ofertas, em partes de até 700 KB (cada registro do banco aguenta 1 MB)
const partes = [];
for (let i = 0; i < painelTxt.length; i += 700_000) partes.push(painelTxt.slice(i, i + 700_000));
console.log('painel', await enviar({ acao: 'painel', partes, atualizado: painel.atualizado }));

// 2) capas: uma ficha por anunciante com as capas dos anúncios dele; manda só o que mudou desde o último envio
const arqEnviadas = new URL('data/capas/enviadas.json', raiz);
const enviadas = fs.existsSync(arqEnviadas) ? JSON.parse(fs.readFileSync(arqEnviadas)) : {};
const fichas = {};
for (const o of painel.ofertas) {
  const c = {};
  for (const a of o.anuncios) {
    if (!a.capa) continue;
    const arq = new URL('data/' + a.capa, raiz);
    if (fs.existsSync(arq)) c[a.id] = 'data:image/jpeg;base64,' + fs.readFileSync(arq).toString('base64');
  }
  if (Object.keys(c).length) fichas[o.page_id] = c;
}
const marca = (c) => Object.keys(c).sort().join(',');
const novas = Object.entries(fichas).filter(([id, c]) => enviadas[id] !== marca(c));
let lote = {}, tam = 0;
const manter = Object.keys(fichas);
for (const [i, [id, c]] of novas.entries()) {
  const t = JSON.stringify(c).length;
  if (tam + t > 3_000_000) { console.log('capas', await enviar({ acao: 'capas', itens: lote })); lote = {}; tam = 0; }
  lote[id] = c; tam += t; enviadas[id] = marca(c);
  if (i === novas.length - 1) console.log('capas', await enviar({ acao: 'capas', itens: lote, manter }));
}
if (!novas.length) console.log('capas', await enviar({ acao: 'capas', itens: {}, manter }));
for (const id of Object.keys(enviadas)) if (!fichas[id]) delete enviadas[id];
fs.writeFileSync(arqEnviadas, JSON.stringify(enviadas));
