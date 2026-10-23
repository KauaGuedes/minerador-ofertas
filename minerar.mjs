// Minerador de ofertas da Biblioteca de Anúncios da Meta
// Abre a Biblioteca como um navegador comum, pesquisa as palavras-chave de cada país,
// guarda só anúncios com destino WhatsApp, agrupa por anunciante e conta os anúncios ativos.
import { chromium } from 'playwright';
import fs from 'node:fs';

const CONFIG = JSON.parse(fs.readFileSync(new URL('./config.json', import.meta.url)));
const ARQ_DADOS = new URL('./data/ofertas.json', import.meta.url);
const ARQ_LOG = new URL('./data/ultima-execucao.json', import.meta.url);
const SO_TESTE = process.argv.includes('--teste'); // rodada curta para testar

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const aleatorio = (a, b) => a + Math.floor(Math.random() * (b - a));
const hoje = new Date().toISOString().slice(0, 10);

// Acha um array JSON começando em `inicio` (posição do "[") e devolve o texto dele
function recortaArray(texto, inicio) {
  let nivel = 0, emTexto = false, escape = false;
  for (let i = inicio; i < texto.length; i++) {
    const c = texto[i];
    if (emTexto) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') emTexto = false;
      continue;
    }
    if (c === '"') emTexto = true;
    else if (c === '[' || c === '{') nivel++;
    else if (c === ']' || c === '}') { nivel--; if (nivel === 0) return texto.slice(inicio, i + 1); }
  }
  return null;
}

// Extrai todos os anúncios ("collated_results") de um HTML ou resposta GraphQL
function extraiAnuncios(texto) {
  const lista = [];
  const chave = '"collated_results":';
  let pos = texto.indexOf(chave);
  while (pos !== -1) {
    const ini = pos + chave.length;
    const trecho = recortaArray(texto, ini);
    if (trecho) { try { lista.push(...JSON.parse(trecho)); } catch {} }
    pos = texto.indexOf(chave, ini);
  }
  return lista;
}

function ehWhatsApp(ad) {
  const s = ad.snapshot || {};
  const partes = [s.cta_type, s.link_url, s.caption, s.cta_text,
    ...(s.cards || []).flatMap((c) => [c.cta_type, c.link_url, c.cta_text])].join(' ').toLowerCase();
  return partes.includes('whatsapp') || partes.includes('wa.me');
}

function resumoAnuncio(ad) {
  const s = ad.snapshot || {};
  const card = (s.cards || [])[0] || {};
  const video = (s.videos || [])[0] || {};
  const img = (s.images || [])[0] || {};
  return {
    id: ad.ad_archive_id,
    inicio: ad.start_date ? new Date(ad.start_date * 1000).toISOString().slice(0, 10) : null,
    duplicado: ad.collation_count || 1,
    texto: (s.body?.text || card.body || '').slice(0, 600),
    titulo: s.title || card.title || '',
    link: s.link_url || card.link_url || '',
    video: video.video_hd_url || video.video_sd_url || card.video_hd_url || card.video_sd_url || null,
    capa: video.video_preview_image_url || card.video_preview_image_url || img.resized_image_url || card.resized_image_url || img.original_image_url || null,
    plataformas: ad.publisher_platform || [],
  };
}

async function abrir(page, url) {
  const respostas = [];
  const ouvinte = async (res) => {
    if (!res.url().includes('/api/graphql')) return;
    try { const t = await res.text(); if (t.includes('collated_results')) respostas.push(t); } catch {}
  };
  page.on('response', ouvinte);
  const r = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await espera(aleatorio(3500, 6000));
  return { status: r?.status(), respostas, parar: () => page.off('response', ouvinte) };
}

