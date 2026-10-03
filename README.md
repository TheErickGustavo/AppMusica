<div align="center">

# ⬤ Onda

**Local Soundscape Engine** — player e gerenciador de música desktop, 100% offline.
Electron + Vite + React 18 + TypeScript + Tailwind + Dexie (IndexedDB). Zero nuvem. Zero telemetria remota. Zero conta.

`zinc-950 por dentro · precisão de instrumento por fora`

</div>

---

## ⚡ Rodando no seu PC em menos de 2 minutos

Requisitos: **Windows 10/11** e **Node.js ≥ 18** (recomendo LTS 20+ — [nodejs.org](https://nodejs.org)).

```powershell
git clone https://github.com/TheErickGustavo/AppMusica.git
cd AppMusica
git checkout arena/01a10052-appmusica
npm install
npm run dev
```

Pronto — a janela do Onda abre em ~5s. Clique em **Importar pasta**, aponte para o diretório das suas
músicas (`.mp3 .flac .m4a .aac .wav .ogg .opus .aiff .webm`) e a biblioteca se monta sozinha.

> **O npm travou baixando o Electron?** (rede lenta/corporativa) Use o espelho:
> ```powershell
> $env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"; npm install
> ```

### Gerar um instalador (.exe)

```powershell
npm run icons      # rasteriza resources/icon.svg -> buildResources/*.png
npm run dist:win   # electron-builder -> release/Onda-Setup-1.0.0.exe + portable
```

O `electron-builder` converte `buildResources/icon.png` em `.ico` automaticamente.

---

## 🧠 Arquitetura

```
├─ src/
│  ├─ types/music.ts              Tipos compartilhados main ⇄ renderer (Track, ScanResponse…)
│  ├─ main/                       Processo Node (Electron main)
│  │  ├─ index.ts                 Janela, IPC (dialog/scan/reveal), single-instance, menu zero
│  │  ├─ scanner.ts               Varredura recursiva + music-metadata + cache de capas em disco
│  │  └─ media.ts                 Protocolo `media://` com HTTP Range 206 (seek <100ms) e ETag
│  ├─ preload/index.ts            contextBridge tipado — `window.onda` (nada de Node na UI)
│  └─ renderer/src/
│     ├─ App.tsx                  Orquestração: layout 3 painéis + atalhos globais
│     ├─ hooks/
│     │  ├─ useAudioPlayer.tsx    ★ Máquina de estados do áudio (engine singleton + useSyncExternalStore)
│     │  └─ useLibrary.ts         ★ Listas inteligentes reativas (Dexie live-queries) + scan incremental
│     ├─ lib/
│     │  ├─ db.ts                 ★ Schema Dexie (tracks/folders/meta) + reconcile de scan + regras
│     │  ├─ smartCover.ts         Capas geométricas determinísticas (FNV-1a → SVG data-url)
│     │  ├─ media.ts              URLs do protocolo (path → base64url, imune a normalização)
│     │  ├─ toast.ts              pub/sub de notificações · format.ts (tempos, datas, bytes)
│     │  └─ …
│     └─ components/
│        ├─ Sidebar.tsx           Navegação, pastas vigiadas, estatísticas, telemetria do IndexedDB
│        ├─ TrackList.tsx        ★ Tabela virtualizada (10k faixas @60fps), ordenação, busca, menu de contexto
│        ├─ TrackRow.tsx          Linha densa: capa, play-count, feedback, hover-state tático
│        ├─ PlayerBar.tsx         ★ Dock: scrubber de precisão (ms), transporte, volume, badges L/D
│        ├─ AlbumShelf.tsx       Estante de capas (visualizador de álbuns com filtro por clique)
│        ├─ QueueDrawer.tsx       Espelho da fila real do motor (pending + bag)
│        ├─ Slider.tsx            pointer-capture + teclado + tooltip (scrubber/volume)
│        ├─ CoverArt.tsx · ContextMenu.tsx · Toaster.tsx · FeedbackButtons.tsx · AppIcon.tsx
├─ resources/icon.svg            Ícone oficial (SVG puro, 1024², squircle r=216)
├─ scripts/generate-icons.mjs    SVG → PNGs (@resvg/resvg-js)
└─ docs/MIDJOURNEY_PROMPTS.md    Prompts de identidade (splash / logotipo / pack de capas)
```

### Stack de decisão
| Camada | Escolha | Por quê |
|---|---|---|
| Shell | Electron 33 | Codecs Chromium nativos no Windows sem toolchain Rust/C++ |
| Metadados | `music-metadata` **no processo main** | Lê ID3v2/Vorbis/MP4/FLAC em paralelo (pool de 8), sem travar a UI |
| Banco | Dexie 4 + `useLiveQuery` | IndexedDB com índices para cada lista inteligente; UI reage sozinha |
| Áudio | `<audio>` + `media://` custom com Range | seek instantâneo, zero servidor local, cache com ETag |
| Capas | extraídas no scan → cache de disco | IndexedDB guarda só metadados (10k faixas = ~2MB de DB) |

---

## 📐 Regras de negócio implementadas

### Telemetria anti-spam (play count “de verdade”)
O contador só soma **+1** quando o tempo *efetivamente ouvido* cruza
`min(50% da duração, 30s)` — o que vier primeiro. A contagem:
- acumula só com áudio **fluindo** (relógio de parede × posição do player precisam concordar, janela de 750ms);
- **não** conta seek, pause-baiting, buffer stall, cliques repetidos, nem faixa pulada cedo;
- roda no `requestAnimationFrame` + `timeupdate` com **flush no `ended`**;
- persiste `playCount` e `lastPlayedAt` por `filePath` (chave primária).

### Blacklist (Dislike)
O shuffle é um **bag Fisher-Yates montado sobre a lista `feedback !== 'disliked'`**.
Rejeitadas **nunca** entram no sorteio nem no auto-advance — só tocam se você
dobro-clicar/acionar diretamente nelas (o motor injeta a faixa na frente do bag
sem poluir o sorteio). O QueueDrawer exibe um rodapé confirmando a exclusão.

### Listas inteligentes (queries reativas, não snapshots)
| Lista | Query |
|---|---|
| Todas as Músicas | catálogo completo, ord. por título/artista/álbum/ano/duração/plays/adicionada |
| Mais Tocadas | ordenação decrescente por `playCount` (padrão da view) |
| Favoritas | `feedback = 'liked'` |
| Rejeitadas | `feedback = 'disliked'` |

Like/Dislike são **toggles** (clicar de novo → `neutral`), e o reconcile do scan
preserva contadores/feedback ao reindexar o disco.

---

## ⌨️ Atalhos

| Tecla | Ação | | Tecla | Ação |
|---|---|---|---|---|
| `Espaço` | Play/Pause | | `S` | Shuffle on/off |
| `←` `→` | Seek ∓5s (`Shift`: 15s) | | `R` | Repetição off→fila→faixa |
| `↑` `↓` | Volume ±5% | | `M` | Mudo |
| `L` / `K` | Curtir / Rejeitar faixa atual | | `Q` | Painel da fila |
| `/` | Focar busca | | `Esc` | Fecha menus/fila/limpa busca |

---

## 🎨 Design tokens

- Base `#09090b` · superfícies `#18181b` · cartões `zinc-900/50` · hairlines `border-white/[0.06]` · `backdrop-blur-md` só no dock/menus.
- Acentos utilitários: **emerald `#10b981`** = reprodução/ativos · **amber `#f59e0b`** = likes · **rose `#f43f5e`** = dislikes. Nunca sombra colorida.
- Tipografia do sistema (`Segoe UI Variable → Inter → fallbacks`); **todo número é `font-mono` tabular** (tempos com ms no scrubber, contadores, percentuais).
- Sem fontes/bibliotecas de CDN: o pacote inteiro funciona em avião.

## 🩺 Troubleshooting

- **Janela preta no `npm run dev` (algumas VMs/AMD antigos):** `npx electron-vite dev -- --no-sandbox`.
- **`npm install` apaga a pasta `node_modules/electron/dist`:** antivírus — adicione exceção ou reinstale com o mirror acima.
- **Capa em branco:** a arte vem do cache em `%APPDATA%/onda/covers` — clique com o botão direito → *Re-escanear* para reextrain-do tag.
- **Formato silencioso (ex.: `.alac`, `.wma`):** não decodifica no Chromium; converta (o app os lista mesmo assim, com aviso de erro no playback).

---

Feito com geometria, não com template. ♠
