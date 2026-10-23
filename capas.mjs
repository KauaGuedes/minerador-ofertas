// Baixa a capa (imagem ou capa do vídeo) dos principais anúncios de cada oferta e guarda no repositório.
// Os links de imagem da Meta expiram em poucos dias; guardando aqui, o app sempre tem a capa.
import fs from 'node:fs';
import sharp from 'sharp';

const DADOS = JSON.parse(fs.readFileSync(new URL('./data/ofertas.json', import.meta.url)));
const PASTA = new URL('./data/capas/', import.meta.url);
fs.mkdirSync(PASTA, { recursive: true });
const MIN_ATIVOS = 10;
const POR_OFERTA = 3;

const indiceArq = new URL('./data/capas/index.json', import.meta.url);
const indice = fs.existsSync(indiceArq) ? JSON.parse(fs.readFileSync(indiceArq)) : {};
let baixadas = 0, falhas = 0;

for (const o of Object.values(DADOS.ofertas)) {
  if ((o.ativos ?? 0) < MIN_ATIVOS) continue;
  for (const a of (o.anuncios || []).filter((x) => x.capa).slice(0, POR_OFERTA)) {
    const arq = new URL(`${a.id}.jpg`, PASTA);
    if (fs.existsSync(arq)) { indice[a.id] = o.page_id; continue; }
    try {
      const r = await fetch(a.capa, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36' } });
      if (!r.ok) throw new Error(r.status);
      fs.writeFileSync(arq, await sharp(Buffer.from(await r.arrayBuffer())).resize({ width: 360, withoutEnlargement: true }).jpeg({ quality: 72, mozjpeg: true }).toBuffer());
      indice[a.id] = o.page_id; baixadas++;
    } catch { falhas++; }
    await new Promise((res) => setTimeout(res, 150));
  }
}
fs.writeFileSync(indiceArq, JSON.stringify(indice));
console.log({ baixadas, falhas, total: Object.keys(indice).length });