async function main() {
  const navegador = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
  const contexto = await navegador.newContext({
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    viewport: { width: 1366, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  });
  const page = await contexto.newPage();
  const log = { data: new Date().toISOString(), buscas: [], erros: [], bloqueado: false };
  const anunciantes = new Map(); // page_id -> dados

  // 1) Buscas por palavra-chave
  for (const [pais, palavras] of Object.entries(CONFIG.paises)) {
    const lista = SO_TESTE ? palavras.slice(0, 2) : palavras;
    for (const palavra of lista) {
      const url = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${pais}` +
        `&q=${encodeURIComponent(palavra)}&search_type=keyword_unordered&media_type=all`;
      try {
        const aba = await abrir(page, url);
        const rolagens = SO_TESTE ? 2 : CONFIG.rolagensPorBusca;
        for (let i = 0; i < rolagens; i++) {
          await page.mouse.wheel(0, aleatorio(4000, 7000));
          await espera(aleatorio(2500, 4500));
        }
        const html = await page.content();
        aba.parar();
        const ads = [...extraiAnuncios(html), ...aba.respostas.flatMap(extraiAnuncios)];
        const zap = ads.filter(ehWhatsApp);
        log.buscas.push({ pais, palavra, status: aba.status, anuncios: ads.length, whatsapp: zap.length });
        if (ads.length === 0 && /login|checkpoint/i.test(page.url())) log.bloqueado = true;

        for (const ad of zap) {
          const s = ad.snapshot || {};
          if ((s.page_like_count || 0) > CONFIG.ignorarPaginasComMaisDeCurtidas) continue;
          const id = ad.page_id;
          if (!anunciantes.has(id)) {
            anunciantes.set(id, {
              page_id: id, pagina: ad.page_name || s.page_name, perfil: s.page_profile_uri,
              foto: s.page_profile_picture_url, curtidas: s.page_like_count, categorias: s.page_categories,
              paises: new Set(), palavras: new Set(), anuncios: new Map(),
            });
          }
          const a = anunciantes.get(id);
          a.paises.add(pais); a.palavras.add(palavra);
          if (!a.anuncios.has(ad.ad_archive_id)) a.anuncios.set(ad.ad_archive_id, resumoAnuncio(ad));
        }
      } catch (e) { log.erros.push(`${pais} "${palavra}": ${e.message}`); }
      await espera(aleatorio(2000, 5000));
    }
  }

  // 2) Total de anúncios ativos de cada anunciante (página dele na Biblioteca)
  const ordem = [...anunciantes.values()]
    .sort((x, y) => Math.max(...[...y.anuncios.values()].map((v) => v.duplicado)) - Math.max(...[...x.anuncios.values()].map((v) => v.duplicado)))
    .slice(0, SO_TESTE ? 10 : CONFIG.maxAnunciantesParaContar);
  for (const a of ordem) {
    try {
      const url = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&view_all_page_id=${a.page_id}&search_type=page&media_type=all`;
      const aba = await abrir(page, url);
      const html = await page.content();
      aba.parar();
      const i = html.indexOf('"search_results_connection"');
      const m = i >= 0 ? html.slice(i, i + 400).match(/"count":(\d+)/) : null;
      a.ativos = m ? Number(m[1]) : null;
      // aproveita pra pegar mais criativos do anunciante
      for (const ad of extraiAnuncios(html).filter(ehWhatsApp).slice(0, 12)) {
        if (!a.anuncios.has(ad.ad_archive_id)) a.anuncios.set(ad.ad_archive_id, resumoAnuncio(ad));
      }
    } catch (e) { log.erros.push(`contagem ${a.pagina}: ${e.message}`); }
    await espera(aleatorio(1500, 4000));
  }
  await navegador.close();

  // 3) Junta com o histórico
  const antigo = fs.existsSync(ARQ_DADOS) ? JSON.parse(fs.readFileSync(ARQ_DADOS)) : { ofertas: {} };
  for (const a of anunciantes.values()) {
    const anuncios = [...a.anuncios.values()].sort((x, y) => (y.duplicado - x.duplicado) || ((x.inicio || '').localeCompare(y.inicio || '')));
    const inicios = anuncios.map((v) => v.inicio).filter(Boolean).sort();
    const velho = antigo.ofertas[a.page_id] || {};
    const historico = [...(velho.historico || []).filter((h) => h.data !== hoje)];
    if (a.ativos != null) historico.push({ data: hoje, ativos: a.ativos });
    antigo.ofertas[a.page_id] = {
      ...velho,
      page_id: a.page_id, pagina: a.pagina, perfil: a.perfil, foto: a.foto, curtidas: a.curtidas, categorias: a.categorias,
      paises: [...new Set([...(velho.paises || []), ...a.paises])],
      palavras: [...new Set([...(velho.palavras || []), ...a.palavras])],
      ativos: a.ativos ?? velho.ativos ?? null,
      anuncio_mais_antigo: inicios[0] || velho.anuncio_mais_antigo || null,
      maior_duplicacao: Math.max(0, ...anuncios.map((v) => v.duplicado)),
      anuncios: anuncios.slice(0, 15),
      primeira_vez: velho.primeira_vez || hoje,
      ultima_vez: hoje,
      historico: historico.slice(-60),
      biblioteca: `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&view_all_page_id=${a.page_id}&search_type=page&media_type=all`,
    };
  }
  antigo.atualizado = new Date().toISOString();
  fs.mkdirSync(new URL('./data/', import.meta.url), { recursive: true });
  fs.writeFileSync(ARQ_DADOS, JSON.stringify(antigo, null, 1));
  log.anunciantes = anunciantes.size;
  log.contados = ordem.filter((a) => a.ativos != null).length;
  fs.writeFileSync(ARQ_LOG, JSON.stringify(log, null, 1));
  console.log(JSON.stringify({ ...log, buscas: log.buscas.length }, null, 1));
  console.table(log.buscas);
}

main().catch((e) => { console.error(e); process.exit(1); });
