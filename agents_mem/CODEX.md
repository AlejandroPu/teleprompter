# CODEX.md

Informe técnico persistente del proyecto, creado por Codex el 2026-04-27.

## Resumen ejecutivo

El proyecto es una aplicación de teleprompter guiado por voz, implementada como frontend estático en JavaScript vanilla y servida por un servidor Express mínimo. Su propuesta técnica es simple y pragmática: evitar frameworks, ejecutar Whisper en el navegador mediante un Web Worker y usar APIs nativas de audio para capturar, procesar y transcribir voz en tiempo real.

El estado general es bueno para un proyecto pequeño o personal: la app es entendible, el arranque es trivial y la separación entre UI, motor principal y worker es suficiente. El principal problema no es de complejidad accidental excesiva, sino de robustez: la lógica crítica está concentrada en un único módulo con bastante estado global mutable y varias transiciones asíncronas sensibles.

## Estructura del proyecto

- `server.js`
  Servidor Express mínimo que expone `public/` como contenido estático.
- `public/index.html`
  Shell principal de la aplicación con pantalla de setup, overlay de carga y pantalla de prompter.
- `public/js/main.js`
  Conecta eventos de UI, sliders, selección de micrófono, monitor de nivel y controles del panel.
- `public/js/prompter.js`
  Núcleo de la aplicación: estado, construcción del texto, matching de transcripción, scroll, grabación de audio y coordinación con Whisper.
- `public/whisper-worker.js`
  Worker que carga el modelo y ejecuta transcripción con Transformers.js.
- `public/css/*.css`
  Estilos separados entre base, setup y vista del prompter.

## Arquitectura

La arquitectura actual tiene una división útil en tres capas:

1. Capa de presentación
   `index.html` + CSS + listeners en `main.js`.

2. Capa de ejecución del prompter
   `prompter.js` controla el flujo principal de sesión, el audio, el avance del texto y el estado de reproducción.

3. Capa de inferencia
   `whisper-worker.js` encapsula la carga del modelo y el proceso de transcripción para no bloquear la UI.

Esto está bien resuelto para un proyecto pequeño. El punto débil es que `prompter.js` hace demasiadas cosas a la vez:

- estado de sesión
- control de micrófono
- decodificación de audio
- armado de chunks
- matching transcript-texto
- scroll automático
- parte del feedback visual

Todavía es mantenible, pero ya es el módulo que concentra casi todo el riesgo técnico.

## Fortalezas

- Arranque simple, sin build step.
- Separación razonable entre UI principal y worker.
- Buen uso de APIs nativas del navegador.
- Interfaz visual cuidada y consistente.
- Soporte multilenguaje ya incorporado.
- Algunas mejoras de accesibilidad ya presentes.
- Código lo bastante pequeño como para refactorizarse sin gran costo.

## Debilidades técnicas

### 1. Estado global mutable

`public/js/prompter.js` depende de varias variables globales de módulo:

- `words`
- `currentIdx`
- `micActive`
- `worker`
- `audioContext`
- `mediaRecorder`
- `processingAudio`
- `audioTail`

Eso vuelve más frágiles los cambios, especialmente en reinicio de sesión, pausa/reanudación y recuperación ante errores.

### 2. Pérdida silenciosa de chunks de audio

En `beginRecording()`, cuando termina un chunk, si `processingAudio` sigue activo se descarta el nuevo chunk en lugar de encolarlo o degradar el sistema de manera explícita.

Consecuencia:

- en hardware lento
- con modelos pesados
- o con transcripción más costosa de lo esperado

la app puede perder fragmentos de voz y avanzar de forma menos confiable.

### 3. Matching heurístico frágil

`findBestMatch()` usa una ventana acotada hacia adelante y acepta coincidencias muy débiles. Eso simplifica bastante la implementación, pero puede producir:

- saltos erróneos en textos repetitivos
- avance por coincidencia aislada
- menor estabilidad cuando Whisper devuelve fragmentos imperfectos

### 4. Semántica incorrecta de reset

`resetPrompter()` reinicia el índice pero también vacía `words`. Eso hace que el “reset” no sea un simple regreso al inicio, sino una destrucción parcial del estado interno del texto.

### 5. Manejo de errores básico

El proyecto usa principalmente:

- `alert(...)`
- `console.warn(...)`
- `console.error(...)`

Eso es suficiente para prototipo, pero pobre para producto utilizable. El usuario no tiene un canal de error consistente dentro de la interfaz.

### 6. Sin pruebas automáticas

No hay tests unitarios, de integración ni smoke tests. Esto importa especialmente porque sí hay lógica determinista que conviene fijar con pruebas:

- normalización de palabras
- matching
- reset de sesión
- transición pausa/reanudar

### 7. Metadata y documentación inconsistentes

Hay varias incoherencias entre repo y estado real del proyecto:

- `package.json` marca versión `1.0.0`, pero el changelog va por `2.2.0`
- `main` apunta a `index.js`, que no existe
- el script `test` es sólo un placeholder
- el README sugiere capacidades “offline” que dependen de que los assets remotos ya estén cacheados

## Riesgos funcionales prioritarios

### Riesgo alto

- Pérdida de chunks mientras el worker sigue ocupado.
- Avance incorrecto por matching demasiado permisivo.

### Riesgo medio

