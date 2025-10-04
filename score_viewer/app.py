# app.py
import mimetypes
import logging
import traceback
import xml.etree.ElementTree as ET
from flask import Flask, render_template, request, jsonify, Response

# ==== NUEVO: imports ampliados de music21 ====
from music21 import (
    converter, stream, note, chord, meter, clef, key, tempo, expressions, duration,
    harmony, roman, metadata, bar
)
from music21.musicxml import m21ToXml
import re

mimetypes.add_type('font/otf', '.otf')

app = Flask(__name__)
app.logger.setLevel(logging.INFO)

# ============================================================
# =========== TABLA DE NORMALIZACIÓN DE CIFRADOS =============
# ============================================================

CHORD_NORMALIZATION_MAP = {
    # ===== CIFRADOS SUSPENDED (sus4, sus2) =====
    # IMPORTANTE: Procesar ANTES de otros para capturar 7sus4, 9sus4, etc.
    r'7sus4': '7 sus4',
    r'9sus4': '9 sus4',
    r'13sus4': '13 sus4',
    r'sus4': 'sus4',
    r'sus2': 'sus2',
    r'sus': 'sus4',  # "sus" → "sus4" por defecto
    
    # ===== CIFRADOS EXTENDIDOS (9, 11, 13) =====
    r'maj13': 'maj7 add 9 add 13',
    r'Maj13': 'maj7 add 9 add 13',
    r'MAJ13': 'maj7 add 9 add 13',
    r'maj11': 'maj7 add 9 add 11',
    r'Maj11': 'maj7 add 9 add 11',
    r'maj9': 'maj7 add 9',
    r'Maj9': 'maj7 add 9',
    
    # Dominantes extendidos
    r'(?<![a-zA-Z])13(?![a-zA-Z])': '7 add 9 add 13',
    r'(?<![a-zA-Z])11(?![a-zA-Z])': '7 add 9 add 11',
    r'(?<![a-zA-Z])9(?![a-zA-Z])': '7 add 9',
    
    # Menores extendidos
    r'm13': 'm7 add 9 add 11 add 13',
    r'min13': 'm7 add 9 add 11 add 13',
    r'm11': 'm7 add 9 add 11',
    r'min11': 'm7 add 9 add 11',
    r'm9': 'm7 add 9',
    r'min9': 'm7 add 9',
    
    # ===== ALTERACIONES (b9, #9, #11, b13, etc.) =====
    r'7\(b9\)': '7 alter b9',
    r'7\(#9\)': '7 alter #9',
    r'7\(#11\)': '7 alter #11',
    r'7\(b13\)': '7 alter b13',
    r'7\(#5\)': '7 alter #5',
    r'7\(b5\)': '7 alter b5',
    
    # Sin paréntesis
    r'7#9': '7 alter #9',
    r'7b9': '7 alter b9',
    r'7#11': '7 alter #11',
    r'7b13': '7 alter b13',
    r'7#5': '7 alter #5',
    r'7b5': '7 alter b5',
    
    # ===== MAYORES CON TENSIONES =====
    r'maj7\(9\)': 'maj7 add 9',
    r'Maj7\(9\)': 'maj7 add 9',
    r'MAJ7\(9\)': 'maj7 add 9',
    r'maj7\+9': 'maj7 add 9',
    r'maj7\(#11\)': 'maj7 alter #11',
    
    # ===== MENORES CON TENSIONES =====
    r'm7\(9,11,13\)': 'm7 add 9 add 11 add 13',
    r'm7\(9, 11, 13\)': 'm7 add 9 add 11 add 13',
    r'min7\(9,11,13\)': 'm7 add 9 add 11 add 13',
    r'm7\(9\)': 'm7 add 9',
    r'min7\(9\)': 'm7 add 9',
    
    # ===== NORMALIZAR MAYÚSCULAS =====
    r'Maj7': 'maj7',
    r'MAJ7': 'maj7',
    r'Maj': 'maj',
    r'MAJ': 'maj',
    r'Min7': 'm7',
    r'MIN7': 'm7',
    r'Min': 'm',
    r'MIN': 'm',
    
    # ===== ESPACIOS EN CIFRADOS =====
    r'([A-G][#b]?) m([0-9])': r'\1m\2',  # "C m7" → "Cm7"
    r'([A-G][#b]?) maj([0-9])': r'\1maj\2',  # "C maj7" → "Cmaj7"
    
    # ===== GUIONES (C-7 → Cm7) =====
    r'([A-G][#b]?)-7': r'\1m7',
    r'([A-G][#b]?)-9': r'\1m9',
    r'([A-G][#b]?)-11': r'\1m11',
    r'([A-G][#b]?)-13': r'\1m13',
    
    # ===== BEMOLES (B- → Bb) =====
    r'B-(?![0-9])': 'Bb',
    r'E-(?![0-9])': 'Eb',
    r'A-(?![0-9])': 'Ab',
    r'D-(?![0-9])': 'Db',
    r'G-(?![0-9])': 'Gb',
    
    # ===== SUS (sus4, sus2) =====
    r'sus': 'sus4',  # "sus" → "sus4"
    
    # ===== DISMINUIDOS Y AUMENTADOS =====
    r'dim7': 'dim7',  # Ya soportado
    r'dim': 'dim',    # Ya soportado
    r'aug': 'aug',    # Ya soportado
    r'\+': 'aug',     # "C+" → "Caug"
    r'o7': 'dim7',    # "Co7" → "Cdim7"
    r'o': 'dim',      # "Co" → "Cdim"
    
    # ===== ACORDES SLASH (C/E, Dm7/G) =====
    # No normalizar, music21 los soporta nativamente
    
    # ===== POWER CHORDS =====
    r'5': '5',  # Ya soportado (C5 es power chord)
}

def normalize_chord_figure(figure: str) -> str:
    """
    Normaliza una figura de cifrado según la tabla de normalización.
    Devuelve la figura normalizada.
    """
    if not figure:
        return figure
    
    normalized = figure
    for pattern, replacement in CHORD_NORMALIZATION_MAP.items():
        normalized = re.sub(pattern, replacement, normalized)
    
    return normalized

