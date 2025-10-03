
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
    document.getElementById('font-select').addEventListener('change', (e) => applyFont(e.target.value));
    document.getElementById('symbol-select').addEventListener('change', (e) => addNewSymbol(e.target.value));

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
        interact(mainToolbar).draggable({ inertia: true, listeners: { move: dragToolbarListener } });
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
        // SOLO asignar ID si NO existe (RESPETAR IDs de assignCorrectIDsFromCode)
        if (!el.id || el.id.trim() === '') {
            const textContent = el.textContent.trim();
            const count = (document.querySelectorAll(`[id^="${textContent}"]`).length);
            el.id = `${textContent.replace(/\s+/g, '-')}-${count}`;
            console.log(`[initEditing] ID auto-asignado (fallback): "${el.id}"`);
        } else {
            console.log(`[initEditing] ID existente respetado: "${el.id}"`);
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
        
        // ✅ Permitir clicks en elementos, paletas y bounding box sin deseleccionar
        if (e.target.closest('#osmd-container text, #sheet-music-svg, #edit-palette, #multi-select-palette, .multi-selection-box')) return;
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
}

function deselectAll() {
    if (selectedElement) selectedElement.classList.remove('selected');
    selectedElement = null;
    clearMultipleSelection();
    hideEditPalette();
    hideMultipleSelectionPalette();
    
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

    const finishEditing = () => {
        const newTextContent = editor.value; // Keep whitespace
        
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
            saveState();
            
            // NUEVO: Actualizar código Python
            if (typeof window.updatePythonCode === 'function') {
                window.updatePythonCode(existingElement);
            }

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
        
        scoreContainer.removeChild(editor);
        editor.removeEventListener('blur', finishEditing);
        editor.removeEventListener('keydown', handleKeydown);
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
    if (!window.codeMirrorEditor && !document.getElementById('code-editor')) return;
    
    const id = el.id;
    const textContent = el.textContent.trim();
    const dataType = el.getAttribute('data-type') || 'text';
    
    // Determinar si es símbolo o texto normal
    const isSymbol = dataType === 'symbol' || el.classList.contains('symbol');
    
    // Generar variable name segura
    const varName = textContent
        .replace(/\s+/g, '_')
        .replace(/[^\w]/g, '')
        .toLowerCase();
    const safeVarName = `${varName}_${Date.now() % 10000}`;
    
    // Generar código Python
    let pythonCode = '\n# Elemento añadido manualmente\n';
    
    if (isSymbol) {
        pythonCode += `${safeVarName} = expressions.TextExpression("${textContent}")\n`;
    } else {
        pythonCode += `${safeVarName} = expressions.TextExpression("${textContent}")\n`;
    }
    
    // Determinar placement basándose en posición Y
    const y = parseFloat(el.getAttribute('y'));
    const placement = y < 200 ? 'above' : 'below';
    pythonCode += `${safeVarName}.placement = '${placement}'\n`;
    pythonCode += `${safeVarName}.id = "${id}"\n`;
    
    // Posición (si no es 0,0)
    const edit = edits[id];
    if (edit && (edit.x !== 0 || edit.y !== 0)) {
        const xTenths = Math.round((edit.x || 0) * 2.5);
        const yTenths = Math.round((edit.y || 0) * 2.5);
        if (xTenths !== 0) pythonCode += `${safeVarName}.style.absoluteX = ${xTenths}\n`;
        if (yTenths !== 0) pythonCode += `${safeVarName}.style.absoluteY = ${yTenths}\n`;
    }
    
    // Insertar en el primer compás (offset 0.0)
    pythonCode += `m.insert(0.0, ${safeVarName})\n`;
    
    // Obtener código actual
    const currentCode = window.codeMirrorEditor 
        ? window.codeMirrorEditor.getValue() 
        : document.getElementById('code-editor').value;
    
    // Insertar al final (antes de "score = s" si existe)
    let newCode;
    if (currentCode.includes('score = s')) {
        newCode = currentCode.replace(/score = s/, pythonCode + '\nscore = s');
    } else if (currentCode.includes('score = ')) {
        newCode = currentCode.replace(/(score = [^\n]+)/, pythonCode + '\n$1');
    } else {
        newCode = currentCode + pythonCode;
    }
    
    // Actualizar editor
    if (window.codeMirrorEditor) {
        window.codeMirrorEditor.setValue(newCode);
    } else {
        document.getElementById('code-editor').value = newCode;
    }
    
    console.log(`[Python Insert] Código generado para "${textContent}" (ID: ${id})`);
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

    // Reposicionar la paleta de edición durante el arrastre
    if (target === selectedElement) {
        updateEditPalettePosition();
    }
}

function handleDragEnd(event) {
    saveState();
    saveToLocalStorage(); // Guardar automáticamente tras cada movimiento
    
    // NUEVO: Actualizar código Python si es un texto OSMD
    // Usar event.target en lugar de selectedElement
    const target = event ? event.target : selectedElement;
    
    console.log('[handleDragEnd] target:', target);
    console.log('[handleDragEnd] tagName:', target ? target.tagName : 'null');
    console.log('[handleDragEnd] updatePythonCode existe?', typeof window.updatePythonCode);
    
    if (target && target.tagName === 'text') {
        console.log('[handleDragEnd] ✅ Llamando a updatePythonCode()');
        if (typeof window.updatePythonCode === 'function') {
            window.updatePythonCode(target);
        } else {
            console.error('[handleDragEnd] ❌ updatePythonCode no es una función');
        }
    } else {
        console.warn('[handleDragEnd] ❌ NO es un texto o target es null');
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
  const codeEditor = document.getElementById('code-editor');
  if (!codeEditor) return;
  
  const code = codeEditor.value;
  
  if (!code.trim()) {
    alert('No hay código para exportar');
    return;
  }
  
  try {
    console.log('[Export XML] Usando API nativa de pywebview...');
    
    // Verificar si pywebview API está disponible
    if (typeof pywebview === 'undefined' || typeof pywebview.api === 'undefined') {
      console.warn('[Export XML] API pywebview no disponible, usando fallback HTTP');
      // Fallback a método HTTP para desarrollo
      const resp = await fetch('/export-xml', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ code })
      });
      
      if (!resp.ok) {
        const error = await resp.text();
        throw new Error(error || 'Error al exportar XML');
      }
      
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `partitura_${Date.now()}.musicxml`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.createObjectURL(url), 100);
      
      console.log('[Export XML] ✅ Archivo descargado (fallback HTTP)');
      return;
    }
    
    // Usar API nativa de pywebview (diálogo nativo de guardado)
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
    console.error('[Export XML] ❌ Error:', err);
    alert(`Error al exportar XML:\n${err.message}`);
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

