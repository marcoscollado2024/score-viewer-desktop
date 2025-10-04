
// --- Variables Globales ---
// IMPORTANTE: NO usar 'let edits = {}', usar directamente window.edits
window.edits = window.edits || {};
let edits = window.edits; // Referencia a la misma variable

let deletions = new Set();
let selectedElement = null;
let selectedElements = new Set(); // NUEVO: Selección múltiple
let editPalette = null;
let newElementCounter = 0;
let history = [];
let historyIndex = -1;
let originalTexts = {};
let clipboard = null;

// Variables para selección múltiple por drag
let isSelecting = false;
let selectionStartX = 0;
let selectionStartY = 0;
let selectionBox = null;
let multiSelectionBox = null; // Rectángulo que engloba todos los seleccionados
let justCompletedSelection = false; // Flag para prevenir limpieza inmediata

// ====== FUNCIONES DE RESALTADO DE CÓDIGO (DEFINIDAS PRIMERO) ======
function highlightCodeLine(lineNumber, isEditing = false) {
    const codeEditor = document.getElementById('code-editor');
    if (!codeEditor) {
        console.warn('[Highlight] Editor no encontrado');
        return;
    }
    
    // Si usa CodeMirror
    if (window.codeMirrorEditor) {
        // ✅ CRÍTICO: Limpiar TODOS los resaltados anteriores (highlighted-line Y editing)
        for (let i = 0; i < window.codeMirrorEditor.lineCount(); i++) {
            window.codeMirrorEditor.removeLineClass(i, 'background', 'highlighted-line');
            window.codeMirrorEditor.removeLineClass(i, 'background', 'editing');
        }
        
        // Añadir clase highlighted-line
        window.codeMirrorEditor.addLineClass(lineNumber, 'background', 'highlighted-line');
        
        // ✅ NUEVO: Añadir clase .editing si está en modo edición
        if (isEditing) {
            window.codeMirrorEditor.addLineClass(lineNumber, 'background', 'editing');
            console.log(`[Highlight] Línea ${lineNumber} resaltada en modo EDITING`);
        } else {
            console.log(`[Highlight] Línea ${lineNumber} resaltada normal`);
        }
        
        // ✅ SCROLL CENTRADO MEJORADO: Usar función dedicada
        scrollCodeToLine(lineNumber);
        
        return;
    }
    
    // Fallback: textarea nativo
    const lines = codeEditor.value.split('\n');
    const start = lines.slice(0, lineNumber).join('\n').length;
    const end = start + lines[lineNumber].length;
    
    codeEditor.focus();
    codeEditor.setSelectionRange(start, end);
    codeEditor.scrollTop = lineNumber * 20;
}

function clearCodeHighlight() {
    if (window.codeMirrorEditor) {
        // Limpiar todas las líneas resaltadas
        for (let i = 0; i < window.codeMirrorEditor.lineCount(); i++) {
            window.codeMirrorEditor.removeLineClass(i, 'background', 'highlighted-line');
            window.codeMirrorEditor.removeLineClass(i, 'background', 'editing');
        }
    }
}

// --- Conversión px ↔ tenths ---
// En MusicXML, las posiciones se miden en "tenths" (1/10 de espacio entre líneas del pentagrama)
// Factor aproximado: ajustar según escala de OSMD
const TENTHS_PER_PX = 2.5; // Valor inicial, puede calibrarse

function pxToTenths(px) {
    return Math.round(px * TENTHS_PER_PX);
}

function tenthsToPx(tenths) {
    return tenths / TENTHS_PER_PX;
}

// --- Inicialización ---
document.addEventListener('DOMContentLoaded', () => {
    editPalette = document.getElementById('edit-palette');
    const mainToolbar = document.getElementById('main-toolbar');
    const scoreContainer = document.querySelector('#score-output');

    // Listeners de la Toolbar Principal
    document.getElementById('save-btn').addEventListener('click', saveAndDownload);
    // NOTA: save-visual-btn fue reemplazado por export-image-select
    document.getElementById('undo-btn').addEventListener('click', undo);
    document.getElementById('redo-btn').addEventListener('click', redo);
    
    // ✅ CORREGIDO: Auto-cerrar selectores tras selección
    const fontSelect = document.getElementById('font-select');
    fontSelect.addEventListener('change', (e) => {
        applyFont(e.target.value);
        e.target.blur(); // Cerrar desplegable
    });
    
    const symbolSelect = document.getElementById('symbol-select');
    symbolSelect.addEventListener('change', (e) => {
        addNewSymbol(e.target.value);
        e.target.blur(); // Cerrar desplegable
    });
    
    const colorSelect = document.getElementById('color-select');
    if (colorSelect) {
        colorSelect.addEventListener('change', (e) => {
            // La lógica de color se maneja en su propio listener más abajo
            e.target.blur(); // Cerrar desplegable
        });
    }
    
    const exportSelect = document.getElementById('export-image-select');
    if (exportSelect) {
        exportSelect.addEventListener('change', (e) => {
            // La lógica de exportación se maneja en su propio listener más abajo
            e.target.blur(); // Cerrar desplegable
        });
    }

    // Listeners de la Paleta de Edición Individual
    document.getElementById('zoom-in-btn').addEventListener('click', () => updateScale(1.1));
    document.getElementById('zoom-out-btn').addEventListener('click', () => updateScale(0.9));
    document.getElementById('delete-btn').addEventListener('click', deleteSelectedElement);

    // ✅ NUEVO: Listeners de la Paleta de Multi-Selección
    document.getElementById('multi-zoom-in-btn').addEventListener('click', () => updateScaleMultiple(1.1));
    document.getElementById('multi-zoom-out-btn').addEventListener('click', () => updateScaleMultiple(0.9));
    document.getElementById('multi-delete-btn').addEventListener('click', deleteMultipleElements);

    // Listener para creación de texto con doble clic
    if (scoreContainer) {
        scoreContainer.addEventListener('dblclick', addNewTextAtCursor);
    }

    // Hacer la toolbar arrastrable
    if (window.interact) {
        interact(mainToolbar).draggable({ 
            inertia: true, 
            listeners: { move: dragToolbarListener },
            // ✅ NO arrastrar si se inicia sobre un select u otro control
            ignoreFrom: 'select, input, textarea, button'
        });
    }

    // Listener para copiar y pegar
    window.addEventListener('keydown', handleCopyPaste);
});

function initEditing() {
    if (!window.interact) return;

    const mainSVG = document.querySelector('#osmd-container svg');
    if (mainSVG) mainSVG.id = 'sheet-music-svg';

    const scoreContainer = document.querySelector('#score-output');

    // Crear capa de anotaciones si no existe
    let annotationSVG = document.getElementById('annotation-svg');
    if (!annotationSVG) {
        annotationSVG = createSVGElement('svg', {
            id: 'annotation-svg',
            style: 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;'
        });
        scoreContainer.appendChild(annotationSVG);
    }

    // NUEVO: Inicializar selección múltiple con drag
    initMultipleSelection(scoreContainer);

    // Hacer textos, SVG principal Y staff-only seleccionables
    const elementsToInit = document.querySelectorAll('#osmd-container text, #sheet-music-svg, #staff-only');
    elementsToInit.forEach(el => {
        // ✅ CRÍTICO: RESPETAR IDs asignados por assignCorrectIDsFromCode
        // Solo asignar ID fallback si realmente NO tiene ID
        if (!el.id || el.id.trim() === '') {
            const textContent = el.textContent.trim();
            const timestamp = Date.now();
            el.id = `fallback_${textContent.replace(/\s+/g, '-')}_${timestamp}`;
            console.log(`[initEditing] ⚠️ ID fallback asignado (elemento no vinculado): "${el.id}"`);
        } else {
            console.log(`[initEditing] ✅ ID estable preservado: "${el.id}"`);
        }
        
        // Establecer el origen de la transformación para un escalado centrado
        el.style.transformOrigin = 'center';
        el.style.transformBox = 'fill-box';

        el.addEventListener('click', (e) => {
            e.stopPropagation();
            selectElement(el);
        });
        // Añadir listener para editar texto existente con doble clic
        if (el.tagName === 'text') {
            el.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                editTextInPlace(el);
            });
        }
    });

    // Deseleccionar al hacer clic en el fondo
    document.querySelector('#score-output').addEventListener('click', (e) => {
        // ✅ Ignorar click si acabamos de completar selección múltiple
        if (justCompletedSelection) {
            justCompletedSelection = false;
            return;
        }
        
        // ✅ CRÍTICO: Ignorar clicks DENTRO del textarea de edición o input
        const activeTextarea = document.querySelector('#score-output textarea');
        const activeInput = document.querySelector('#score-output input[type="text"]');
        
        if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT' || activeTextarea || activeInput) {
            console.log('[Click] Ignorado: dentro de textarea/input (mantener resaltado)');
            return;
        }
        
        // ✅ Permitir clicks en elementos, paletas y bounding box sin deseleccionar
        if (e.target.closest('#osmd-container text, #sheet-music-svg, #edit-palette, #multi-select-palette, .multi-selection-box')) return;
        
        // ✅ CRÍTICO: Llamar a deselectAll directamente (sin override)
        deselectAll();
    });

    // NUEVO: Hacer elementos arrastrables INDIVIDUALMENTE (no por selector)
    // Esto asegura que funcionen incluso tras re-render
    const elementsToMakeDraggable = document.querySelectorAll('#osmd-container text, #sheet-music-svg, #staff-only');
    elementsToMakeDraggable.forEach(el => {
        // Primero limpiar configuración anterior si existe
        interact(el).unset();
        
        // Configurar arrastre CON CONDICIÓN: No funciona si Shift está presionado
        interact(el).draggable({
            inertia: true,
            // ✅ NUEVO: Ignorar drag si Shift está presionado (para permitir selección múltiple)
            manualStart: true,
            listeners: { 
                move: (event) => {
                    // Solo mover si NO se presionó Shift al inicio
                    if (!event.interaction.shiftKey) {
                        dragMoveListener(event);
                    }
                },
                start: (event) => {
                    // Guardar estado de Shift al inicio del drag
                    event.interaction.shiftKey = event.shiftKey;
                },
                end: handleDragEnd 
            }
        }).on('down', (event) => {
            // ✅ CLAVE: Solo iniciar drag si NO hay Shift
            if (!event.shiftKey) {
                const interaction = event.interaction;
                if (!interaction.interacting()) {
                    interaction.start({ name: 'drag' }, event.interactable, event.currentTarget);
                }
            }
        });
        
        console.log(`[initEditing] Elemento "${el.id || el.tagName}" configurado como arrastrable`);
    });

    resetAndSaveInitialState();
}

// --- Lógica de Selección y UI ---

function selectElement(el) {
    if (selectedElement === el) return;
    
    // ✅ CRÍTICO: No interrumpir si acabamos de completar multi-selección
    if (justCompletedSelection) {
        console.log('[selectElement] Ignorando porque justCompletedSelection=true');
        justCompletedSelection = false;
        return;
    }
    
    deselectAll();
    selectedElement = el;
    el.classList.add('selected');
    showEditPalette(el);
    
    // ✅ SISTEMA SIMPLE: Resaltar usando data-codeLine
    if (el.dataset && el.dataset.codeLine !== undefined) {
        const lineNumber = parseInt(el.dataset.codeLine);
        highlightCodeLine(lineNumber);
        console.log(`[Select] ✅ Resaltado línea ${lineNumber} para "${el.textContent?.trim()}"`);
    } else {
        console.log(`[Select] Elemento sin data-codeLine (manual o sin vincular)`);
    }
}

function deselectAll() {
    if (selectedElement) selectedElement.classList.remove('selected');
    selectedElement = null;
    clearMultipleSelection();
    hideEditPalette();
    hideMultipleSelectionPalette();
    
    // ✅ CRÍTICO: NO limpiar resaltado si hay un textarea O input activo
    const activeTextarea = document.querySelector('#score-output textarea');
    const activeInput = document.querySelector('#score-output input[type="text"]');
    
    if (!activeTextarea && !activeInput) {
        // Solo limpiar si NO hay textarea ni input activo
        if (typeof clearCodeHighlight === 'function') {
            clearCodeHighlight();
            console.log('[Deselect] Resaltado de código limpiado');
        }
    } else {
        console.log('[Deselect] Resaltado MANTENIDO (textarea/input activo)');
    }
    
    // Restaurar cursor al deseleccionar
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.body.style.webkitUserSelect = '';
}