def safe_create_chord_symbol(figure: str, warnings_list=None):
    """
    Intenta crear un ChordSymbol. Si falla, devuelve un TextExpression.
    Devuelve (elemento, tipo) donde tipo ∈ {'chordsymbol', 'text'}
    """
    if warnings_list is None:
        warnings_list = []
    
    # Normalizar figura
    normalized = normalize_chord_figure(figure)
    
    # Intentar crear ChordSymbol
    try:
        cs = harmony.ChordSymbol(normalized)
        if normalized != figure:
            warnings_list.append(f"Cifrado normalizado: '{figure}' → '{normalized}'")
        return cs, 'chordsymbol'
    except Exception as e:
        # Fallback: TextExpression abajo
        te = expressions.TextExpression(figure)
        te.placement = 'below'
        warnings_list.append(f"Cifrado inválido '{figure}', mostrado como texto: {str(e)}")
        return te, 'text'

# ============================================================
# ================== NORMALIZACIÓN UNIVERSAL ==================
# ============================================================

def _ensure_duration(e):
    """Asegura que notas/acordes tengan duración válida (default: negra)"""
    if isinstance(e, (note.Note, chord.Chord)):
        if not e.duration or e.duration.quarterLength == 0.0:
            e.duration = duration.Duration(1.0)
    return e

def _wrap_in_measure(e):
    """Envuelve un elemento en un compás"""
    m = stream.Measure()
    e = _ensure_duration(e)
    m.append(e)
    return m

def _wrap_in_part(obj, warnings_list=None):
    """Envuelve objetos en un Part, con warnings opcionales"""
    if warnings_list is None:
        warnings_list = []
    
    p = stream.Part()
    
    # Iterable de elementos sueltos
    if isinstance(obj, (list, tuple)):
        for el in obj:
            if isinstance(el, (stream.Measure, stream.Stream)):
                p.append(el)
            else:
                el = _ensure_duration(el)
                p.append(_wrap_in_measure(el))
        return p

    # Stream genérico
    if isinstance(obj, stream.Stream) and not isinstance(obj, (stream.Part, stream.Score)):
        p.append(obj)
        return p

    # Measure o elementos "atómicos" conocidos
    if isinstance(obj, (stream.Measure, note.Note, chord.Chord,
                        meter.TimeSignature, clef.Clef, key.Key,
                        tempo.MetronomeMark, expressions.TextExpression,
                        harmony.ChordSymbol, roman.RomanNumeral)):
        obj = _ensure_duration(obj)
        p.append(_wrap_in_measure(obj))
        return p

    # Si ya es Part, devolver tal cual
    if isinstance(obj, stream.Part):
        return obj

    # Último recurso: degradación elegante
    warnings_list.append(f"Objeto de tipo {type(obj).__name__} no reconocido, se intentó envolver")
    try:
        p.append(obj)
    except Exception as e:
        warnings_list.append(f"No se pudo añadir {type(obj).__name__}: {str(e)}")
    return p

def add_defaults_to_score(sc: stream.Score, warnings_list=None):
    """
    Añade defaults si faltan:
    - Compás 4/4 si no hay
    - Tempo ♩=72 si no hay (MetronomeMark + texto words)
    - Título "Untitled" si no hay
    """
    if warnings_list is None:
        warnings_list = []
    
    # Metadata por defecto
    if not sc.metadata:
        sc.insert(0, metadata.Metadata())
    if not sc.metadata.title:
        sc.metadata.title = "Untitled"
        warnings_list.append("Título no especificado, usando 'Untitled'")
    
    # Procesar cada parte
    for part in sc.parts:
        # Verificar si tiene tiempo (usar flatten() en lugar de flat)
        has_time_sig = any(isinstance(el, meter.TimeSignature) for el in part.flatten())
        if not has_time_sig:
            ts = meter.TimeSignature('4/4')
            part.insert(0, ts)
            warnings_list.append("Compás no especificado, usando 4/4")
        
        # Verificar si tiene tempo (usar flatten() en lugar de flat)
        has_tempo = any(isinstance(el, tempo.MetronomeMark) for el in part.flatten())
        if not has_tempo:
            # Agregar SOLO MetronomeMark, SIN texto adicional
            mm = tempo.MetronomeMark(number=72, referent=duration.Duration(1.0))
            part.insert(0, mm)
            warnings_list.append("Tempo no especificado, usando ♩=72")
    
    return sc

def normalize_to_score(obj, warnings_list=None):
    """
    Acepta: ruta de archivo, MusicXML (texto), Score/Part/Stream/Measure/Note/Chord,
            o lista/tupla de elementos.
    Devuelve un music21.stream.Score.
    """
    if warnings_list is None:
        warnings_list = []
    
    # 1) str → intentar parsear (ruta o MusicXML)
    if isinstance(obj, str):
        # Si parece MusicXML crudo
        if obj.lstrip().startswith("<?xml"):
            try:
                sc = converter.parse(obj)
                if isinstance(sc, stream.Score):
                    return sc
                p = _wrap_in_part(sc, warnings_list)
                s = stream.Score()
                s.insert(0, p)
                return s
            except Exception:
                pass
        # Ruta de archivo (mid, xml, mxl, krn, abc, etc.)
        sc = converter.parse(obj)
        if isinstance(sc, stream.Score):
            return sc
        p = _wrap_in_part(sc, warnings_list)
        s = stream.Score()
        s.insert(0, p)
        return s

    # 2) Score directo
    if isinstance(obj, stream.Score):
        return obj

    # 3) Part → Score
    if isinstance(obj, stream.Part):
        s = stream.Score()
        s.insert(0, obj)
        return s

    # 4) Stream genérico → Part → Score
    if isinstance(obj, stream.Stream):
        p = _wrap_in_part(obj, warnings_list)
        s = stream.Score()
        s.insert(0, p)
        return s

    # 5) Measure/Note/Chord/Elementos sueltos → Part → Score
    if isinstance(obj, (stream.Measure, note.Note, chord.Chord,
                        meter.TimeSignature, clef.Clef, key.Key,
                        tempo.MetronomeMark, expressions.TextExpression,
                        harmony.ChordSymbol, roman.RomanNumeral)):
        p = _wrap_in_part(obj, warnings_list)
        s = stream.Score()
        s.insert(0, p)
        return s

    # 6) Lista/tupla → Part → Score
    if isinstance(obj, (list, tuple)):
        p = _wrap_in_part(obj, warnings_list)
        s = stream.Score()
        s.insert(0, p)
        return s

    warnings_list.append(f"Tipo desconocido {type(obj).__name__}, intento de conversión")
    try:
        p = _wrap_in_part(obj, warnings_list)
        s = stream.Score()
        s.insert(0, p)
        return s
    except Exception as e:
        raise TypeError(f"No se pudo normalizar objeto de tipo {type(obj)}: {str(e)}")

