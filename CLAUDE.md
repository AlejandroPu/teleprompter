# CLAUDE.md — Análisis de arquitectura

Teleprompter controlado por voz: transcribe el habla en el navegador con Whisper (Transformers.js) y resalta/desplaza el texto sincronizado con la lectura. Todo el cómputo ocurre en el cliente; el servidor solo sirve archivos estáticos.

## Diagrama lógico

```
┌──────────────────────────────────────────────────────────────────────┐
│ Navegador                                                            │
│                                                                      │
│  index.html                                                          │
│    │                                                                 │
│    ├─ css/ (base · setup · prompter)      ← variables CSS + temas    │
│    │                                                                 │
│    └─ js/main.js  (UI / eventos DOM)                                 │
│         │                                                            │
│         └─► js/prompter.js  (motor: estado + audio + matching)       │
│                │                                                     │
│                │  postMessage(Float32 PCM 16kHz)                     │
│                ▼                                                     │
│         whisper-worker.js  (Web Worker)                              │
│                │  pipeline('automatic-speech-recognition',           │
│                │           'Xenova/whisper-tiny.en')                 │
│                ▼                                                     │
│         Transformers.js (CDN jsDelivr) + modelo cacheado IndexedDB   │
└──────────────────────────────────────────────────────────────────────┘
                      ▲
                      │  HTTP estático
┌──────────────────────────────────────────────────────────────────────┐
│ server.js  — Express, sirve public/ en :3000                         │
└──────────────────────────────────────────────────────────────────────┘
```

## Capas

### 1. Servidor (`server.js`)
- Express 5 sirviendo `public/` como estáticos en el puerto 3000.
- Sin API, sin sesión, sin estado. Es un simple shell de distribución.

### 2. Vista (`public/index.html` + `css/`)
- Tres pantallas superpuestas controladas por `display`: `#setup`, `#loadingOverlay`, `#prompter`.
- CSS partido por pantalla: `base.css` (variables, reset), `setup.css`, `prompter.css`.
- Parámetros visuales vía variables CSS en `:root` (`--font-size`, `--text-width`) que los sliders modifican en caliente.

### 3. UI / Controlador (`public/js/main.js`)
- Punto de entrada (`<script type="module">`).
- Solo conecta eventos DOM (click, input, keydown, wheel) con la API pública de `prompter.js`.
- No mantiene estado de dominio: toda la lógica la delega. La única excepción es el debounce de 3 s para reanudar auto-scroll tras scroll manual.

### 4. Motor (`public/js/prompter.js`)
Módulo ES con **estado interno privado** y una superficie pública explícita (`export { buildPrompter, initWorker, toggleMic, toggleAutoScroll, togglePanelVisibility, reset, exit }`). Encapsula cuatro responsabilidades:

1. **Modelo de texto** — `buildPrompter(text)` tokeniza en palabras, crea `<span class="word">` por cada una y mantiene el array `words` con `{text, clean, el}`.
2. **Captura de audio** — `getUserMedia` + `MediaRecorder` graba chunks de `CHUNK_MS` (2000 ms). En `onstop` decodifica con `AudioContext(16000)`, extrae `Float32Array` mono, y lo envía **transferible** al worker. Clave: **reinicia la grabación antes de esperar la transcripción** para evitar huecos de audio y que el procesamiento bloquee el scroll.
3. **Matching habla→texto** — `findBestMatch()` usa una ventana deslizante hacia adelante (`SEARCH_WINDOW=15`, `MATCH_CHAIN=6`) que solo permite avanzar (desde `currentIdx-2`). Compara las últimas 6 palabras habladas normalizadas (`cleanWord`: minúsculas, sin puntuación) contra el guion. Evita retrocesos espurios y re-matches cuando Whisper repite.
4. **Scroll y highlight** — `scrollToWord` anima `scrollTop` con `requestAnimationFrame` a velocidad máxima `MAX_SCROLL_SPEED=3 px/frame`, manteniendo la palabra activa al 28 % desde arriba. `updateHighlight` marca palabras como `passed` / `active` / (sin clase).

