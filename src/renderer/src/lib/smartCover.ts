/**
 * Capas geradas deterministicamente (fallback anti-broken-image).
 *
 * Sem biblioteca de render — SVG puro como data-url:
 *  - FNV-1a vira o seed (mesmo nome → mesma arte, sempre);
 *  - mulberry32 gera composição geométrica (discos concêntricos, setor
 *    pontilhado, diagonal, tipografia mínima);
 *  - paleta dark zinc + acento HSL dessaturado → combina com o app inteiro.
 */

const cache = new Map<string, string>()

export function fnv1a(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function smartCoverDataUrl(seedKey: string, label?: string): string {
  const cached = cache.get(seedKey)
  if (cached) return cached

  const hash = fnv1a(seedKey)
  const rnd = mulberry32(hash)
  const hue = Math.floor(rnd() * 360)
  const sat = 22 + Math.floor(rnd() * 20) // 22–42%: contido, nunca "rainbow slop"
  const rot = Math.floor(rnd() * 360)
  const cx = 128
  const cy = 128
  const r0 = 34 + Math.floor(rnd() * 14)

  const rings: string[] = []
  for (let i = 1; i <= 4; i++) {
    const r = r0 + i * 26 + Math.floor(rnd() * 8)
    const w = (0.6 + rnd() * 1.6).toFixed(2)
    const o = (0.06 + rnd() * 0.12).toFixed(3)
    rings.push(
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="hsl(${hue} ${sat}% 70%)" stroke-opacity="${o}" stroke-width="${w}"/>`
    )
  }

  // Setor pontilhado (estilo "grooves" de vinil)
  const arcR = r0 + 100 + Math.floor(rnd() * 26)
  const arcC = 2 * Math.PI * arcR
  const dash = 1.2
  const gap = 6 + Math.floor(rnd() * 10)
  const arcDeg = 40 + Math.floor(rnd() * 120)
  const arcLen = (arcDeg / 360) * arcC
  const arcRot = Math.floor(rnd() * 360)
  const arc =
    `<circle cx="${cx}" cy="${cy}" r="${arcR}" fill="none" stroke="hsl(${hue} ${Math.min(sat + 25, 70)}% 62%)" ` +
    `stroke-opacity="0.55" stroke-width="2" stroke-dasharray="${dash} ${gap}" stroke-linecap="round" ` +
    `stroke-dashoffset="${(arcC - arcLen).toFixed(1)}" transform="rotate(${arcRot} ${cx} ${cy})"/>`

  // Diagonal fina de "agulha"
  const needleY = 168 + Math.floor(rnd() * 90)
  const needle = `<line x1="24" y1="${needleY}" x2="200" y2="248" stroke="hsl(${hue} ${sat}% 80%)" stroke-opacity="0.14" stroke-width="1.5"/>`

  const initials = (label ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[\s-–—_]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => (w[0] ?? '#').toUpperCase())
    .join('')

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">` +
    `<defs>` +
    `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="#1c1c20"/>` +
    `<stop offset="0.55" stop-color="#121215"/>` +
    `<stop offset="1" stop-color="#09090b"/>` +
    `</linearGradient>` +
    `<radialGradient id="a" cx="${(28 + rnd() * 44).toFixed(0)}%" cy="18%" r="88%">` +
    `<stop offset="0" stop-color="hsl(${hue} ${sat + 8}% 26%)" stop-opacity="0.55"/>` +
    `<stop offset="1" stop-color="hsl(${hue} ${sat}% 12%)" stop-opacity="0"/>` +
    `</radialGradient>` +
    `</defs>` +
    `<rect width="256" height="256" fill="url(#g)"/>` +
    `<rect width="256" height="256" fill="url(#a)"/>` +
    `<g transform="rotate(${rot} ${cx} ${cy})">${rings.join('')}${arc}</g>` +
    `${needle}` +
    `<circle cx="${cx}" cy="${cy}" r="${r0}" fill="hsl(${hue} ${sat}% 16%)" stroke="hsl(${hue} ${Math.min(sat + 22, 72)}% 60%)" stroke-opacity="0.5" stroke-width="1.5"/>` +
    (initials
      ? `<text x="${cx}" y="${cy + 9}" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif" font-size="30" font-weight="600" letter-spacing="1" fill="hsl(${hue} ${Math.min(sat + 30, 78)}% 80%)" fill-opacity="0.85">${esc(initials)}</text>`
      : '') +
    `<rect x="0.5" y="0.5" width="255" height="255" rx="6" fill="none" stroke="#ffffff" stroke-opacity="0.06" stroke-width="1"/>` +
    `</svg>`

  const url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
  cache.set(seedKey, url)
  return url
}
