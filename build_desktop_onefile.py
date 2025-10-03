#!/usr/bin/env python3
"""
Script para crear un EJECUTABLE ÚNICO (onefile) más compacto.
Tarda más en iniciar pero es un solo archivo .exe/.app
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

def create_spec_file_onefile():
    """Crea archivo .spec para modo onefile (ejecutable único)"""
    
    system = platform.system()
    is_macos = system == 'Darwin'
    is_windows = system == 'Windows'
    
    # Preparar datas
    datas = [
        ('score_viewer/templates', 'templates'),
        ('score_viewer/static', 'static'),
    ]
    
    # Añadir corpus de music21 si existe
    corpus_path = get_music21_corpus_path()
    if corpus_path:
        datas.append((corpus_path, 'music21/corpus'))
    
    # Hidden imports
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
        'webbrowser',
        'threading',
        'time',
    ]
    
    # Icono
    if is_macos:
        icon_file = 'score_viewer/static/icons/icon-512.png'
        bundle_identifier = 'com.partituras.scoreviewer'
    else:
        icon_file = 'score_viewer/static/icons/icon-512.png'
        bundle_identifier = None
    
    spec_content = f'''# -*- mode: python ; coding: utf-8 -*-

block_cipher = None

a = Analysis(
    ['score_viewer/launcher.py'],
    pathex=[],
    binaries=[],
    datas={datas},
    hiddenimports={hidden_imports},
    hookspath=[],
    hooksconfig={{}},
    runtime_hooks=[],
    excludes=['matplotlib', 'numpy', 'scipy', 'pandas', 'PIL', 'pytest', 'IPython'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='ScoreViewer',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console={'True' if is_windows else 'False'},
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='{icon_file}',
)
'''
    
    if is_macos:
        spec_content += f'''
app = BUNDLE(
    exe,
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
    
    spec_path = Path.cwd() / 'ScoreViewer_onefile.spec'
    with open(spec_path, 'w', encoding='utf-8') as f:
        f.write(spec_content)
    
    print(f"✅ Archivo .spec creado: {spec_path}")
    return spec_path

def install_dependencies():
    """Instala PyInstaller y dependencias"""
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

def build_app(spec_path):
    """Ejecuta PyInstaller"""
    print("\n🔨 Iniciando construcción (ONEFILE - puede tardar varios minutos)...")
    
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
        
        system = platform.system()
        if system == 'Darwin':
            app_path = Path('dist/ScoreViewer.app')
            print(f"\n📦 Aplicación creada: {app_path.absolute()}")
            print(f"   Para ejecutar: open {app_path}")
            print(f"   Tamaño aproximado: ~100-200 MB")
        else:
            exe_path = Path('dist/ScoreViewer.exe')
            print(f"\n📦 Ejecutable creado: {exe_path.absolute()}")
            print(f"   Para ejecutar: {exe_path}")
            print(f"   Tamaño aproximado: ~100-200 MB")
        
        print("\n⚠️  NOTA: El ejecutable tarda ~10-30 segundos en iniciar la primera vez")
        print("         (descomprime archivos en carpeta temporal)")
        
    except subprocess.CalledProcessError as e:
        print(f"\n❌ Error durante la construcción: {e}")
        sys.exit(1)

def main():
    print("=" * 70)
    print("  EMPAQUETADOR SCORE VIEWER - MODO ONEFILE (Ejecutable Único)")
    print("=" * 70)
    print(f"Sistema: {platform.system()} {platform.release()}")
    print(f"Python: {sys.version.split()[0]}")
    print()
    print("🎯 Este modo crea UN SOLO ARCHIVO ejecutable (más compacto)")
    print("   Ventaja: Fácil de distribuir, un solo archivo")
    print("   Desventaja: Tarda más en iniciar (~10-30 seg)")
    print()
    
    # Verificar directorio
    if not os.path.exists('score_viewer/launcher.py'):
        print("❌ Error: Ejecuta este script desde el directorio raíz del proyecto")
        sys.exit(1)
    
    # Instalar PyInstaller
    install_dependencies()
    
    # Crear .spec
    spec_path = create_spec_file_onefile()
    
    # Convertir icono en Windows
    if platform.system() == 'Windows':
        png_icon = 'score_viewer/static/icons/icon-512.png'
        if os.path.exists(png_icon):
            try:
                from PIL import Image
                img = Image.open(png_icon)
                ico_path = png_icon.replace('.png', '.ico')
                img.save(ico_path, format='ICO', sizes=[(256, 256)])
                print(f"✅ Icono convertido: {ico_path}")
            except Exception as e:
                print(f"⚠️ No se pudo convertir icono: {e}")
    
    # Construir
    build_app(spec_path)
    
    print("\n" + "=" * 70)
    print("  ✅ PROCESO COMPLETADO")
    print("=" * 70)
    print("\n📋 El ejecutable está en dist/")
    print("   - Puedes distribuir SOLO ese archivo")
    print("   - Los usuarios NO necesitan Python")
    print("   - El archivo pesa ~100-200 MB")
    print()

if __name__ == '__main__':
    main()