- Reinicios de sesión inconsistentes por estado global.
- Posibles errores al alternar micrófono, pausar y reanudar en secuencias no previstas.

### Riesgo bajo

- Servidor mínimo sin configuración adicional.
- Deuda de scripts y metadata.

## Experiencia de ejecución observada

Se verificó que la app arranca localmente y responde por HTTP:

- `http://localhost:3000`
- `http://localhost:3000/js/prompter.js`

El servidor está bien para el objetivo actual. No se detectó problema de arranque en la capa Express.

## Evaluación por área

### Frontend y UX

La UI está bien pensada para el caso de uso. La separación setup/prompter es clara, y el panel de control en sesión es consistente con la experiencia esperada.

Puntos a mejorar:

- mensajes de error en pantalla
- feedback si el modelo tarda demasiado en cargar
- feedback si la transcripción está perdiendo chunks
- feedback más claro al no detectar coincidencias en el texto

### Audio y transcripción

La estrategia general es correcta:

- `getUserMedia`
- `AudioContext`
- `GainNode`
- `MediaRecorder`
- worker de inferencia

El punto delicado no es el pipeline base sino la coordinación temporal entre grabación, decodificación y transcripción.

### Mantenibilidad

El proyecto todavía es refactorizable con bajo costo. No está “roto”; simplemente está entrando en la etapa donde conviene modularizar antes de agregar más features.

## Recomendaciones priorizadas

### Prioridad 1

- Corregir `package.json`: versión, `main`, scripts reales (`start`, opcionalmente `dev`).
- Arreglar `resetPrompter()` para que reinicie sin vaciar `words`.
- Introducir una estrategia explícita para chunks cuando el worker esté ocupado.

### Prioridad 2

- Endurecer `findBestMatch()` con umbral mejor definido.
- Separar en módulos la lógica de:
  - audio/captura
  - matching
  - estado de sesión
- Reemplazar `alert` por una capa simple de notificaciones UI.

### Prioridad 3

- Agregar tests unitarios para `cleanWord()` y `findBestMatch()`.
- Revisar la promesa de funcionamiento offline y decidir si se usarán assets locales.
- Alinear README, changelog y metadata del paquete.

## Plan de trabajo

Este plan está pensado para ejecutarse más adelante, sin mezclar todavía implementación con análisis.

### Fase 1: saneamiento base

Objetivo: alinear el repo con el estado real del proyecto y corregir inconsistencias semánticas.

- Corregir `package.json`:
  - versión
  - `main`
  - scripts reales como `start`
- Corregir `resetPrompter()` para que resetee la lectura sin destruir `words`
- Revisar y alinear README, changelog y metadata del proyecto
- Identificar y listar comportamiento esperado de reset, pausa, reanudación y salida

Resultado esperado:

- proyecto coherente a nivel de metadata
- semántica de sesión más clara
- base más segura para refactors posteriores

### Fase 2: robustez funcional

Objetivo: reducir fallos silenciosos y endurecer el comportamiento en uso real.

- Rediseñar el manejo de chunks cuando el worker sigue procesando
- Evitar pérdida silenciosa de audio o, si se decide degradación controlada, hacerla explícita
- Endurecer `findBestMatch()`:
  - umbral mínimo más razonable
  - mejor tolerancia a repeticiones
  - menor probabilidad de falsos positivos
- Separar mejor responsabilidades dentro de `prompter.js`:
  - estado de sesión
  - audio
  - matching
  - scroll
- Sustituir `alert(...)` por feedback visual integrado en la UI

Resultado esperado:

- seguimiento más confiable
- menos saltos erróneos
- mejor tolerancia a equipos lentos o audio ruidoso

### Fase 3: confiabilidad y mantenimiento

Objetivo: dejar una base mantenible y verificable antes de seguir creciendo el proyecto.

- Añadir tests unitarios para:
  - `cleanWord()`
  - `findBestMatch()`
  - flujos de reset y sesión
- Definir una estrategia real para soporte offline
- Agregar smoke checks manuales o automatizables para la sesión completa
- Documentar límites conocidos del sistema de matching y transcripción

Resultado esperado:

- cambios futuros menos riesgosos
- mejor capacidad de diagnóstico
- documentación técnica más honesta y útil

## Roadmap técnico sugerido

### Fase 1: saneamiento

- corregir metadata
- corregir reset
- definir mejor errores UI
- añadir scripts útiles

### Fase 2: robustez

- rediseñar manejo de chunks
- mejorar matching
- encapsular mejor el estado

### Fase 3: confiabilidad

- agregar tests
- añadir smoke test manual o automatizable
- documentar límites conocidos del matching por voz

## Veredicto

El proyecto tiene una base buena y honesta. No está sobreingenierizado, y eso es un punto a favor. La aplicación probablemente funciona bien en escenarios normales, pero hoy su confiabilidad depende de que varias suposiciones implícitas se cumplan al mismo tiempo:

- que la transcripción no se atrase
- que el matching sea suficiente
- que el usuario siga un flujo de uso “feliz”

Si el objetivo es mantenerlo como proyecto pequeño, bastan unas pocas correcciones bien escogidas. Si el objetivo es crecerlo o usarlo con más exigencia, conviene priorizar robustez antes de sumar nuevas funciones.

## Firma

Análisis realizado por Codex.