// Hacer notas clicables para aplicar color
function makeNotesClickable() {
  const svg = document.querySelector('#osmd-container svg');
  if (!svg) return;
  
  // Seleccionar todas las cabezas de nota (ellipse para notas normales, path para algunas figuras)
  const noteHeads = svg.querySelectorAll('ellipse, path[d*="M"]');
  
  noteHeads.forEach(noteHead => {
    noteHead.style.cursor = 'pointer';
    
    noteHead.addEventListener('click', (e) => {
      e.stopPropagation();
      
      // Deseleccionar anterior
      if (selectedNoteElement) {
        selectedNoteElement.style.outline = '';
      }
      
      // Seleccionar nueva
      selectedNoteElement = noteHead;
      selectedNoteElement.style.outline = '2px solid #0066ff';
      
      console.log('[Color] Nota seleccionada');
    });
  });
  
  console.log(`[Color] ${noteHeads.length} nota(s) ahora clicables para aplicar color`);
}

// Aplicar color a nota O texto seleccionado O multi-selección
document.getElementById('color-select')?.addEventListener('change', (e) => {
  const color = e.target.value;
  
  if (!color) return;
  
  // PRIORIDAD 1: Nota seleccionada (de makeNotesClickable)
  if (selectedNoteElement) {
    selectedNoteElement.setAttribute('fill', color);
    selectedNoteElement.style.outline = '';
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
        });
        saveState();
        console.log(`[Multi-Select] Escala aplicada a ${selectedElements.size} elemento(s)`);
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
    });
    
    saveState();
    showMultipleSelectionPalette(); // Actualizar posición
    console.log(`[Multi-Select] Escala ${factor > 1 ? 'aumentada' : 'reducida'} en ${selectedElements.size} elemento(s)`);
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

// Listener para menú contextual
document.addEventListener('contextmenu', (e) => {
    // ✅ CORREGIDO: Ocultar menú existente SIEMPRE al hacer click derecho
    hideContextMenu();
    
    // Solo mostrar en elementos seleccionables o si hay selección activa
    const clickedElement = e.target.closest('#osmd-container text, #annotation-svg text');
    if (!clickedElement && selectedElements.size === 0 && !selectedElement) {
        console.log('[Context Menu] Click derecho ignorado: sin elemento seleccionado');
        return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    
    // ✅ CORREGIDO: Mostrar menú con timeout para evitar conflictos
    setTimeout(() => {
        showContextMenu(e.pageX, e.pageY);
        console.log('[Context Menu] Menú activado con click derecho');
    }, 10);
});

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