function showEditPalette(el) {
    if (!editPalette) return;
    editPalette.style.display = 'flex';
    // Ocultar botón de borrar para SVG principal y staff-only
    const canDelete = (el.id !== 'sheet-music-svg' && el.id !== 'staff-only');
    document.getElementById('delete-btn').style.display = canDelete ? 'block' : 'none';
    updateEditPalettePosition();
}

function updateEditPalettePosition() {
    if (!selectedElement || !editPalette) return;

    const elRect = selectedElement.getBoundingClientRect();
    const containerRect = selectedElement.closest('#score-output').getBoundingClientRect();
    
    editPalette.style.left = `${elRect.left - containerRect.left + elRect.width / 2 - editPalette.offsetWidth / 2}px`;
    editPalette.style.top = `${elRect.top - containerRect.top - editPalette.offsetHeight - 10}px`;
}

function hideEditPalette() {
    if (editPalette) editPalette.style.display = 'none';
}

// --- Creación y Edición de Texto "In-situ" ---

function addNewTextAtCursor(event) {
    // Prevenir si se hace doble clic sobre un elemento existente
    if (event.target.closest('text, g, #edit-palette')) return;
    
    const scoreContainer = document.querySelector('#score-output');
    const containerRect = scoreContainer.getBoundingClientRect();

    const points = {
        svg: getAnnotationSVGCoordinates(event),
        screen: {
            x: event.clientX - containerRect.left,
            y: event.clientY - containerRect.top
        }
    };
    
    editTextInPlace(null, points);
}

function editTextInPlace(existingElement, points) {
    const scoreContainer = document.querySelector('#score-output');

    // Guardar texto original para el historial si es la primera vez que se edita
    if (existingElement && !originalTexts.hasOwnProperty(existingElement.id)) {
        const tspans = existingElement.querySelectorAll('tspan');
        if (tspans.length > 0) {
            originalTexts[existingElement.id] = Array.from(tspans).map(t => t.textContent).join('\n');
        } else {
            originalTexts[existingElement.id] = existingElement.textContent;
        }
    }

    // Ocultar el elemento existente si estamos editando
    if (existingElement) {
        existingElement.style.visibility = 'hidden';
    }

    let initialText = "Nuevo Texto";
    if (existingElement) {
        const tspans = existingElement.querySelectorAll('tspan');
        if (tspans.length > 0) {
            initialText = Array.from(tspans).map(t => t.textContent).join('\n');
        } else {
            initialText = existingElement.textContent;
        }
    }

    const fontSize = existingElement ? existingElement.getAttribute('font-size') || 20 : 20;
    const fontFamily = existingElement ? existingElement.getAttribute('font-family') || 'Times New Roman' : 'Times New Roman';
    
    let pos, screenPos;

    if (existingElement) {
        const elRect = existingElement.getBoundingClientRect();
        const containerRect = scoreContainer.getBoundingClientRect();
        screenPos = {
            x: elRect.left - containerRect.left,
            y: elRect.top - containerRect.top
        };
    } else {
        pos = points.svg;
        screenPos = points.screen;
    }

    const editor = document.createElement('textarea');
    editor.value = initialText;
    editor.style.cssText = `
        position: absolute;
        background: #fff; color: #000; border: 1px solid var(--primary);
        font-size: ${fontSize}px; font-family: ${fontFamily};
        width: 200px; height: 80px; padding: 2px 5px;
        z-index: 2000; resize: both;
    `;
    
    scoreContainer.appendChild(editor);
    
    editor.style.left = `${screenPos.x}px`;
    editor.style.top = `${screenPos.y}px`;

    editor.focus();
    editor.select();
    
    // ✅ NUEVO: Obtener línea de código para actualización en tiempo real
    const codeLine = existingElement ? parseInt(existingElement.dataset.codeLine) : null;
    
    // ✅ NUEVO: Resaltar línea con clase .editing (más oscuro)
    if (codeLine !== null && !isNaN(codeLine)) {
        highlightCodeLine(codeLine, true); // true = modo editing
        console.log(`[Live Edit] Resaltando línea ${codeLine} en modo editing`);
    }
    
    // ✅ NUEVO: Actualización en tiempo real mientras escribe + VALIDACIÓN
    editor.addEventListener('input', async () => {
        const newText = editor.value;
        
        // ✅ VALIDACIÓN EN VIVO: Verificar si el texto es válido
        let isValid = true;
        let validationError = null;
        
        if (existingElement && codeLine !== null && newText.trim()) {
            // Detectar tipo de elemento
            const elementType = detectElementTypeFromLine(codeLine);
            
            if (elementType === 'ChordSymbol') {
                const result = await validateChord(newText.trim());
                isValid = result;
                if (!result) {
                    validationError = 'Acorde inválido';
                }
            } else if (elementType === 'Note') {
                const result = await validateNote(newText.trim());
                isValid = result;
                if (!result) {
                    validationError = 'Nota inválida';
                }
            }
            // Lyrics y textos siempre son válidos
        }
        
        // Indicar visualmente si es inválido
        if (!isValid && newText.trim()) {
            editor.style.borderColor = '#ff0000';
            editor.style.background = '#ffe6e6';
            editor.title = validationError || 'Entrada inválida';
            console.log(`[Live Edit] ⚠️ ${validationError}: "${newText.trim()}"`);
            // NO actualizar código ni visual si es inválido
            return;
        } else {
            editor.style.borderColor = 'var(--primary)';
            editor.style.background = '#fff';
            editor.title = '';
        }
        
        // Actualizar elemento visual inmediatamente solo si es válido
        if (existingElement) {
            existingElement.innerHTML = '';
            const lines = newText.split('\n');
            lines.forEach((line, index) => {
                const tspan = createSVGElement('tspan', {
                    x: existingElement.getAttribute('x'),
                    dy: index === 0 ? '0' : '1.2em',
                    textContent: line || ' '
                });
                existingElement.appendChild(tspan);
            });
        }
        
        // ✅ Actualizar código Python EN VIVO solo si es válido
        if (codeLine !== null && !isNaN(codeLine) && isValid) {
            updateCodeLineDirectly(codeLine, newText);
        }
    });

    const finishEditing = async () => {
        try {
            const newTextContent = editor.value; // Keep whitespace
            
            // ✅ VALIDACIÓN FINAL antes de guardar
            if (existingElement && codeLine !== null && newTextContent.trim()) {
                const elementType = detectElementTypeFromLine(codeLine);
                let isValid = true;
                
                if (elementType === 'ChordSymbol') {
                    isValid = await validateChord(newTextContent.trim());
                    if (!isValid) {
                        alert(`❌ Acorde inválido: "${newTextContent.trim()}"\n\nNo se guardará el cambio.`);
                        // Restaurar valor original
                        if (originalTexts.hasOwnProperty(existingElement.id)) {
                            existingElement.innerHTML = '';
                            const lines = originalTexts[existingElement.id].split('\n');
                            lines.forEach((line, index) => {
                                const tspan = createSVGElement('tspan', {
                                    x: existingElement.getAttribute('x'),
                                    dy: index === 0 ? '0' : '1.2em',
                                    textContent: line || ' '
                                });
                                existingElement.appendChild(tspan);
                            });
                        }
                        existingElement.style.visibility = 'visible';
                        return; // NO guardar
                    }
                } else if (elementType === 'Note') {
                    isValid = await validateNote(newTextContent.trim());
                    if (!isValid) {
                        alert(`❌ Nota inválida: "${newTextContent.trim()}"\n\nNo se guardará el cambio.`);
                        // Restaurar valor original
                        if (originalTexts.hasOwnProperty(existingElement.id)) {
                            existingElement.innerHTML = '';
                            const lines = originalTexts[existingElement.id].split('\n');
                            lines.forEach((line, index) => {
                                const tspan = createSVGElement('tspan', {
                                    x: existingElement.getAttribute('x'),
                                    dy: index === 0 ? '0' : '1.2em',
                                    textContent: line || ' '
                                });
                                existingElement.appendChild(tspan);
                            });
                        }
                        existingElement.style.visibility = 'visible';
                        return; // NO guardar
                    }
                }
            }
            
            if (existingElement) {
                existingElement.innerHTML = ''; // Clear existing content
                const lines = newTextContent.split('\n');
                lines.forEach((line, index) => {
                    const tspan = createSVGElement('tspan', {
                        x: existingElement.getAttribute('x'),
                        dy: index === 0 ? '0' : '1.2em',
                        textContent: line || ' ' // Use a space for empty lines to maintain height
                    });
                    existingElement.appendChild(tspan);
                });

                existingElement.style.visibility = 'visible';
                
                const id = existingElement.id;
                if (!edits[id]) edits[id] = { x: 0, y: 0, scale: 1.0 };
                edits[id].textContent = newTextContent; // Store raw multiline text
                
                // ✅ CRÍTICO: Actualizar código Python SIEMPRE al editar texto
                console.log('[Edit Text] Llamando a updatePythonCode para:', id);
                if (typeof window.updatePythonCode === 'function') {
                    window.updatePythonCode(existingElement);
                } else {
                    console.error('[Edit Text] updatePythonCode NO disponible');
                }
                
                saveState();

            } else if (newTextContent.trim()) {
                const newText = createSVGElement('text', {
                    x: pos.x, y: pos.y,
                    fill: 'var(--text)', 'font-size': `${fontSize}px`, 'font-family': fontFamily,
                    'data-type': 'text',
                    'dominant-baseline': 'hanging'
                });

                const lines = newTextContent.split('\n');
                lines.forEach((line, index) => {
                    const tspan = createSVGElement('tspan', {
                        x: pos.x,
                        dy: index === 0 ? '0' : '1.2em',
                        textContent: line || ' '
                    });
                    newText.appendChild(tspan);
                });
                finalizeNewElement(newText);
            }
        } catch (error) {
            console.error('[Edit Text] Error al procesar:', error);
        } finally {
            // ✅ CRÍTICO: SIEMPRE limpiar el editor Y el resaltado
            try {
                if (editor && editor.parentNode) {
                    scoreContainer.removeChild(editor);
                }
                editor.removeEventListener('blur', finishEditing);
                editor.removeEventListener('keydown', handleKeydown);
                
                // ✅ NUEVO: Limpiar resaltado oscuro al cerrar editor
                if (codeLine !== null && !isNaN(codeLine) && window.codeMirrorEditor) {
                    window.codeMirrorEditor.removeLineClass(codeLine, 'background', 'highlighted-line');
                    window.codeMirrorEditor.removeLineClass(codeLine, 'background', 'editing');
                }
                
                console.log('[Edit Text] ✅ Editor y resaltado limpiados correctamente');
            } catch (cleanupError) {
                console.error('[Edit Text] Error limpiando editor:', cleanupError);
            }
        }
    };

    const handleKeydown = (e) => {
        if (e.key === 'Escape') {
            // Si se presiona Escape, se cancela la edición sin guardar.
            if (existingElement) {
                // Restaurar el texto original si existía
                const originalText = originalTexts[existingElement.id];
                if (typeof originalText !== 'undefined') {
                    existingElement.innerHTML = ''; // Limpiar antes de restaurar
                    const lines = originalText.split('\n');
                    lines.forEach((line, index) => {
                        const tspan = createSVGElement('tspan', {
                            x: existingElement.getAttribute('x'),
                            dy: index === 0 ? '0' : '1.2em',
                            textContent: line || ' '
                        });
                        existingElement.appendChild(tspan);
                    });
                }
                existingElement.style.visibility = 'visible';
            }
            scoreContainer.removeChild(editor);
            // Quitar los listeners para evitar que 'blur' se dispare y guarde
            editor.removeEventListener('blur', finishEditing);
            editor.removeEventListener('keydown', handleKeydown);
        }
        // La tecla Enter ahora se comporta de forma nativa (salto de línea).
        // El guardado se gestiona únicamente con el evento 'blur' (clic fuera).
    };

    editor.addEventListener('blur', finishEditing);
    editor.addEventListener('keydown', handleKeydown);
}

function addNewSymbol(symbolValue) {
    if (!symbolValue) return;

    const scoreContainer = document.querySelector('#score-output');
    if (!scoreContainer) return;

    const centerX = scoreContainer.clientWidth / 2;
    const centerY = scoreContainer.clientHeight / 2;

    const newSymbol = createSVGElement('text', {
        x: centerX,
        y: centerY,
        'font-family': 'Arial, sans-serif',
        'font-size': '32',
        'dominant-baseline': 'middle',
        'text-anchor': 'middle',
        'data-type': 'symbol',
        fill: 'var(--text)',
        textContent: symbolValue
    });

    finalizeNewElement(newSymbol);
    document.getElementById('symbol-select').value = ""; // Reset dropdown
}

