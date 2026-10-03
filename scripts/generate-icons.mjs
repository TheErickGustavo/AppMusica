/**
 * Gera os raster dos ícones a partir de resources/icon.svg (fonte da verdade).
 *  - buildResources/icon.png  → 512² (electron-builder converte para .ico no Windows)
 *  - buildResources/icon@256.png / @128.png / @64.png / @32.png
 * Uso: `npm run icons` (ou antes do `npm run dist:win`).
 */
import { promises as fs } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { Resvg } from '@resvg/resvg-js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svg = await fs.readFile(join(root, 'resources', 'icon.svg'), 'utf8')
const outDir = join(root, 'buildResources')
await fs.mkdir(outDir, { recursive: true })

const sizes = [
  { name: 'icon.png', size: 512 },
  { name: 'icon@256.png', size: 256 },
  { name: 'icon@128.png', size: 128 },
  { name: 'icon@64.png', size: 64 },
  { name: 'icon@32.png', size: 32 }
]

for (const { name, size } of sizes) {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size }, background: 'transparent' })
  const png = resvg.render().asPng()
  await fs.writeFile(join(outDir, name), png)
  console.log(`✓ buildResources/${name} (${size}×${size}, ${(png.length / 1024).toFixed(1)} KB)`)
}

console.log('\nFeito. electron-builder empacota o .ico automaticamente a partir de buildResources/icon.png.')
