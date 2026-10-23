// Concorrentes e clonadores das nossas ofertas (configurados em concorrentes.json)
import fs from 'node:fs';

export const CONC = JSON.parse(fs.readFileSync(new URL('./concorrentes.json', import.meta.url))).ofertas;
export const normaliza = (t) => (t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
// Marca de quais ofertas nossas o anunciante é concorrente, e se copiou texto dos nossos anúncios
export function classificaConcorrencia(anuncios, porBusca = []) {
  const texto = anuncios.map((a) => `${a.titulo} ${a.texto}`).join(' ');
  const plano = normaliza(texto);
  const concorrencia = new Set(porBusca);
  const clonador = new Set(), parecida = new Set();
  for (const o of CONC) {
    if (o.reconhecer && new RegExp(o.reconhecer, 'i').test(texto)) concorrencia.add(o.id);
    for (const t of o.parecidos || []) if (plano.includes(normaliza(t))) { parecida.add(o.id); concorrencia.add(o.id); }
    for (const t of o.nossosTextos || []) {
      const n = normaliza(t);
      if (n.split(' ').length >= 6 && plano.includes(n)) { clonador.add(o.id); concorrencia.add(o.id); }
    }
  }
  return { concorrencia: [...concorrencia], clonador_de: [...clonador], parecida_com: [...parecida].filter((x) => !clonador.has(x)) };
}