def finalize_notation(score: stream.Score) -> stream.Score:
    """
    Finaliza notación sin destruir barlines personalizados.
    Solo llama makeMeasures si no hay compases ya definidos.
    IMPORTANTE: Maneja BeamException y otros errores de notación.
    """
    # Solo hacer makeMeasures si no existen Measure
    has_measures = any(isinstance(el, stream.Measure) for part in score.parts for el in part)
    if not has_measures:
        try:
            score.makeMeasures(inPlace=True)
        except Exception as e:
            app.logger.warning(f"[Finalize] Error en makeMeasures: {e}")
    
    # makeNotation puede fallar con BeamException - manejar gracefully
    try:
        score.makeNotation(inPlace=True)
    except Exception as e:
        app.logger.warning(f"[Finalize] Error en makeNotation (ignorado): {e}")
        # Intentar makeBeams individual para cada parte
        for part in score.parts:
            try:
                for measure in part.getElementsByClass(stream.Measure):
                    try:
                        measure.makeBeams(inPlace=True)
                    except Exception:
                        pass  # Ignorar errores de beams individuales
            except Exception:
                pass
    return score

def separate_fused_texts(xml_text: str) -> str:
    """
    DESACTIVADA: No separar textos automáticamente.
    Si el usuario proporcionó IDs únicos, confiar en que los textos YA están separados.
    """
    app.logger.info("[Separate Texts] Función desactivada - confiar en IDs del usuario")
    return xml_text

def deduplicate_words_in_xml(xml_text: str) -> str:
    """
    Elimina <direction-type><words> duplicados dentro del mismo compás.
    Mantiene solo el primero cuando coincidan texto y placement.
    AGRESIVO: Elimina TODO duplicado encontrado, sin importar estructura.
    """
    try:
        # Extraer declaración XML y DOCTYPE si existen
        xml_declaration = ''
        doctype = ''
        if xml_text.startswith('<?xml'):
            lines = xml_text.split('\n')
            if lines[0].startswith('<?xml'):
                xml_declaration = lines[0] + '\n'
            if len(lines) > 1 and lines[1].startswith('<!DOCTYPE'):
                doctype = lines[1] + '\n'
        
        root = ET.fromstring(xml_text)
        total_removed = 0
        
        for part in root.findall('.//part'):
            for measure in part.findall('.//measure'):
                # Recopilar todas las direcciones con words
                directions = []
                for direction in measure.findall('.//direction'):
                    words_el = direction.find('.//words')
                    if words_el is not None:
                        placement = direction.get('placement', 'above')
                        text = (words_el.text or '').strip()
                        
                        # Firma: solo texto + placement
                        signature = (text, placement)
                        directions.append((direction, signature))
                
                # Identificar duplicados
                seen = set()
                to_remove = []
                for direction, sig in directions:
                    if sig in seen:
                        to_remove.append(direction)
                        total_removed += 1
                        app.logger.info(f"[Dedup XML] ❌ Eliminando duplicado: texto='{sig[0]}', placement={sig[1]}")
                    else:
                        seen.add(sig)
                
                # Eliminar duplicados
                for direction in to_remove:
                    measure.remove(direction)
        
        if total_removed > 0:
            app.logger.info(f"[Dedup XML] Total eliminados: {total_removed}")
        else:
            app.logger.info(f"[Dedup XML] No se encontraron duplicados")
        
        # Reconstruir XML completo con declaración
        xml_body = ET.tostring(root, encoding='unicode', method='xml')
        return xml_declaration + doctype + xml_body
    except Exception as e:
        app.logger.warning(f"No se pudo deduplicar words: {e}")
        return xml_text

def adjust_text_offsets(score: stream.Score, warnings_list=None) -> stream.Score:
    """
    Ajusta offsets de TextExpression para evitar fusión.
    Si múltiples TextExpression tienen el mismo offset en un compás,
    ajusta a 0, 0.0001, 0.0002, etc. (imperceptible pero evita fusión).
    IMPORTANTE: Asegura IDs únicos y consistentes.
    """
    if warnings_list is None:
        warnings_list = []
    
    for part_idx, part in enumerate(score.parts):
        for measure_idx, measure in enumerate(part.getElementsByClass(stream.Measure)):
            # Agrupar TextExpression por offset
            text_by_offset = {}
            for el in measure.getElementsByClass(expressions.TextExpression):
                offset = measure.elementOffset(el)
                if offset not in text_by_offset:
                    text_by_offset[offset] = []
                text_by_offset[offset].append(el)
            
            # Ajustar offsets si hay múltiples en el mismo
            for original_offset, texts in text_by_offset.items():
                if len(texts) > 1:
                    for i, text in enumerate(texts):
                        # RESPETAR ID del usuario - solo asignar si falta
                        if not text.id or not text.id.strip():
                            text_content_safe = text.content.strip().replace(' ', '-').replace('/', '-').replace('♭', 'b').replace('♯', 's')[:20]
                            text.id = f"{text_content_safe}-m{measure_idx}-p{part_idx}-{i}"
                            app.logger.info(f"[Adjust Offsets] ID auto-asignado (fallback): '{text.id}'")
                        else:
                            app.logger.info(f"[Adjust Offsets] ID del usuario respetado: '{text.id}'")
                        
                        # Ajustar a offsets microscópicos: 0, 0.0001, 0.0002
                        new_offset = original_offset + (i * 0.0001)
                        measure.remove(text)
                        measure.insert(new_offset, text)
                        app.logger.info(f"[Adjust Offsets] '{text.content}' offset: {original_offset} → {new_offset}")
    
    return score

