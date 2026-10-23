// Junta ofertas.json + analise.json num pacote enxuto e gera a prévia em HTML
import fs from 'node:fs';
import { classificaConcorrencia, CONC } from '../concorrencia.mjs';
const raiz = new URL('../', import.meta.url);
const ler = (p) => JSON.parse(fs.readFileSync(new URL(p, raiz)));
const dados = ler('data/ofertas.json');
const PAINEL = process.argv.includes('--painel');
const thumbs = process.env.THUMBS && fs.existsSync(process.env.THUMBS) ? JSON.parse(fs.readFileSync(process.env.THUMBS)) : {};
const analise = fs.existsSync(new URL('data/analise.json', raiz)) ? ler('data/analise.json').ofertas : {};

export function pacote() {
  const ofertas = Object.values(dados.ofertas).map((o) => ({
    page_id: o.page_id, pagina: o.pagina, paises: o.paises, ativos: o.ativos,
    anuncio_mais_antigo: o.anuncio_mais_antigo, maior_duplicacao: o.maior_duplicacao,
    primeira_vez: o.primeira_vez, historico: o.historico, biblioteca: o.biblioteca,
    anuncios: (o.anuncios || []).slice(0, 4).map((a) => ({
      id: a.id, inicio: a.inicio, duplicado: a.duplicado, titulo: (a.titulo || '').slice(0, 120),
      texto: (a.texto || '').slice(0, 450),
      video: PAINEL ? (a.video || null) : !!a.video,
      capa: PAINEL ? (fs.existsSync(new URL(`data/capas/${a.id}.jpg`, raiz)) ? `capas/${a.id}.jpg` : null) : (thumbs[a.id] || null),
    })),
    analise: analise[o.page_id] || null,
    ...(o.concorrencia ? { concorrencia: o.concorrencia, clonador_de: o.clonador_de || [], parecida_com: o.parecida_com || [] } : classificaConcorrencia(o.anuncios || [])),
  }));
  return { atualizado: (dados.atualizado || '').slice(0, 10), ofertas, nossas: CONC.map(({ id, nome }) => ({ id, nome })), logo: process.env.LOGO && fs.existsSync(process.env.LOGO) ? fs.readFileSync(process.env.LOGO, 'utf8').trim() : null };
}

if (PAINEL) {
  // pacote que o app da VK lê (capas e vídeos por link)
  fs.writeFileSync(new URL('data/painel.json', raiz), JSON.stringify(pacote()));
  console.log('painel.json ok');
} else if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const json = JSON.stringify(pacote()).replace(/</g, '\\u003c');
  const html = fs.readFileSync(new URL('visual/template.html', raiz), 'utf8').replace('__DATA__', () => json);
  const saida = process.argv[2] || new URL('visual/minerador-preview.html', raiz);
  fs.writeFileSync(saida, html);
  console.log('ok', (html.length / 1024).toFixed(0) + 'KB');
}
