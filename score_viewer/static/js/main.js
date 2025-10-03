let lastLoadedXML = ''; // Variable global para guardar el último XML
let convertedTexts = new Set(); // IDs de textos convertidos a overlay

document.addEventListener('DOMContentLoaded', () => {
  const renderBtn   = document.getElementById('render-btn');
  const codeEditor  = document.getElementById('code-editor');
  const scoreOutput = document.getElementById('score-output');
  const errorOutput = document.getElementById('error-output');

  // contenedor único
  let container = document.createElement('div');
  container.id = 'osmd-container';
  scoreOutput.appendChild(container);

  // instancia OSMD (debe existir opensheetmusicdisplay en global)
  const OSMD =
    window.opensheetmusicdisplay?.OpenSheetMusicDisplay ||
    window.OpenSheetMusicDisplay;
  if (!OSMD) {
    errorOutput.textContent = '❌ OSMD no cargó. Revisa el <script> de OSMD.';
    return;
  }
  let osmd = new OSMD(container, {
    autoResize: true,
    drawTitle: true,
    drawPartNames: false,
    drawLyrics: true,            // mostrar lyrics (números de intervalos)
    drawMetronomeMarks: false,   // no metrónomos
    drawChordSymbols: true,      // ACTIVAR para ver símbolos de acorde
    drawCredits: false,          // desactivar para evitar duplicación
    drawPartAbbreviations: false,
    backend: 'svg'
  });

  // para evitar llamar clear() antes del primer render
  let hasRenderedOnce = false;

  async function waitForNonZeroWidth(el, tries = 10) {
    for (let i = 0; i < tries; i++) {
      const w = el.clientWidth || el.getBoundingClientRect().width;
      if (w > 0) return;
      // espera al próximo frame (o ~50ms si prefieres)
      await new Promise(r => requestAnimationFrame(r));
    }
    console.warn('[score-viewer] contenedor sigue con width=0 tras esperar');
  }

  renderBtn.addEventListener('click', async () => {
    const code = codeEditor.value;
    errorOutput.textContent = '';

    // NUEVO: Limpiar memoria de ediciones anteriores
    console.log('[score-viewer] Limpiando memoria antes de nuevo render...');
    window.edits = {};
    if (typeof window.clearDeletions === 'function') {
      window.clearDeletions();
    }
    localStorage.removeItem('scoreEdits');
    convertedTexts.clear();
    
    try {
      console.log('[score-viewer] POST /render-xml …');
      const resp = await fetch('/render-xml', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      });

      const xml = await resp.text();
      lastLoadedXML = xml; // Guardar el XML
      console.log('[score-viewer] POST /render-xml status', resp.status, 'len', xml.length);

      if (!resp.ok) throw new Error(xml || 'Error del servidor.');
      
      // Aceptar XML con o sin declaración
      const xmlTrimmed = xml.trim();
      if (!xmlTrimmed.startsWith('<?xml') && !xmlTrimmed.startsWith('<score-partwise')) {
        throw new Error('Respuesta inesperada: no es MusicXML válido.');
      }

      // limpia DOM por si acaso (seguro siempre)
      container.innerHTML = '';

      // solo limpiar vía OSMD si ya hubo un render anterior
      if (hasRenderedOnce && typeof osmd.clear === 'function') {
        try { osmd.clear(); } catch (_) { /* no pasa nada */ }
      }

      // ⚠️ NUEVO: asegúrate de que el contenedor ya tiene ancho
      await waitForNonZeroWidth(container);

      await osmd.load(xml);
      await osmd.render();
      hasRenderedOnce = true;

      // Crear grupo separado para pentagrama (sin textos)
      wrapStaffElements();

      // Eliminar duplicados (textos con style="" vacío o sin transform)
      removeDuplicateTexts();

      // NUEVO: Asignar IDs correctos basándose en código Python
      assignCorrectIDsFromCode(code);

      // Activar la lógica de edición
      if (typeof initEditing === 'function') {
        initEditing();
      }

      // NUEVO: Hacer notas clicables para selector de color
      if (typeof makeNotesClickable === 'function') {
        makeNotesClickable();
      }

      // NUEVO: Cargar ediciones guardadas si existen
      if (typeof loadFromLocalStorage === 'function' && loadFromLocalStorage()) {
        // Re-aplicar transforms CSS
        Object.keys(window.edits || {}).forEach(id => {
          const el = document.getElementById(id);
          if (el && typeof window.applyTransform === 'function') {
            window.applyTransform(el);
          }
        });
        console.log('[Persistencia] Ediciones restauradas desde LocalStorage');
      }

      console.log('[score-viewer] OSMD render OK, staff-only group created, duplicates removed');
    } catch (err) {
      console.error(err);
      errorOutput.textContent = `❌ ${err.message}`;
    }
  });

  // ====== ELIMINAR DUPLICADOS ======
  function removeDuplicateTexts() {
    const osmdSVG = container.querySelector('svg');
    if (!osmdSVG) return;

    const allTexts = Array.from(osmdSVG.querySelectorAll('text'));
    const seen = new Map(); // key: "contenido-x-y", value: primer texto encontrado
    let removed = 0;

    allTexts.forEach(text => {
      const content = text.textContent.trim();
      const x = text.getAttribute('x');
      const y = text.getAttribute('y');
      const key = `${content}-${x}-${y}`;

      if (seen.has(key)) {
        // Este es un duplicado, eliminar
        text.remove();
        removed++;
      } else {
        // Primer texto con este contenido+posición
        seen.set(key, text);
      }
    });

    console.log(`[score-viewer] ${removed} texto(s) duplicado(s) eliminado(s)`);
  }

  // ====== CONVERTIR TEXTOS OSMD A OVERLAY ======
  function convertOSMDTextsToOverlay() {
    const osmdSVG = container.querySelector('svg');
    const annotationSVG = document.getElementById('annotation-svg');
    
    if (!osmdSVG || !annotationSVG) {
      console.warn('[Overlay] No se encontró SVG o annotation-svg');
      return;
    }

    const osmdTexts = osmdSVG.querySelectorAll('text');
    let converted = 0;

    osmdTexts.forEach(originalText => {
      // Obtener propiedades del texto original
      const rect = originalText.getBoundingClientRect();
      const containerRect = scoreOutput.getBoundingClientRect();
      
      // Posición relativa al contenedor
      const x = rect.left - containerRect.left;
      const y = rect.top - containerRect.top;
      
      // Crear nuevo texto en overlay
      const overlayText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      overlayText.textContent = originalText.textContent;
      overlayText.setAttribute('x', x);
      overlayText.setAttribute('y', y);
      overlayText.setAttribute('font-size', originalText.getAttribute('font-size') || '20');
      overlayText.setAttribute('font-family', originalText.getAttribute('font-family') || 'Times New Roman');
      overlayText.setAttribute('fill', originalText.getAttribute('fill') || 'currentColor');
      overlayText.style.pointerEvents = 'auto';
      
      // Copiar ID o crear uno nuevo
      const originalId = originalText.id || `text-${originalText.textContent.trim().replace(/\s+/g, '-')}-${converted}`;
      overlayText.id = `overlay-${originalId}`;
      
      // Añadir al annotation-svg
      annotationSVG.appendChild(overlayText);
      
      // BORRAR original (no solo ocultar)
      originalText.remove();
      
      converted++;
    });

    console.log(`[Overlay] ${converted} texto(s) convertido(s) a overlay y BORRADOS originales`);
    
    // Hacer textos overlay editables
    makeOverlayTextsEditable();
  }

  // ====== HACER TEXTOS OVERLAY EDITABLES ======
  function makeOverlayTextsEditable() {
    const annotationSVG = document.getElementById('annotation-svg');
    if (!annotationSVG) return;

    const overlayTexts = annotationSVG.querySelectorAll('[id^="overlay-"]');
    
    overlayTexts.forEach(text => {
      // Establecer estilos de transformación
      text.style.transformOrigin = 'center';
      text.style.transformBox = 'fill-box';
      text.style.cursor = 'move';
      
      // Hacer arrastrables con interact.js
      if (window.interact) {
        interact(text).draggable({
          inertia: true,
          listeners: {
            move: (event) => {
              if (typeof dragMoveListener === 'function') {
                dragMoveListener(event);
              }
            },
            end: (event) => {
              if (typeof handleDragEnd === 'function') {
                handleDragEnd(event);
              }
            }
          }
        });
      }
      
      // Listener para seleccionar
      text.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof selectElement === 'function') {
          selectElement(text);
        }
      });
    });

    console.log(`[Overlay] ${overlayTexts.length} texto(s) overlay ahora editables`);
  }

  // ====== AGRUPAR PENTAGRAMA (SIN TEXTOS) ======
  function wrapStaffElements() {
    const osmdSVG = container.querySelector('svg');
    if (!osmdSVG) return;

    // Crear grupo para elementos del pentagrama
    const staffGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    staffGroup.id = 'staff-only';
    staffGroup.style.transformOrigin = 'center';
    staffGroup.style.transformBox = 'fill-box';

    // Obtener todos los hijos del SVG
    const children = Array.from(osmdSVG.children);
    
    // Función recursiva para verificar si un elemento contiene textos
    function containsText(element) {
      if (element.tagName === 'text') return true;
      return Array.from(element.children).some(child => containsText(child));
    }
    
    // Mover solo elementos que NO contienen textos
    children.forEach(child => {
      if (!containsText(child)) {
        staffGroup.appendChild(child);
      }
    });

    // Añadir el grupo al SVG (solo si tiene contenido)
    if (staffGroup.children.length > 0) {
      osmdSVG.appendChild(staffGroup);
      console.log('[score-viewer] Elementos del pentagrama agrupados en #staff-only');
      
      // Vincular textos overlay con pentagrama
      linkOverlayWithStaff(staffGroup);
    } else {
      console.warn('[score-viewer] No se encontraron elementos del pentagrama para agrupar');
    }
  }

  // ====== VINCULAR TEXTOS OVERLAY CON PENTAGRAMA Y SVG PRINCIPAL ======
  function linkOverlayWithStaff(staffGroup) {
    if (!window.interact) return;

    const mainSVG = document.getElementById('sheet-music-svg');
    if (!mainSVG) {
      console.warn('[Overlay] No se encontró #sheet-music-svg');
      return;
    }

    // Vincular con #staff-only (pentagrama)
    interact(staffGroup).draggable({
      inertia: true,
      listeners: {
        move: (event) => {
          // Mover el pentagrama
          if (typeof dragMoveListener === 'function') {
            dragMoveListener(event);
          }

          // Mover TAMBIÉN todos los textos overlay
          syncOverlayWithStaff(event.dx, event.dy);
        },
        end: () => {
          if (typeof handleDragEnd === 'function') {
            handleDragEnd();
          }
        }
      }
    });

    // Vincular con #sheet-music-svg (SVG principal)
    interact(mainSVG).draggable({
      inertia: true,
      listeners: {
        move: (event) => {
          // Mover el SVG
          if (typeof dragMoveListener === 'function') {
            dragMoveListener(event);
          }

          // Mover TAMBIÉN todos los textos overlay
          syncOverlayWithStaff(event.dx, event.dy);
        },
        end: () => {
          if (typeof handleDragEnd === 'function') {
            handleDragEnd();
          }
        }
      }
    });

    console.log('[Overlay] Textos overlay vinculados con #staff-only y #sheet-music-svg');
  }

  // Sincronizar movimiento de overlay con pentagrama
  function syncOverlayWithStaff(dx, dy) {
    const annotationSVG = document.getElementById('annotation-svg');
    if (!annotationSVG) return;

    const overlayTexts = annotationSVG.querySelectorAll('[id^="overlay-"]');
    overlayTexts.forEach(text => {
      const id = text.id;
      if (!window.edits) window.edits = {};
      if (!window.edits[id]) window.edits[id] = { x: 0, y: 0, xTenths: 0, yTenths: 0, scale: 1.0 };
      
      // Aplicar el mismo movimiento
      window.edits[id].x = (window.edits[id].x || 0) + dx;
      window.edits[id].y = (window.edits[id].y || 0) + dy;
      window.edits[id].xTenths = pxToTenths(window.edits[id].x);
      window.edits[id].yTenths = pxToTenths(window.edits[id].y);
      
      if (typeof window.applyTransform === 'function') {
        window.applyTransform(text);
      }
    });
  }

  // Exponer función para uso externo
  window.syncOverlayWithStaff = syncOverlayWithStaff;

  // ====== CONVERTIR TEXTO INDIVIDUAL A OVERLAY (BAJO DEMANDA) ======
  function convertTextToOverlay(osmdText) {
    // Verificar si ya está convertido
    if (osmdText.id && osmdText.id.startsWith('overlay-')) {
      return osmdText; // Ya es overlay
    }

    const annotationSVG = document.getElementById('annotation-svg');
    if (!annotationSVG) {
      console.warn('[Overlay] No existe annotation-svg');
      return osmdText;
    }

    // Obtener posición actual
    const rect = osmdText.getBoundingClientRect();
    const containerRect = scoreOutput.getBoundingClientRect();
    const x = rect.left - containerRect.left;
    const y = rect.top - containerRect.top;

    // Crear texto overlay
    const overlayText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    overlayText.textContent = osmdText.textContent;
    overlayText.setAttribute('x', x);
    overlayText.setAttribute('y', y);
    overlayText.setAttribute('font-size', osmdText.getAttribute('font-size') || '20');
    overlayText.setAttribute('font-family', osmdText.getAttribute('font-family') || 'Times New Roman');
    overlayText.setAttribute('fill', osmdText.getAttribute('fill') || 'currentColor');
    overlayText.style.pointerEvents = 'auto';
    overlayText.style.transformOrigin = 'center';
    overlayText.style.transformBox = 'fill-box';
    overlayText.style.cursor = 'move';

    // Generar ID
    const originalId = osmdText.id || `text-${osmdText.textContent.trim().replace(/\s+/g, '-')}-${Date.now()}`;
    overlayText.id = `overlay-${originalId}`;

    // Añadir al annotation-svg
    annotationSVG.appendChild(overlayText);

    // Hacer arrastrable
    if (window.interact) {
      interact(overlayText).draggable({
        inertia: true,
        listeners: {
          move: (event) => {
            if (typeof dragMoveListener === 'function') {
              dragMoveListener(event);
            }
          },
          end: (event) => {
            if (typeof handleDragEnd === 'function') {
              handleDragEnd(event);
            }
          }
        }
      });
    }

    // Listener para seleccionar
    overlayText.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof selectElement === 'function') {
        selectElement(overlayText);
      }
    });

    // Memorizar contenido del texto convertido
    const textKey = osmdText.textContent.trim();
    convertedTexts.add(textKey);

    // Borrar original
    osmdText.remove();

    console.log(`[Overlay] Texto "${textKey}" convertido a overlay y memorizado`);
    return overlayText;
  }

  // Borrar textos que ya fueron convertidos (tras reload)
  function removeConvertedTextsAfterReload() {
    const osmdSVG = container.querySelector('svg');
    if (!osmdSVG) return;

    const allTexts = osmdSVG.querySelectorAll('text');
    let removed = 0;

    allTexts.forEach(text => {
      const content = text.textContent.trim();
      if (convertedTexts.has(content)) {
        text.remove();
        removed++;
      }
    });

    if (removed > 0) {
      console.log(`[Overlay] ${removed} texto(s) previamente convertido(s) eliminado(s) tras reload`);
    }
  }

  // Exponer funciones globalmente
  window.convertTextToOverlay = convertTextToOverlay;
  window.convertedTexts = convertedTexts;

  // Exponer función de conversión px→tenths globalmente
  window.pxToTenths = function(px) {
    const TENTHS_PER_PX = 2.5;
    return Math.round(px * TENTHS_PER_PX);
  };

  // ====== REPRODUCTOR MIDI CON SOUNDFONTS ======
  const playBtn = document.getElementById('play-btn');
  const stopBtn = document.getElementById('stop-btn');
  const instrumentSelect = document.getElementById('instrument-select');
  let currentInstrument = null;
  let isPlaying = false;
  let scheduledNotes = [];
  let audioContext = null;
  let currentInstrumentName = 'acoustic_grand_piano';

  // Mapa de instrumentos a soundfonts
  const instrumentMap = {
    'piano': 'acoustic_grand_piano',
    'strings': 'string_ensemble_1',
    'horns': 'brass_section',
    'rhodes': 'electric_piano_1',
    'pad': 'pad_2_warm'
  };

  // Habilitar botones
  if (playBtn) playBtn.disabled = false;
  if (stopBtn) stopBtn.disabled = false;

  // Listener para cambio de instrumento
  instrumentSelect?.addEventListener('change', (e) => {
    currentInstrumentName = instrumentMap[e.target.value] || 'acoustic_grand_piano';
    currentInstrument = null; // Forzar recarga en próxima reproducción
    console.log(`[Soundfont] Instrumento seleccionado: ${currentInstrumentName}`);
    
    if (isPlaying) {
      stopPlayback();
      errorOutput.textContent = '⚠️ Cambia el instrumento antes de reproducir';
      setTimeout(() => { errorOutput.textContent = ''; }, 3000);
    }
  });

  // Función para cargar instrumento
  async function loadInstrument() {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (currentInstrument && currentInstrument.name === currentInstrumentName) {
      return currentInstrument;
    }

    console.log(`[Soundfont] Cargando instrumento: ${currentInstrumentName}...`);
    playBtn.textContent = '⏳';
    
    try {
      currentInstrument = await Soundfont.instrument(audioContext, currentInstrumentName, {
        soundfont: 'MusyngKite',
        gain: 2.0
      });
      
      console.log(`[Soundfont] ✅ Instrumento cargado: ${currentInstrumentName}`);
      return currentInstrument;
    } catch (err) {
      console.error('[Soundfont] Error cargando instrumento:', err);
      throw new Error('No se pudo cargar el instrumento');
    }
  }

  // Estado del botón de acordes (toggle)
  let chordsEnabled = false;
  const chordsToggle = document.getElementById('chords-toggle');
  
  // Listener para toggle de acordes
  chordsToggle?.addEventListener('click', () => {
    chordsEnabled = !chordsEnabled;
    
    // Cambiar estilos según estado
    if (chordsEnabled) {
      chordsToggle.style.background = '#667eea';
      chordsToggle.style.color = '#fff';
      chordsToggle.style.borderColor = '#667eea';
      console.log('[Acordes] ✅ Activado');
    } else {
      chordsToggle.style.background = '#444';
      chordsToggle.style.color = '#999';
      chordsToggle.style.borderColor = '#666';
      console.log('[Acordes] ⚪ Desactivado');
    }
  });

  // Función para reproducir
  async function playScore() {
    if (isPlaying) {
      stopPlayback();
      return;
    }

    const code = codeEditor.value;
    if (!code.trim()) {
      errorOutput.textContent = '❌ No hay código para reproducir';
      return;
    }

    try {
      playBtn.textContent = '⏳';
      playBtn.disabled = true;
      console.log('[Soundfont] Exportando MIDI...');
      
      console.log(`[Soundfont] Acompañamiento de acordes: ${chordsEnabled ? 'ACTIVADO' : 'DESACTIVADO'}`);
      
      // Obtener MIDI del backend con parámetros de acompañamiento
      const resp = await fetch('/export-midi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          code,
          include_chords: chordsEnabled,
          chord_rhythm: 'auto',    // Duración inteligente hasta siguiente acorde
          chord_octave: 3,         // Octava 3 (configurable)
          chord_velocity: 0.5      // Volumen medio (configurable)
        })
      });

      if (!resp.ok) {
        const error = await resp.text();
        throw new Error(error || 'Error exportando MIDI');
      }

      const midiBlob = await resp.blob();

      console.log('[Soundfont] MIDI obtenido, parseando...');

      // Parsear MIDI con @tonejs/midi
      const midi = await Midi.fromUrl(URL.createObjectURL(midiBlob));
      
      console.log('[Soundfont] MIDI parseado:', midi.tracks.length, 'pistas');

      // Cargar instrumento
      const instrument = await loadInstrument();

      // Extraer notas de todas las pistas
      const notes = [];
      
      midi.tracks.forEach(track => {
        track.notes.forEach(note => {
          if (note.duration > 0.01) { // Filtrar notas muy cortas
            notes.push({
              time: note.time,
              midi: note.midi,
              velocity: note.velocity,
              duration: note.duration
            });
          }
        });
      });

      console.log('[Soundfont]', notes.length, 'notas encontradas');
      console.log('[Soundfont] Tempo:', midi.header.tempos[0]?.bpm || 120, 'BPM');

      // Ordenar por tiempo
      notes.sort((a, b) => a.time - b.time);

      // Calcular duración total
      const maxTime = notes.length > 0 ? notes[notes.length - 1].time + 2 : 0;
      
      // Crear visualización
      createPlaybackVisualization(maxTime);

      // Programar notas
      const startTime = audioContext.currentTime;
      scheduledNotes = [];
      
      notes.forEach(note => {
        const scheduleTime = startTime + note.time;
        const noteObj = instrument.play(note.midi, scheduleTime, {
          gain: note.velocity,
          duration: note.duration || 0.5
        });
        scheduledNotes.push(noteObj);
        
        // Log primera nota para debug de octavas
        if (scheduledNotes.length === 1) {
          const noteName = midiNoteToName(note.midi);
          console.log(`[Soundfont] Primera nota: MIDI ${note.midi} = ${noteName}, velocity: ${note.velocity.toFixed(2)}`);
        }
      });

      // Programar fin de reproducción
      setTimeout(() => {
        stopPlayback();
      }, maxTime * 1000 + 500);

      isPlaying = true;
      playBtn.textContent = '⏹️';
      playBtn.disabled = false;
      playBtn.title = 'Detener';
      
      console.log('[Soundfont] ✅ Reproducción iniciada');

    } catch (err) {
      console.error('[Soundfont] ❌ Error:', err);
      errorOutput.textContent = `❌ Error reproduciendo: ${err.message}`;
      isPlaying = false;
      playBtn.textContent = '▶️';
      playBtn.disabled = false;
      playBtn.title = 'Reproducir';
    }
  }

  // Función helper para convertir MIDI a nombre de nota
  function midiNoteToName(midi) {
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const octave = Math.floor(midi / 12) - 1;
    const noteName = noteNames[midi % 12];
    return `${noteName}${octave}`;
  }

  // Función para detener
  function stopPlayback() {
    // Detener todas las notas programadas
    scheduledNotes.forEach(note => {
      if (note && note.stop) {
        try {
          note.stop();
        } catch (e) {
          // Ignorar errores al detener
        }
      }
    });
    scheduledNotes = [];
    
    isPlaying = false;
    playBtn.textContent = '▶️';
    playBtn.title = 'Reproducir';
    playBtn.disabled = false;
    
    // Remover visualización
    removePlaybackVisualization();
    
    console.log('[Soundfont] Reproducción detenida');
  }

  // Crear visualización de reproducción
  function createPlaybackVisualization(duration) {
    // Remover visualización previa si existe
    removePlaybackVisualization();
    
    const container = document.getElementById('score-output');
    if (!container) return;
    
    // Crear overlay
    const overlay = document.createElement('div');
    overlay.id = 'playback-visualization';
    overlay.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 4px;
      background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
      transform-origin: left;
      transform: scaleX(0);
      transition: transform ${duration}s linear;
      z-index: 1000;
      box-shadow: 0 2px 8px rgba(102, 126, 234, 0.5);
    `;
    container.prepend(overlay);
    
    // Animar
    requestAnimationFrame(() => {
      overlay.style.transform = 'scaleX(1)';
    });
    
    console.log('[Visualización] Barra de progreso creada');
  }
  
  // Remover visualización
  function removePlaybackVisualization() {
    const viz = document.getElementById('playback-visualization');
    if (viz) {
      viz.remove();
      console.log('[Visualización] Barra de progreso removida');
    }
  }

  // Event listeners
  playBtn?.addEventListener('click', playScore);
  stopBtn?.addEventListener('click', stopPlayback);

  console.log('[Tone.js] Reproductor inicializado correctamente');

  // ====== HELPERS PARA CODE MIRROR (totalmente independientes del closure) ======
  window.getCodeEditorValue = function() {
    if (window.codeMirrorEditor) {
      return window.codeMirrorEditor.getValue();
    }
    const editor = document.getElementById('code-editor');
    return editor ? editor.value : '';
  };

  window.setCodeEditorValue = function(value) {
    if (window.codeMirrorEditor) {
      window.codeMirrorEditor.setValue(value);
    } else {
      const editor = document.getElementById('code-editor');
      if (editor) {
        editor.value = value;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  };

  // ====== ASIGNAR IDS CORRECTOS DESDE CÓDIGO PYTHON ======
  function assignCorrectIDsFromCode(pythonCode) {
    const osmdSVG = container.querySelector('svg');
    if (!osmdSVG) return;

    const lines = pythonCode.split('\n');
    const idMappings = []; // {text, placement, id, order, type}

    // Parsear código Python para extraer IDs CON ORDEN Y TIPO
    let orderCounter = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Buscar declaraciones de TextExpression o ChordSymbol
      const isTextExpression = line.includes('TextExpression(');
      const isChordSymbol = line.includes('ChordSymbol(');
      
      if (isTextExpression || isChordSymbol) {
        const textMatch = line.match(/["'](.+?)["']/);
        if (!textMatch) continue;
        
        const text = textMatch[1];
        const type = isChordSymbol ? 'ChordSymbol' : 'TextExpression';
        let placement = 'above'; // Default
        let id = null;
        
        // Buscar placement e ID en las siguientes líneas
        for (let j = i + 1; j < i + 5 && j < lines.length; j++) {
          if (lines[j].includes('.placement') && lines[j].includes('below')) {
            placement = 'below';
          }
          if (lines[j].includes('.id =')) {
            const idMatch = lines[j].match(/\.id\s*=\s*["'](.+?)["']/);
            if (idMatch) {
              id = idMatch[1];
              break;
            }
          }
        }
        
        if (id) {
          idMappings.push({ text, placement, id, order: orderCounter++, type });
          console.log(`[ID Mapping] #${orderCounter-1} "${text}" (${type}, ${placement}) → ID: "${id}"`);
        }
      }
    }

    // Asignar IDs a elementos SVG POR ORDEN DE APARICIÓN
    const allTexts = Array.from(osmdSVG.querySelectorAll('text'));
    let assigned = 0;

    // NUEVO: Separar ChordSymbols (harmony) de otros textos
    const chordSymbols = Array.from(osmdSVG.querySelectorAll('[class*="Chord"], [class*="harmony"]'));
    const regularTexts = allTexts.filter(t => !chordSymbols.includes(t));

    // Agrupar por contenido
    const textsByContent = {};
    const chordsByContent = {};
    
    regularTexts.forEach((textEl, index) => {
      const content = textEl.textContent.trim();
      if (!textsByContent[content]) {
        textsByContent[content] = [];
      }
      textsByContent[content].push({ element: textEl, index });
    });
    
    chordSymbols.forEach((textEl, index) => {
      const content = textEl.textContent.trim();
      if (!chordsByContent[content]) {
        chordsByContent[content] = [];
      }
      chordsByContent[content].push({ element: textEl, index });
    });

    // Asignar IDs respetando orden y tipo
    idMappings.forEach(mapping => {
      // Elegir fuente correcta según tipo
      const sourceMap = mapping.type === 'ChordSymbol' ? chordsByContent : textsByContent;
      const candidates = sourceMap[mapping.text];
      
      if (!candidates || candidates.length === 0) {
        console.warn(`[ID Assignment] No encontrados candidatos para "${mapping.text}" (${mapping.type})`);
        return;
      }

      // Si solo hay uno, asignarlo directamente
      if (candidates.length === 1) {
        candidates[0].element.id = mapping.id;
        assigned++;
        console.log(`[ID Assigned] "${mapping.text}" → "${mapping.id}" (único, ${mapping.type})`);
        return;
      }

      // Si hay múltiples, usar placement Y orden
      const filtered = candidates.filter(c => {
        const y = parseFloat(c.element.getAttribute('y'));
        const isAbove = y < 200;
        const isBelow = y >= 200;
        return (mapping.placement === 'above' && isAbove) || (mapping.placement === 'below' && isBelow);
      });

      if (filtered.length > 0) {
        // Tomar el primero disponible sin ID
        const target = filtered.find(c => !c.element.id || c.element.id.trim() === '');
        if (target) {
          target.element.id = mapping.id;
          assigned++;
          console.log(`[ID Assigned] "${mapping.text}" → "${mapping.id}" (${mapping.type}, placement: ${mapping.placement})`);
        }
      }
    });

    console.log(`[ID Assignment] ${assigned} ID(s) asignado(s) correctamente de ${idMappings.length} total`);
  }

  // ====== ACTUALIZAR CÓDIGO PYTHON AUTOMÁTICAMENTE ======
  window.updatePythonCode = function(textElement) {
    const codeEditor = document.getElementById('code-editor');
    if (!codeEditor) return;

    const textContent = textElement.textContent.trim();
    const edit = window.edits ? window.edits[textElement.id] : null;
    if (!edit) return;

    const elementId = textElement.id || '';
    
    // DETECTAR TIPO POR ID O CONTENIDO (orden importa!)
    // 1. Primero detectar ChordSymbol (por ID o por patrón de acorde)
    if (elementId.includes('cifrado') || isChordPattern(textContent)) {
      updateChordSymbolInCode(elementId, textContent, edit, codeEditor);
    } 
    // 2. Luego TextExpression (grados, modos, intervalos)
    else if (elementId.includes('grado') || elementId.includes('modo') || elementId.includes('intervalos')) {
      updateTextExpressionInCode(elementId, textContent, edit, codeEditor);
    } 
    // 3. Lyrics (números con/sin alteraciones)
    else if (elementId.match(/^\d+/) || textContent.match(/^[♭♯]?\d+$/)) {
      updateLyricInCode(elementId, textContent, edit, codeEditor);
    } 
    // 4. Título (solo si realmente es el título)
    else if (elementId.includes('title') || elementId === 'Untitled-0' || isTitleElement(textElement)) {
      updateTitleInCode(elementId, textContent, edit, codeEditor);
    } 
    else {
      console.warn(`[Python Update] Tipo desconocido para ID "${elementId}", texto: "${textContent}"`);
    }
  };
  
  // Función auxiliar para detectar patrones de acordes
  function isChordPattern(text) {
    // Patrones comunes: C, Cm, Cmaj7, C7, C#m7, Db9, etc.
    return /^[A-G][b#]?(m|maj|min|dim|aug|sus)?(\d+)?(\(.*\))?/.test(text);
  }
  
  // Función auxiliar para detectar si un elemento es el título
  function isTitleElement(textElement) {
    // El título suele estar en la parte superior y con font-size más grande
    const y = parseFloat(textElement.getAttribute('y'));
    const fontSize = parseFloat(textElement.getAttribute('font-size')) || 20;
    
    // Si está muy arriba (y < 50) y tiene fontSize grande (>20)
    return y < 50 && fontSize > 20;
  }

  // ====== ACTUALIZAR ChordSymbol ======
  function updateChordSymbolInCode(elementId, textContent, edit, codeEditor) {
    let code = getCodeEditorValue();
    const lines = code.split('\n');
    const originalText = edit.textContent || textContent;

    console.log(`[Python Update ChordSymbol] Buscando: "${textContent}", ID: "${elementId}"`);

    // Buscar línea con .id que coincida
    let targetLineIndex = -1;
    let csVarName = null;
    
    // Buscar primero por ID (más confiable)
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(`.id = "${elementId}"`)) {
        // Encontramos el ID, ahora buscar hacia arriba la declaración
        for (let j = i; j >= Math.max(0, i - 3); j--) {
          if (lines[j].includes('harmony.ChordSymbol')) {
            targetLineIndex = j;
            const match = lines[j].match(/(\w+)\s*=\s*harmony\.ChordSymbol/);
            if (match) csVarName = match[1];
            console.log(`[Python Update ChordSymbol] Encontrado por ID en línea ${j}, var: ${csVarName}`);
            break;
          }
        }
        if (targetLineIndex !== -1) break;
      }
    }

    // Fallback: buscar por texto
    if (targetLineIndex === -1) {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('harmony.ChordSymbol') && 
            (lines[i].includes(`"${textContent}"`) || lines[i].includes(`"${originalText}"`))) {
          targetLineIndex = i;
          const match = lines[i].match(/(\w+)\s*=\s*harmony\.ChordSymbol/);
          if (match) csVarName = match[1];
          console.log(`[Python Update ChordSymbol] Encontrado por texto en línea ${i}, var: ${csVarName}`);
          break;
        }
      }
    }

    if (targetLineIndex === -1) {
      console.warn(`[Python Update ChordSymbol] ❌ No encontrado: "${textContent}", ID: "${elementId}"`);
      return;
    }

    if (!csVarName) {
      const varMatch = lines[targetLineIndex].match(/(\w+)\s*=\s*harmony\.ChordSymbol/);
      if (!varMatch) {
        console.warn(`[Python Update ChordSymbol] ❌ No se pudo extraer variable`);
        return;
      }
      csVarName = varMatch[1];
    }

    if (!csVarName) {
      const varMatch = lines[targetLineIndex].match(/(\w+)\s*=\s*harmony\.ChordSymbol/);
      if (!varMatch) return;
      csVarName = varMatch[1];
    }

    const indent = lines[targetLineIndex].match(/^(\s*)/)[1];

    // Actualizar texto si cambió (obtener texto original de la línea)
    const currentTextMatch = lines[targetLineIndex].match(/ChordSymbol\(["'](.+?)["']\)/);
    const currentText = currentTextMatch ? currentTextMatch[1] : textContent;
    
    if (edit.textContent && edit.textContent !== currentText) {
      lines[targetLineIndex] = lines[targetLineIndex].replace(`"${currentText}"`, `"${edit.textContent}"`);
      console.log(`[Python Update ChordSymbol] Texto actualizado: "${currentText}" → "${edit.textContent}"`);
    }

    // Borrar líneas style existentes
    let i = targetLineIndex + 1;
    while (i < lines.length) {
      if (lines[i].trim().startsWith(`${csVarName}.style.`)) {
        lines.splice(i, 1);
        continue;
      }
      if (lines[i].trim() && !lines[i].includes(csVarName)) break;
      i++;
    }

    // Insertar nuevas líneas style
    let insertIndex = targetLineIndex + 1;
    for (let j = targetLineIndex + 1; j < lines.length && j < targetLineIndex + 10; j++) {
      if (lines[j].includes(`${csVarName}.id`)) insertIndex = j + 1;
      if (lines[j].trim() && !lines[j].includes(csVarName)) break;
    }

    const newLines = [];
    const xTenths = Math.round((edit.x || 0) * 2.5);
    const yTenths = Math.round((edit.y || 0) * 2.5);
    newLines.push(`${indent}${csVarName}.style.absoluteX = ${xTenths}`);
    newLines.push(`${indent}${csVarName}.style.absoluteY = ${yTenths}`);
    
    if (edit.scale && edit.scale !== 1.0) {
      const scalePercent = Math.round(edit.scale * 100);
      newLines.push(`${indent}${csVarName}.style.fontSize = '${scalePercent}%'`);
    }
    
    lines.splice(insertIndex, 0, ...newLines);
    setCodeEditorValue(lines.join('\n'));
    console.log(`[Python Update ChordSymbol] ✅ "${textContent}"`);
  }

  // ====== ACTUALIZAR Title ======
  function updateTitleInCode(elementId, textContent, edit, codeEditor) {
    let code = codeEditor.value;
    const lines = code.split('\n');

    console.log(`[Python Update Title] Buscando título, ID: "${elementId}", texto: "${textContent}"`);
    console.log(`[Python Update Title] Edit:`, edit);

    // Buscar línea con metadata.title o .title
    let targetLineIndex = -1;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith('#')) continue;
      
      // Buscar por metadata.title o simplemente .title
      if ((line.includes('.metadata') && line.includes('.title')) || 
          (line.includes('.title') && line.includes('='))) {
        targetLineIndex = i;
        console.log(`[Python Update Title] Encontrado en línea ${i}: "${line.trim()}"`);
        break;
      }
    }

    if (targetLineIndex === -1) {
      console.warn(`[Python Update Title] ❌ No encontrada línea con .title`);
      return;
    }

    let modified = false;

    // Actualizar texto si cambió
    if (edit.textContent) {
      // Obtener texto actual de la línea
      const currentTextMatch = lines[targetLineIndex].match(/=\s*["'](.*)["']/);
      const currentText = currentTextMatch ? currentTextMatch[1] : '';
      
      if (edit.textContent !== currentText) {
        lines[targetLineIndex] = lines[targetLineIndex].replace(
          /=\s*["'].*["']/, 
          `= "${edit.textContent}"`
        );
        modified = true;
        console.log(`[Python Update Title] Texto actualizado: "${currentText}" → "${edit.textContent}"`);
      }
    }

    if (modified) {
      codeEditor.value = lines.join('\n');
      codeEditor.dispatchEvent(new Event('input', { bubbles: true }));
      console.log(`[Python Update Title] ✅ Actualización completa`);
    } else {
      console.log(`[Python Update Title] ⚠️ Sin cambios detectados`);
    }
  }

  // ====== ACTUALIZAR TextExpression ======
  function updateTextExpressionInCode(elementId, textContent, edit, codeEditor) {
    let code = getCodeEditorValue();
    const lines = code.split('\n');

    console.log(`[Python Update TextExpression] Buscando ID: "${elementId}", texto: "${textContent}"`);

    // NUEVO: Buscar PRIMERO por ID (más confiable)
    let targetLineIndex = -1;
    let varName = null;
    
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(`.id = "${elementId}"`)) {
        // Encontrado, buscar hacia arriba la declaración TextExpression
        for (let j = i; j >= Math.max(0, i - 5); j--) {
          if (lines[j].includes('TextExpression')) {
            targetLineIndex = j;
            const match = lines[j].match(/(\w+)\s*=\s*expressions\.TextExpression/);
            if (match) varName = match[1];
            console.log(`[Python Update TextExpression] Encontrado por ID en línea ${j}, var: ${varName}`);
            break;
          }
        }
        if (targetLineIndex !== -1) break;
      }
    }

    if (targetLineIndex === -1) {
      console.warn(`[Python Update TextExpression] ❌ No encontrado ID: "${elementId}"`);
      return;
    }

    if (!varName) {
      const varMatch = lines[targetLineIndex].match(/(\w+)\s*=\s*expressions\.TextExpression/);
      if (!varMatch) return;
      varName = varMatch[1];
    }

    const indent = lines[targetLineIndex].match(/^(\s*)/)[1];

    // Actualizar texto si cambió (obtener texto original de la línea)
    const currentTextMatch = lines[targetLineIndex].match(/TextExpression\(["'](.+?)["']\)/);
    const currentText = currentTextMatch ? currentTextMatch[1] : textContent;
    
    if (edit.textContent && edit.textContent !== currentText) {
      lines[targetLineIndex] = lines[targetLineIndex].replace(`"${currentText}"`, `"${edit.textContent}"`);
      console.log(`[Python Update TextExpression] Texto actualizado: "${currentText}" → "${edit.textContent}"`);
    }

    // Borrar líneas style existentes
    let i = targetLineIndex + 1;
    while (i < lines.length) {
      if (lines[i].trim().startsWith(`${varName}.style.`)) {
        lines.splice(i, 1);
        continue;
      }
      if (lines[i].trim() && !lines[i].includes(varName)) break;
      i++;
    }

    // Insertar nuevas líneas style
    let insertIndex = targetLineIndex + 1;
    for (let j = targetLineIndex + 1; j < lines.length && j < targetLineIndex + 10; j++) {
      if (lines[j].includes(`${varName}.placement`) || lines[j].includes(`${varName}.id`)) {
        insertIndex = j + 1;
      }
      if (lines[j].trim() && !lines[j].includes(varName)) break;
    }

    const newLines = [];
    const xTenths = Math.round((edit.x || 0) * 2.5);
    const yTenths = Math.round((edit.y || 0) * 2.5);
    newLines.push(`${indent}${varName}.style.absoluteX = ${xTenths}`);
    newLines.push(`${indent}${varName}.style.absoluteY = ${yTenths}`);
    
    if (edit.scale && edit.scale !== 1.0) {
      const scalePercent = Math.round(edit.scale * 100);
      newLines.push(`${indent}${varName}.style.fontSize = '${scalePercent}%'`);
    }
    
    lines.splice(insertIndex, 0, ...newLines);
    setCodeEditorValue(lines.join('\n'));
    console.log(`[Python Update TextExpression] ✅ "${textContent}"`);
  }

  // ====== ACTUALIZAR Lyric ======
  function updateLyricInCode(elementId, textContent, edit, codeEditor) {
    let code = getCodeEditorValue();
    const lines = code.split('\n');
    
    // Extraer texto original del ID (formato "X-Y")
    const match = elementId.match(/^([^-]+)-/);
    const originalText = match ? match[1] : textContent;
    
    console.log(`[Python Update Lyric] ID: "${elementId}", Original: "${originalText}", Actual: "${textContent}"`);
    console.log(`[Python Update Lyric] Edit:`, edit);
    
    // Buscar línea que contenga lyric="original" o textContent actual
    let targetLineIndex = -1;
    const searchTexts = [originalText];
    if (edit.textContent && edit.textContent !== originalText) {
      searchTexts.push(edit.textContent);
    }
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith('#')) continue;
      
      for (const searchText of searchTexts) {
        if (line.includes(`lyric="${searchText}"`) || line.includes(`lyric='${searchText}'`)) {
          targetLineIndex = i;
          console.log(`[Python Update Lyric] Encontrado en línea ${i}: "${line.trim()}"`);
          break;
        }
      }
      if (targetLineIndex !== -1) break;
    }
    
    if (targetLineIndex === -1) {
      console.warn(`[Python Update Lyric] ❌ No encontrado: "${originalText}" ni "${edit.textContent}"`);
      return;
    }
    
    let modified = false;
    
    // 1. Actualizar texto si cambió
    if (edit.textContent && edit.textContent !== originalText) {
      lines[targetLineIndex] = lines[targetLineIndex].replace(`lyric="${originalText}"`, `lyric="${edit.textContent}"`);
      lines[targetLineIndex] = lines[targetLineIndex].replace(`lyric='${originalText}'`, `lyric='${edit.textContent}'`);
      modified = true;
      console.log(`[Python Update Lyric] Texto actualizado: "${originalText}" → "${edit.textContent}"`);
    }
    
    // 2. NUEVO: Actualizar escala si cambió
    if (edit.scale && edit.scale !== 1.0) {
      const scalePercent = Math.round(edit.scale * 100);
      const line = lines[targetLineIndex];
      
      // Comprobar si ya tiene fontSize
      if (line.includes('fontSize')) {
        // Reemplazar valor existente
        lines[targetLineIndex] = line.replace(/fontSize\s*=\s*['"]?\d+%?['"]?/, `fontSize="${scalePercent}%"`);
      } else {
        // Añadir fontSize antes del paréntesis de cierre
        // Buscar el lyric="X" y añadir después
        const lyricMatch = line.match(/(lyric\s*=\s*['"][^'"]*['"])/);
        if (lyricMatch) {
          lines[targetLineIndex] = line.replace(lyricMatch[1], `${lyricMatch[1]}, fontSize="${scalePercent}%"`);
        }
      }
      modified = true;
      console.log(`[Python Update Lyric] Escala actualizada: ${scalePercent}%`);
    }
    
    if (modified) {
      setCodeEditorValue(lines.join('\n'));
      console.log(`[Python Update Lyric] ✅ Actualización completa`);
    } else {
      console.log(`[Python Update Lyric] ⚠️ Sin cambios detectados`);
    }
  }

  // ====== ACTUALIZAR BORRADOS EN CÓDIGO PYTHON ======
  window.updateDeletionsInPython = function(deletions) {
    const codeEditor = document.getElementById('code-editor');
    if (!codeEditor || deletions.size === 0) return;

    let code = getCodeEditorValue();
    const lines = code.split('\n');
    let modified = false;

    deletions.forEach(id => {
      console.log(`[Python Deletions] Procesando borrado de: "${id}"`);
      
      // Buscar por ID en el código
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Si la línea ya está comentada, skip
        if (line.trim().startsWith('#')) continue;
        
        // Buscar líneas que contengan este ID (con o sin espacios alrededor del =)
        if (line.includes(`.id = "${id}"`) || line.includes(`.id="${id}"`)) {
          console.log(`[Python Deletions] Encontrado ID en línea ${i}: "${line.trim()}"`);
          
          // Determinar tipo de elemento
          let varMatch = null;
          let elementType = null;
          
          // Buscar hacia atrás la declaración del elemento
          for (let j = i; j >= 0 && j >= Math.max(0, i - 5); j--) {
            if (lines[j].includes('TextExpression')) {
              varMatch = lines[j].match(/(\w+)\s*=\s*expressions\.TextExpression/);
              elementType = 'TextExpression';
              break;
            } else if (lines[j].includes('ChordSymbol')) {
              varMatch = lines[j].match(/(\w+)\s*=\s*harmony\.ChordSymbol/);
              elementType = 'ChordSymbol';
              break;
            } else if (lines[j].includes('MetronomeMark')) {
              varMatch = lines[j].match(/(\w+)\s*=\s*tempo\.MetronomeMark/);
              elementType = 'MetronomeMark';
              break;
            }
          }
          
          if (varMatch && elementType) {
            const varName = varMatch[1];
            console.log(`[Python Deletions] Tipo: ${elementType}, Variable: ${varName}`);
            
            // Encontrar línea de declaración
            const declarationLine = lines.findIndex((l, idx) => 
              idx <= i && l.includes(varName) && l.includes(elementType)
            );
            
            if (declarationLine !== -1) {
              // Comentar desde declaración hasta línea de insert/append
              for (let k = declarationLine; k < lines.length; k++) {
                const currentLine = lines[k].trim();
                
                // Comentar si:
                // - Es la línea de declaración
                // - Es una propiedad de esta variable (.id, .placement, .style, etc)
                // - Es una línea de insert que usa esta variable
                if (currentLine && !currentLine.startsWith('#')) {
                  if (k === declarationLine || 
                      currentLine.startsWith(`${varName}.`) || 
                      (currentLine.includes('.insert') && currentLine.includes(varName)) ||
                      (currentLine.includes('.append') && currentLine.includes(varName))) {
                    lines[k] = '# ' + lines[k];
                    modified = true;
                    console.log(`[Python Deletions] Comentada línea ${k}: "${lines[k].trim()}"`);
                  } else if (currentLine && !currentLine.includes(varName)) {
                    // Encontramos otra variable, parar
                    break;
                  }
                }
              }
            }
          }
          break;
        }
      }
      
      // FALLBACK: Si no encontramos por ID, buscar el texto del elemento en el código
      if (!modified) {
        // Obtener texto del elemento
        const deletedElement = document.getElementById(id);
        let elementText = null;
        
        if (deletedElement) {
          elementText = deletedElement.textContent.trim();
        } else if (window.edits && window.edits[id] && window.edits[id].textContent) {
          elementText = window.edits[id].textContent.trim();
        } else {
          // Extraer del ID como último recurso
          const match = id.match(/^([^-]+)/);
          if (match) elementText = match[1];
        }
        
        if (elementText) {
          console.log(`[Python Deletions] Buscando por contenido: "${elementText}"`);
          
          // Buscar TextExpression con ese contenido
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.trim().startsWith('#')) continue;
            
            if (line.includes('TextExpression') && 
                (line.includes(`"${elementText}"`) || line.includes(`'${elementText}'`))) {
              console.log(`[Python Deletions] Encontrado TextExpression en línea ${i}: "${line.trim()}"`);
              
              // Encontrar variable
              const varMatch = line.match(/(\w+)\s*=\s*expressions\.TextExpression/);
              if (varMatch) {
                const varName = varMatch[1];
                
                // Comentar todas las líneas de esta variable
                for (let k = i; k < lines.length; k++) {
                  const currentLine = lines[k].trim();
                  if (currentLine && !currentLine.startsWith('#')) {
                    if (k === i || currentLine.startsWith(`${varName}.`) || 
                        (currentLine.includes('.insert') && currentLine.includes(varName))) {
                      lines[k] = '# ' + lines[k];
                      modified = true;
                      console.log(`[Python Deletions] Comentada línea ${k}: "${lines[k].trim()}"`);
                    } else if (currentLine && !currentLine.includes(varName)) {
                      break;
                    }
                  }
                }
              }
              break;
            }
          }
        }
      }
      
      // ÚLTIMO RECURSO: Si no encontramos por ID ni por TextExpression, buscar por contenido en lyrics
      if (!modified) {
        // Obtener el texto del elemento - PRIORIZAR window.edits
        let lyricText = null;
        
        // 1. Intentar obtener de window.edits (más confiable si fue editado)
        if (window.edits && window.edits[id] && window.edits[id].textContent) {
          lyricText = window.edits[id].textContent.trim();
          console.log(`[Python Deletions] Usando textContent de edits: "${lyricText}"`);
        }
        // 2. Si no está en edits, intentar del DOM
        else {
          const deletedElement = document.getElementById(id);
          if (deletedElement) {
            lyricText = deletedElement.textContent.trim();
          } else {
            // 3. Extraer del ID como último recurso (formato "X-Y")
            const match = id.match(/^([^-]+)-/);
            if (match) lyricText = match[1];
          }
        }
        
        // Buscar cualquier texto, no solo números (para lyrics editados como "yu")
        if (lyricText) {
          console.log(`[Python Deletions] Buscando lyric por contenido: "${lyricText}"`);
          
          // Buscar líneas que contengan lyric="X"
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.trim().startsWith('#')) continue;
            
            if (line.includes(`lyric="${lyricText}"`) || line.includes(`lyric='${lyricText}'`)) {
              console.log(`[Python Deletions] Encontrado lyric en línea ${i}: "${line.trim()}"`);
              lines[i] = '# ' + lines[i];
              modified = true;
              console.log(`[Python Deletions] Comentada línea ${i}: "${lines[i].trim()}"`);
              break;
            }
          }
        }
      }
    });

    if (modified) {
      setCodeEditorValue(lines.join('\n'));
      console.log(`[Python Deletions] ✅ ${deletions.size} elemento(s) comentado(s) en código`);
    } else {
      console.warn(`[Python Deletions] ⚠️ No se modificó ninguna línea para ${deletions.size} elemento(s)`);
    }
  };

  // ====== CALCULAR OFFSET RELATIVO AL COMPÁS ======
  window.calculateRelativeOffset = function(textElement) {
    // Encontrar el compás más cercano al texto
    const osmdSVG = container.querySelector('svg');
    if (!osmdSVG) return null;

    // Obtener posición del texto (incluyendo transform)
    const textRect = textElement.getBoundingClientRect();
    const textX = textRect.left + textRect.width / 2;
    const textY = textRect.top + textRect.height / 2;

    // Buscar todos los elementos <g> que contienen compases
    // En OSMD, los compases suelen estar en grupos con class que contiene "measure"
    const measureGroups = osmdSVG.querySelectorAll('g');
    
    let closestMeasure = null;
    let minDistance = Infinity;
    let measureNumber = 0;

    measureGroups.forEach((group, index) => {
      // Filtrar solo grupos que parezcan compases (tienen líneas verticales)
      const hasLines = group.querySelector('path, line');
      if (!hasLines) return;

      const groupRect = group.getBoundingClientRect();
      const groupCenterX = groupRect.left + groupRect.width / 2;
      const groupCenterY = groupRect.top + groupRect.height / 2;

      const distance = Math.sqrt(
        Math.pow(textX - groupCenterX, 2) +
        Math.pow(textY - groupCenterY, 2)
      );

      if (distance < minDistance) {
        minDistance = distance;
        closestMeasure = group;
        measureNumber = index + 1; // Número de compás (empezando en 1)
      }
    });

    if (!closestMeasure) return null;

    // Calcular offset relativo
    const measureRect = closestMeasure.getBoundingClientRect();
    const offsetX = textX - (measureRect.left + measureRect.width / 2);
    const offsetY = textY - (measureRect.top + measureRect.height / 2);

    return {
      measureNumber: measureNumber,
      offsetX: offsetX,
      offsetY: offsetY
    };
  };

  // ====== RECALCULAR POSICIONES TRAS RELOAD ======
  window.recalculateRelativePositions = function() {
    if (!window.edits) return;
    
    Object.keys(window.edits).forEach(id => {
      const edit = window.edits[id];
      
      // Si tiene datos de offset relativo
      if (edit.measureNumber && typeof edit.offsetX !== 'undefined') {
        const textElement = document.getElementById(id);
        if (!textElement) return;

        // Buscar el compás por número
        const osmdSVG = container.querySelector('svg');
        if (!osmdSVG) return;

        const measureGroups = osmdSVG.querySelectorAll('g');
        let targetMeasure = null;
        let count = 0;

        measureGroups.forEach(group => {
          const hasLines = group.querySelector('path, line');
          if (!hasLines) return;
          count++;
          if (count === edit.measureNumber) {
            targetMeasure = group;
          }
        });

        if (!targetMeasure) return;

        // Calcular nueva posición absoluta basada en offset relativo
        const measureRect = targetMeasure.getBoundingClientRect();
        const containerRect = scoreOutput.getBoundingClientRect();
        
        const measureCenterX = measureRect.left - containerRect.left + measureRect.width / 2;
        const measureCenterY = measureRect.top - containerRect.top + measureRect.height / 2;

        const textRect = textElement.getBoundingClientRect();
        const currentTextCenterX = textRect.left - containerRect.left + textRect.width / 2;
        const currentTextCenterY = textRect.top - containerRect.top + textRect.height / 2;

        // Calcular nueva posición transform
        const newX = measureCenterX + edit.offsetX - currentTextCenterX + (edit.x || 0);
        const newY = measureCenterY + edit.offsetY - currentTextCenterY + (edit.y || 0);

        // Actualizar edits
        window.edits[id].x = newX;
        window.edits[id].y = newY;

        // Aplicar transform
        if (typeof window.applyTransform === 'function') {
          window.applyTransform(textElement);
        }

        console.log(`[Recalc] "${textElement.textContent.trim()}" → nueva pos (${newX.toFixed(1)}, ${newY.toFixed(1)})`);
      }
    });
  };

  // ====== RESPONSIVIDAD: reloadWithEdits ======
  async function reloadWithEdits() {
    if (!lastLoadedXML) {
      console.warn('[Responsividad] No hay XML cargado');
      return;
    }

    try {
      // 1. Aplicar ediciones al XML (en tenths)
      const response = await fetch('/apply-edits-xml', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          xml_content: lastLoadedXML,
          edits: window.edits  // Usa xTenths/yTenths
        })
      });

      if (!response.ok) {
        throw new Error(`Error aplicando ediciones: ${response.status}`);
      }

      const modifiedXML = await response.text();

      // 2. Limpiar contenedor
      container.innerHTML = '';
      if (hasRenderedOnce && typeof osmd.clear === 'function') {
        try { osmd.clear(); } catch (_) {}
      }

      // 3. Re-cargar OSMD con XML modificado
      await osmd.load(modifiedXML);
      await osmd.render();

      // 4. Eliminar duplicados
      removeDuplicateTexts();

      // 4.5. Borrar textos que ya fueron convertidos a overlay
      removeConvertedTextsAfterReload();

      // 5. Re-inicializar edición
      if (typeof initEditing === 'function') {
        initEditing();
      }

      // 6. RECALCULAR posiciones relativas al compás
      if (typeof window.recalculateRelativePositions === 'function') {
        window.recalculateRelativePositions();
      }

      // 7. Re-aplicar transforms CSS (px)
      Object.keys(window.edits || {}).forEach(id => {
        const el = document.getElementById(id);
        if (el && typeof window.applyTransform === 'function') {
          window.applyTransform(el);
        }
      });

      console.log('[Responsividad] Recarga completa con ediciones');
    } catch (err) {
      console.error('[Responsividad] Error:', err);
      errorOutput.textContent = `Error al recargar: ${err.message}`;
    }
  }

  // Exponer globalmente para uso desde editing.js
  window.reloadWithEdits = reloadWithEdits;

  // ====== ANÁLISIS INTELIGENTE DE COMPASES ======
  function analyzeMusicXML(xmlString) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
    
    // Contar compases
    const measures = xmlDoc.querySelectorAll('measure');
    const measureCount = measures.length;
    
    // Estimar ancho promedio de compás basándose en contenido
    let totalComplexity = 0;
    measures.forEach(measure => {
      let complexity = 100; // Ancho base
      
      // Añadir por número de notas
      const notes = measure.querySelectorAll('note');
      complexity += notes.length * 15;
      
      // Añadir por acordes (harmony)
      const harmonies = measure.querySelectorAll('harmony');
      complexity += harmonies.length * 20;
      
      // Añadir por alteraciones
      const accidentals = measure.querySelectorAll('accidental');
      complexity += accidentals.length * 10;
      
      // Añadir por textos (words, direction)
      const words = measure.querySelectorAll('words');
      complexity += words.length * 15;
      
      totalComplexity += complexity;
    });
    
    const avgMeasureWidth = measureCount > 0 ? totalComplexity / measureCount : 150;
    
    console.log(`[Análisis XML] ${measureCount} compases, ancho promedio: ${avgMeasureWidth.toFixed(0)}px`);
    
    return {
      measureCount,
      avgMeasureWidth,
      totalComplexity
    };
  }

  // ====== CALCULAR ANCHO CONTENEDOR INTELIGENTE ======
  function calculateSmartWidth(measuresPerSystem, xmlAnalysis) {
    const { avgMeasureWidth, measureCount } = xmlAnalysis;
    
    if (measureCount === 0) {
      // Fallback a valores por defecto
      return measuresPerSystem === 1 ? 300 : measuresPerSystem === 2 ? 600 : measuresPerSystem === 3 ? 900 : 1200;
    }
    
    // Calcular ancho necesario para el número de compases deseado
    // Añadir 20% de margen para layout de OSMD
    const baseWidth = avgMeasureWidth * measuresPerSystem * 1.2;
    
    // Limitar entre valores mínimos y máximos razonables
    const minWidth = 250;
    const maxWidth = 2000;
    const smartWidth = Math.max(minWidth, Math.min(maxWidth, baseWidth));
    
    console.log(`[Smart Width] ${measuresPerSystem} compases → ${smartWidth.toFixed(0)}px (ancho promedio: ${avgMeasureWidth.toFixed(0)}px)`);
    
    return smartWidth;
  }

  // ====== CONTROL DE COMPASES POR SISTEMA (BOTONES) ======
  const layoutButtons = document.querySelectorAll('.layout-btn');
  
  layoutButtons.forEach(btn => {
    btn.addEventListener('click', async () => {
      const measuresPerSystem = parseInt(btn.dataset.measures);
      console.log(`[Responsividad] Cambio a ${measuresPerSystem} compases/sistema`);
      
      // Actualizar estado activo
      layoutButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // NUEVO: Analizar MusicXML para calcular ancho inteligente
      let containerWidth;
      if (lastLoadedXML) {
        const xmlAnalysis = analyzeMusicXML(lastLoadedXML);
        containerWidth = calculateSmartWidth(measuresPerSystem, xmlAnalysis);
      } else {
        // Fallback a valores por defecto si no hay XML
        containerWidth = measuresPerSystem === 1 ? 300 : measuresPerSystem === 2 ? 600 : measuresPerSystem === 3 ? 900 : 1200;
      }
      
      container.style.width = `${containerWidth}px`;
      container.style.maxWidth = `${containerWidth}px`;
      container.style.minWidth = `${containerWidth}px`;
      
      // NUEVO: Regenerar desde código actualizado del editor
      const updatedCode = codeEditor.value;
      console.log(`[Responsividad] Regenerando desde código actualizado (${updatedCode.length} chars)`);
      
      try {
        // 1. Generar nuevo XML desde código actualizado
        const resp = await fetch('/render-xml', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: updatedCode })
        });
        
        if (!resp.ok) throw new Error('Error regenerando XML');
        
        const newXML = await resp.text();
        lastLoadedXML = newXML; // Actualizar XML global
        
        // 2. Limpiar y recargar OSMD
        container.innerHTML = '';
        if (hasRenderedOnce && typeof osmd.clear === 'function') {
          try { osmd.clear(); } catch (_) {}
        }
        
        await osmd.load(newXML);
        await osmd.render();
        
        // 3. Limpiar duplicados
        removeDuplicateTexts();
        
        // 3.5 NUEVO: Asignar IDs desde código Python actualizado
        assignCorrectIDsFromCode(updatedCode);
        
        // 4. Re-inicializar edición
        if (typeof initEditing === 'function') {
          initEditing();
        }
        
        // 4.5. NUEVO: Re-hacer notas clicables para selector de color
        if (typeof makeNotesClickable === 'function') {
          makeNotesClickable();
        }
        
        // 5. NUEVO: Re-aplicar transforms CSS y textContent desde edits guardados
        console.log(`[Responsividad] IDs en window.edits:`, Object.keys(window.edits || {}));
        console.log(`[Responsividad] IDs en DOM:`, Array.from(document.querySelectorAll('text')).map(t => t.id));
        
        // Primero restaurar textContent para todos los elementos (excepto borrados)
        const deletions = typeof window.getDeletions === 'function' ? window.getDeletions() : new Set();
        Object.keys(window.edits || {}).forEach(id => {
          // Ignorar elementos borrados
          if (deletions.has(id)) return;
          
          const el = document.getElementById(id);
          const edit = window.edits[id];
          
          if (el && edit.textContent && el.tagName === 'text') {
            el.textContent = edit.textContent;
            console.log(`[Responsividad] ✅ Restaurando texto editado para "${id}": "${edit.textContent}"`);
          }
        });
        
        // Luego actualizar código Python con todos los textos editados
        Object.keys(window.edits || {}).forEach(id => {
          const el = document.getElementById(id);
          if (el && window.edits[id].textContent && el.tagName === 'text') {
            if (typeof window.updatePythonCode === 'function') {
              window.updatePythonCode(el);
            }
          }
        });
        
        // Finalmente aplicar transforms (posición y escala)
        // NUEVO: Mapear IDs viejos → nuevos para lyrics editados
        const oldToNewIdMap = {};
        Object.keys(window.edits || {}).forEach(oldId => {
          const edit = window.edits[oldId];
          let el = document.getElementById(oldId);
          
          // Si no se encuentra, buscar por textContent editado (para lyrics)
          if (!el && edit.textContent) {
            // Buscar elementos con ese texto
            const allTexts = document.querySelectorAll('text');
            for (const text of allTexts) {
              if (text.textContent.trim() === edit.textContent && text.id !== oldId) {
                console.log(`[Responsividad] Mapeando ID viejo "${oldId}" → nuevo "${text.id}" (texto: "${edit.textContent}")`);
                oldToNewIdMap[oldId] = text.id;
                el = text;
                break;
              }
            }
          }
          
          if (el && typeof window.applyTransform === 'function') {
            window.applyTransform(el);
            console.log(`[Responsividad] ✅ Reaplicando transform a "${el.textContent.trim()}"`);
          } else if (!el) {
            console.warn(`[Responsividad] ❌ No se encontró elemento con ID "${oldId}"`);
          }
        });
        
        // Actualizar window.edits con nuevos IDs
        Object.keys(oldToNewIdMap).forEach(oldId => {
          const newId = oldToNewIdMap[oldId];
          window.edits[newId] = window.edits[oldId];
          delete window.edits[oldId];
          console.log(`[Responsividad] Actualizado window.edits: "${oldId}" → "${newId}"`);
        });
        
        // 6. NUEVO: Re-aplicar deletions (ocultar elementos borrados)
        if (typeof window.getDeletions === 'function') {
          const deletions = window.getDeletions();
          deletions.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
              el.style.display = 'none';
              console.log(`[Responsividad] ✅ Ocultando elemento borrado "${el.textContent.trim()}"`);
            }
          });
          
          // NO llamar updateDeletionsInPython aquí - ya se llamó cuando se borró el elemento
          // Si lo llamamos aquí, puede comentar elementos que solo fueron editados
          console.log(`[Responsividad] ${deletions.size} elemento(s) permanecen ocultos (ya comentados en Python)`);
        }
        
        console.log('[Responsividad] ✅ Regeneración completa con código actualizado y transforms reaplicados');
      } catch (err) {
        console.error('[Responsividad] Error regenerando:', err);
        errorOutput.textContent = `Error: ${err.message}`;
      }
    });
  });

  // ====== BOTÓN RESET (LIMPIAR) ======
  const resetBtn = document.getElementById('reset-btn');

  resetBtn?.addEventListener('click', () => {
    if (confirm('¿Estás seguro de que quieres limpiar el editor? Se perderán todos los cambios.')) {
      // Limpiar editor (CodeMirror)
      if (window.codeMirrorEditor) {
        window.codeMirrorEditor.setValue('');
      } else {
        codeEditor.value = '';
      }
      
      // Limpiar partitura renderizada
      container.innerHTML = '';
      errorOutput.textContent = '';
      
      // Limpiar ediciones guardadas
      window.edits = {};
      if (typeof window.saveToLocalStorage === 'function') {
        localStorage.removeItem('scoreEdits');
      }
      
      console.log('[Reset] Editor y partitura limpiados');
      alert('Editor limpiado correctamente');
    }
  });

  // ====== PANELES REDIMENSIONABLES ======
  const dragbar = document.getElementById('dragbar');
  const editorPanel = document.getElementById('editor-panel');
  const viewerPanel = document.getElementById('viewer-panel');
  const mainContainer = document.querySelector('.container');

  let isResizing = false;

  dragbar.addEventListener('mousedown', (e) => {
    isResizing = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;

    const containerRect = mainContainer.getBoundingClientRect();
    const offsetX = e.clientX - containerRect.left;
    const containerWidth = containerRect.width;
    
    // Calcular porcentaje (min 20%, max 80%)
    let percentage = (offsetX / containerWidth) * 100;
    percentage = Math.max(20, Math.min(80, percentage));

    editorPanel.style.flex = `0 0 ${percentage}%`;
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
});