def deduplicate_in_memory(score: stream.Score, warnings_list=None) -> stream.Score:
    """
    Deduplica elementos en memoria ANTES de exportar.
    Elimina TextExpression y ChordSymbol duplicados por firma.
    """
    if warnings_list is None:
        warnings_list = []
    
    duplicates_found = 0
    
    for part_idx, part in enumerate(score.parts):
        for measure_idx, measure in enumerate(part.getElementsByClass(stream.Measure)):
            # LOG: Mostrar TODOS los TextExpression en este compás
            text_elements = []
            for el in measure:
                if isinstance(el, (expressions.TextExpression, harmony.ChordSymbol)):
                    offset = measure.elementOffset(el)
                    text_elements.append((el, offset))
                    
                    # LOG cada elemento encontrado
                    if isinstance(el, expressions.TextExpression):
                        text = (el.content or '').strip()
                        placement = getattr(el, 'placement', 'above')
                        app.logger.info(f"[Dedup] Part {part_idx}, Measure {measure_idx}: TextExpression '{text}' @ {placement}, offset {offset}")
            
            # Deduplicar por firma
            seen_signatures = set()
            to_remove = []
            
            for el, offset in text_elements:
                signature = None
                
                # TextExpression
                if isinstance(el, expressions.TextExpression):
                    text = (el.content or '').strip()
                    placement = getattr(el, 'placement', 'above')
                    signature = ('text', text, placement)
                
                # ChordSymbol
                elif isinstance(el, harmony.ChordSymbol):
                    try:
                        figure = str(el.figure)
                    except:
                        figure = str(el)
                    signature = ('chord', figure)
                
                # Si hay firma y está duplicada, marcar para eliminar
                if signature:
                    if signature in seen_signatures:
                        to_remove.append(el)
                        duplicates_found += 1
                        app.logger.info(f"[Dedup Memoria] ❌ DUPLICADO ELIMINADO: {signature}")
                    else:
                        seen_signatures.add(signature)
            
            # Eliminar duplicados
            for el in to_remove:
                measure.remove(el)
    
    if duplicates_found > 0:
        warnings_list.append(f"{duplicates_found} elemento(s) duplicado(s) eliminado(s)")
        app.logger.info(f"[Dedup Memoria] Total eliminados: {duplicates_found}")
    else:
        app.logger.info(f"[Dedup Memoria] No se encontraron duplicados")
    
    return score

def to_musicxml_string(obj, warnings_list=None) -> str:
    """
    Normaliza a Score, aplica defaults, deduplica EN MEMORIA, exporta a MusicXML.
    """
    if warnings_list is None:
        warnings_list = []
    
    s = normalize_to_score(obj, warnings_list)
    s = add_defaults_to_score(s, warnings_list)
    s = finalize_notation(s)
    
    # Ajustar offsets para evitar fusión de TextExpression
    s = adjust_text_offsets(s, warnings_list)
    
    # Deduplicar en memoria ANTES de exportar
    s = deduplicate_in_memory(s, warnings_list)
    
    exporter = m21ToXml.GeneralObjectExporter(s)
    xml_bytes = exporter.parse()
    xml_text = xml_bytes.decode('utf-8')
    
    # Separar textos fusionados (ej: "Imaj7 Jónico" → separados)
    xml_text = separate_fused_texts(xml_text)
    
    # Mantener deduplicación XML como red de seguridad
    xml_text = deduplicate_words_in_xml(xml_text)
    
    return xml_text

# ============================================================
# ======== DETECCIÓN AUTOMÁTICA EN EL NAMESPACE exec() =======
# ============================================================

M21_TYPES = (
    stream.Score, stream.Part, stream.Stream, stream.Measure,
    note.Note, chord.Chord, meter.TimeSignature, clef.Clef, key.Key,
    tempo.MetronomeMark, expressions.TextExpression,
    harmony.ChordSymbol, roman.RomanNumeral
)

def find_first_music21_object(ns: dict):
    """
    Busca en el namespace un objeto utilizable para music21.
    Preferencias:
      1) 'score' si existe
      2) cualquier instancia de tipos M21_TYPES
      3) 'xml' (MusicXML crudo)
      4) 'mxl' (bytes)
      5) 'path' (str ruta)
    Devuelve una tupla (kind, value) donde kind ∈ {'score','obj','xml','mxl','path'}.
    """
    # 1) score explícito
    sc = ns.get("score")
    if isinstance(sc, stream.Score):
        return "score", sc

    # 2) cualquier objeto de music21
    for k, v in ns.items():
        if isinstance(v, M21_TYPES):
            return "obj", v

    # 3) MusicXML crudo
    if isinstance(ns.get("xml"), str) and ns["xml"].lstrip().startswith("<?xml"):
        return "xml", ns["xml"]

    # 4) MXL en bytes
    if isinstance(ns.get("mxl"), (bytes, bytearray)):
        return "mxl", ns["mxl"]

    # 5) ruta
    if isinstance(ns.get("path"), str):
        return "path", ns["path"]

    return None, None

# ============================================================
# ======== WRAPPER PARA HARMONY.CHORDSYMBOL ROBUSTO ==========
# ============================================================

def SafeChordSymbol(figure, **kwargs):
    """
    Función que reemplaza harmony.ChordSymbol para manejar cifrados no válidos.
    Si falla, devuelve TextExpression automáticamente.
    
    IMPORTANTE: Devuelve el elemento REAL (ChordSymbol o TextExpression),
    no un wrapper, para que pueda ser insertado en Streams.
    """
    # Normalizar figura
    normalized = normalize_chord_figure(figure)
    
    # Intentar crear ChordSymbol
    try:
        element = harmony.ChordSymbol(normalized, **kwargs)
        if normalized != figure:
            app.logger.info(f"[SafeChordSymbol] ✅ Normalizado: '{figure}' → '{normalized}'")
        return element
    except Exception as e:
        # Fallback: TextExpression
        element = expressions.TextExpression(figure)
        element.placement = kwargs.get('placement', 'above')
        app.logger.warning(f"[SafeChordSymbol] ⚠️ Cifrado '{figure}' no reconocido, fallback a TextExpression: {str(e)}")
        return element