function finalizeNewElement(el) {
    const annotationSVG = document.getElementById('annotation-svg');
    if (!annotationSVG) return;

    // Generar ID basado en contenido
    const textContent = el.textContent.trim();
    const baseId = textContent.replace(/\s+/g, '-').replace(/[^\w-]/g, '');
    const count = document.querySelectorAll(`[id^="${baseId}"]`).length;
    const id = `${baseId}-${count}`;
    el.id = id;
    
    // Estilos para el nuevo elemento
    el.style.transformOrigin = 'center';
    el.style.transformBox = 'fill-box';
    el.style.pointerEvents = 'auto'; // Hacer el elemento interactivo

    annotationSVG.appendChild(el);

    // Listener para seleccionar
    el.addEventListener('click', (e) => { 
        e.stopPropagation(); 
        selectElement(el); 
    });

    // Listener para re-editar
    el.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const scoreContainer = document.querySelector('#score-output');
        const containerRect = scoreContainer.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const points = {
            // Coordenadas SVG del elemento de texto en la capa de anotación
            svg: { x: parseFloat(el.getAttribute('x')), y: parseFloat(el.getAttribute('y')) },
            // Coordenadas de pantalla para posicionar el editor textarea
            screen: { x: elRect.left - containerRect.left, y: elRect.top - containerRect.top }
        };
        editTextInPlace(el, points);
    });

    interact(el).draggable({ inertia: true, listeners: { move: dragMoveListener, end: handleDragEnd } });

    edits[id] = { x: 0, y: 0, scale: 1.0 };
    saveState();
    selectElement(el);
    
    // NUEVO: Insertar código Python para el nuevo elemento
    insertPythonCodeForNewElement(el);
}

// ====== GENERAR E INSERTAR CÓDIGO PYTHON PARA ELEMENTOS NUEVOS ======
function insertPythonCodeForNewElement(el) {
    const id = el.id;
    const textContent = el.textContent.trim();
    const type = el.getAttribute('data-type') || 'text';
    const fontSize = el.getAttribute('font-size') || '20';
    const placement = type === 'symbol' ? 'above' : 'below';
    
    console.log(`[Python Insert] Generando código para elemento manual: "${textContent}" (ID: ${id})`);
    
    // Obtener código actual
    const code = window.getCodeEditorValue();
    const lines = code.split('\n');
    
    // ✅ OPCIÓN B: Insertar AL FINAL del código como overlay independiente
    // Buscar última línea no vacía
    let insertLine = lines.length;
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].trim()) {
            insertLine = i + 1;
            break;
        }
    }
    
    // Generar código Python para elemento overlay
    const varName = `overlay_${id.replace(/[^a-zA-Z0-9]/g, '_')}`;
    
    // Calcular posición absoluta desde transform actual
    const edit = edits[id] || { x: 0, y: 0 };
    const xPos = parseFloat(el.getAttribute('x')) + (edit.x || 0);
    const yPos = parseFloat(el.getAttribute('y')) + (edit.y || 0);
    
    const pythonCode = [
        ``,
        `# ═══ Elemento Manual Overlay ═══`,
        `${varName} = expressions.TextExpression("${textContent}")`,
        `${varName}.id = "${id}"`,
        `${varName}.placement = '${placement}'`,
        `${varName}.style.absoluteX = ${xPos}  # Posición X absoluta`,
        `${varName}.style.absoluteY = ${yPos}  # Posición Y absoluta`,
        `# Añadir a la última parte (overlay independiente)`,
        `if hasattr(score, 'parts') and len(score.parts) > 0:`,
        `    score.parts[-1].insert(0, ${varName})`
    ];
    
    // Insertar al final
    lines.splice(insertLine, 0, ...pythonCode);
    
    // Actualizar editor
    window.setCodeEditorValue(lines.join('\n'));
    
    console.log(`[Python Insert] ✅ Código overlay insertado al final para "${textContent}"`);
    console.log(`[Python Insert] Variable: ${varName}, Posición: (${xPos}, ${yPos})`);
    
    // Asignar data-codeLine al elemento para vinculación
    const newLineNumber = insertLine + 2; // Línea de TextExpression
    el.dataset.codeLine = newLineNumber;
    
    console.log(`[Python Insert] ✅ Elemento vinculado a línea ${newLineNumber}`);
}

// --- Manipulación de Elementos ---

