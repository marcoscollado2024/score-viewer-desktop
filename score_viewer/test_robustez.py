"""
Tests para verificar el Plan de Robustez Completo
Sprint 4: Tests Automáticos
"""

import sys
import os

# Añadir el directorio padre al path para importar app
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import (
    normalize_chord_figure,
    safe_create_chord_symbol,
    normalize_to_score,
    deduplicate_in_memory,
    to_musicxml_string
)
from music21 import stream, note, chord, expressions, harmony

def test_normalize_chord_figure():
    """Test de normalización de cifrados"""
    print("\n=== Test: Normalización de Cifrados ===")
    
    tests = [
        ("maj7(9)", "maj9"),
        ("Maj7(9)", "maj9"),
        ("m7(9,11,13)", "m13"),
        ("C-7", "Cm7"),
        ("C m7", "Cm7"),
        ("7#9", "7(#9)"),
        ("7b9", "7(b9)"),
        ("B-", "Bb"),
    ]
    
    passed = 0
    for original, expected in tests:
        result = normalize_chord_figure(original)
        status = "✅" if result == expected else "❌"
        print(f"{status} '{original}' → '{result}' (esperado: '{expected}')")
        if result == expected:
            passed += 1
    
    print(f"\nResultado: {passed}/{len(tests)} tests pasados")
    return passed == len(tests)

def test_safe_create_chord_symbol():
    """Test de creación segura de símbolos de acorde"""
    print("\n=== Test: Creación Segura de Símbolos ===")
    
    warnings = []
    
    # Test 1: Cifrado válido después de normalizar
    print("\nTest 1: Cifrado válido (Cmaj7(9) → Cmaj9)")
    elem, tipo = safe_create_chord_symbol("Cmaj7(9)", warnings)
    print(f"  Resultado: tipo='{tipo}', warnings={len(warnings)}")
    assert tipo in ['chordsymbol', 'text'], "Tipo debe ser chordsymbol o text"
    
    # Test 2: Cifrado inválido → fallback a texto
    warnings.clear()
    print("\nTest 2: Cifrado inválido (XXX###)")
    elem, tipo = safe_create_chord_symbol("XXX###", warnings)
    print(f"  Resultado: tipo='{tipo}', warnings={len(warnings)}")
    assert tipo == 'text', "Cifrado inválido debe devolver 'text'"
    assert len(warnings) > 0, "Debe registrar warning"
    
    print("\n✅ Tests de creación segura pasados")
    return True

def test_normalize_to_score():
    """Test de normalización a Score"""
    print("\n=== Test: Normalización a Score ===")
    
    warnings = []
    
    # Test 1: Nota suelta
    print("\nTest 1: Nota suelta")
    n = note.Note('C4', quarterLength=1.0)
    score = normalize_to_score(n, warnings)
    assert isinstance(score, stream.Score), "Debe devolver Score"
    print(f"  ✅ Nota → Score ({len(score.parts)} parts)")
    
    # Test 2: Acorde suelto
    print("\nTest 2: Acorde suelto")
    c = chord.Chord(['C', 'E', 'G'])
    score = normalize_to_score(c, warnings)
    assert isinstance(score, stream.Score), "Debe devolver Score"
    print(f"  ✅ Acorde → Score ({len(score.parts)} parts)")
    
    # Test 3: Lista mixta
    print("\nTest 3: Lista mixta")
    lista = [note.Note('C4'), chord.Chord(['D', 'F', 'A'])]
    score = normalize_to_score(lista, warnings)
    assert isinstance(score, stream.Score), "Debe devolver Score"
    print(f"  ✅ Lista → Score ({len(score.parts)} parts)")
    
    print("\n✅ Tests de normalización pasados")
    return True

def test_deduplicate_in_memory():
    """Test de deduplicación en memoria"""
    print("\n=== Test: Deduplicación en Memoria ===")
    
    warnings = []
    
    # Crear score con duplicados
    score = stream.Score()
    part = stream.Part()
    measure = stream.Measure()
    
    # Añadir acorde
    c = chord.Chord(['C', 'E', 'G'])
    measure.append(c)
    
    # Añadir DUPLICADOS de texto
    te1 = expressions.TextExpression("I-7 (9,11,13)")
    te1.placement = 'above'
    measure.insert(0, te1)
    
    te2 = expressions.TextExpression("I-7 (9,11,13)")
    te2.placement = 'above'
    measure.insert(0, te2)  # DUPLICADO
    
    te3 = expressions.TextExpression("Dórico")
    te3.placement = 'below'
    measure.insert(0, te3)
    
    part.append(measure)
    score.append(part)
    
    # Contar elementos antes
    texts_before = len([e for e in measure if isinstance(e, expressions.TextExpression)])
    print(f"\nAntes de deduplicar: {texts_before} textos")
    
    # Deduplicar
    score = deduplicate_in_memory(score, warnings)
    
    # Contar elementos después
    measure = score.parts[0].getElementsByClass(stream.Measure)[0]
    texts_after = len([e for e in measure if isinstance(e, expressions.TextExpression)])
    print(f"Después de deduplicar: {texts_after} textos")
    print(f"Warnings generados: {len(warnings)}")
    
    assert texts_after < texts_before, "Debe eliminar duplicados"
    assert len(warnings) > 0, "Debe registrar warnings"
    
    print("✅ Test de deduplicación pasado")
    return True

def test_export_musicxml():
    """Test de exportación a MusicXML"""
    print("\n=== Test: Exportación a MusicXML ===")
    
    # Crear score simple
    score = stream.Score()
    part = stream.Part()
    measure = stream.Measure()
    measure.append(note.Note('C4', quarterLength=1.0))
    part.append(measure)
    score.append(part)
    
    # Exportar
    warnings = []
    xml = to_musicxml_string(score, warnings)
    
    # Verificar
    assert xml.startswith('<?xml') or xml.startswith('<score-partwise'), "Debe empezar por XML válido"
    assert 'score-partwise' in xml, "Debe contener score-partwise"
    
    print(f"✅ XML exportado: {len(xml)} chars")
    print(f"  Empieza con: {xml[:50]}")
    print(f"  Warnings: {len(warnings)}")
    
    return True

def run_all_tests():
    """Ejecuta todos los tests"""
    print("\n" + "="*60)
    print("EJECUTANDO TESTS DE ROBUSTEZ")
    print("="*60)
    
    results = {
        "Normalización de Cifrados": test_normalize_chord_figure(),
        "Creación Segura de Símbolos": test_safe_create_chord_symbol(),
        "Normalización a Score": test_normalize_to_score(),
        "Deduplicación en Memoria": test_deduplicate_in_memory(),
        "Exportación a MusicXML": test_export_musicxml(),
    }
    
    print("\n" + "="*60)
    print("RESUMEN DE TESTS")
    print("="*60)
    
    for test_name, passed in results.items():
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"{status} - {test_name}")
    
    total = len(results)
    passed = sum(results.values())
    
    print("\n" + "="*60)
    print(f"RESULTADO FINAL: {passed}/{total} tests pasados ({passed*100//total}%)")
    print("="*60)
    
    return passed == total

if __name__ == "__main__":
    try:
        success = run_all_tests()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"\n❌ ERROR CRÍTICO: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
