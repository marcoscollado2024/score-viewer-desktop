#!/usr/bin/env python3
"""
Script de empaquetado para crear aplicación de escritorio con PyInstaller.
Funciona en macOS y Windows.
"""
import os
import sys
import platform
import subprocess
import shutil
from pathlib import Path

def get_music21_corpus_path():
    """Encuentra la ubicación del corpus de music21"""
    try:
        import music21
        music21_path = Path(music21.__file__).parent
        corpus_path = music21_path / 'corpus'
        if corpus_path.exists():
            return str(corpus_path)
    except:
        pass
    return None

def create_spec_file():
    """Crea el archivo .spec para PyInstaller"""
    
    system = platform.system()
    is_macos = system == 'Darwin'
    is_windows = system == 'Windows'
    
    # Obtener rutas
    current_dir = Path.cwd()
    app_dir = current_dir / 'score_viewer'
    
    # Preparar datas (archivos a incluir)
    datas = [
        ('score_viewer/templates', 'templates'),
        ('score_viewer/static', 'static'),
    ]
    
    # Añadir corpus de music21 si existe
    corpus_path = get_music21_corpus_path()
    if corpus_path:
        datas.append((corpus_path, 'music21/corpus'))
    
    # Hidden imports necesarios
    hidden_imports = [
        'flask',
        'music21',
        'music21.converter',
        'music21.stream',
        'music21.note',
        'music21.chord',
        'music21.meter',
        'music21.clef',
        'music21.key',
        'music21.tempo',
        'music21.expressions',
        'music21.harmony',
        'music21.roman',
        'music21.metadata',
        'music21.duration',
        'music21.bar',
        'music21.musicxml',
        'music21.musicxml.m21ToXml',
        'bs4',
        'beautifulsoup4',
        'lxml',
        'xml.etree.ElementTree',
        'mimetypes',
        'logging',
        'traceback',
        're',
    ]
    
    # Configuración específica por plataforma
    if is_macos:
        icon_file = 'score_viewer/static/icons/icon-512.png'
        bundle_identifier = 'com.partituras.scoreviewer'
    else:
        icon_file = 'score_viewer/static/icons/icon-512.png'  # Se convertirá a .ico
        bundle_identifier = None
    
    spec_content = f'''# -*- mode: python ; coding: utf-8 -*-

block_cipher = None

a = Analysis(
    ['score_viewer/app.py'],
    pathex=[],
    binaries=[],
    datas={datas},
    hiddenimports={hidden_imports},
    hookspath=[],
    hooksconfig={{}},
    runtime_hooks=[],
    excludes=['matplotlib', 'numpy', 'scipy', 'pandas', 'PIL'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='ScoreViewer',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console={'True' if is_windows else 'False'},
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='{icon_file}',
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='ScoreViewer',
)

'''
    
    if is_macos:
        spec_content += f'''
app = BUNDLE(
    coll,
    name='ScoreViewer.app',
    icon='{icon_file}',
    bundle_identifier='{bundle_identifier}',
    info_plist={{
        'CFBundleName': 'Score Viewer',
        'CFBundleDisplayName': 'Score Viewer',
        'CFBundleIdentifier': '{bundle_identifier}',
        'CFBundleVersion': '1.0.0',
        'CFBundleShortVersionString': '1.0.0',
        'NSHighResolutionCapable': True,
    }},
)
'''
    
    # Escribir archivo .spec
    spec_path = current_dir / 'ScoreViewer.spec'
    with open(spec_path, 'w', encoding='utf-8') as f:
        f.write(spec_content)
    
    print(f"✅ Archivo .spec creado: {spec_path}")
    return spec_path

def install_dependencies():
    """Instala PyInstaller y dependencias necesarias"""
    print("📦 Instalando PyInstaller...")
    
    try:
        subprocess.run([
            sys.executable, '-m', 'pip', 'install', 
            'pyinstaller', 'pillow'
        ], check=True)
        print("✅ PyInstaller instalado correctamente")
    except subprocess.CalledProcessError as e:
        print(f"❌ Error instalando PyInstaller: {e}")
        sys.exit(1)

def convert_icon_to_ico(png_path):
    """Convierte PNG a ICO para Windows"""
    try:
        from PIL import Image
        img = Image.open(png_path)
        ico_path = png_path.replace('.png', '.ico')
        img.save(ico_path, format='ICO', sizes=[(256, 256)])
        print(f"✅ Icono convertido: {ico_path}")
        return ico_path
    except Exception as e:
        print(f"⚠️ No se pudo convertir icono: {e}")
        return png_path

def build_app(spec_path):
    """Ejecuta PyInstaller con el archivo .spec"""
    print("\n🔨 Iniciando construcción...")
    
    try:
        # Limpiar builds anteriores
        for folder in ['build', 'dist']:
            if os.path.exists(folder):
                shutil.rmtree(folder)
                print(f"🧹 Limpiado: {folder}/")
        
        # Ejecutar PyInstaller
        subprocess.run([
            'pyinstaller',
            '--clean',
            '--noconfirm',
            str(spec_path)
        ], check=True)
        
        print("\n✅ ¡Construcción completada!")
        
        # Mostrar ubicación del ejecutable
        system = platform.system()
        if system == 'Darwin':
            app_path = Path('dist/ScoreViewer.app')
            print(f"\n📦 Aplicación creada: {app_path.absolute()}")
            print(f"   Para ejecutar: open {app_path}")
        else:
            exe_path = Path('dist/ScoreViewer/ScoreViewer.exe')
            print(f"\n📦 Ejecutable creado: {exe_path.absolute()}")
            print(f"   Para ejecutar: {exe_path}")
        
    except subprocess.CalledProcessError as e:
        print(f"\n❌ Error durante la construcción: {e}")
        sys.exit(1)

def main():
    print("=" * 60)
    print("  EMPAQUETADOR SCORE VIEWER - PyInstaller")
    print("=" * 60)
    print(f"Sistema: {platform.system()} {platform.release()}")
    print(f"Python: {sys.version.split()[0]}")
    print()
    
    # Verificar que estamos en el directorio correcto
    if not os.path.exists('score_viewer/app.py'):
        print("❌ Error: Ejecuta este script desde el directorio raíz del proyecto")
        print("   (debe contener la carpeta 'score_viewer/')")
        sys.exit(1)
    
    # Paso 1: Instalar PyInstaller
    install_dependencies()
    
    # Paso 2: Crear archivo .spec
    spec_path = create_spec_file()
    
    # Paso 3: Convertir icono en Windows
    if platform.system() == 'Windows':
        png_icon = 'score_viewer/static/icons/icon-512.png'
        if os.path.exists(png_icon):
            convert_icon_to_ico(png_icon)
    
    # Paso 4: Construir aplicación
    build_app(spec_path)
    
    print("\n" + "=" * 60)
    print("  ✅ PROCESO COMPLETADO")
    print("=" * 60)
    print("\n📋 Próximos pasos:")
    print("   1. Prueba el ejecutable en dist/")
    print("   2. Distribuye la carpeta/app completa a usuarios")
    print("   3. Los usuarios NO necesitan Python instalado")
    print()

if __name__ == '__main__':
    main()