def run_music21_snippet_any(code: str):
    """
    Ejecuta el snippet y devuelve (xml_text:str, warnings:list, error:str|None).
    Acepta score/obj/xml/mxl/path en el namespace del usuario.
    """
    # IMPORTANTE: Crear clase SafeHarmony que envuelve harmony
    class SafeHarmony:
        """Wrapper para harmony que usa SafeChordSymbol"""
        def __getattr__(self, name):
            if name == 'ChordSymbol':
                return SafeChordSymbol
            return getattr(harmony, name)
        
        # Exponer todos los atributos de harmony
        def __dir__(self):
            return dir(harmony)
    
    # Pre-popular namespace con imports comunes de music21
    ns = {
        "__name__": "__main__",
        "stream": stream,
        "note": note,
        "chord": chord,
        "meter": meter,
        "clef": clef,
        "key": key,
        "tempo": tempo,
        "expressions": expressions,
        "harmony": SafeHarmony(),  # ✅ Usar SafeHarmony en lugar de harmony
        "metadata": metadata,
        "duration": duration,
        "roman": roman,
        "bar": bar,
        "converter": converter
    }
    warnings_list = []
    
    try:
        # NUEVO: Pre-procesar código
        lines = code.split('\n')
        modified_lines = []
        
        for line in lines:
            # 1. Si importa harmony, NO agregarlo (usaremos SafeHarmony del namespace)
            if 'from music21 import' in line and 'harmony' in line:
                import re
                # Enfoque robusto: split por import, parsear lista, filtrar harmony, reconstruir
                match = re.match(r'^(\s*from\s+music21\s+import\s+)(.+)$', line)
                if match:
                    prefix = match.group(1)
                    imports_str = match.group(2)
                    
                    # Dividir imports por coma
                    imports = [imp.strip() for imp in imports_str.split(',')]
                    # Filtrar harmony
                    imports_filtered = [imp for imp in imports if imp != 'harmony']
                    
                    if imports_filtered:
                        # Reconstruir línea
                        line = prefix + ', '.join(imports_filtered)
                        app.logger.info(f"[SafeChordSymbol] Import modificado: {line.strip()}")
                    else:
                        # Si no queda nada, skip línea
                        app.logger.info(f"[SafeChordSymbol] Import vacío después de remover harmony, skipped")
                        continue
            
            modified_lines.append(line)
            
            # 2. Auto-inicializar metadata si falta
            if 'stream.Score()' in line and '=' in line:
                var_name = line.split('=')[0].strip()
                # Verificar si hay metadata.title más adelante
                has_metadata_use = any('.metadata.title' in l or '.metadata.composer' in l for l in lines)
                has_metadata_init = any('metadata.Metadata()' in l or '.metadata =' in l for l in lines)
                
                if has_metadata_use and not has_metadata_init:
                    indent = len(line) - len(line.lstrip())
                    modified_lines.append(' ' * indent + f'{var_name}.metadata = metadata.Metadata()')
                    warnings_list.append(f"Metadata inicializada automáticamente para '{var_name}'")
                    app.logger.info(f"[Auto-init] Metadata agregada para '{var_name}'")
        
        code = '\n'.join(modified_lines)
        
        exec(code, ns, ns)
        
        # ✅ NUEVO: Añadir lyrics invisibles a TODAS las notas sin lyric
        # Esto permite mapear notas sin lyrics (casos verticales, chord.Chord, etc.)
        for var_name, obj in ns.items():
            # Buscar cualquier objeto Score, Part o Stream
            if isinstance(obj, (stream.Score, stream.Part, stream.Stream)):
                note_count = 0
                for element in obj.recurse().notes:
                    if not element.lyric:
                        element.lyric = ' '  # Espacio simple → invisible en OSMD
                        note_count += 1
                
                if note_count > 0:
                    app.logger.info(f"[Lyrics Invisibles] ✅ Añadidos {note_count} lyrics invisibles a notas sin lyric")
                    warnings_list.append(f"{note_count} nota(s) sin lyric recibieron un lyric invisible para mapeo")
        
        # ✅ CREAR MAPEO: ID del elemento → número de línea
        element_line_map = {}
        lines = code.split('\n')
        
        for line_num, line in enumerate(lines):
            line_stripped = line.strip()
            
            # Detectar asignaciones (c1 =, tx1 =, n =, etc.)
            if '=' in line and not line_stripped.startswith('#'):
                match = re.match(r'^(\s*)(\w+)\s*=\s*', line)
                if match:
                    var_name = match.group(2)
                    
                    if var_name in ns:
                        obj = ns[var_name]
                        
                        # Si tiene ID (.id property)
                        if isinstance(obj, M21_TYPES) and hasattr(obj, 'id') and obj.id:
                            element_line_map[obj.id] = line_num
                            app.logger.info(f"[Line Map] {obj.id} → línea {line_num}")
        
        # Guardar mapeo en namespace global (para devolver luego)
        ns['__element_line_map__'] = element_line_map
        
        kind, value = find_first_music21_object(ns)

        if kind == "score":
            xml_text = to_musicxml_string(value, warnings_list)
            return xml_text, warnings_list, None, element_line_map

        if kind == "obj":
            xml_text = to_musicxml_string(value, warnings_list)
            return xml_text, warnings_list, None, element_line_map

        if kind == "xml":
            # XML directo, sin warnings
            return value, [], None, element_line_map

        if kind == "path":
            xml_text = to_musicxml_string(value, warnings_list)
            return xml_text, warnings_list, None, element_line_map

        if kind == "mxl":
            from io import BytesIO
            sc = converter.parse(BytesIO(value))
            xml_text = to_musicxml_string(sc, warnings_list)
            return xml_text, warnings_list, None, element_line_map

        return None, warnings_list, "No se encontró ningún objeto de music21, 'xml' o 'path' en el código.", {}
    except Exception:
        return None, warnings_list, traceback.format_exc(), {}

