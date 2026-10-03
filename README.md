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
git checkout main
npm install
npm run dev
```

Pronto — a janela do Onda abre em ~5s. Clique em **Importar pasta**, aponte para o diretório das suas
músicas (`.mp3 .flac .m4a .aac .wav .ogg .opus .aiff .webm`) e a biblioteca se monta sozinha.

> **O npm travou baixando o Electron?** (rede lenta/corporativa) Use o espelho:
> ```powershell
> $env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"; npm install
> ```

### Dependências novas (Onda 2)

```powershell
npm i            # instala tudo — chokidar (watcher) e fuse.js (busca) já estão no package.json
```

Se você instalou o `.exe` via `npm run dist:win`, os glifos do ThumbarButtons são gerados/empacotados
automaticamente (`npm run icons:media` regenera `resources/player/*.png` se quiser mudar o desenho).

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
│     │  ├─ db.ts                 ★ Schema Dexie v2 (tracks/folders/meta/playlists) + reconcile + regras
│     │  ├─ prompt.ts             Store do diálogo de texto global (criar/renomear playlist)
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
│        ├─ MiniPlayer.tsx        Janela flutuante (?mini=1) — só IPC, sem engine própria
│        ├─ PromptHost.tsx        Modal de texto (criar/renomear playlist)
│        ├─ CoverArt.tsx · ContextMenu.tsx (com submenus) · Toaster.tsx · FeedbackButtons.tsx · AppIcon.tsx
├─ resources/icon.svg            Ícone oficial (SVG puro, 1024², squircle r=216)
├─ scripts/generate-icons.mjs    SVG → PNGs (@resvg/resvg-js)
└─ docs/MIDJOURNEY_PROMPTS.md    Prompts de identidade (splash / logotipo / pack de capas)
```

### Stack de decisão
| Camada | Escolha | Por quê |
|---|---|---|
| Shell | Electron 33 | Codecs Chromium nativos no Windows sem toolchain Rust/C++ |
| Metadados | `music-metadata` **no processo main** | Lê ID3v2/Vorbis/MP4/FLAC em paralelo (pool de 4), sem travar a UI |
| Banco | Dexie 4 + `useLiveQuery` | IndexedDB com índices para cada lista inteligente; UI reage sozinha |
| Áudio | `<audio>` + `media://` custom com Range | seek instantâneo, zero servidor local, cache com ETag |
| Capas | extraídas no scan → cache de disco | IndexedDB guarda só metadados (10k faixas = ~2MB de DB) |
| Watcher | `chokidar` no main | Eventos de disco robustos (awaitWriteFinish p/ downloads em andamento) |
| Busca | `fuse.js` no renderer | Índice de ~5 kB em memória; tolera erro de digitação sem servidor |

---

## 🆕 Onda 2 — playlists, watcher e segundo plano

| Recurso | Como funciona |
|---|---|
| **Playlists customizadas** | Dexie **v2** aditivo (`playlists` + `playlist_tracks` com chave composta `[playlistId+filePath]`). Criar/renomear/excluir, adicionar em lote, arrastar para reordenar, e um diálogo de texto próprio no lugar do `prompt()` do browser. `playCount`/`lastPlayedAt`/`feedback` sobrevivem intactos à migration. |
| **Auto-watcher de pastas** | `chokidar` no processo main vigia cada pasta importada (`awaitWriteFinish` 1.5s + debounce 1s): ao terminar um download com OUTRO app, o arquivo é parseado no main e entra via IPC no Dexie — sem clicar em "Re-escanear". Arquivo apagado também some da biblioteca. HD externo fora do ar é reatado sozinho (retry de 20s). |
| **Drag & drop do Explorer** | solte `.mp3/.flac/.m4a/...` **ou uma pasta inteira** na janela. Caminhos são resolvidos no preload com `webUtils.getPathForFile` (Electron ≥ 32 removeu `File.path`). Nada tocando → toca na hora; tocando algo → entra na fila. |
| **Seleção múltipla** | `Ctrl+clique`, `Shift+clique` (range) e `Ctrl+A`; barra de ações em lote (tocar, fila, playlist, curtir, rejeitar, remover) e menu de contexto com contagem ("Adicionar 15 à playlist…"). |
| **Busca fuzzy** | `fuse.js` (≈5 kB) com `threshold 0.4` sobre título/artista/álbum: `daftpunk` acha *Daft Punk*, `radiohed` acha *Radiohead*. Fallback de substring quando o fuzzy não retorna nada. |
| **Bandeja + teclas de mídia** | Tray com Play/Pause dinâmico, próxima/anterior, mini player e "Sair" — fechar a janela esconde e **a música continua**. `MediaPlayPause`/`MediaNextTrack`/`MediaPreviousTrack` via `globalShortcut`, além do `ThumbarButtons` na barra de tarefas. `backgroundThrottling: false` mantém timers/telemetria exatos com a janela oculta. |
| **Mini player flutuante** | segunda `BrowserWindow` frameless/always-on-top (`?mini=1`, 360×104): capa, título, progresso e transporte. Estado sincronizado por IPC com throttle de 400 ms — a janela do mini **não** tem engine de áudio própria. |
| **Crossfade (opcional)** | fade-out de ~1.8s nos últimos 2s da faixa, desligado por padrão. Sem ping-pong de dois `<audio>`: o volume volta ao normal na faixa seguinte e é abortado em pause/seek. |
| **Manutenção** | "Limpar cache de capas órfãs" no rodapé da sidebar (varre `%APPDATA%/onda/covers` contra os `coverPath` vivos) e pool do scanner reduzido de 8 → 4 para não fazer *thrash* em HDD externo. |

> **Nota honesta sobre o visualizador de espectro (Fase 3.3):** não foi implementado. Criar um `AnalyserNode` obriga a passar o `<audio>` pelo grafo do Web Audio, e o protocolo `media://` é servido como origem customizada — se o grafo fosse "tainted" o áudio sairia mudo ou zerado. Com a regra de "não quebrar a reprodução" acima de tudo, as barrinhas seguem em CSS (elemento de estado, não de fidelidade).

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
| `P` | Abrir mini player | | `Ctrl+A` | Selecionar tudo na lista |

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
- **A janela sumiu e o app continua no Gerenciador de Tarefas:** é o "Fechar para a bandeja" (padrão ligado). Clique no ícone na área de notificação ou desligue a opção no rodapé da sidebar.
- **Música nova não aparece sozinha:** confirme o toggle "Vigar pastas em tempo real" e se a pasta está online (HD desconectado é reatado em até 20s). O log do main (`npm run dev`) mostra `[watcher] vigiando N/M pasta(s)`.
- **Formato silencioso (ex.: `.alac`, `.wma`):** não decodifica no Chromium; converta (o app os lista mesmo assim, com aviso de erro no playback).

---

Feito com geometria, não com template. ♠
