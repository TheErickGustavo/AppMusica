/**
 * Gera os glifos de mídia usados no ThumbarButtons do Windows (barra de
 * tarefas) — PNGs 32×32 brancos com fundo transparente, rasterizados a partir
 * de SVG com o mesmo pipeline dos ícones do app (@resvg/resvg-js, devDep).
 *
 * Uso: `npm run icons:media` (roda junto de `npm run icons`).
 * Os arquivos são commitados em resources/player/ — não é preciso rodar isto
 * para desenvolver; rode apenas se quiser ajustar o desenho dos glifos.
 */
import { promises as fs } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { Resvg } from '@resvg/resvg-js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'resources', 'player')
await fs.mkdir(outDir, { recursive: true })

const SIZE = 32

/** Glifos em stroke branco puro (o Windows inverte/realça sobre a taskbar). */
const GLYPHS = {
  play: '<path d="M11 7.5 L24 16 L11 24.5 Z" fill="#ffffff"/>',
  pause: '<rect x="10" y="7.5" width="4.5" height="17" rx="1.4" fill="#ffffff"/><rect x="17.5" y="7.5" width="4.5" height="17" rx="1.4" fill="#ffffff"/>',
  next: '<path d="M9 7.5 L20 16 L9 24.5 Z" fill="#ffffff"/><rect x="21" y="7.5" width="3" height="17" rx="1.2" fill="#ffffff"/>',
  prev: '<path d="M23 7.5 L12 16 L23 24.5 Z" fill="#ffffff"/><rect x="8" y="7.5" width="3" height="17" rx="1.2" fill="#ffffff"/>'
}

for (const [name, shape] of Object.entries(GLYPHS)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${SIZE}" height="${SIZE}">${shape}</svg>`
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: SIZE }, background: 'transparent' }).render().asPng()
  await fs.writeFile(join(outDir, `${name}.png`), png)
  console.log(`✓ resources/player/${name}.png (${SIZE}×${SIZE}, ${(png.length / 1024).toFixed(1)} KB)`)
}

console.log('\nFeito. Os glifos são empacotados via extraResources (pasta "player").')