# ============================================================
# ======================= RUTAS FLASK ========================
# ============================================================

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/render-xml", methods=["POST"])
def render_xml():
    """
    Recibe:
      - {"code": "...python..."}  -> ejecuta, normaliza y devuelve MusicXML
      - {"xml": "<score-partwise..."} -> lo devuelve tal cual
      - {"path": "/ruta/a/archivo.mid"} -> parsea y devuelve MusicXML
    """
    data = request.get_json(silent=True) or {}

    # 1) si mandan XML directo
    if isinstance(data.get("xml"), str) and data["xml"].lstrip().startswith("<?xml"):
        xml_clean = data["xml"].lstrip('\ufeff').strip()  # Eliminar BOM
        return Response(xml_clean, mimetype="application/vnd.recordare.musicxml+xml; charset=utf-8")

    # 2) si mandan ruta
    if isinstance(data.get("path"), str):
        try:
            xml_payload = to_musicxml_string(data["path"])
            xml_payload = xml_payload.lstrip('\ufeff').strip()  # Eliminar BOM
            return Response(xml_payload, mimetype="application/vnd.recordare.musicxml+xml; charset=utf-8")
        except Exception as e:
            app.logger.exception("Error al convertir ruta a MusicXML")
            return Response(f"Error al convertir ruta a MusicXML: {e}", status=400, mimetype="text/plain")

    # 3) si mandan código python
    code = data.get("code")
    if not code:
        return jsonify({"error": "No se proporcionó 'code', 'xml' ni 'path'."}), 400

    xml_payload, warnings_list, err, element_line_map = run_music21_snippet_any(code)
    if err:
        return jsonify({"error": err}), 400

    if not xml_payload or not xml_payload.strip():
        return Response("Export MusicXML vacío.", status=500, mimetype="text/plain")

    # Garantizar XML puro: eliminar BOM y asegurar inicio correcto
    xml_payload = xml_payload.lstrip('\ufeff').strip()
    
    # Verificar que empiece por <?xml o <score-partwise
    if not (xml_payload.startswith('<?xml') or xml_payload.startswith('<score-partwise')):
        app.logger.error(f"XML generado no válido. Primeros 120 chars: {xml_payload[:120]}")
        # Fallback: crear Score mínimo con mensaje de error
        try:
            from music21 import stream, note, expressions
            fallback_score = stream.Score()
            fallback_part = stream.Part()
            fallback_measure = stream.Measure()
            error_text = expressions.TextExpression("Error: XML generado inválido")
            error_text.placement = 'above'
            fallback_measure.append(error_text)
            fallback_measure.append(note.Rest(quarterLength=4.0))
            fallback_part.append(fallback_measure)
            fallback_score.append(fallback_part)
            fallback_score.metadata = metadata.Metadata()
            fallback_score.metadata.title = "Error en Exportación"
            
            exporter = m21ToXml.GeneralObjectExporter(fallback_score)
            xml_bytes = exporter.parse()
            xml_payload = xml_bytes.decode('utf-8').lstrip('\ufeff').strip()
            
            warnings_list.append("XML inválido, se generó partitura de fallback")
        except Exception as e:
            app.logger.exception("Fallo crítico en fallback de exportación")
            return Response(f"Error crítico en exportación: {e}", status=500, mimetype="text/plain")
    
    # Preparar respuesta con header X-Warnings si hay warnings
    response = Response(xml_payload, mimetype="application/vnd.recordare.musicxml+xml; charset=utf-8")
    
    if warnings_list:
        # Log warnings
        for w in warnings_list:
            app.logger.info(f"[Adaptador Universal] {w}")
        
        # Añadir header X-Warnings (primeros 3 warnings, max 500 chars)
        # Codificar en ASCII eliminando caracteres especiales para HTTP headers
        warnings_summary = "; ".join(warnings_list[:3])
        if len(warnings_summary) > 500:
            warnings_summary = warnings_summary[:497] + "..."
        
        # Convertir caracteres Unicode a ASCII seguro para headers HTTP
        warnings_summary_safe = warnings_summary.encode('ascii', 'replace').decode('ascii')
        
        response.headers['X-Warnings'] = warnings_summary_safe
        response.headers['X-Warnings-Count'] = str(len(warnings_list))
    
    # ✅ NUEVO: Devolver mapeo ID→línea como header JSON
    if element_line_map:
        import json
        element_line_map_json = json.dumps(element_line_map)
        response.headers['X-Element-Line-Map'] = element_line_map_json
        app.logger.info(f"[Line Map] Devolviendo mapeo de {len(element_line_map)} elemento(s)")
    
    return response

@app.route("/apply-edits", methods=["POST"])
def apply_edits():
    data = request.get_json()
    xml_content = data.get("xml_content")
    edits = data.get("edits", {})
    deletions = data.get("deletions", [])
    additions = data.get("additions", [])

    if not xml_content:
        return jsonify({"error": "No se proporcionó contenido MusicXML."}), 400

    try:
        # Simplificación de namespace por comodidad
        xml_content = xml_content.replace('xmlns="http://www.musicxml.org/xsd/musicxml.xsd"', '')
        root = ET.fromstring(xml_content)

        work_title_element = root.find(".//work-title")
        harmony_elements = root.findall(".//harmony")

        element_map = {}
        if work_title_element is not None:
            element_map[f"{work_title_element.text}-0"] = work_title_element

        harmony_counts = {}
        for harmony in harmony_elements:
            kind_node = harmony.find('kind')
            root_step_node = harmony.find('root-step')
            if kind_node is not None and root_step_node is not None:
                kind_text = kind_node.get('text', kind_node.text)
                chord_text = root_step_node.text + kind_text
                count = harmony_counts.get(chord_text, 0)
                element_map[f"{chord_text}-{count}"] = harmony
                harmony_counts[chord_text] = count + 1

        for element_id, pos in edits.items():
            target_element = element_map.get(element_id)
            if target_element is not None:
                target_element.set("default-x", str(pos["x"]))
                target_element.set("default-y", str(pos["y"]))
                app.logger.info(f"Moved element '{element_id}' to ({pos['x']}, {pos['y']})")

        for element_id in deletions:
            target_element = element_map.get(element_id)
            if target_element is not None:
                for parent in root.iter():
                    try:
                        parent.remove(target_element)
                        app.logger.info(f"Deleted element '{element_id}'")
                        break
                    except ValueError:
                        pass

        modified_xml_str = ET.tostring(root, encoding='unicode', method='xml')
        final_xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
        final_xml += '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n'
        final_xml += modified_xml_str

        return Response(final_xml, mimetype="application/vnd.recordare.musicxml+xml; charset=utf-8")

    except ET.ParseError as e:
        app.logger.error(f"Error al parsear MusicXML: {e}")
        return jsonify({"error": f"Error al parsear MusicXML: {e}"}), 400
    except Exception as e:
        app.logger.exception(f"Error inesperado en /apply-edits: {e}")
        return jsonify({"error": f"Error inesperado: {e}"}), 500