function handleCopyPaste(e) {
    // Ignorar si estamos escribiendo en un input o textarea
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') {
        console.log('[Copy/Paste] Ignorado: dentro de input/textarea');
        return;
    }

    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const isCopy = (isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === 'c';
    const isPaste = (isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === 'v';

    console.log(`[Copy/Paste] Tecla: ${e.key}, metaKey: ${e.metaKey}, ctrlKey: ${e.ctrlKey}, isCopy: ${isCopy}, isPaste: ${isPaste}`);
    console.log(`[Copy/Paste] selectedElement: ${!!selectedElement}, selectedElements.size: ${selectedElements.size}`);

    // ✅ CORREGIDO: Verificar también selectedElements
    if (isCopy && (selectedElement || selectedElements.size > 0)) {
        e.preventDefault();
        console.log('[Copy/Paste] ✅ Ejecutando COPY');
        copySelectedElement();
    } else if (isPaste) {
        e.preventDefault();
        console.log('[Copy/Paste] ✅ Ejecutando PASTE');
        pasteFromClipboard();
    } else {
        console.log('[Copy/Paste] ❌ No se cumplieron condiciones para copy/paste');
    }
}

function copySelectedElement() {
    // ✅ MEJORADO: Copiar posiciones REALES de pantalla
    if (selectedElements.size > 0) {
        const elements = [];
        const containerRect = document.querySelector('#score-output').getBoundingClientRect();
        
        // Calcular centro del grupo
        let sumX = 0, sumY = 0;
        selectedElements.forEach(el => {
            const rect = el.getBoundingClientRect();
            sumX += (rect.left - containerRect.left);
            sumY += (rect.top - containerRect.top);
        });
        const centerX = sumX / selectedElements.size;
        const centerY = sumY / selectedElements.size;
        
        selectedElements.forEach(el => {
            let textContent;
            const tspans = el.querySelectorAll('tspan');
            if (tspans.length > 0) {
                textContent = Array.from(tspans).map(t => t.textContent).join('\n');
            } else {
                textContent = el.textContent;
            }
            
            const edit = edits[el.id] || { scale: 1.0 };
            const rect = el.getBoundingClientRect();
            const elX = rect.left - containerRect.left;
            const elY = rect.top - containerRect.top;
            
            elements.push({
                content: textContent,
                type: el.getAttribute('data-type') || 'text',
                fontSize: el.getAttribute('font-size') || '20',
                fontFamily: el.style.fontFamily || 'Times New Roman',
                scale: edit.scale || 1.0,
                isSymbol: el.classList.contains('symbol'),
                // ✅ Guardar offset RELATIVO al centro del grupo
                offsetX: elX - centerX,
                offsetY: elY - centerY
            });
        });
        
        clipboard = {
            isMultiple: true,
            elements: elements
        };
        
        console.log(`[Copy] ${elements.length} con offsets relativos al centro`);
        return;
    }
    
    // Copiar elemento individual (comportamiento original)
    if (!selectedElement || selectedElement.id === 'sheet-music-svg') return;

    let textContent;
    const tspans = selectedElement.querySelectorAll('tspan');
    if (tspans.length > 0) {
        textContent = Array.from(tspans).map(t => t.textContent).join('\n');
    } else {
        textContent = selectedElement.textContent;
    }

    const edit = edits[selectedElement.id] || {};

    clipboard = {
        isMultiple: false,
        content: textContent,
        type: selectedElement.getAttribute('data-type') || 'text',
        fontSize: selectedElement.getAttribute('font-size') || '20',
        fontFamily: selectedElement.style.fontFamily || 'Times New Roman',
        scale: edit.scale || 1.0,
        isSymbol: selectedElement.classList.contains('symbol')
    };
    
    console.log('[Copy] 1 elemento copiado');
}

function pasteFromClipboard() {
    if (!clipboard) return;

    const annotationSVG = document.getElementById('annotation-svg');
    const scoreContainer = document.querySelector('#score-output');
    if (!scoreContainer || !annotationSVG) return;

    // ✅ CORREGIDO: Usar coordenadas SVG correctas de la capa de anotación
    // Obtener el centro del contenedor en coordenadas de pantalla
    const containerRect = scoreContainer.getBoundingClientRect();
    const screenCenterX = containerRect.left + containerRect.width / 2;
    const screenCenterY = containerRect.top + containerRect.height / 2;
    
    // Convertir a coordenadas SVG usando el sistema de coordenadas de la capa de anotación
    const pt = annotationSVG.createSVGPoint();
    pt.x = screenCenterX;
    pt.y = screenCenterY;
    const svgCenter = pt.matrixTransform(annotationSVG.getScreenCTM().inverse());

    // ✅ MULTI-SELECCIÓN: Pegar con offsets relativos + offset base
    if (clipboard.isMultiple) {
        const newElements = [];
        
        // Limpiar selección anterior
        deselectAll();
        
        // Offset base pequeño (20px) para distinguir del original
        const pasteBaseX = 20;
        const pasteBaseY = 20;
        
        clipboard.elements.forEach(elementData => {
            const newElement = createSVGElement('text', {
                x: svgCenter.x,
                y: svgCenter.y,
                fill: 'var(--text)',
                'font-size': elementData.fontSize,
                'font-family': elementData.fontFamily,
                'data-type': elementData.type,
                'dominant-baseline': 'hanging'
            });

            if (elementData.isSymbol) {
                newElement.classList.add('symbol');
                newElement.setAttribute('text-anchor', 'middle');
                newElement.setAttribute('dominant-baseline', 'middle');
            }

            const lines = elementData.content.split('\n');
            if (lines.length > 1 && !elementData.isSymbol) {
                lines.forEach((line, index) => {
                    const tspan = createSVGElement('tspan', {
                        x: svgCenter.x,
                        dy: index === 0 ? '0' : '1.2em',
                        textContent: line || ' '
                    });
                    newElement.appendChild(tspan);
                });
            } else {
                newElement.textContent = elementData.content;
            }

            finalizeNewElement(newElement);

            // ✅ Usar offsets relativos + offset base
            const id = newElement.id;
            edits[id].scale = elementData.scale; // Preservar escala
            edits[id].x = elementData.offsetX + pasteBaseX; // Offset relativo + base
            edits[id].y = elementData.offsetY + pasteBaseY;
            applyTransform(newElement);
            
            newElements.push(newElement);
        });
        
        // ✅ NUEVO: Seleccionar automáticamente los elementos pegados
        newElements.forEach(el => {
            selectedElements.add(el);
            el.classList.add('multi-selected');
        });
        
        // Mostrar paleta y bounding box
        showMultipleSelectionPalette();
        
        saveState();
        console.log(`[Paste] ${newElements.length} elemento(s) pegado(s) y auto-seleccionados para mover juntos`);
        return;
    }

    // ✅ ELEMENTO INDIVIDUAL: Pegar en el centro con offset pequeño
    const newElement = createSVGElement('text', {
        x: svgCenter.x,
        y: svgCenter.y,
        fill: 'var(--text)',
        'font-size': clipboard.fontSize,
        'font-family': clipboard.fontFamily,
        'data-type': clipboard.type,
        'dominant-baseline': 'hanging'
    });

    if (clipboard.isSymbol) {
        newElement.classList.add('symbol');
        newElement.setAttribute('text-anchor', 'middle');
        newElement.setAttribute('dominant-baseline', 'middle');
    }

    const lines = clipboard.content.split('\n');
    if (lines.length > 1 && !clipboard.isSymbol) {
        lines.forEach((line, index) => {
            const tspan = createSVGElement('tspan', {
                x: svgCenter.x,
                dy: index === 0 ? '0' : '1.2em',
                textContent: line || ' '
            });
            newElement.appendChild(tspan);
        });
    } else {
        newElement.textContent = clipboard.content;
    }

    finalizeNewElement(newElement);

    // ✅ Offset pequeño (20px) para distinguir del original
    const id = newElement.id;
    edits[id].scale = clipboard.scale;
    edits[id].x = 20;
    edits[id].y = 20;
    applyTransform(newElement);
    saveState();
    
    console.log('[Paste] 1 elemento pegado con offset de 20px');
}

function deleteSelectedElement() {
    if (!selectedElement || selectedElement.id === 'sheet-music-svg') return;
    
    // IMPORTANTE: Guardar ID ANTES de deselectAll() que lo pone a null
    const deletedId = selectedElement.id;
    
    deletions.add(deletedId);
    selectedElement.style.display = 'none';
    deselectAll();
    saveState();
    
    // NUEVO: Actualizar código Python para comentar el elemento borrado
    const codeEditor = document.getElementById('code-editor');
    if (codeEditor && typeof window.updateDeletionsInPython === 'function') {
        // Crear un Set temporal con solo este ID
        const tempDeletions = new Set([deletedId]);
        window.updateDeletionsInPython(tempDeletions);
    }
}

function updateScale(factor) {
    if (!selectedElement) return;
    const id = selectedElement.id;
    const edit = edits[id] || { x: 0, y: 0, scale: 1.0 };

    // Simplemente actualiza el factor de escala. 
    // 'transform-origin' se encarga de que el escalado sea desde el centro.
    edit.scale = (edit.scale || 1.0) * factor;
    
    edits[id] = edit;
    applyTransform(selectedElement);
    updateEditPalettePosition(); // Actualizar paleta tras escalar
    saveState();
    
    // NUEVO: Actualizar código Python si es un texto OSMD
    if (selectedElement.tagName === 'text' && typeof window.updatePythonCode === 'function') {
        window.updatePythonCode(selectedElement);
    }
    
    // ✅ FIX: Mantener resaltado al escalar
    if (selectedElement.dataset && selectedElement.dataset.codeLine !== undefined) {
        const lineNumber = parseInt(selectedElement.dataset.codeLine);
        highlightCodeLine(lineNumber, false);
    }
}

function applyFont(fontFamily) {
    if (!selectedElement || selectedElement.tagName !== 'text') return;
    selectedElement.style.fontFamily = fontFamily;
}

function applyTransform(target) {
    const edit = edits[target.id] || {};
    const x = edit.x || 0;
    const y = edit.y || 0;
    const scale = edit.scale || 1.0;
    target.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
}

// Exponer applyTransform globalmente
window.applyTransform = applyTransform;

// Exponer getDeletions globalmente
window.getDeletions = function() {
    return deletions;
};

function dragMoveListener(event) {
    const target = event.target;
    
    // NUEVO: Si el elemento arrastrado está en selección múltiple, mover todos
    if (selectedElements.has(target) && selectedElements.size > 1) {
        selectedElements.forEach(el => {
            const id = el.id;
            if (!edits[id]) edits[id] = { x: 0, y: 0, xTenths: 0, yTenths: 0, scale: 1.0 };
            
            // Aplicar mismo movimiento a todos
            edits[id].x = (edits[id].x || 0) + event.dx;
            edits[id].y = (edits[id].y || 0) + event.dy;
            edits[id].xTenths = pxToTenths(edits[id].x);
            edits[id].yTenths = pxToTenths(edits[id].y);
            
            applyTransform(el);
        });
        
        // Actualizar paleta si está visible
        if (editPalette && editPalette.style.display === 'flex') {
            showMultipleSelectionPalette();
        }
        
        // ✅ NUEVO: Forzar repaint para evitar ghosting en empaquetado
        requestAnimationFrame(() => {
            selectedElements.forEach(el => {
                el.style.transform = el.style.transform;
            });
        });
        
        console.log(`[Multi-Select] Movidos ${selectedElements.size} elemento(s) juntos`);
        return;
    }
    
    // Movimiento individual (comportamiento original)
    const id = target.id;
    if (!edits[id]) edits[id] = { x: 0, y: 0, xTenths: 0, yTenths: 0, scale: 1.0 };
    
    // Guardar en px (para transform CSS)
    edits[id].x = (edits[id].x || 0) + event.dx;
    edits[id].y = (edits[id].y || 0) + event.dy;
    
    // Guardar también en tenths (para persistencia en MusicXML)
    edits[id].xTenths = pxToTenths(edits[id].x);
    edits[id].yTenths = pxToTenths(edits[id].y);
    
    // NUEVO: Calcular y guardar offset relativo al compás
    if (target.tagName === 'text' && typeof window.calculateRelativeOffset === 'function') {
        const relativeData = window.calculateRelativeOffset(target);
        if (relativeData) {
            edits[id].measureNumber = relativeData.measureNumber;
            edits[id].offsetX = relativeData.offsetX;
            edits[id].offsetY = relativeData.offsetY;
            console.log(`[Offset Relativo] "${target.textContent.trim()}" → Compás ${relativeData.measureNumber}, offset (${relativeData.offsetX}, ${relativeData.offsetY})`);
        }
    }
    
    applyTransform(target);
    
    // ✅ NUEVO: Forzar repaint para evitar ghosting en empaquetado
    requestAnimationFrame(() => {
        target.style.transform = target.style.transform;
    });

    // Reposicionar la paleta de edición durante el arrastre
    if (target === selectedElement) {
        updateEditPalettePosition();
    }
}

function handleDragEnd(event) {
    saveState();
    saveToLocalStorage();
    
    // ✅ UNIVERSAL: Actualizar Python para CUALQUIER texto movido
    const target = event ? event.target : selectedElement;
    
    if (target && target.tagName === 'text' && typeof window.updatePythonCode === 'function') {
        window.updatePythonCode(target);
        console.log(`[handleDragEnd] ✅ Python actualizado para "${target.textContent.trim()}"`);
    }
    
    // Si hay multi-selección, actualizar Python para TODOS
    if (selectedElements.size > 0) {
        selectedElements.forEach(el => {
            if (el.tagName === 'text' && typeof window.updatePythonCode === 'function') {
                window.updatePythonCode(el);
                console.log(`[handleDragEnd Multi] ✅ Python actualizado para "${el.textContent.trim()}"`);
            }
        });
    }
}

// --- Guardado y Persistencia ---
// (Las funciones saveAndDownload, downloadXML, saveVisualChanges son las mismas de antes)
async function saveAndDownload() {
  if (!lastLoadedXML) { alert('No se ha cargado ningún MusicXML.'); return; }
  const editsToSend = {};
  const additions = [];
  for (const id in edits) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (id.startsWith('new-element-')) {
      additions.push({
        id: id, type: el.getAttribute('data-type') || 'text', content: el.textContent,
        x: edits[id].x || 0, y: edits[id].y || 0, scale: edits[id].scale || 1.0,
        fontFamily: el.style.fontFamily || 'Times New Roman'
      });
    } else { editsToSend[id] = edits[id]; }
  }
  const payload = {
    xml_content: lastLoadedXML, edits: editsToSend,
    deletions: Array.from(deletions), additions: additions
  };
  try {
    const resp = await fetch('/apply-edits', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    if (!resp.ok) throw new Error(`El servidor respondió con: ${resp.status}`);
    const modifiedXml = await resp.text();
    downloadXML('partitura_modificada.musicxml', modifiedXml);
  } catch (err) { console.error('Error al guardar:', err); alert(`Error: ${err.message}`); }
}
function saveVisualChanges() { alert('Cambios visuales guardados en la sesión.'); }
function downloadXML(filename, xmlString) {
  const blob = new Blob([xmlString], { type: 'application/vnd.recordare.musicxml+xml; charset=utf-t' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a);
  a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

// --- Persistencia LocalStorage ---
function saveToLocalStorage() {
    const data = {
        edits: edits,
        deletions: Array.from(deletions),
        timestamp: Date.now()
    };
    try {
        localStorage.setItem('scoreEdits', JSON.stringify(data));
        console.log('[Persistencia] Ediciones guardadas en LocalStorage');
    } catch (e) {
        console.warn('[Persistencia] Error guardando en LocalStorage:', e);
    }
}

function loadFromLocalStorage() {
    try {
        const data = JSON.parse(localStorage.getItem('scoreEdits'));
        if (data) {
            edits = data.edits || {};
            window.edits = edits; // Sincronizar con window
            deletions = new Set(data.deletions || []);
            console.log('[Persistencia] Ediciones cargadas desde LocalStorage');
            return true;
        }
    } catch (e) {
        console.warn('[Persistencia] Error cargando desde LocalStorage:', e);
    }
    return false;
}

function clearLocalStorage() {
    localStorage.removeItem('scoreEdits');
    console.log('[Persistencia] LocalStorage limpiado');
}

// --- Historial (Undo/Redo) ---
function saveState() {
  if (historyIndex < history.length - 1) history = history.slice(0, historyIndex + 1);
  const currentState = {
    edits: JSON.parse(JSON.stringify(edits)),
    deletions: new Set(Array.from(deletions))
    // Nota: La recreación de elementos nuevos en undo/redo no está implementada.
  };
  history.push(currentState);
  historyIndex++;
  updateUndoRedoButtons();
}
function restoreState(state) {
  edits = JSON.parse(JSON.stringify(state.edits));
  window.edits = edits; // Sincronizar con window
  deletions = new Set(Array.from(state.deletions));
  
  // ✅ CORREGIDO: Incluir elementos de OSMD Y anotaciones
  const allElements = document.querySelectorAll('#osmd-container text, #annotation-svg text, #sheet-music-svg');
  
  allElements.forEach(el => {
    if (deletions.has(el.id)) {
        el.style.display = 'none';
    } else {
        el.style.display = '';
        applyTransform(el);

        // Restaurar contenido de texto si es un elemento de texto
        if (el.tagName === 'text') {
            const edit = edits[el.id];
            if (edit && typeof edit.textContent !== 'undefined') {
                el.textContent = edit.textContent;
            } else if (originalTexts.hasOwnProperty(el.id)) {
                // Si no hay edición de texto en este estado, volver al original
                el.textContent = originalTexts[el.id];
            }
        }
    }
  });
  
  // ✅ Limpiar selección múltiple si existe
  clearMultipleSelection();
  
  updateUndoRedoButtons();
  console.log('[Undo/Redo] Estado restaurado correctamente');
}
function undo() { if (historyIndex > 0) { historyIndex--; restoreState(history[historyIndex]); } }
function redo() { if (historyIndex < history.length - 1) { historyIndex++; restoreState(history[historyIndex]); } }
function updateUndoRedoButtons() {
    document.getElementById('undo-btn').disabled = historyIndex <= 0;
    document.getElementById('redo-btn').disabled = historyIndex >= history.length - 1;
}
function resetAndSaveInitialState() {
    // NO resetear si ya hay ediciones guardadas
    if (Object.keys(edits).length > 0) {
        console.log('[Persistencia] Manteniendo ediciones existentes, no resetear');
        return;
    }
    
    edits = {}; 
    window.edits = edits; // Sincronizar con window
    deletions.clear(); 
    history = []; 
    historyIndex = -1;
    newElementCounter = 0; 
    saveState();
}

// --- Utilidades ---
function getAnnotationSVGCoordinates(event) {
    const annotationSVG = document.getElementById('annotation-svg');
    if (!annotationSVG) return { x: 0, y: 0 };
    const pt = annotationSVG.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    return pt.matrixTransform(annotationSVG.getScreenCTM().inverse());
}

function dragToolbarListener(event) {
    const target = event.target;
    const x = (parseFloat(target.getAttribute('data-x')) || 0) + event.dx;
    const y = (parseFloat(target.getAttribute('data-y')) || 0) + event.dy;
    target.style.transform = `translate(${x}px, ${y}px)`;
    target.setAttribute('data-x', x); target.setAttribute('data-y', y);
}
function getSVGCoordinates(event) {
    const mainSVG = document.getElementById('sheet-music-svg');
    const pt = mainSVG.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    return pt.matrixTransform(mainSVG.getScreenCTM().inverse());
}
function createSVGElement(tag, attributes) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const key in attributes) {
        if (key === 'textContent') el.textContent = attributes[key];
        else el.setAttribute(key, attributes[key]);
    }
    return el;
}

// ====== EXPORTACIÓN XML CON EDICIONES ======
document.getElementById('save-btn')?.addEventListener('click', async () => {
  // ✅ CRÍTICO: Usar código actualizado del editor (con símbolos manuales)
  const code = window.getCodeEditorValue();
  
  if (!code.trim()) {
    alert('No hay código para exportar');
    return;
  }
  
  try {
    console.log('[Export XML] Intentando usar API nativa...');
    console.log(`[Export XML] Código a exportar: ${code.length} caracteres`);
    
    // Esperar a que pywebview se inicialice (importante en app empaquetada)
    let attempts = 0;
    while (attempts < 10 && (typeof pywebview === 'undefined' || typeof pywebview.api === 'undefined')) {
      console.log(`[Export XML] Esperando pywebview... intento ${attempts + 1}`);
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }
    
    if (typeof pywebview === 'undefined' || typeof pywebview.api === 'undefined') {
      throw new Error('pywebview API no disponible. Reinicia la aplicación.');
    }
    
    // Usar API nativa de pywebview (diálogo nativo de guardado)
    console.log('[Export XML] ✅ API disponible, llamando a save_xml_file...');
    const result = await pywebview.api.save_xml_file(code);
    
    if (result.success) {
      console.log(`[Export XML] ✅ Archivo guardado: ${result.filepath}`);
      alert(`✅ Archivo guardado correctamente en:\n${result.filepath}`);
    } else {
      if (result.error === 'Guardado cancelado') {
        console.log('[Export XML] Usuario canceló guardado');
      } else {
        console.error('[Export XML] ❌ Error:', result.error);
        alert(`Error al exportar XML:\n${result.error}`);
      }
    }
    
  } catch (err) {
    console.error('[Export XML] ❌ Error fatal:', err);
    alert(`Error al exportar XML:\n${err.message}\n\nPor favor, reinicia la aplicación.`);
  }
});

// ====== EXPORTACIÓN DE IMÁGENES (PNG/SVG) ======
async function exportAsPNG() {
  const svg = document.querySelector('#osmd-container svg');
  if (!svg) {
    alert('No hay partitura para exportar');
    return;
  }
  
  // Clonar SVG y serializarlo
  const svgClone = svg.cloneNode(true);
  const svgData = new XMLSerializer().serializeToString(svgClone);
  const svgBlob = new Blob([svgData], {type: 'image/svg+xml;charset=utf-8'});
  
  // Crear imagen desde SVG
  const img = new Image();
  const url = URL.createObjectURL(svgBlob);
  
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = svg.getBoundingClientRect().width * 2; // 2x para calidad
    canvas.height = svg.getBoundingClientRect().height * 2;
    
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    
    canvas.toBlob(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'partitura.png';
      a.click();
      URL.revokeObjectURL(url);
      console.log('[Export PNG] Imagen descargada');
    });
  };
  
  img.src = url;
}

