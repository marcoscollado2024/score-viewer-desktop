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
      
      // ✅ LEER MAPEO DEL HEADER
      const mapeoHeader = resp.headers.get('X-Element-Line-Map');
      let elementLineMap = {};
      
      if (mapeoHeader) {
        try {
          elementLineMap = JSON.parse(mapeoHeader);
          window.elementLineMap = elementLineMap;
          console.log(`[score-viewer] ✅ Mapeo recibido: ${Object.keys(elementLineMap).length} elemento(s)`);
        } catch (e) {
          console.error('[score-viewer] Error parseando mapeo:', e);
        }
      } else {
        console.warn('[score-viewer] ⚠️ No se recibió mapeo del backend');
      }
      
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

      // ✅ CRÍTICO: Asignar IDs estables ANTES de initEditing
      const stableMapping = assignCorrectIDsFromCode(code);
      console.log(`[score-viewer] IDs estables asignados: ${Object.keys(stableMapping).length}`);

      // ✅ NUEVO: Vincular usando mapeo del backend (DESPUÉS de IDs estables)
      linkElementsFromBackend(elementLineMap);

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

  // ====== ASIGNAR IDs ESTABLES DESDE CÓDIGO PYTHON ======
  function assignCorrectIDsFromCode(pythonCode) {
    console.log('[ID Mapping] Iniciando asignación de IDs estables...');
    
    const osmdSVG = container.querySelector('svg');
    if (!osmdSVG) {
      console.warn('[ID Mapping] No se encontró SVG de OSMD');
      return {};
    }
    
    // Mapeo: texto + compás + tipo → ID estable
    const stableIdMap = {};
    let elementCounter = 0;
    
    // 1. Parsear código Python para extraer elementos
    const lines = pythonCode.split('\n');
    const codeElements = []; // {tipo, texto, compas, idEstable}
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // ChordSymbol
      if (line.includes('harmony.ChordSymbol(')) {
        const match = line.match(/harmony\.ChordSymbol\(["'](.+?)["']\)/);
        if (match) {
          const texto = match[1];
          const compas = detectarCompasPorLinea(lines, i);
          const idEstable = `element_${elementCounter++}`;
          codeElements.push({tipo: 'ChordSymbol', texto, compas, idEstable, linea: i});
          console.log(`[ID Mapping] ChordSymbol "${texto}" → ${idEstable} (línea ${i})`);
        }
      }
      
      // TextExpression
      if (line.includes('expressions.TextExpression(')) {
        const match = line.match(/expressions\.TextExpression\(["'](.+?)["']\)/);
        if (match) {
          const texto = match[1];
          const compas = detectarCompasPorLinea(lines, i);
          const idEstable = `element_${elementCounter++}`;
          codeElements.push({tipo: 'TextExpression', texto, compas, idEstable, linea: i});
          console.log(`[ID Mapping] TextExpression "${texto}" → ${idEstable} (línea ${i})`);
        }
      }
      
      // Lyrics - ✅ CORREGIDO: Usar SIEMPRE línea del .lyric, NO línea de la nota
      if (line.includes('.lyric =') || line.includes('.lyric=')) {
        const match = line.match(/lyric\s*=\s*["'](.+?)["']/);
        
        if (match) {
          const texto = match[1];
          const compas = detectarCompasPorLinea(lines, i);
          const idEstable = `element_${elementCounter++}`;
          
          // ✅ NUEVO: Calcular posición Y aproximada (lyrics van en orden de arriba-abajo)
          // Cada lyric se asume que está aproximadamente en la misma Y que su nota padre
          const estimatedY = (elementCounter - 1) * 50; // Estimación básica
          
          codeElements.push({
            tipo: 'Lyric', 
            texto, 
            compas, 
            idEstable, 
            linea: i, // ✅ LÍNEA DEL .lyric, NO de la nota
            estimatedY: estimatedY // Para matching por orden
          });
          
          console.log(`[ID Mapping] Lyric "${texto}" (compás ${compas}) → ${idEstable} (línea ${i})`);
        }
      }
      
      // ✅ NUEVO: Notas - Extraer ID del código Python
      if (line.includes('note.Note(') && line.includes('.id =')) {
        // Formato: n10 = note.Note("D4", quarterLength=0.5); n10.lyric = "1";  n10.id = "n-m1-0";
        const idMatch = line.match(/\.id\s*=\s*["'](.+?)["']/);
        if (idMatch) {
          const noteId = idMatch[1]; // ej: "n-m1-0"
          const compas = detectarCompasPorLinea(lines, i);
          
          // Para notas, necesitamos buscar el lyric más cercano en el SVG
          // Así que guardamos el ID del código Python para vinculación directa
          codeElements.push({
            tipo: 'Note',
            noteId: noteId, // ID explícito del código
            compas: compas,
            linea: i
          });
          
          console.log(`[ID Mapping] Note ID "${noteId}" (compás ${compas}) → línea ${i}`);
        }
      }
      
      // Title
      if (line.includes('.title') && line.includes('=')) {
        const match = line.match(/=\s*["'](.+?)["']/);
        if (match) {
          const texto = match[1];
          const idEstable = `element_${elementCounter++}`;
          codeElements.push({tipo: 'Title', texto, compas: 0, idEstable, linea: i});
          console.log(`[ID Mapping] Title "${texto}" → ${idEstable} (línea ${i})`);
        }
      }
    }
    
    // 2. Buscar elementos en SVG y asignar IDs estables (TEXTOS)
    const allTexts = osmdSVG.querySelectorAll('text');
    let matchedTexts = 0;
    const usedElements = new Set(); // Para marcar elementos ya usados
    
    // ✅ MEJORADO: Agrupar elementos del código por tipo y texto
    const elementsByTypeAndText = {};
    codeElements.forEach(el => {
      const key = `${el.tipo}_${el.texto}`;
      if (!elementsByTypeAndText[key]) {
        elementsByTypeAndText[key] = [];
      }
      elementsByTypeAndText[key].push(el);
    });
    
    // ✅ NUEVO: Ordenar elementos SVG por posición Y (de arriba abajo)
    const sortedTexts = Array.from(allTexts).sort((a, b) => {
      const aY = a.getBBox().y;
      const bY = b.getBBox().y;
      return aY - bY;
    });
    
    sortedTexts.forEach(textElement => {
      const textoSVG = textElement.textContent.trim();
      const key = `Lyric_${textoSVG}`; // Asumir que son lyrics por ahora
      
      // Buscar en grupo de elementos con mismo tipo y texto
      let match = null;
      if (elementsByTypeAndText[key] && elementsByTypeAndText[key].length > 0) {
        // Tomar el PRIMER elemento no usado (en orden del código)
        match = elementsByTypeAndText[key].find(el => !usedElements.has(el.idEstable));
      }
      
      // Si no es lyric, buscar en otros tipos
      if (!match) {
        match = codeElements.find(el => 
          el.texto === textoSVG && !usedElements.has(el.idEstable)
        );
      }
      
      if (match) {
        // ✅ ASIGNAR ID ESTABLE
        textElement.id = match.idEstable;
        textElement.setAttribute('data-code-line', match.linea);
        textElement.dataset.codeLine = match.linea; // Doble para compatibilidad
        
        stableIdMap[match.idEstable] = {
          svgId: match.idEstable,
          codeLine: match.linea,
          originalText: textoSVG,
          tipo: match.tipo
        };
        
        // ✅ Marcar como usado para evitar duplicados
        usedElements.add(match.idEstable);
        
        matchedTexts++;
        console.log(`[ID Mapping] ✅ Text Match: "${textoSVG}" → ${match.idEstable} (línea ${match.linea})`);
      } else {
        // No match: asignar ID temporal
        const tempId = `temp_${textoSVG.replace(/\s+/g, '-')}_${Date.now()}`;
        textElement.id = tempId;
        console.log(`[ID Mapping] ⚠️ Sin match: "${textoSVG}" → ${tempId} (manual)`);
      }
    });
    
    console.log(`[ID Mapping] ✅ ${matchedTexts} textos vinculados`);
    
    // 3. ✅ NUEVO: Buscar NOTAS (ellipses) y asignar IDs por compás
    const allNotes = Array.from(osmdSVG.querySelectorAll('ellipse'));
    const notesByMeasure = {}; // Agrupar notas por compás
    
    // Agrupar notas SVG por compás
    allNotes.forEach(noteEl => {
      const measureNum = calcularCompasDesdeElemento(noteEl);
      if (!notesByMeasure[measureNum]) {
        notesByMeasure[measureNum] = [];
      }
      notesByMeasure[measureNum].push(noteEl);
    });
    
    // Agrupar IDs de notas del código por compás
    const noteIdsByMeasure = {};
    codeElements.filter(el => el.tipo === 'Note').forEach(noteData => {
      if (!noteIdsByMeasure[noteData.compas]) {
        noteIdsByMeasure[noteData.compas] = [];
      }
      noteIdsByMeasure[noteData.compas].push(noteData);
    });
    
    // Matchear notas por compás en orden (izquierda→derecha en SVG, orden del código)
    let matchedNotes = 0;
    Object.keys(noteIdsByMeasure).forEach(measureNum => {
      const codeNotesInMeasure = noteIdsByMeasure[measureNum];
      const svgNotesInMeasure = notesByMeasure[measureNum] || [];
      
      // Ordenar notas SVG por X (izquierda→derecha)
      svgNotesInMeasure.sort((a, b) => {
        return a.getBoundingClientRect().left - b.getBoundingClientRect().left;
      });
      
      // Matchear: nota N del SVG → nota N del código en este compás
      const minLength = Math.min(codeNotesInMeasure.length, svgNotesInMeasure.length);
      for (let i = 0; i < minLength; i++) {
        const svgNote = svgNotesInMeasure[i];
        const codeNote = codeNotesInMeasure[i];
        
        // Asignar ID del código a la nota SVG
        svgNote.id = codeNote.noteId;
        svgNote.dataset.codeLine = codeNote.linea;
        
        matchedNotes++;
        
        if (matchedNotes <= 5) {
          console.log(`[ID Mapping] ✅ Note Match: Compás ${measureNum}, Nota #${i+1} → "${codeNote.noteId}" (línea ${codeNote.linea})`);
        }
      }
    });
    
    console.log(`[ID Mapping] ✅ ${matchedNotes} notas vinculadas`);
    
    // Guardar mapeo global
    window.stableMapping = stableIdMap;
    
    return stableIdMap;
  }
  
  // Helper: Detectar compás por línea de código
  function detectarCompasPorLinea(lines, lineIndex) {
    // Buscar hacia atrás la declaración de compás más cercana
    for (let i = lineIndex; i >= Math.max(0, lineIndex - 20); i--) {
      const line = lines[i];
      if (line.includes('stream.Measure(')) {
        // ✅ MEJORADO: Detectar ambos formatos
        // Formato 1: stream.Measure(number=1)
        let match = line.match(/Measure\(number=(\d+)\)/);
        if (match) return parseInt(match[1]);
        
        // Formato 2: stream.Measure(1) (antiguo)
        match = line.match(/Measure\((\d+)\)/);
        if (match) return parseInt(match[1]);
      }
    }
    return 1; // Default: compás 1
  }
  
  // ====== MAPEAR NOTAS GLOBALMENTE (SIN DEPENDER DE COMPASES) ======
  function mapNotesGlobally() {
    const osmdSVG = container.querySelector('svg');
    if (!osmdSVG) {
      console.warn('[Note Map] No se encontró SVG de OSMD');
      return;
    }
    
    // 1. Obtener TODAS las notas del SVG ordenadas por X (izquierda→derecha)
    const allNotes = Array.from(osmdSVG.querySelectorAll('ellipse, path[d*="M"]'))
      .filter(el => {
        // Filtrar solo elementos que parecen notas (ellipses o paths pequeños)
        try {
          const bbox = el.getBBox();
          // Ellipses son notas, paths con cierto tamaño también
          return el.tagName === 'ellipse' || (el.tagName === 'path' && bbox.width < 20 && bbox.height < 20);
        } catch (e) {
          return false;
        }
      })
      .sort((a, b) => {
        const aX = a.getBoundingClientRect().left;
        const bX = b.getBoundingClientRect().left;
        return aX - bX;
      });
    
    // 2. Obtener TODAS las note.Note() del código en orden
    const code = window.getCodeEditorValue();
    const lines = code.split('\n');
    const noteLinesInOrder = [];
    
    lines.forEach((line, index) => {
      if (line.includes('note.Note(')) {
        noteLinesInOrder.push(index);
      }
    });
    
    console.log(`[Note Map] ${allNotes.length} notas en SVG, ${noteLinesInOrder.length} note.Note() en código`);
    
    // 3. Matchear: Nota N del SVG → note.Note() N del código
    let matched = 0;
    allNotes.forEach((noteHead, index) => {
      if (noteLinesInOrder[index] !== undefined) {
        noteHead.dataset.codeLine = noteLinesInOrder[index];
        noteHead.id = `note_${index}`;
        matched++;
        
        if (index < 5) { // Log primeras 5 para debug
          console.log(`[Note Map] Nota #${index+1} → línea ${noteLinesInOrder[index]} (ID: note_${index})`);
        }
      }
    });
    
    console.log(`[Note Map] ✅ ${matched} nota(s) mapeada(s) globalmente`);
  }

  // Helper: Calcular compás desde estructura DOM de OSMD
  function calcularCompasDesdeElemento(element) {
    // ✅ MÉTODO ROBUSTO: Usar jerarquía DOM de OSMD
    // OSMD organiza elementos en grupos <g> que representan compases
    
    let parent = element.parentElement;
    let measureCount = 0;
    
    // 1. Subir en la jerarquía DOM buscando el grupo del compás
    while (parent && parent.tagName === 'g') {
      // Buscar hermanos previos que parezcan compases (tienen líneas de compás)
      const siblings = Array.from(parent.parentElement?.children || []);
      const currentIndex = siblings.indexOf(parent);
      
      // Contar cuántos grupos "compás" hay antes de este
      for (let i = 0; i < currentIndex; i++) {
        const sibling = siblings[i];
        if (sibling.tagName === 'g') {
          // Un grupo es un compás si contiene líneas verticales (barlines)
          const hasBarline = sibling.querySelector('path[d*="M"], line');
          if (hasBarline) {
            measureCount++;
          }
        }
      }
      
      // Si encontramos evidencia de compás en este nivel, retornar
      const hasBarline = parent.querySelector('path[d*="M"], line');
      if (hasBarline && measureCount > 0) {
        return measureCount + 1; // +1 porque el compás actual cuenta
      }
      
      parent = parent.parentElement;
    }
    
    // 2. FALLBACK: Si no encontramos por estructura, usar posición X mejorada
    const osmdSVG = container.querySelector('svg');
    if (!osmdSVG) return 1;
    
    try {
      const elementX = element.getBBox().x;
      
      // Contar todos los grupos que parecen compases en el SVG
      const allGroups = osmdSVG.querySelectorAll('g');
      const measureGroups = Array.from(allGroups).filter(g => 
        g.querySelector('path[d*="M"], line')
      );
      
      if (measureGroups.length === 0) return 1;
      
      // Encontrar el compás más cercano por posición X
      let closestMeasure = 1;
      let minDistance = Infinity;
      
      measureGroups.forEach((group, index) => {
        try {
          const groupX = group.getBBox().x;
          const distance = Math.abs(elementX - groupX);
          
          if (distance < minDistance) {
            minDistance = distance;
            closestMeasure = index + 1;
          }
        } catch (e) {
          // Ignorar grupos sin bbox válido
        }
      });
      
      console.log(`[Compás Calc] Elemento en X=${elementX.toFixed(0)} → Compás ${closestMeasure} (${measureGroups.length} compases totales)`);
      return closestMeasure;
      
    } catch (e) {
      console.warn(`[Compás Calc] Error calculando compás:`, e);
      return 1; // Fallback final
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

  // ====== VINCULACIÓN SIMPLE: Usar mapeo del backend ======
  window.elementLineMap = {}; // Mapeo global ID→línea
  
  function linkElementsFromBackend(idToLineMap) {
    const osmdSVG = container.querySelector('svg');
    if (!osmdSVG) return;
    
    let linked = 0;
    
    // Recorrer TODOS los elementos con ID
    const allElements = osmdSVG.querySelectorAll('[id]');
    
    allElements.forEach(el => {
      const elementId = el.id;
      
      if (idToLineMap[elementId] !== undefined) {
        const lineNumber = idToLineMap[elementId];
        el.dataset.codeLine = lineNumber;
        linked++;
        console.log(`[Link] "${elementId}" → línea ${lineNumber}`);
      }
    });
    
    console.log(`[Link] ✅ ${linked}/${Object.keys(idToLineMap).length} elementos vinculados`);
  }

  // ====== ACTUALIZAR CÓDIGO PYTHON AUTOMÁTICAMENTE (SISTEMA SIMPLE) ======
  window.updatePythonCode = function(textElement) {
    const codeEditor = document.getElementById('code-editor');
    if (!codeEditor) return;

    const textContent = textElement.textContent.trim();
    const edit = window.edits ? window.edits[textElement.id] : null;
    if (!edit) return;

    // ✅ SISTEMA SIMPLE: Usar data-codeLine directamente
    if (!textElement.dataset || textElement.dataset.codeLine === undefined) {
        console.log(`[Python Update] Elemento sin data-codeLine (manual), skip`);
        return;
    }

    const lineNumber = parseInt(textElement.dataset.codeLine);
    let code = getCodeEditorValue();
    const lines = code.split('\n');
    
    console.log(`[Python Update] ✅ Usando línea ${lineNumber} para "${textContent}"`);
    
    // BÚSQUEDA UNIVERSAL POR ID
    let targetLineIndex = -1;
    let varName = null;
    let elementType = null;
    
    // ✅ PRIMERO: Detectar si es el título por características visuales
    const y = parseFloat(textElement.getAttribute('y'));
    const fontSize = parseFloat(textElement.getAttribute('font-size')) || 20;
    const isLikelyTitle = y < 100 && fontSize > 22; // Título suele estar arriba y ser grande
    
    if (isLikelyTitle) {
      // Buscar .metadata.title o .title directamente
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('.title') && lines[i].includes('=')) {
          targetLineIndex = i;
          elementType = 'Title';
          console.log(`[Python Update] ✅ Detectado como título por características visuales (y=${y}, fontSize=${fontSize})`);
          break;
        }
      }
    }
    
    // Si no es título, buscar por ID normalmente
    if (targetLineIndex === -1) {
      const elementId = textElement.id; // ✅ DECLARAR variable local
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(`.id = "${elementId}"`)) {
          // Encontrado ID, buscar declaración hacia arriba
          for (let j = i; j >= Math.max(0, i - 10); j--) {
            const line = lines[j];
            
            if (line.includes('harmony.ChordSymbol')) {
              elementType = 'ChordSymbol';
              const match = line.match(/(\w+)\s*=\s*harmony\.ChordSymbol/);
              if (match) varName = match[1];
              targetLineIndex = j;
              break;
            } else if (line.includes('expressions.TextExpression')) {
              elementType = 'TextExpression';
              const match = line.match(/(\w+)\s*=\s*expressions\.TextExpression/);
              if (match) varName = match[1];
              targetLineIndex = j;
              break;
            } else if (line.includes('.lyric')) {
              elementType = 'Lyric';
              targetLineIndex = j;
              break;
            } else if (line.includes('.title')) {
              elementType = 'Title';
              targetLineIndex = j;
              break;
            }
          }
          if (targetLineIndex !== -1) break;
        }
      }
    }
    
    // Si NO se encuentra por ID, buscar por CONTENIDO como fallback
    if (targetLineIndex === -1) {
      // PRIMERO: Buscar si es el título (por contenido en .title)
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().startsWith('#')) continue;
        
        if (line.includes('.title') && line.includes('=') && 
            (line.includes(`"${textContent}"`) || line.includes(`'${textContent}'`))) {
          targetLineIndex = i;
          elementType = 'Title';
          console.log(`[Python Update] ✅ Encontrado título por contenido en línea ${i}`);
          break;
        }
      }
      
      // Si no es título, buscar otros tipos
      if (targetLineIndex === -1) {
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.trim().startsWith('#')) continue;
          
          if ((line.includes('ChordSymbol') || line.includes('TextExpression')) && 
              (line.includes(`"${textContent}"`) || line.includes(`'${textContent}'`))) {
            targetLineIndex = i;
            
            if (line.includes('ChordSymbol')) {
              elementType = 'ChordSymbol';
              const match = line.match(/(\w+)\s*=\s*harmony\.ChordSymbol/);
              if (match) varName = match[1];
            } else {
              elementType = 'TextExpression';
              const match = line.match(/(\w+)\s*=\s*expressions\.TextExpression/);
              if (match) varName = match[1];
            }
            break;
          } else if (line.includes(`lyric="${textContent}"`) || line.includes(`lyric='${textContent}'`)) {
            targetLineIndex = i;
            elementType = 'Lyric';
            break;
          }
        }
      }
    }
    
    if (targetLineIndex === -1) {
      console.warn(`[Python Update] ❌ No encontrado: "${textContent}" (ID: ${textElement.id})`);
      return;
    }
    
    console.log(`[Python Update] ✅ Encontrado tipo ${elementType} en línea ${targetLineIndex}, var: ${varName}`);
    
    // ACTUALIZAR SEGÚN TIPO
    if (elementType === 'Lyric') {
      updateLyricInCodeUniversal(targetLineIndex, textContent, edit, lines);
    } else if (elementType === 'Title') {
      updateTitleInCodeUniversal(targetLineIndex, textContent, edit, lines);
    } else if (varName) {
      // ChordSymbol o TextExpression
      updateGenericElementInCode(targetLineIndex, varName, textContent, edit, lines);
    }
    
    setCodeEditorValue(lines.join('\n'));
    console.log(`[Python Update] ✅ Código actualizado para "${textContent}"`);
  };
  
  // FUNCIÓN UNIVERSAL para ChordSymbol y TextExpression
  function updateGenericElementInCode(startLine, varName, newText, edit, lines) {
    const indent = lines[startLine].match(/^(\s*)/)[1];
    
    // 1. ✅ MEJORADO: Verificar si ya está actualizado antes de intentar
    if (edit.textContent) {
      const beforeReplace = lines[startLine];
      
      // ✅ Verificar si ya contiene el texto correcto
      if (beforeReplace.includes(`"${edit.textContent}"`) || beforeReplace.includes(`'${edit.textContent}'`)) {
        console.log(`[Python] Texto ya actualizado en línea ${startLine}: "${edit.textContent}"`);
        // Ya está correcto, skip
      } else {
        // Intentar actualizar
        lines[startLine] = lines[startLine].replace(/["'](.+?)["']/, `"${edit.textContent}"`);
        
        if (beforeReplace !== lines[startLine]) {
          console.log(`[Python] Texto actualizado directamente: "${edit.textContent}"`);
        } else {
          console.warn(`[Python] ⚠️ No se pudo actualizar texto en línea ${startLine}`);
        }
      }
    }
    
    // 2. Borrar líneas style existentes
    let i = startLine + 1;
    while (i < lines.length) {
      if (lines[i].trim().startsWith(`${varName}.style.`)) {
        lines.splice(i, 1);
        continue;
      }
      if (lines[i].trim() && !lines[i].includes(varName)) break;
      i++;
    }
    
    // 3. ✅ MEJORADO: Encontrar punto de inserción ROBUSTO
    let insertIndex = startLine + 1;
    
    // Buscar la ÚLTIMA línea que menciona esta variable antes de otra variable o código no relacionado
    for (let j = startLine + 1; j < lines.length && j < startLine + 15; j++) {
      const line = lines[j].trim();
      
      // Si es una línea de esta variable (cualquier propiedad), actualizar insertIndex
      if (line.startsWith(`${varName}.`)) {
        insertIndex = j + 1;
        continue;
      }
      
      // Si es una línea relacionada con inserción/append de esta variable
      if (line.includes(`.insert(`) && line.includes(varName)) {
        insertIndex = j + 1;
        continue;
      }
      if (line.includes(`.append(${varName})`)) {
        insertIndex = j + 1;
        continue;
      }
      
      // Si encontramos otra variable o código no relacionado, parar
      if (line && !line.startsWith('#') && !line.includes(varName)) {
        break;
      }
    }
    
    // 4. Insertar nuevas líneas style
    const newLines = [];
    const xTenths = Math.round((edit.x || 0) * 2.5);
    const yTenths = Math.round((edit.y || 0) * 2.5);
    
    if (xTenths !== 0) newLines.push(`${indent}${varName}.style.absoluteX = ${xTenths}`);
    if (yTenths !== 0) newLines.push(`${indent}${varName}.style.absoluteY = ${yTenths}`);
    if (edit.scale && edit.scale !== 1.0) {
      const scalePercent = Math.round(edit.scale * 100);
      newLines.push(`${indent}${varName}.style.fontSize = '${scalePercent}%'`);
    }
    
    if (newLines.length > 0) {
      lines.splice(insertIndex, 0, ...newLines);
      console.log(`[Python] ✅ Insertadas ${newLines.length} líneas en índice ${insertIndex}: x=${xTenths}, y=${yTenths}, scale=${edit.scale}`);
    } else {
      console.log(`[Python] ⚠️ Sin cambios de posición/escala para insertar`);
    }
  }
  
  // FUNCIÓN UNIVERSAL para Lyrics
  function updateLyricInCodeUniversal(lineIndex, newText, edit, lines) {
    let modified = false;
    
    // Obtener texto actual
    const currentMatch = lines[lineIndex].match(/lyric\s*=\s*["'](.+?)["']/);
    const currentText = currentMatch ? currentMatch[1] : newText;
    
    // 1. Actualizar texto
    if (edit.textContent && edit.textContent !== currentText) {
      lines[lineIndex] = lines[lineIndex].replace(`lyric="${currentText}"`, `lyric="${edit.textContent}"`);
      lines[lineIndex] = lines[lineIndex].replace(`lyric='${currentText}'`, `lyric='${edit.textContent}'`);
      modified = true;
      console.log(`[Python] Lyric texto: "${currentText}" → "${edit.textContent}"`);
    }
    
    // 2. Actualizar escala
    if (edit.scale && edit.scale !== 1.0) {
      const scalePercent = Math.round(edit.scale * 100);
      if (lines[lineIndex].includes('fontSize')) {
        lines[lineIndex] = lines[lineIndex].replace(/fontSize\s*=\s*['"]?\d+%?['"]?/, `fontSize="${scalePercent}%"`);
      } else {
        const lyricMatch = lines[lineIndex].match(/(lyric\s*=\s*['"][^'"]*['"])/);
        if (lyricMatch) {
          lines[lineIndex] = lines[lineIndex].replace(lyricMatch[1], `${lyricMatch[1]}, fontSize="${scalePercent}%"`);
        }
      }
      modified = true;
      console.log(`[Python] Lyric escala: ${scalePercent}%`);
    }
    
    return modified;
  }
  
  // FUNCIÓN UNIVERSAL para Title
  function updateTitleInCodeUniversal(lineIndex, newText, edit, lines) {
    if (edit.textContent) {
      const currentMatch = lines[lineIndex].match(/=\s*["'](.*)["']/);
      const currentText = currentMatch ? currentMatch[1] : '';
      
      if (edit.textContent !== currentText) {
        lines[lineIndex] = lines[lineIndex].replace(/=\s*["'].*["']/, `= "${edit.textContent}"`);
        console.log(`[Python] Title: "${currentText}" → "${edit.textContent}"`);
      }
    }
  }
  
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
        
        // ✅ CRÍTICO: Asignar IDs ANTES de aplicar textContent
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
        
        // ✅ CRÍTICO: Aplicar textContent usando IDs ya asignados correctamente
        const deletions = typeof window.getDeletions === 'function' ? window.getDeletions() : new Set();
        const oldIdToNewIdMap = {}; // Declarar variable
        
        Object.keys(window.edits || {}).forEach(id => {
          // Ignorar elementos borrados
          if (deletions.has(id)) return;
          
          let el = document.getElementById(id);
          const edit = window.edits[id];
          
          // Si el elemento NO se encuentra por ID actual
          if (!el && edit.textContent) {
            // Buscar por texto ORIGINAL usando el mapeo
            // El ID guardado en edits corresponde al texto EDITADO
            // Necesitamos encontrar qué texto ORIGINAL corresponde a este ID
            
            // Buscar en el mapeo inverso: necesitamos saber qué texto original tenía este ID
            // Para eso, buscar en el código Python qué texto tiene este ID
            const lines = updatedCode.split('\n');
            let originalTextFromPython = null;
            
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].includes(`.id = "${id}"`)) {
                // Buscar hacia arriba la declaración
                for (let j = i; j >= Math.max(0, i - 10); j--) {
                  const match = lines[j].match(/["'](.+?)["']\)/);
                  if (match) {
                    originalTextFromPython = match[1];
                    break;
                  }
                }
                break;
              }
            }
            
            // Si encontramos el texto original, buscar el ID en el mapeo
            if (originalTextFromPython && textToIdMap.has(originalTextFromPython)) {
              const newId = textToIdMap.get(originalTextFromPython);
              el = document.getElementById(newId);
              
              if (el) {
                oldIdToNewIdMap[id] = newId;
                console.log(`[ID Remapping] "${id}" → "${newId}" (texto original: "${originalTextFromPython}")`);
              }
            }
          }
          
          // Aplicar textContent si existe
          if (el && edit.textContent && el.tagName === 'text') {
            el.textContent = edit.textContent;
            console.log(`[Responsividad] ✅ Restaurando texto editado para "${el.id}": "${edit.textContent}"`);
          }
        });
        
        // ✅ Actualizar window.edits con los IDs remapeados
        Object.keys(oldIdToNewIdMap).forEach(oldId => {
          const newId = oldIdToNewIdMap[oldId];
          window.edits[newId] = window.edits[oldId];
          delete window.edits[oldId];
          console.log(`[window.edits] Actualizado: "${oldId}" → "${newId}"`);
        });
        
        // Luego actualizar código Python con TODAS las ediciones (posición, escala, texto)
        Object.keys(window.edits || {}).forEach(id => {
          const el = document.getElementById(id);
          if (el && el.tagName === 'text') {
            // Actualizar si hay CUALQUIER edición (posición, escala o texto)
            const edit = window.edits[id];
            if (edit && (edit.x !== 0 || edit.y !== 0 || edit.scale !== 1.0 || edit.textContent)) {
              if (typeof window.updatePythonCode === 'function') {
                window.updatePythonCode(el);
                console.log(`[Responsividad] ✅ Actualizando Python para "${el.textContent.trim()}" (x:${edit.x}, y:${edit.y}, scale:${edit.scale})`);
              }
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
      // ✅ CORREGIDO: Detener reproductor ANTES de limpiar
      if (isPlaying) {
        stopPlayback();
      }
      
      // ✅ CORREGIDO: Limpiar lastLoadedXML para forzar regeneración
      lastLoadedXML = '';
      
      // ✅ CORREGIDO: Limpiar memoria de textos convertidos
      if (typeof window.convertedTexts !== 'undefined') {
        window.convertedTexts.clear();
      }
      
      // Limpiar editor (CodeMirror)
      if (window.codeMirrorEditor) {
        window.codeMirrorEditor.setValue('');
      } else {
        codeEditor.value = '';
      }
      
      // Limpiar partitura renderizada
      container.innerHTML = '';
      errorOutput.textContent = '';
      
      // Limpiar OSMD instance
      if (hasRenderedOnce && typeof osmd.clear === 'function') {
        try { 
          osmd.clear(); 
          hasRenderedOnce = false; // ✅ Resetear flag
        } catch (_) {}
      }
      
      // Limpiar ediciones guardadas
      window.edits = {};
      if (typeof window.clearDeletions === 'function') {
        window.clearDeletions();
      }
      if (typeof window.saveToLocalStorage === 'function') {
        localStorage.removeItem('scoreEdits');
      }
      
      // ✅ CORREGIDO: Resetear estado del reproductor
      scheduledNotes = [];
      if (audioContext) {
        audioContext.close().then(() => {
          audioContext = null;
          currentInstrument = null;
        }).catch(() => {
          audioContext = null;
          currentInstrument = null;
        });
      }
      
      console.log('[Reset] Editor, partitura y reproductor completamente limpiados');
      alert('Editor limpiado correctamente. Puedes introducir nuevo código.');
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