@app.route("/apply-edits-xml", methods=["POST"])
def apply_edits_xml():
    """
    Aplica ediciones en coordenadas de tenths (MusicXML) al XML.
    Input: {xml_content, edits: {id: {xTenths, yTenths, scale}}}
    Output: MusicXML modificado
    """
    data = request.get_json()
    xml_content = data.get("xml_content")
    edits = data.get("edits", {})
    
    if not xml_content:
        return jsonify({"error": "No se proporcionó contenido MusicXML."}), 400
    
    try:
        # Simplificar namespace
        xml_content = xml_content.replace('xmlns="http://www.musicxml.org/xsd/musicxml.xsd"', '')
        root = ET.fromstring(xml_content)
        
        # Aplicar ediciones a elementos <direction><words>
        for part in root.findall('.//part'):
            for measure in part.findall('.//measure'):
                for direction in measure.findall('.//direction'):
                    words = direction.find('.//words')
                    if words is not None:
                        text = (words.text or '').strip()
                        placement = direction.get('placement', 'above')
                        
                        # Buscar edición por ID (formato: "texto-N")
                        for edit_id, edit_data in edits.items():
                            if text in edit_id:
                                # Aplicar default-x y default-y en tenths
                                if 'xTenths' in edit_data:
                                    direction.set('default-x', str(edit_data['xTenths']))
                                if 'yTenths' in edit_data:
                                    direction.set('default-y', str(edit_data['yTenths']))
                                app.logger.info(f"[apply-edits-xml] '{edit_id}' → x={edit_data.get('xTenths')}, y={edit_data.get('yTenths')}")
                                break
        
        # Reconstruir XML
        modified_xml = ET.tostring(root, encoding='unicode', method='xml')
        final_xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
        final_xml += '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n'
        final_xml += modified_xml
        
        return Response(final_xml, mimetype="application/vnd.recordare.musicxml+xml; charset=utf-8")
    
    except Exception as e:
        app.logger.exception(f"Error en /apply-edits-xml: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/render-test")
def render_test():
    return jsonify({
        "ok": True,
        "message": "Backend Flask OK. Usa /render-xml desde el frontend."
    })

def generate_chord_accompaniment(score_obj, rhythm_type='auto', octave=3, velocity=0.5):
    """
    Genera una pista de acompañamiento a partir de ChordSymbol.
    
    Args:
        score_obj: Score de music21
        rhythm_type: 'auto' (inteligente), 'whole', 'half', 'quarter'
        octave: octava base para los acordes (3-4 recomendado)
        velocity: intensidad 0.0-1.0 (0.5 = suave)
    
    Returns:
        Part con el acompañamiento o None si no hay cifrados
    """
    # Mapeo de ritmos
    rhythm_map = {
        'whole': 4.0,
        'half': 2.0,
        'quarter': 1.0
    }
    
    # Buscar todos los ChordSymbol en el score con su offset absoluto
    chord_symbols_raw = []
    measure_durations = {}
    
    for part in score_obj.parts:
        for measure in part.getElementsByClass(stream.Measure):
            measure_offset = measure.offset
            measure_duration = measure.duration.quarterLength
            measure_durations[measure_offset] = measure_duration
            
            chords_in_measure = []
            for cs in measure.getElementsByClass(harmony.ChordSymbol):
                local_offset = measure.elementOffset(cs)
                absolute_offset = measure_offset + local_offset
                chords_in_measure.append((absolute_offset, local_offset, cs, measure_offset, measure_duration))
            
            # Si hay múltiples acordes en el mismo offset dentro de un compás, distribuirlos
            if len(chords_in_measure) > 1:
                # Verificar si hay acordes duplicados en el mismo local_offset
                offset_counts = {}
                for _, local_off, _, _, _ in chords_in_measure:
                    offset_counts[local_off] = offset_counts.get(local_off, 0) + 1
                
                # Si todos están en offset 0, distribuirlos uniformemente
                if all(local_off == 0 for _, local_off, _, _, _ in chords_in_measure):
                    num_chords = len(chords_in_measure)
                    interval = measure_duration / num_chords
                    
                    app.logger.info(f"[Acompañamiento] Distribuyendo {num_chords} acordes en compás @ {measure_offset}: intervalo {interval}")
                    
                    adjusted_chords = []
                    for i, (_, _, cs, meas_off, meas_dur) in enumerate(chords_in_measure):
                        new_local_offset = i * interval
                        new_absolute_offset = meas_off + new_local_offset
                        adjusted_chords.append((new_absolute_offset, cs))
                        app.logger.info(f"  {cs.figure} → offset {new_absolute_offset}")
                    
                    chord_symbols_raw.extend(adjusted_chords)
                else:
                    # Algunos están en offsets diferentes, usar tal cual
                    chord_symbols_raw.extend([(abs_off, cs) for abs_off, _, cs, _, _ in chords_in_measure])
            elif len(chords_in_measure) == 1:
                abs_off, _, cs, _, _ = chords_in_measure[0]
                chord_symbols_raw.append((abs_off, cs))
    
    if not chord_symbols_raw:
        app.logger.info("[Acompañamiento] No se encontraron ChordSymbol")
        return None
    
    # Ordenar por offset
    chord_symbols = sorted(chord_symbols_raw, key=lambda x: x[0])
    
    app.logger.info(f"[Acompañamiento] Encontrados {len(chord_symbols)} ChordSymbol")
    
    # Crear nueva Part para acompañamiento
    accomp_part = stream.Part()
    accomp_part.id = 'accompaniment'
    accomp_part.partName = 'Acompañamiento (Oculto)'
    
    # Copiar TimeSignature y tempo del original
    original_part = score_obj.parts[0]
    for ts in original_part.flatten().getElementsByClass(meter.TimeSignature):
        accomp_part.insert(0, ts)
        break
    for mm in original_part.flatten().getElementsByClass(tempo.MetronomeMark):
        accomp_part.insert(0, mm)
        break
    
    # Generar acordes con duración inteligente
    for i, (offset, cs) in enumerate(chord_symbols):
        try:
            # Obtener las notas del acorde
            pitches = cs.pitches
            
            if not pitches:
                app.logger.warning(f"[Acompañamiento] ChordSymbol sin pitches: {cs.figure}")
                continue
            
            # Calcular duración inteligente
            if rhythm_type == 'auto':
                # Duración hasta el siguiente acorde (o hasta fin de compás)
                if i < len(chord_symbols) - 1:
                    next_offset = chord_symbols[i + 1][0]
                    duration_ql = next_offset - offset
                else:
                    # Último acorde: usar 4.0 (redonda) por defecto
                    duration_ql = 4.0
                
                # Limitar duración mínima y máxima
                duration_ql = max(0.25, min(duration_ql, 4.0))
            else:
                duration_ql = rhythm_map.get(rhythm_type, 2.0)
            
            # Crear acorde en la octava especificada
            notes_list = []
            for pitch in pitches:
                # Ajustar octava
                new_pitch = pitch.transpose(12 * (octave - pitch.octave))
                notes_list.append(new_pitch)
            
            # Crear Chord
            chord_obj = chord.Chord(notes_list)
            chord_obj.quarterLength = duration_ql
            chord_obj.volume.velocity = int(velocity * 127)
            
            # Insertar en la Part
            accomp_part.insert(offset, chord_obj)
            
            app.logger.info(f"[Acompañamiento] {cs.figure} @ offset {offset}, duración {duration_ql} → {[str(n) for n in notes_list]}")
            
        except Exception as e:
            app.logger.warning(f"[Acompañamiento] Error procesando {cs.figure}: {e}")
            continue
    
    # Hacer makeMeasures para estructura correcta
    try:
        accomp_part.makeMeasures(inPlace=True)
    except:
        pass
    
    return accomp_part