function exportAsSVG() {
  const svg = document.querySelector('#osmd-container svg');
  if (!svg) {
    alert('No hay partitura para exportar');
    return;
  }
  
  const svgData = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([svgData], {type: 'image/svg+xml;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'partitura.svg';
  a.click();
  URL.revokeObjectURL(url);
  console.log('[Export SVG] Imagen descargada');
}

// Event listener para el selector de exportación de imágenes
document.getElementById('export-image-select')?.addEventListener('change', (e) => {
  const format = e.target.value;
  if (format === 'png') exportAsPNG();
  else if (format === 'svg') exportAsSVG();
  e.target.value = ''; // Reset select
});

// ====== SELECTOR DE COLOR PARA NOTAS ======
let selectedNoteElement = null;
let noteColors = {}; // Almacenar colores de notas: { "lyric_id": "color" }

// Hacer notas clicables para aplicar color Y editar pitch
function makeNotesClickable() {
  const svg = document.querySelector('#osmd-container svg');
  if (!svg) return;
  
  // Seleccionar todas las cabezas de nota (ellipse para notas normales, path para algunas figuras)
  const noteHeads = svg.querySelectorAll('ellipse, path[d*="M"]');
  
  noteHeads.forEach(noteHead => {
    noteHead.style.cursor = 'pointer';
    
    // ✅ CLICK SIMPLE: Seleccionar para cambiar color Y resaltar código
    noteHead.addEventListener('click', (e) => {
      e.stopPropagation();
      
      // Deseleccionar anterior
      if (selectedNoteElement) {
        selectedNoteElement.style.outline = '';
      }
      
      // Seleccionar nueva
      selectedNoteElement = noteHead;
      selectedNoteElement.style.outline = '2px solid #0066ff';
      
      // ✅ CRÍTICO: Buscar lyric más cercano para obtener línea de código
      const closestLyric = findClosestLyricToNote(noteHead);
      if (closestLyric && closestLyric.dataset && closestLyric.dataset.codeLine !== undefined) {
        const lyricLine = parseInt(closestLyric.dataset.codeLine);
        
        // Buscar hacia ARRIBA la línea note.Note
        const code = window.getCodeEditorValue();
        const lines = code.split('\n');
        
        for (let i = lyricLine; i >= Math.max(0, lyricLine - 5); i--) {
          if (lines[i].includes('note.Note(')) {
            if (typeof highlightCodeLine === 'function') {
              highlightCodeLine(i, false);
              console.log(`[Note Click] ✅ Resaltada línea ${i} para nota (desde lyric línea ${lyricLine})`);
            }
            break;
          }
        }
      } else {
        console.log('[Note Click] ⚠️ No se encontró lyric cercano para resaltar');
      }
      
      console.log('[Color] Nota seleccionada');
    });
    
    // ✅ DOBLE CLICK: Editar pitch de la nota
    noteHead.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      
      // Buscar el lyric más cercano para inferir la nota actual
      const currentPitch = inferNotePitchFromPosition(noteHead);
      
      showNoteEditInput(noteHead, currentPitch);
      console.log('[Note Edit] Iniciando edición de nota');
    });
  });
  
  console.log(`[Color] ${noteHeads.length} nota(s) ahora clicables (click = color, doble click = editar)`);
}