### 5. Worker de inferencia (`public/whisper-worker.js`)
- Aislado en Web Worker (módulo ES) para no bloquear el hilo principal con la inferencia.
- Carga `@xenova/transformers` desde CDN jsDelivr (no desde `node_modules`; el paquete npm es probablemente un vestigio).
- Modelo: `Xenova/whisper-tiny` (multilenguaje). El idioma se pasa por inferencia vía la opción `language` del pipeline, seleccionado por el usuario en el setup.
- Protocolo de mensajes: `{type:'load'}` → `'status'`/`'ready'`; `{type:'transcribe', audio}` → `'transcript'`/`'error'`.

## Flujo de una sesión

1. Usuario pega texto y ajusta sliders en `#setup`.
2. `startBtn` → `buildPrompter(raw)` crea los spans, oculta setup, muestra overlay.
3. `initWorker()` instancia el Worker y envía `load`. Durante la descarga del modelo (~150 MB, cacheado en IndexedDB tras la primera vez) se muestran los `status`.
4. `ready` → oculta overlay, muestra prompter, llama `startMic()`.
5. `MediaRecorder` produce un blob cada 2 s → decodificado a PCM 16 kHz → `worker.postMessage` con `Transferable`.
6. Worker devuelve `transcript` → `handleTranscript` empareja → actualiza `currentIdx`, repinta highlight y dispara scroll animado.
7. `exit` detiene tracks, termina el worker y vuelve a `#setup`.

## Decisiones de diseño relevantes

- **Privacidad**: toda la inferencia corre en el cliente; el servidor no ve audio ni texto.
- **Back-pressure por descarte**: si llega un chunk mientras `processingAudio=true`, se descarta. Prioriza latencia percibida sobre cobertura de transcripción.
- **Solo avance**: el matcher nunca retrocede (`matched >= currentIdx`). Errores de ASR no deshacen progreso.
- **Estado encapsulado en closures de módulo** en lugar de clase. `main.js` no puede mutar `currentIdx`, `words`, etc.; solo invocar la API pública.
- **Variables CSS como canal UI↔render**: los sliders escriben `--font-size` / `--text-width` en `:root` en lugar de tocar estilos por elemento.

## Dependencias

- Runtime servidor: `express@^5.2.1`.
- Runtime cliente: `@xenova/transformers@2.17.2` cargado desde jsDelivr (el paquete npm instalado no se usa en tiempo de ejecución).
- APIs del navegador requeridas: Web Workers (módulos), MediaDevices, MediaRecorder, AudioContext, IndexedDB (caché del modelo).

## Puntos frágiles / deuda técnica

- **Idioma**: resuelto en 2.1.0 con selector de idioma y modelo multilenguaje.
- **Dependencia doble** de transformers (npm + CDN): npm es peso muerto o preparación para bundling futuro.
- **Transcript acumulativo**: cada chunk es una transcripción *independiente* de 2 s; la continuidad la resuelve el matcher, no un buffer. Si el usuario habla entre chunks, se pierde.
- **Sin tests** (`npm test` es placeholder) ni script `start` en `package.json`.
- **`package.json`** con `main: index.js` inexistente y sin metadatos (author, description, repository).
- **Accesibilidad**: botones sin `aria-label`, sliders sin `<label for>` explícito, textos solo en inglés.
- **Sin manejo de errores de permisos persistente** más allá de un `alert` al denegar el micro.

## Mapa rápido de archivos

| Archivo | Responsabilidad |
|---|---|
| `server.js` | Express estático en :3000 |
| `public/index.html` | Marcado de las tres pantallas + carga de CSS/JS |
| `public/css/base.css` | Variables CSS, reset, estilos compartidos |
| `public/css/setup.css` | Pantalla de configuración inicial |
| `public/css/prompter.css` | Pantalla de lectura, panel y overlays |
| `public/js/main.js` | Glue de eventos DOM → API del motor |
| `public/js/prompter.js` | Estado, audio, matching, scroll (API pública) |
| `public/whisper-worker.js` | Worker que hospeda Transformers.js + Whisper |