@app.route("/export-midi", methods=["POST"])
def export_midi():
    """
    Recibe código Python con music21
    → Lo ejecuta
    → Exporta a MIDI
    → Devuelve archivo MIDI
    
    Parámetros opcionales:
    - include_chords: bool (default: False) - generar acompañamiento de cifrados
    - chord_rhythm: str (default: 'half') - 'whole', 'half', 'quarter'
    - chord_octave: int (default: 3) - octava base para acordes
    - chord_velocity: float (default: 0.5) - intensidad 0.0-1.0
    """
    try:
        data = request.get_json()
        code_str = data.get('code', '')
        
        # Parámetros de acompañamiento
        include_chords = data.get('include_chords', False)
        chord_rhythm = data.get('chord_rhythm', 'half')
        chord_octave = data.get('chord_octave', 3)
        chord_velocity = data.get('chord_velocity', 0.5)

        if not code_str.strip():
            return "Error: código vacío", 400

        # ✅ FIX: Ejecutar código con 4 valores de retorno
        xml_payload, warnings_list, err, element_line_map = run_music21_snippet_any(code_str)
        if err:
            return jsonify({"error": err}), 400

        # Parsear el XML generado de vuelta a Score
        score_obj = converter.parse(xml_payload)
        
        # Si se solicita acompañamiento, generarlo
        if include_chords:
            app.logger.info("[MIDI Export] Generando acompañamiento de cifrados...")
            accomp_part = generate_chord_accompaniment(
                score_obj,
                rhythm_type=chord_rhythm,
                octave=chord_octave,
                velocity=chord_velocity
            )
            
            if accomp_part:
                # Añadir Part de acompañamiento al Score
                score_obj.insert(0, accomp_part)
                app.logger.info("[MIDI Export] ✅ Pista de acompañamiento añadida")
            else:
                app.logger.info("[MIDI Export] ⚠️ No se generó acompañamiento (sin cifrados)")
        
        # Exportar a MIDI
        import tempfile
        import os
        
        # Crear archivo temporal
        fd, temp_path = tempfile.mkstemp(suffix='.mid')
        os.close(fd)
        
        try:
            score_obj.write('midi', fp=temp_path)
            
            # Leer contenido
            with open(temp_path, 'rb') as f:
                midi_content = f.read()
            
            # Limpiar archivo temporal
            os.unlink(temp_path)
            
            # Devolver MIDI
            return Response(
                midi_content,
                mimetype='audio/midi',
                headers={
                    'Content-Disposition': 'attachment; filename=score.mid'
                }
            )
        except Exception as e:
            # Limpiar en caso de error
            if os.path.exists(temp_path):
                os.unlink(temp_path)
            raise e
            
    except Exception as e:
        app.logger.exception(f"Error en /export-midi: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/export-xml", methods=["POST"])
def export_xml():
    """
    Endpoint para exportar XML con ediciones.
    Recibe código Python, lo ejecuta y devuelve el XML como descarga.
    """
    try:
        data = request.get_json()
        code_str = data.get('code', '')
        
        if not code_str.strip():
            return "Error: código vacío", 400
        
        # ✅ FIX: Ejecutar código con 4 valores de retorno
        xml_payload, warnings_list, err, element_line_map = run_music21_snippet_any(code_str)
        if err:
            return jsonify({"error": err}), 400
        
        if not xml_payload or not xml_payload.strip():
            return "Error: XML vacío", 500
        
        # Limpiar XML
        xml_payload = xml_payload.lstrip('\ufeff').strip()
        
        # Generar nombre de archivo con timestamp
        from datetime import datetime
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f'partitura_editada_{timestamp}.musicxml'
        
        # Devolver como descarga
        return Response(
            xml_payload,
            mimetype='application/vnd.recordare.musicxml+xml',
            headers={
                'Content-Disposition': f'attachment; filename={filename}',
                'Content-Type': 'application/vnd.recordare.musicxml+xml; charset=utf-8'
            }
        )
        
    except Exception as e:
        app.logger.exception(f"Error en /export-xml: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/validate-chord', methods=['POST'])
def validate_chord():
    """Valida si un texto es un acorde válido"""
    try:
        data = request.get_json()
        chord_text = data.get('text', '').strip()
        
        if not chord_text:
            return jsonify({'valid': False, 'error': 'Texto vacío'})
        
        # Normalizar e intentar crear ChordSymbol
        normalized = normalize_chord_figure(chord_text)
        
        try:
            cs = harmony.ChordSymbol(normalized)
            return jsonify({
                'valid': True,
                'normalized': normalized if normalized != chord_text else None
            })
        except Exception as e:
            return jsonify({
                'valid': False,
                'error': str(e)
            })
            
    except Exception as e:
        app.logger.exception(f"Error en /validate-chord: {e}")
        return jsonify({'valid': False, 'error': str(e)}), 500

@app.route('/validate-note', methods=['POST'])
def validate_note():
    """Valida si un texto es una nota válida (pitch)"""
    try:
        data = request.get_json()
        note_text = data.get('text', '').strip()
        
        if not note_text:
            return jsonify({'valid': False, 'error': 'Texto vacío'})
        
        # Intentar crear nota
        try:
            n = note.Note(note_text)
            return jsonify({'valid': True})
        except Exception as e:
            return jsonify({
                'valid': False,
                'error': f'Nota inválida: {str(e)}'
            })
            
    except Exception as e:
        app.logger.exception(f"Error en /validate-note: {e}")
        return jsonify({'valid': False, 'error': str(e)}), 500

@app.route("/favicon.ico")
def favicon():
    return Response(status=204)

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5001, debug=False, use_reloader=False)