// ✅ MEJORADO: Buscar la línea de note.Note asociada al lyric
function inferNotePitchFromPosition(noteHead) {
  try {
    // Buscar el lyric más cercano
    const closestLyric = findClosestLyricToNote(noteHead);
    
    if (closestLyric && closestLyric.dataset && closestLyric.dataset.codeLine !== undefined) {
      const lyricLine = parseInt(closestLyric.dataset.codeLine);
      const code = window.getCodeEditorValue();
      const lines = code.split('\n');
      
      // Buscar hacia ARRIBA desde el lyric la línea note.Note
      for (let i = lyricLine; i >= Math.max(0, lyricLine - 5); i--) {
        const line = lines[i];
        
        // Extraer pitch: note.Note("D4", ...)
        const match = line.match(/note\.Note\s*\(\s*["']([A-G][#b]?-?\d+)["']/);
        if (match) {
          const pitch = match[1];
          console.log(`[Note Inference] ✅ Pitch encontrado en línea ${i}: ${pitch}`);
          
          // ✅ GUARDAR línea para actualización posterior
          noteHead.dataset.noteCodeLine = i;
          
          return pitch;
        }
      }
    }
    
    console.warn(`[Note Inference] ⚠️ No se pudo detectar pitch`);
  } catch (e) {
    console.error('[Note Inference] ❌ Error:', e);
  }
  
  return 'C5'; // Fallback
}

// ✅ NUEVO: Detectar número de compás usando barlines
function detectMeasureNumber(noteHead) {
    const svg = document.querySelector('#osmd-container svg');
    if (!svg) return 1;
    
    try {
        const noteRect = noteHead.getBoundingClientRect();
        const noteX = noteRect.left + noteRect.width / 2;
        
        // Buscar todas las barlines (líneas verticales que marcan compases)
        const barlines = Array.from(svg.querySelectorAll('path')).filter(path => {
            const d = path.getAttribute('d') || '';
            // Barlines típicamente son paths verticales: "M x y1 L x y2"
            return /^M\s*[\d.]+\s+[\d.]+\s+L\s*[\d.]+\s+[\d.]+$/.test(d);
        });
        
        // Ordenar barlines por posición X
        barlines.sort((a, b) => {
            const aX = a.getBoundingClientRect().left;
            const bX = b.getBoundingClientRect().left;
            return aX - bX;
        });
        
        // Contar cuántas barlines hay a la IZQUIERDA de la nota
        let measureNumber = 1; // Primer compás = 1
        for (const barline of barlines) {
            const barlineX = barline.getBoundingClientRect().left;
            if (barlineX < noteX) {
                measureNumber++;
            } else {
                break;
            }
        }
        
        console.log(`[Measure Detection] Nota en compás ${measureNumber} (barlines a la izquierda: ${measureNumber - 1})`);
        return measureNumber;
        
    } catch (e) {
        console.error('[Measure Detection] Error:', e);
        return 1;
    }
}

// ✅ NUEVO: Contar posición de nota dentro del compás
function countNotePositionInMeasure(noteHead, measureNumber) {
    const svg = document.querySelector('#osmd-container svg');
    if (!svg) return 1;
    
    try {
        const noteRect = noteHead.getBoundingClientRect();
        const noteX = noteRect.left + noteRect.width / 2;
        
        // Buscar todas las notas (ellipses) en el compás
        const allNotes = Array.from(svg.querySelectorAll('ellipse, path[d*="M"]'));
        
        // Detectar límites del compás usando barlines
        const barlines = Array.from(svg.querySelectorAll('path')).filter(path => {
            const d = path.getAttribute('d') || '';
            return /^M\s*[\d.]+\s+[\d.]+\s+L\s*[\d.]+\s+[\d.]+$/.test(d);
        }).sort((a, b) => {
            return a.getBoundingClientRect().left - b.getBoundingClientRect().left;
        });
        
        // Límites X del compás actual
        const measureStartX = measureNumber > 1 ? barlines[measureNumber - 2].getBoundingClientRect().left : 0;
        const measureEndX = measureNumber <= barlines.length ? barlines[measureNumber - 1].getBoundingClientRect().left : Infinity;
        
        // Filtrar notas dentro del compás y ordenar por X
        const notesInMeasure = allNotes.filter(note => {
            const noteX = note.getBoundingClientRect().left;
            return noteX >= measureStartX && noteX < measureEndX;
        }).sort((a, b) => {
            return a.getBoundingClientRect().left - b.getBoundingClientRect().left;
        });
        
        // Encontrar posición de nuestra nota
        const position = notesInMeasure.indexOf(noteHead) + 1;
        
        console.log(`[Note Position] Nota en posición ${position} de ${notesInMeasure.length} en compás ${measureNumber}`);
        return position || 1;
        
    } catch (e) {
        console.error('[Note Position] Error:', e);
        return 1;
    }
}

// ✅ NUEVO: Mostrar input para editar nota
function showNoteEditInput(noteHead, currentPitch) {
  const scoreContainer = document.querySelector('#score-output');
  if (!scoreContainer) return;
  
  // Crear input si no existe
  if (!liveEditInput) {
    liveEditInput = document.createElement('input');
    liveEditInput.type = 'text';
    liveEditInput.style.cssText = `
      position: absolute;
      background: #fff;
      color: #000;
      border: 2px solid #667eea;
      font-size: 18px;
      padding: 8px 12px;
      z-index: 3000;
      border-radius: 4px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      font-family: monospace;
      width: 80px;
      text-align: center;
    `;
    scoreContainer.appendChild(liveEditInput);
  }
  
  // Posicionar sobre la nota
  const noteRect = noteHead.getBoundingClientRect();
  const containerRect = scoreContainer.getBoundingClientRect();
  liveEditInput.style.left = `${noteRect.left - containerRect.left - 20}px`;
  liveEditInput.style.top = `${noteRect.top - containerRect.top - 40}px`;
  
  // Valor inicial
  liveEditInput.value = currentPitch;
  liveEditInput.style.display = 'block';
  liveEditInput.focus();
  liveEditInput.select();
  
  // Guardar referencia a la nota
  liveEditInput.noteHead = noteHead;
  liveEditInput.originalPitch = currentPitch;
  
  // Listeners
  liveEditInput.oninput = () => handleNoteEdit(noteHead, currentPitch);
  liveEditInput.onblur = () => finishNoteEdit(noteHead, currentPitch);
  liveEditInput.onkeydown = (e) => {
    if (e.key === 'Enter') {
      liveEditInput.blur();
    } else if (e.key === 'Escape') {
      liveEditInput.value = currentPitch;
      liveEditInput.blur();
    }
  };
}

// ✅ MEJORADO: Actualizar código Python EN TIEMPO REAL mientras escribe
async function handleNoteEdit(noteHead, originalPitch) {
  const newPitch = liveEditInput.value.trim();
  
  // Validar formato de nota (ej: C4, G#5, Db3)
  const valid = /^[A-G][#b]?\d+$/.test(newPitch);
  
  if (!valid && newPitch !== '') {
    liveEditInput.style.borderColor = '#ff0000';
    liveEditInput.style.background = '#ffe6e6';
    return;
  }
  
  // Válido → Resetear estilos
  liveEditInput.style.borderColor = '#667eea';
  liveEditInput.style.background = '#fff';
  
  // ✅ ACTUALIZAR CÓDIGO PYTHON EN TIEMPO REAL
  if (newPitch && noteHead.dataset.noteCodeLine) {
    const lineNumber = parseInt(noteHead.dataset.noteCodeLine);
    updateNotePitchInCode(lineNumber, newPitch);
  }
}

// ✅ NUEVO: Actualizar pitch en el código
function updateNotePitchInCode(lineNumber, newPitch) {
  const code = window.getCodeEditorValue();
  const lines = code.split('\n');
  
  if (lineNumber >= 0 && lineNumber < lines.length) {
    // Reemplazar pitch: note.Note("D4", ...) → note.Note("E5", ...)
    lines[lineNumber] = lines[lineNumber].replace(
      /note\.Note\s*\(\s*["']([A-G][#b]?-?\d+)["']/,
      `note.Note("${newPitch}"`
    );
    
    window.setCodeEditorValue(lines.join('\n'));
    console.log(`[Note Edit] ✅ Código actualizado en línea ${lineNumber}: ${newPitch}`);
  }
}

// ✅ NUEVO: Finalizar edición de nota
function finishNoteEdit(noteHead, originalPitch) {
  if (!liveEditInput) return;
  
  const newPitch = liveEditInput.value.trim();
  
  // Validar formato básico
  const valid = /^[A-G][#b]?\d+$/.test(newPitch);
  
  if (!valid || newPitch === originalPitch) {
    liveEditInput.style.display = 'none';
    console.log('[Note Edit] Edición cancelada o sin cambios');
    return;
  }
  
  // ✅ NUEVO: Guardar color si la nota ya tiene uno aplicado
  const currentColor = noteHead.getAttribute('fill');
  const closestLyric = findClosestLyricToNote(noteHead);
  let lyricId = null;
  
  if (closestLyric && closestLyric.id) {
    lyricId = closestLyric.id;
    if (currentColor && currentColor !== 'currentColor' && currentColor !== 'black') {
      noteColors[lyricId] = currentColor;
      console.log(`[Note Color] 💾 Color guardado: ${lyricId} → ${currentColor}`);
    }
  }
  
  // Buscar la línea de código asociada a esta nota
  if (closestLyric && closestLyric.dataset.codeLine) {
    const lyricLine = parseInt(closestLyric.dataset.codeLine);
    const code = window.getCodeEditorValue();
    const lines = code.split('\n');
    
    // Buscar hacia arriba la declaración de la nota
    for (let i = lyricLine; i >= Math.max(0, lyricLine - 5); i--) {
      if (lines[i].includes('note.Note(')) {
        // Actualizar el pitch en el código
        lines[i] = lines[i].replace(
          /note\.Note\(["'][A-G][#b]?\d+["']/,
          `note.Note("${newPitch}"`
        );
        
        window.setCodeEditorValue(lines.join('\n'));
        console.log(`[Note Edit] ✅ Nota actualizada: ${originalPitch} → ${newPitch} (línea ${i})`);
        
        // Regenerar partitura
        const renderBtn = document.getElementById('render-btn');
        if (renderBtn) {
          // ✅ Regenerar y restaurar colores después
          setTimeout(() => {
            renderBtn.click();
            // Esperar a que termine el render para restaurar colores
            setTimeout(() => restoreNoteColors(), 500);
          }, 100);
        }
        
        break;
      }
    }
  } else {
    console.warn('[Note Edit] ⚠️ No se pudo encontrar la línea de código de la nota');
    alert('No se pudo actualizar la nota. Asegúrate de que la nota tiene un lyric asociado.');
  }
  
  liveEditInput.style.display = 'none';
}

// ✅ NUEVO: Restaurar colores de notas después de regenerar
function restoreNoteColors() {
  if (Object.keys(noteColors).length === 0) {
    console.log('[Note Color] No hay colores guardados para restaurar');
    return;
  }
  
  console.log(`[Note Color] 🎨 Restaurando ${Object.keys(noteColors).length} color(es)...`);
  
  // Para cada lyric con color guardado
  Object.keys(noteColors).forEach(lyricId => {
    const color = noteColors[lyricId];
    const lyric = document.getElementById(lyricId);
    
    if (lyric) {
      // Buscar la nota más cercana a este lyric
      const noteHead = findNoteHeadFromLyric(lyric);
      
      if (noteHead) {
        noteHead.setAttribute('fill', color);
        console.log(`[Note Color] ✅ Color restaurado: ${lyricId} → ${color}`);
      } else {
        console.warn(`[Note Color] ⚠️ No se encontró nota para lyric ${lyricId}`);
      }
    } else {
      console.warn(`[Note Color] ⚠️ Lyric ${lyricId} no encontrado después de render`);
    }
  });
}

// ✅ NUEVO: Encontrar cabeza de nota desde un lyric
function findNoteHeadFromLyric(lyric) {
  const svg = document.querySelector('#osmd-container svg');
  if (!svg) return null;
  
  try {
    const lyricRect = lyric.getBoundingClientRect();
    const lyricX = lyricRect.left + lyricRect.width / 2;
    const lyricY = lyricRect.top;
    
    // Buscar ellipses (cabezas de nota) ARRIBA del lyric
    const noteHeads = svg.querySelectorAll('ellipse, path[d*="M"]');
    let closestNote = null;
    let minDistance = Infinity;
    
    noteHeads.forEach(noteHead => {
      const noteRect = noteHead.getBoundingClientRect();
      const noteX = noteRect.left + noteRect.width / 2;
      const noteY = noteRect.top + noteRect.height / 2;
      
      // Solo considerar notas ARRIBA del lyric (Y menor)
      if (noteY < lyricY) {
        const distance = Math.sqrt(
          Math.pow(lyricX - noteX, 2) +
          Math.pow(lyricY - noteY, 2)
        );
        
        if (distance < minDistance) {
          minDistance = distance;
          closestNote = noteHead;
        }
      }
    });
    
    return closestNote;
  } catch (e) {
    console.warn('[Find Note] Error:', e);
    return null;
  }
}

// ✅ NUEVO: Encontrar el lyric más cercano a una nota
function findClosestLyricToNote(noteHead) {
  const svg = document.querySelector('#osmd-container svg');
  if (!svg) return null;
  
  try {
    const noteRect = noteHead.getBoundingClientRect();
    const noteY = noteRect.top + noteRect.height / 2;
    const noteX = noteRect.left + noteRect.width / 2;
    
    const lyrics = svg.querySelectorAll('text');
    let closestLyric = null;
    let minDistance = Infinity;
    
    lyrics.forEach(lyric => {
      // Solo considerar elementos con data-codeLine (lyrics del código)
      if (!lyric.dataset.codeLine) return;
      
      const lyricRect = lyric.getBoundingClientRect();
      const lyricY = lyricRect.top;
      const lyricX = lyricRect.left + lyricRect.width / 2;
      
      // Solo considerar lyrics debajo de la nota
      if (lyricY > noteY) {
        const distance = Math.sqrt(
          Math.pow(noteX - lyricX, 2) +
          Math.pow(noteY - lyricY, 2)
        );
        
        if (distance < minDistance) {
          minDistance = distance;
          closestLyric = lyric;
        }
      }
    });
    
    return closestLyric;
  } catch (e) {
    console.warn('[Find Lyric] Error:', e);
    return null;
  }
}

// Aplicar color a nota O texto seleccionado O multi-selección
document.getElementById('color-select')?.addEventListener('change', (e) => {
  const color = e.target.value;
  
  if (!color) return;
  
  // PRIORIDAD 1: Nota seleccionada (de makeNotesClickable)
  if (selectedNoteElement) {
    selectedNoteElement.setAttribute('fill', color);
    selectedNoteElement.style.outline = '';
    
    // ✅ NUEVO: Guardar color para persistencia
    const closestLyric = findClosestLyricToNote(selectedNoteElement);
    if (closestLyric && closestLyric.id) {
      noteColors[closestLyric.id] = color;
      console.log(`[Color] 💾 Color guardado para persistencia: ${closestLyric.id} → ${color}`);
    }
    
    selectedNoteElement = null;
    console.log(`[Color] Aplicado a nota: ${color}`);
  }
  // PRIORIDAD 2: Multi-selección (múltiples textos)
  else if (selectedElements.size > 0) {
    selectedElements.forEach(el => {
      if (el.tagName === 'text') {
        el.setAttribute('fill', color);
      }
    });
    console.log(`[Color] Aplicado a ${selectedElements.size} elemento(s): ${color}`);
  }
  // PRIORIDAD 3: Elemento de texto seleccionado individual
  else if (selectedElement && selectedElement.tagName === 'text') {
    selectedElement.setAttribute('fill', color);
    console.log(`[Color] Aplicado a texto "${selectedElement.textContent.trim()}": ${color}`);
  } 
  else {
    alert('Selecciona una nota o texto primero haciendo clic en ella');
  }
  
  e.target.value = ''; // Reset select
});

// Exponer función globalmente
window.makeNotesClickable = makeNotesClickable;

// ====== SELECCIÓN MÚLTIPLE CON DRAG ======
function initMultipleSelection(scoreContainer) {
    // Crear div para rectángulo de selección
    selectionBox = document.createElement('div');
    selectionBox.id = 'selection-box';
    selectionBox.style.cssText = `
        position: absolute;
        border: 2px dashed #0066ff;
        background: rgba(0, 102, 255, 0.1);
        pointer-events: none;
        display: none;
        z-index: 1000;
    `;
    scoreContainer.appendChild(selectionBox);
    
    // Event listeners para drag de selección
    scoreContainer.addEventListener('mousedown', startSelection);
    document.addEventListener('mousemove', updateSelection);
    document.addEventListener('mouseup', endSelection);
    
    console.log('[Multi-Select] Inicializado');
}

function startSelection(e) {
    // Solo iniciar si NO estamos sobre un elemento editable
    if (e.target.closest('text, #edit-palette, #main-toolbar')) return;
    
    // Solo con click izquierdo
    if (e.button !== 0) return;
    
    // NUEVO: Solo si se presiona Shift (evita conflicto con drag del SVG)
    if (!e.shiftKey) return;
    
    // ✅ CRÍTICO: Prevenir selección de texto nativa del navegador
    e.preventDefault();
    
    isSelecting = true;
    const containerRect = e.currentTarget.getBoundingClientRect();
    selectionStartX = e.clientX - containerRect.left;
    selectionStartY = e.clientY - containerRect.top;
    
    // Limpiar selección anterior si no se mantiene Ctrl/Cmd
    if (!e.ctrlKey && !e.metaKey) {
        clearMultipleSelection();
    }
    
    // ✅ Desactivar selección de texto durante drag
    document.body.style.userSelect = 'none';
    document.body.style.webkitUserSelect = 'none';
    document.body.style.cursor = 'crosshair';
    
    selectionBox.style.left = `${selectionStartX}px`;
    selectionBox.style.top = `${selectionStartY}px`;
    selectionBox.style.width = '0px';
    selectionBox.style.height = '0px';
    selectionBox.style.display = 'block';
    
    console.log('[Multi-Select] Inicio');
}

function updateSelection(e) {
    if (!isSelecting) return;
    
    const scoreContainer = document.querySelector('#score-output');
    const containerRect = scoreContainer.getBoundingClientRect();
    const currentX = e.clientX - containerRect.left;
    const currentY = e.clientY - containerRect.top;
    
    const width = Math.abs(currentX - selectionStartX);
    const height = Math.abs(currentY - selectionStartY);
    const left = Math.min(currentX, selectionStartX);
    const top = Math.min(currentY, selectionStartY);
    
    selectionBox.style.left = `${left}px`;
    selectionBox.style.top = `${top}px`;
    selectionBox.style.width = `${width}px`;
    selectionBox.style.height = `${height}px`;
}

function endSelection(e) {
    if (!isSelecting) return;
    
    console.log('[Multi-Select] endSelection llamado');
    
    isSelecting = false;
    
    // ✅ Restaurar selección de texto y cursor
    document.body.style.userSelect = '';
    document.body.style.webkitUserSelect = '';
    document.body.style.cursor = '';
    
    // Detectar elementos dentro del rectángulo
    const boxRect = selectionBox.getBoundingClientRect();
    console.log('[Multi-Select] boxRect:', boxRect);
    
    selectionBox.style.display = 'none';
    
    // ✅ MEJORADO: Incluir elementos de OSMD Y elementos de anotación
    const elements = document.querySelectorAll('#osmd-container text, #annotation-svg text');
    console.log(`[Multi-Select] ${elements.length} elemento(s) de texto encontrado(s) (OSMD + anotaciones)`);
    
    let selectionCount = 0;
    elements.forEach(el => {
        const elRect = el.getBoundingClientRect();
        
        // Verificar intersección
        const intersects = !(
            elRect.right < boxRect.left ||
            elRect.left > boxRect.right ||
            elRect.bottom < boxRect.top ||
            elRect.top > boxRect.bottom
        );
        
        if (intersects) {
            selectedElements.add(el);
            el.classList.add('multi-selected');
            selectionCount++;
            console.log(`[Multi-Select] ✅ Seleccionado: "${el.textContent.trim()}"`);
        }
    });
    
    if (selectionCount > 0) {
        console.log(`[Multi-Select] ${selectionCount} elemento(s) seleccionado(s) en total`);
        
        // ✅ CRÍTICO: Deseleccionar SVG principal si está seleccionado
        const svgPrincipal = document.getElementById('sheet-music-svg');
        if (svgPrincipal && svgPrincipal.classList.contains('selected')) {
            svgPrincipal.classList.remove('selected');
            selectedElement = null;
            console.log('[Multi-Select] SVG principal deseleccionado');
        }
        
        showMultipleSelectionPalette();
        
        // ✅ CRÍTICO: Setear flag para prevenir limpieza inmediata
        justCompletedSelection = true;
        
        // ✅ CRÍTICO: Prevenir que el click del SVG limpie la selección
        e.stopPropagation();
    } else {
        console.warn('[Multi-Select] ⚠️ No se seleccionó ningún elemento');
    }
}

function clearMultipleSelection() {
    selectedElements.forEach(el => {
        el.classList.remove('multi-selected');
    });
    selectedElements.clear();
    
    // ✅ Limpiar bounding box
    if (multiSelectionBox) {
        multiSelectionBox.style.display = 'none';
    }
    
    console.log('[Multi-Select] Limpiado');
}

function createMultiSelectionBox() {
    const scoreContainer = document.querySelector('#score-output');
    if (!scoreContainer || selectedElements.size === 0) return;
    
    const containerRect = scoreContainer.getBoundingClientRect();
    
    // Calcular bounds de todos los elementos
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    
    selectedElements.forEach(el => {
        const rect = el.getBoundingClientRect();
        minX = Math.min(minX, rect.left);
        minY = Math.min(minY, rect.top);
        maxX = Math.max(maxX, rect.right);
        maxY = Math.max(maxY, rect.bottom);
    });
    
    // Convertir a coordenadas relativas al container
    const left = minX - containerRect.left - 10; // Padding de 10px
    const top = minY - containerRect.top - 10;
    const width = (maxX - minX) + 20;
    const height = (maxY - minY) + 20;
    
    // Crear o actualizar bounding box
    if (!multiSelectionBox) {
        multiSelectionBox = document.createElement('div');
        multiSelectionBox.className = 'multi-selection-box';
        scoreContainer.appendChild(multiSelectionBox);
        
        // Hacer arrastrable con interact.js
        interact(multiSelectionBox).draggable({
            inertia: true,
            listeners: {
                move: dragMultiSelectionBox,
                end: () => {
                    saveState();
                    saveToLocalStorage();
                }
            }
        });
        
        console.log('[Multi-Select] Bounding box creado y arrastrable');
    }
    
    // Actualizar posición y tamaño
    multiSelectionBox.style.left = `${left}px`;
    multiSelectionBox.style.top = `${top}px`;
    multiSelectionBox.style.width = `${width}px`;
    multiSelectionBox.style.height = `${height}px`;
    multiSelectionBox.style.display = 'block';
}

function dragMultiSelectionBox(event) {
    // Mover todos los elementos seleccionados
    selectedElements.forEach(el => {
        const id = el.id;
        if (!edits[id]) edits[id] = { x: 0, y: 0, xTenths: 0, yTenths: 0, scale: 1.0 };
        
        edits[id].x = (edits[id].x || 0) + event.dx;
        edits[id].y = (edits[id].y || 0) + event.dy;
        edits[id].xTenths = pxToTenths(edits[id].x);
        edits[id].yTenths = pxToTenths(edits[id].y);
        
        applyTransform(el);
    });
    
    // Actualizar posición del box y paleta
    const currentLeft = parseFloat(multiSelectionBox.style.left) || 0;
    const currentTop = parseFloat(multiSelectionBox.style.top) || 0;
    multiSelectionBox.style.left = `${currentLeft + event.dx}px`;
    multiSelectionBox.style.top = `${currentTop + event.dy}px`;
    
    showMultipleSelectionPalette(); // Actualizar paleta
    
    console.log(`[Multi-Select] Grupo movido ${event.dx}, ${event.dy}`);
}

function showMultipleSelectionPalette() {
    const multiPalette = document.getElementById('multi-select-palette');
    if (!multiPalette || selectedElements.size === 0) return;
    
    // ✅ Ocultar paleta individual si está visible
    if (editPalette) editPalette.style.display = 'none';
    
    // ✅ Crear/actualizar bounding box
    createMultiSelectionBox();
    
    // ✅ NUEVO: Resaltar MÚLTIPLES líneas en el código
    highlightMultipleCodeLines();
    
    // Calcular centro de todos los elementos seleccionados
    let sumX = 0, sumY = 0;
    const containerRect = document.querySelector('#score-output').getBoundingClientRect();
    
    selectedElements.forEach(el => {
        const rect = el.getBoundingClientRect();
        sumX += (rect.left + rect.width / 2) - containerRect.left;
        sumY += (rect.top + rect.height / 2) - containerRect.top;
    });
    
    const centerX = sumX / selectedElements.size;
    const centerY = sumY / selectedElements.size;
    
    // ✅ Usar paleta de multi-selección
    multiPalette.style.display = 'flex';
    multiPalette.style.left = `${centerX - 60}px`; // Centrar (aprox 120px de ancho)
    multiPalette.style.top = `${centerY - 80}px`; // Arriba del grupo
    
    console.log('[Multi-Select] Paleta y bounding box actualizados');
}

// ✅ NUEVO: Resaltar múltiples líneas en el código
function highlightMultipleCodeLines() {
    if (!window.codeMirrorEditor) return;
    
    // Limpiar todos los resaltados previos
    clearCodeHighlight();
    
    // Recolectar todas las líneas de código de los elementos seleccionados
    const lineNumbers = [];
    selectedElements.forEach(el => {
        if (el.dataset && el.dataset.codeLine !== undefined) {
            const lineNum = parseInt(el.dataset.codeLine);
            if (!isNaN(lineNum) && !lineNumbers.includes(lineNum)) {
                lineNumbers.push(lineNum);
            }
        }
    });
    
    if (lineNumbers.length === 0) {
        console.log('[Multi-Highlight] No hay líneas vinculadas en selección múltiple');
        return;
    }
    
    // Resaltar todas las líneas
    lineNumbers.forEach(lineNum => {
        window.codeMirrorEditor.addLineClass(lineNum, 'background', 'highlighted-line');
    });
    
    // Scroll a la primera línea (centrada)
    if (lineNumbers.length > 0) {
        const firstLine = Math.min(...lineNumbers);
        scrollCodeToLine(firstLine);
    }
    
    console.log(`[Multi-Highlight] ✅ ${lineNumbers.length} línea(s) resaltada(s): ${lineNumbers.join(', ')}`);
}

// ✅ NUEVO: Scroll mejorado y centrado para CodeMirror
function scrollCodeToLine(lineNumber) {
    if (!window.codeMirrorEditor) return;
    
    try {
        // Obtener información del editor
        const editor = window.codeMirrorEditor;
        const scrollInfo = editor.getScrollInfo();
        const lineHeight = editor.defaultTextHeight();
        
        // Calcular posición de la línea
        const lineTop = lineNumber * lineHeight;
        
        // Calcular scroll para centrar
        const editorMiddle = scrollInfo.clientHeight / 2;
        const targetScroll = lineTop - editorMiddle + (lineHeight / 2);
        
        // Aplicar scroll
        editor.scrollTo(null, Math.max(0, targetScroll));
        
        console.log(`[Scroll] ✅ Línea ${lineNumber} centrada (lineTop: ${lineTop}, scroll: ${targetScroll})`);
    } catch (e) {
        console.error('[Scroll] Error:', e);
    }
}

// Adaptar funciones existentes para soportar selección múltiple
const originalUpdateScale = updateScale;
updateScale = function(factor) {
    if (selectedElements.size > 0) {
        // Aplicar a todos los seleccionados
        selectedElements.forEach(el => {
            const id = el.id;
            const edit = edits[id] || { x: 0, y: 0, scale: 1.0 };
            edit.scale = (edit.scale || 1.0) * factor;
            edits[id] = edit;
            applyTransform(el);
            
            // ✅ UNIVERSAL: Actualizar Python tras escalar
            if (el.tagName === 'text' && typeof window.updatePythonCode === 'function') {
                window.updatePythonCode(el);
                console.log(`[Scale Multi] ✅ Python actualizado para "${el.textContent.trim()}"`);
            }
        });
        saveState();
    } else {
        originalUpdateScale(factor);
    }
};

const originalDeleteSelectedElement = deleteSelectedElement;
deleteSelectedElement = function() {
    if (selectedElements.size > 0) {
        // Borrar todos los seleccionados
        const deletedIds = [];
        selectedElements.forEach(el => {
            const id = el.id;
            deletions.add(id);
            el.style.display = 'none';
            deletedIds.push(id);
        });
        
        clearMultipleSelection();
        saveState();
        
        // Actualizar código Python
        if (typeof window.updateDeletionsInPython === 'function') {
            const tempDeletions = new Set(deletedIds);
            window.updateDeletionsInPython(tempDeletions);
        }
        
        console.log(`[Multi-Select] ${deletedIds.length} elemento(s) borrado(s)`);
        hideEditPalette();
    } else {
        originalDeleteSelectedElement();
    }
};

// ✅ FUNCIONES EXCLUSIVAS PARA MULTI-SELECCIÓN
function updateScaleMultiple(factor) {
    if (selectedElements.size === 0) return;
    
    selectedElements.forEach(el => {
        const id = el.id;
        const edit = edits[id] || { x: 0, y: 0, scale: 1.0 };
        edit.scale = (edit.scale || 1.0) * factor;
        edits[id] = edit;
        applyTransform(el);
        
        // ✅ UNIVERSAL: Actualizar Python tras escalar
        if (el.tagName === 'text' && typeof window.updatePythonCode === 'function') {
            window.updatePythonCode(el);
        }
    });
    
    saveState();
    showMultipleSelectionPalette();
    
    // ✅ FIX: Mantener resaltado al escalar multi-selección
    // Resaltar línea del primer elemento seleccionado
    const firstElement = Array.from(selectedElements)[0];
    if (firstElement && firstElement.dataset && firstElement.dataset.codeLine !== undefined) {
        const lineNumber = parseInt(firstElement.dataset.codeLine);
        highlightCodeLine(lineNumber, false);
    }
    
    console.log(`[Multi-Select] Escala y Python actualizados para ${selectedElements.size} elemento(s)`);
}

function deleteMultipleElements() {
    if (selectedElements.size === 0) return;
    
    const deletedIds = [];
    selectedElements.forEach(el => {
        const id = el.id;
        deletions.add(id);
        el.style.display = 'none';
        deletedIds.push(id);
    });
    
    clearMultipleSelection();
    hideMultipleSelectionPalette();
    saveState();
    
    // Actualizar código Python
    if (typeof window.updateDeletionsInPython === 'function') {
        const tempDeletions = new Set(deletedIds);
        window.updateDeletionsInPython(tempDeletions);
    }
    
    console.log(`[Multi-Select] ${deletedIds.length} elemento(s) borrado(s)`);
}

function hideMultipleSelectionPalette() {
    const multiPalette = document.getElementById('multi-select-palette');
    if (multiPalette) multiPalette.style.display = 'none';
}

// ====== MENÚ CONTEXTUAL ======
let contextMenu = null;

function createContextMenu() {
    if (contextMenu) return contextMenu;
    
    contextMenu = document.createElement('div');
    contextMenu.id = 'context-menu';
    contextMenu.style.cssText = `
        position: absolute;
        background: white;
        border: 1px solid #ccc;
        border-radius: 4px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.2);
        padding: 5px 0;
        z-index: 10000;
        display: none;
        min-width: 120px;
    `;
    
    const copyBtn = document.createElement('button');
    copyBtn.textContent = '📋 Copiar';
    copyBtn.style.cssText = `
        width: 100%;
        padding: 8px 15px;
        border: none;
        background: none;
        text-align: left;
        cursor: pointer;
        font-size: 14px;
    `;
    copyBtn.addEventListener('mouseenter', () => copyBtn.style.background = '#f0f0f0');
    copyBtn.addEventListener('mouseleave', () => copyBtn.style.background = 'none');
    copyBtn.addEventListener('click', () => {
        console.log('[Context Menu] Click en Copiar');
        copySelectedElement();
        hideContextMenu();
    });
    
    const pasteBtn = document.createElement('button');
    pasteBtn.textContent = '📄 Pegar';
    pasteBtn.style.cssText = copyBtn.style.cssText;
    pasteBtn.addEventListener('mouseenter', () => pasteBtn.style.background = '#f0f0f0');
    pasteBtn.addEventListener('mouseleave', () => pasteBtn.style.background = 'none');
    pasteBtn.addEventListener('click', () => {
        console.log('[Context Menu] Click en Pegar');
        pasteFromClipboard();
        hideContextMenu();
    });
    
    contextMenu.appendChild(copyBtn);
    contextMenu.appendChild(pasteBtn);
    document.body.appendChild(contextMenu);
    
    // Ocultar menú al hacer click fuera
    document.addEventListener('click', (e) => {
        if (!contextMenu.contains(e.target)) {
            hideContextMenu();
        }
    });
    
    console.log('[Context Menu] Menú contextual creado');
    return contextMenu;
}

function showContextMenu(x, y) {
    const menu = createContextMenu();
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.display = 'block';
    console.log(`[Context Menu] Mostrado en (${x}, ${y})`);
}

function hideContextMenu() {
    if (contextMenu) {
        contextMenu.style.display = 'none';
        console.log('[Context Menu] Ocultado');
    }
}

// Listener para menú contextual - SOLO en elementos de texto editables
document.addEventListener('contextmenu', (e) => {
    // ✅ CRÍTICO: Solo activar menú en textos editables del score
    const clickedElement = e.target.closest('#osmd-container text, #annotation-svg text');
    
    if (!clickedElement) {
        console.log('[Context Menu] Click derecho fuera de texto editable, ignorado');
        return; // Permitir menú nativo en otras áreas
    }
    
    // ✅ Prevenir menú nativo SOLO en textos editables
    e.preventDefault();
    e.stopPropagation();
    
    // Ocultar menú existente
    hideContextMenu();
    
    // Verificar si hay algo seleccionado
    if (selectedElements.size === 0 && !selectedElement) {
        console.log('[Context Menu] Sin selección activa');
        return;
    }
    
    showContextMenu(e.pageX, e.pageY);
    console.log('[Context Menu] Menú activado en texto');
});

// ✅ MEJORADO: Cerrar menú contextual con cualquier click (incluyendo dentro del SVG)
document.addEventListener('click', (e) => {
    // Si el menú está visible y NO se clickó dentro del menú mismo
    if (contextMenu && contextMenu.style.display === 'block') {
        if (!contextMenu.contains(e.target)) {
            hideContextMenu();
            console.log('[Context Menu] Cerrado por click');
        }
    }
}, true); // ✅ useCapture=true para capturar antes que otros listeners

// ✅ NUEVO: Cerrar menú contextual al presionar Escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && contextMenu && contextMenu.style.display === 'block') {
        hideContextMenu();
        console.log('[Context Menu] Cerrado con Escape');
    }
});

// ====== EDICIÓN VISUAL DIRECTA DEL CÓDIGO ======
let liveEditInput = null;
let currentEditingElement = null;

function showLiveEditInput(element) {
    const scoreContainer = document.querySelector('#score-output');
    if (!scoreContainer) return;
    
    // Obtener tipo de elemento
    const elementId = element.id;
    const elementType = detectElementType(element);
    
    console.log(`[Live Edit] Iniciando edición: ID=${elementId}, tipo=${elementType}`);
    
    // Resaltar línea en código
    if (window.codeLineMap && window.codeLineMap[elementId]) {
        highlightCodeLine(window.codeLineMap[elementId]);
    }
    
    // Crear input si no existe
    if (!liveEditInput) {
        liveEditInput = document.createElement('input');
        liveEditInput.type = 'text';
        liveEditInput.style.cssText = `
            position: absolute;
            background: #fff;
            color: #000;
            border: 2px solid #667eea;
            font-size: 18px;
            padding: 8px 12px;
            z-index: 3000;
            border-radius: 4px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            font-family: monospace;
        `;
        scoreContainer.appendChild(liveEditInput);
    }
    
    // Posicionar sobre elemento
    const elRect = element.getBoundingClientRect();
    const containerRect = scoreContainer.getBoundingClientRect();
    liveEditInput.style.left = `${elRect.left - containerRect.left}px`;
    liveEditInput.style.top = `${elRect.top - containerRect.top - 40}px`;
    
    // Valor inicial
    liveEditInput.value = element.textContent.trim();
    liveEditInput.style.display = 'block';
    liveEditInput.focus();
    liveEditInput.select();
    
    currentEditingElement = element;
    
    // Listeners
    liveEditInput.oninput = () => handleLiveEdit(element, elementType);
    liveEditInput.onblur = () => finishLiveEdit(element);
    liveEditInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
            liveEditInput.blur();
        } else if (e.key === 'Escape') {
            cancelLiveEdit();
        }
    };
}

async function handleLiveEdit(element, elementType) {
    const newValue = liveEditInput.value.trim();
    
    // Validar según tipo
    if (elementType === 'ChordSymbol') {
        const valid = await validateChord(newValue);
        if (!valid) {
            liveEditInput.style.borderColor = '#ff0000';
            liveEditInput.style.background = '#ffe6e6';
            return;
        }
    } else if (elementType === 'Note') {
        const valid = await validateNote(newValue);
        if (!valid) {
            liveEditInput.style.borderColor = '#ff0000';
            liveEditInput.style.background = '#ffe6e6';
            return;
        }
    }
    
    // Válido → Resetear estilos
    liveEditInput.style.borderColor = '#667eea';
    liveEditInput.style.background = '#fff';
    
    // Actualizar DOM
    element.textContent = newValue;
    
    // Actualizar código Python EN VIVO
    if (window.codeLineMap && window.codeLineMap[element.id] !== undefined) {
        updateCodeLineLive(window.codeLineMap[element.id], newValue, elementType);
    }
}

function finishLiveEdit(element) {
    if (!liveEditInput || !currentEditingElement) return;
    
    liveEditInput.style.display = 'none';
    currentEditingElement = null;
    
    // Guardar en edits
    const id = element.id;
    if (!edits[id]) edits[id] = { x: 0, y: 0, scale: 1.0 };
    edits[id].textContent = element.textContent.trim();
    
    // Regenerar partitura
    regenerateScore();
    
    // Limpiar resaltado
    clearCodeHighlight();
}

function cancelLiveEdit() {
    if (liveEditInput) {
        liveEditInput.style.display = 'none';
    }
    currentEditingElement = null;
    clearCodeHighlight();
}

function detectElementType(element) {
    // Usar codeLineMap para determinar tipo
    const elementId = element.id;
    if (!window.codeLineMap || !elementId) return 'Text';
    
    const lineNumber = window.codeLineMap[elementId];
    if (lineNumber === undefined) return 'Text';
    
    return detectElementTypeFromLine(lineNumber);
}

// ✅ NUEVO: Detectar tipo desde número de línea
function detectElementTypeFromLine(lineNumber) {
    const code = window.getCodeEditorValue();
    const lines = code.split('\n');
    
    if (lineNumber < 0 || lineNumber >= lines.length) return 'Text';
    
    // Buscar hacia arriba desde la línea
    for (let i = lineNumber; i >= Math.max(0, lineNumber - 10); i--) {
        const line = lines[i];
        if (line.includes('ChordSymbol(')) return 'ChordSymbol';
        if (line.includes('TextExpression(')) return 'TextExpression';
        if (line.includes('note.Note(')) return 'Note';
        if (line.includes('.title')) return 'Title';
        if (line.includes('.lyric')) return 'Lyric';
    }
    
    return 'Text';
}

async function validateChord(text) {
    if (!text.trim()) return false;
    
    try {
        const resp = await fetch('/validate-chord', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
        const data = await resp.json();
        return data.valid;
    } catch (e) {
        console.error('[Validate] Error:', e);
        return false;
    }
}

async function validateNote(text) {
    if (!text.trim()) return false;
    
    try {
        const resp = await fetch('/validate-note', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
        const data = await resp.json();
        return data.valid;
    } catch (e) {
        console.error('[Validate] Error:', e);
        return false;
    }
}

function updateCodeLineLive(lineNumber, newValue, elementType) {
    const code = window.getCodeEditorValue();
    const lines = code.split('\n');
    
    if (lineNumber < 0 || lineNumber >= lines.length) return;
    
    // Actualizar según tipo
    if (elementType === 'ChordSymbol') {
        lines[lineNumber] = lines[lineNumber].replace(/\(["'](.+?)["']\)/, `("${newValue}")`);
    } else if (elementType === 'TextExpression') {
        lines[lineNumber] = lines[lineNumber].replace(/\(["'](.+?)["']\)/, `("${newValue}")`);
    } else if (elementType === 'Note') {
        lines[lineNumber] = lines[lineNumber].replace(/Note\(["'](.+?)["']/, `Note("${newValue}"`);
    } else if (elementType === 'Title') {
        lines[lineNumber] = lines[lineNumber].replace(/=\s*["'].*["']/, `= "${newValue}"`);
    }
    
    window.setCodeEditorValue(lines.join('\n'));
    console.log(`[Live Edit] Código actualizado: línea ${lineNumber} → "${newValue}"`);
}

function regenerateScore() {
    // Simular click en botón render
    const renderBtn = document.getElementById('render-btn');
    if (renderBtn) {
        renderBtn.click();
        console.log('[Live Edit] Partitura regenerada');
    }
}

// Modificar el doble click para usar el nuevo sistema
const originalEditTextInPlace = editTextInPlace;
editTextInPlace = function(existingElement, points) {
    // Usar nuevo sistema si es un elemento OSMD con ID mapeado
    if (existingElement && window.codeLineMap && window.codeLineMap[existingElement.id] !== undefined) {
        showLiveEditInput(existingElement);
        return;
    }
    
    // Fallback a sistema original para elementos manuales
    originalEditTextInPlace(existingElement, points);
};

// ====== FUNCIÓN PARA ACTUALIZAR CÓDIGO EN TIEMPO REAL ======
function updateCodeLineDirectly(lineNumber, newText) {
    const code = window.getCodeEditorValue();
    const lines = code.split('\n');
    
    if (lineNumber < 0 || lineNumber >= lines.length) {
        console.warn(`[updateCodeLineDirectly] Línea ${lineNumber} fuera de rango`);
        return;
    }
    
    const originalLine = lines[lineNumber];
    
    // ✅ MEJORADO: Buscar cualquier texto entre comillas (vacío o no)
    // Usar regex global para asegurar reemplazo
    let updatedLine = originalLine;
    
    // Intentar con comillas dobles primero
    if (originalLine.includes('"')) {
        updatedLine = originalLine.replace(/"[^"]*"/, `"${newText}"`);
    }
    // Si no, intentar con comillas simples
    else if (originalLine.includes("'")) {
        updatedLine = originalLine.replace(/'[^']*'/, `'${newText}'`);
    }
    
    if (updatedLine !== originalLine) {
        lines[lineNumber] = updatedLine;
        window.setCodeEditorValue(lines.join('\n'));
        console.log(`[updateCodeLineDirectly] ✅ Línea ${lineNumber}: "${newText}"`);
    } else {
        console.warn(`[updateCodeLineDirectly] ⚠️ No se pudo actualizar línea ${lineNumber}`);
    }
}


// Exponer funciones globalmente
window.initEditing = initEditing;
window.selectElement = selectElement;
window.applyTransform = applyTransform;
window.dragMoveListener = dragMoveListener;
window.handleDragEnd = handleDragEnd;
window.updateScale = updateScale;
window.loadFromLocalStorage = loadFromLocalStorage;
window.saveToLocalStorage = saveToLocalStorage;
window.getDeletions = getDeletions;
window.exportAsPNG = exportAsPNG;
window.exportAsSVG = exportAsSVG;
window.clearMultipleSelection = clearMultipleSelection;
window.updateScaleMultiple = updateScaleMultiple;
window.deleteMultipleElements = deleteMultipleElements;
window.copySelectedElement = copySelectedElement;
window.pasteFromClipboard = pasteFromClipboard;
window.showLiveEditInput = showLiveEditInput;
window.highlightCodeLine = highlightCodeLine;
window.clearCodeHighlight = clearCodeHighlight;
window.updateCodeLineDirectly = updateCodeLineDirectly;
