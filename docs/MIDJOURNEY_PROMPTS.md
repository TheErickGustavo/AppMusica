# ONDA · Kit de Identidade Visual — Prompts de Geração

Prompts de produção para Midjourney v6 (`--v 6.1`) e DALL-E 3, calibrados para casar
com o design system do app: base grafite `#09090b/#18181b`, hairlines `white/6%`,
acento esmeralda `#10b981`, âmbar para likes e rosa para dislikes, geometria
"industrial precision" (Linear × Apple Music × Teenage Engineering).

---

## 1 · Splash Screen

### Midjourney v6
```
minimalist dark splash screen artwork for an offline desktop audio player, deep
graphite-black background (#09090b), a single luminous emerald sound wave made of
thin concentric vinyl-groove rings morphing into a vertical equalizer, subtle
brushed-metal gradient, hairline 1px light borders, volumetric glow only at the
wave core, generous negative space, flat vector look with soft noise texture,
industrial design aesthetic, Swiss typographic grid, no text, no logo, no
watermark --ar 16:9 --style raw --stylize 120 --v 6.1
```
**Parâmetros:** `--ar 16:9` cobre a janela padrão do app; renderizar 2560×1440 e
escurecer 8% num overlay CSS se for usar como fundo de janela de splash.

### DALL-E 3 (versão condensada)
```
Dark graphite splash illustration for an offline music player: concentric vinyl
grooves on the left dissolve into a glowing emerald equalizer wave on the right.
Ultra-minimal, flat vector style with subtle grain, single accent color #10b981
on #09090b background, thin silver hairlines, large empty negative space, no text.
```

---

## 2 · Logotipo (wordmark + símbolo)

### Midjourney v6
```
logomark for premium audio software, a bold geometric monogram fusing the letter
O with a spinning vinyl disc and a single sine wave cut through it, matte black
metal disc with one emerald (#10b981) glowing core dot, crisp white waveform bars,
geometric sans wordmark "ONDA" spaced out, flat design, extreme precision, Apple
Human Interface icon style, 8pt grid construction, on light gray #f4f4f5 AND dark
#09090b shown side by side, no gradients except hairline metal sheen, no mockup,
no background scene --ar 4:3 --style raw --stylize 60 --v 6.1
```
**Parâmetros:** `--stylize 60` mantém geometria "de engenharia" (menos pintura,
mais grid). Pedir fundo claro E escuro no mesmo frame facilita extrair as duas
variantes; para iterar o símbolo isolado, trocar o wordmark por `symbol only`.

### DALL-E 3 (versão condensada)
```
Flat vector logomark: letter O as a dark vinyl record, one sine wave slicing
through it, small emerald glow dot at the center, paired with letterspaced wordmark
"ONDA" in a geometric grotesque. Show one version on dark #09090b and one on light
gray. Minimal, precise, no gradients, no scene.
```

---

## 3 · Pacote de Artes de Capa Abstratas (placeholder covers)

### Midjourney v6
```
set of abstract square album cover artworks, unified dark futurist system:
near-black graphite base, one large centered circle of concentric grooves, thin
diagonal scanline, sparse particles, embossed ring, holographic emerald OR amber
(#f59e0b) OR rose (#f43f5e) accent per piece, Bauhaus meets sci-fi, flat vector
with micro-texture grain, crisp 1px inner frame, no text, no artist face, no
logos --ar 1:1 --style raw --stylize 100 --v 6.1
```
**Parâmetros:** gerar em lote com `--ar 1:1`, 1024×1024; nomear arquivos
`onda-pack-01…12` e usar no app (ou como banco de capas genéricas). Para o pack
temático de "modo vazio" do app, renderizar também `--tile` para texturas de fundo.

### DALL-E 3 (versão condensada)
```
One abstract 1:1 album cover, near-black graphite, giant concentric-disc circle
slightly off-center, a single amber holographic arc, fine film grain, Bauhaus
sci-fi minimalism, no text. (repeat swapping accent: emerald #10b981, amber
#f59e0b, rose #f43f5e)
```

---

## Notas de aplicação no produto

- O **ícone canônico do app** já vive em código: `resources/icon.svg` (1024×1024,
  squircle de raio 216 — mesma gramática dos ícones de SO modernos). As imagens
  geradas por IA servem para marketing/hero; o produto permanece 100% vetorial.
- Todas as artes *in-app* de fallback são geradas por hash (FNV-1a → SVG
  determinístico em `src/renderer/src/lib/smartCover.ts`) — cada faixa sem capa
  recebe uma "capa" própria, estável e infinitamente barata.
- Paleta de suporte dos packs: `zinc-950 → zinc-800` de fundo; acentos apenas
  emerald/amber/rose, um por peça — nunca dois acentos na mesma arte.
