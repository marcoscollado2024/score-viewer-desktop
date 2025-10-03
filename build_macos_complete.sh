#!/bin/bash
# Script maestro para empaquetar Score Viewer como app profesional de macOS
# Incluye: compilación, DMG, firma y notarización

set -e  # Detener si hay errores

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}    EMPAQUETADO PROFESIONAL SCORE VIEWER - macOS${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"

# Verificar que estamos en el directorio correcto
if [ ! -d "score_viewer" ]; then
    echo -e "${RED}❌ Error: Ejecuta este script desde el directorio raíz del proyecto${NC}"
    exit 1
fi

# Variables de configuración
APP_NAME="Score Viewer"
APP_BUNDLE_ID="com.partituras.scoreviewer"
APP_VERSION="1.0.0"
VENV_DIR="venv_build"
DMG_NAME="ScoreViewer-${APP_VERSION}"

# ============================================================
# PASO 1: CREAR ENTORNO VIRTUAL Y COMPILAR CON PYINSTALLER
# ============================================================
echo -e "\n${GREEN}📦 PASO 1: Creando entorno virtual y compilando app${NC}"

# Limpiar entorno virtual anterior si existe
if [ -d "$VENV_DIR" ]; then
    echo "🧹 Limpiando entorno virtual anterior..."
    rm -rf "$VENV_DIR"
fi

# Crear nuevo entorno virtual
echo "🔨 Creando entorno virtual..."
python3 -m venv "$VENV_DIR"
source "$VENV_DIR/bin/activate"

# Instalar dependencias
echo "📥 Instalando dependencias..."
pip install --upgrade pip > /dev/null 2>&1
pip install pyinstaller pillow > /dev/null 2>&1
pip install -r score_viewer/requirements.txt > /dev/null 2>&1

# Crear archivo .spec para PyInstaller
echo "📝 Generando configuración PyInstaller..."
python3 << 'PYTHON_SCRIPT'
from pathlib import Path
import music21

# Obtener ruta del corpus de music21
music21_path = Path(music21.__file__).parent
corpus_path = music21_path / 'corpus'

spec_content = f'''# -*- mode: python ; coding: utf-8 -*-

block_cipher = None

# Recopilar datos
datas = [
    ('score_viewer/templates', 'templates'),
    ('score_viewer/static', 'static'),
    ('{corpus_path}', 'music21/corpus'),
]

# Hidden imports
hiddenimports = [
    'flask', 'music21', 'music21.converter', 'music21.stream',
    'music21.note', 'music21.chord', 'music21.meter', 'music21.clef',
    'music21.key', 'music21.tempo', 'music21.expressions', 'music21.harmony',
    'music21.roman', 'music21.metadata', 'music21.duration', 'music21.bar',
    'music21.musicxml', 'music21.musicxml.m21ToXml', 'bs4', 'beautifulsoup4',
    'lxml', 'xml.etree.ElementTree', 'mimetypes', 'logging', 'traceback',
    're', 'webbrowser', 'threading', 'time',
]

a = Analysis(
    ['score_viewer/launcher.py'],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={{}},
    runtime_hooks=[],
    excludes=['matplotlib', 'numpy', 'scipy', 'pandas', 'pytest', 'IPython'],
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
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
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

app = BUNDLE(
    coll,
    name='Score Viewer.app',
    icon='score_viewer/static/icons/icon-512.png',
    bundle_identifier='com.partituras.scoreviewer',
    info_plist={{
        'CFBundleName': 'Score Viewer',
        'CFBundleDisplayName': 'Score Viewer',
        'CFBundleIdentifier': 'com.partituras.scoreviewer',
        'CFBundleVersion': '1.0.0',
        'CFBundleShortVersionString': '1.0.0',
        'NSHighResolutionCapable': True,
        'NSAppleScriptEnabled': False,
        'CFBundleDocumentTypes': [],
    }},
)
'''

with open('ScoreViewer.spec', 'w') as f:
    f.write(spec_content)
print("✅ Archivo .spec creado")
PYTHON_SCRIPT

# Compilar con PyInstaller
echo "🔨 Compilando aplicación (esto puede tardar 3-5 minutos)..."
pyinstaller --clean --noconfirm ScoreViewer.spec

# Verificar que se creó la app
if [ ! -d "dist/Score Viewer.app" ]; then
    echo -e "${RED}❌ Error: No se pudo crear la aplicación${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Aplicación compilada: dist/Score Viewer.app${NC}"

# Desactivar entorno virtual
deactivate

# ============================================================
# PASO 2: CREAR ICONO .icns PARA macOS
# ============================================================
echo -e "\n${GREEN}🎨 PASO 2: Generando icono .icns${NC}"

# Crear iconset desde PNG
mkdir -p icon.iconset
sips -z 16 16     score_viewer/static/icons/icon-512.png --out icon.iconset/icon_16x16.png > /dev/null 2>&1
sips -z 32 32     score_viewer/static/icons/icon-512.png --out icon.iconset/icon_16x16@2x.png > /dev/null 2>&1
sips -z 32 32     score_viewer/static/icons/icon-512.png --out icon.iconset/icon_32x32.png > /dev/null 2>&1
sips -z 64 64     score_viewer/static/icons/icon-512.png --out icon.iconset/icon_32x32@2x.png > /dev/null 2>&1
sips -z 128 128   score_viewer/static/icons/icon-512.png --out icon.iconset/icon_128x128.png > /dev/null 2>&1
sips -z 256 256   score_viewer/static/icons/icon-512.png --out icon.iconset/icon_128x128@2x.png > /dev/null 2>&1
sips -z 256 256   score_viewer/static/icons/icon-512.png --out icon.iconset/icon_256x256.png > /dev/null 2>&1
sips -z 512 512   score_viewer/static/icons/icon-512.png --out icon.iconset/icon_256x256@2x.png > /dev/null 2>&1
sips -z 512 512   score_viewer/static/icons/icon-512.png --out icon.iconset/icon_512x512.png > /dev/null 2>&1
sips -z 1024 1024 score_viewer/static/icons/icon-512.png --out icon.iconset/icon_512x512@2x.png > /dev/null 2>&1

# Convertir a .icns
iconutil -c icns icon.iconset -o app_icon.icns
cp app_icon.icns "dist/Score Viewer.app/Contents/Resources/icon-windowed.icns"

# Limpiar
rm -rf icon.iconset

echo -e "${GREEN}✅ Icono .icns generado${NC}"

# ============================================================
# PASO 3: CREAR DMG PROFESIONAL
# ============================================================
echo -e "\n${GREEN}💿 PASO 3: Creando DMG profesional${NC}"

# Crear directorio temporal para DMG
DMG_TEMP="dmg_temp"
rm -rf "$DMG_TEMP"
mkdir -p "$DMG_TEMP"

# Copiar app al directorio temporal
cp -R "dist/Score Viewer.app" "$DMG_TEMP/"

# Crear enlace simbólico a Applications
ln -s /Applications "$DMG_TEMP/Applications"

# Crear DMG temporal sin comprimir
DMG_TEMP_FILE="${DMG_NAME}_temp.dmg"
rm -f "$DMG_TEMP_FILE"

hdiutil create -volname "$APP_NAME" \
    -srcfolder "$DMG_TEMP" \
    -ov -format UDRW \
    -fs HFS+ \
    "$DMG_TEMP_FILE"

echo -e "${GREEN}✅ DMG temporal creado${NC}"

# Montar DMG para personalizar
echo "🎨 Personalizando DMG..."
MOUNT_DIR="/Volumes/$APP_NAME"
hdiutil attach "$DMG_TEMP_FILE" -mountpoint "$MOUNT_DIR"

# Esperar a que se monte
sleep 2

# Configurar vista del Finder
echo '
   tell application "Finder"
     tell disk "'$APP_NAME'"
           open
           set current view of container window to icon view
           set toolbar visible of container window to false
           set statusbar visible of container window to false
           set the bounds of container window to {100, 100, 700, 500}
           set viewOptions to the icon view options of container window
           set arrangement of viewOptions to not arranged
           set icon size of viewOptions to 128
           set position of item "Score Viewer.app" of container window to {150, 200}
           set position of item "Applications" of container window to {450, 200}
           update without registering applications
           delay 2
     end tell
   end tell
' | osascript

# Desmontar
hdiutil detach "$MOUNT_DIR"

# Convertir a DMG final comprimido
DMG_FINAL="${DMG_NAME}.dmg"
rm -f "$DMG_FINAL"
hdiutil convert "$DMG_TEMP_FILE" -format UDZO -imagekey zlib-level=9 -o "$DMG_FINAL"

# Limpiar temporales
rm -f "$DMG_TEMP_FILE"
rm -rf "$DMG_TEMP"

echo -e "${GREEN}✅ DMG creado: ${DMG_FINAL}${NC}"

# ============================================================
# PASO 4: FIRMA Y NOTARIZACIÓN (OPCIONAL)
# ============================================================
echo -e "\n${YELLOW}🔐 PASO 4: Firma y Notarización${NC}"
echo -e "${YELLOW}Para firmar y notarizar, necesitas:${NC}"
echo -e "  1. Certificado 'Developer ID Application' instalado"
echo -e "  2. Credenciales de notarización configuradas"
echo ""
echo -e "${YELLOW}¿Quieres proceder con firma y notarización ahora?${NC}"
echo -e "  Escribe 'si' para continuar, o presiona Enter para omitir"
read -p "> " SIGN_RESPONSE

if [[ "$SIGN_RESPONSE" == "si" ]]; then
    # Buscar identidad de firma
    echo "🔍 Buscando certificado Developer ID..."
    SIGNING_IDENTITY=$(security find-identity -v -p codesigning | grep "Developer ID Application" | head -1 | awk -F'"' '{print $2}')
    
    if [ -z "$SIGNING_IDENTITY" ]; then
        echo -e "${RED}❌ No se encontró certificado 'Developer ID Application'${NC}"
        echo "   Instala tu certificado desde Apple Developer"
        exit 1
    fi
    
    echo -e "${GREEN}✅ Certificado encontrado: $SIGNING_IDENTITY${NC}"
    
    # Firmar app
    echo "✍️  Firmando aplicación..."
    codesign --deep --force --verify --verbose \
        --sign "$SIGNING_IDENTITY" \
        --options runtime \
        "dist/Score Viewer.app"
    
    # Verificar firma
    codesign --verify --deep --strict --verbose=2 "dist/Score Viewer.app"
    echo -e "${GREEN}✅ Aplicación firmada correctamente${NC}"
    
    # Firmar DMG
    echo "✍️  Firmando DMG..."
    codesign --force --sign "$SIGNING_IDENTITY" "$DMG_FINAL"
    echo -e "${GREEN}✅ DMG firmado correctamente${NC}"
    
    # Notarización
    echo ""
    echo -e "${YELLOW}Para notarizar necesitas:${NC}"
    echo "  - Apple ID configurado con credenciales específicas de app"
    echo "  - Team ID de tu cuenta de desarrollador"
    echo ""
    echo "Comando para notarizar (ejecuta manualmente):"
    echo -e "${BLUE}xcrun notarytool submit $DMG_FINAL --apple-id TU_EMAIL --password TU_APP_PASSWORD --team-id TU_TEAM_ID --wait${NC}"
    echo ""
    echo "Después de notarizar, agrapa el ticket:"
    echo -e "${BLUE}xcrun stapler staple $DMG_FINAL${NC}"
else
    echo -e "${YELLOW}⏭️  Firma y notarización omitidas${NC}"
    echo "   La app funcionará pero macOS mostrará advertencia de seguridad"
    echo "   Los usuarios deben hacer clic derecho > Abrir la primera vez"
fi

# ============================================================
# RESUMEN FINAL
# ============================================================
echo -e "\n${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ PROCESO COMPLETADO${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${GREEN}📦 Archivos generados:${NC}"
echo -e "   1. dist/Score Viewer.app    (Aplicación)"
echo -e "   2. $DMG_FINAL  (Instalador DMG)"
echo ""
echo -e "${GREEN}📋 Para probar:${NC}"
echo -e "   ${BLUE}open \"dist/Score Viewer.app\"${NC}"
echo ""
echo -e "${GREEN}📋 Para distribuir:${NC}"
echo -e "   Sube el archivo ${BLUE}$DMG_FINAL${NC}"
echo ""
echo -e "${GREEN}🔒 Estado de seguridad:${NC}"
if [[ "$SIGN_RESPONSE" == "si" ]]; then
    echo -e "   ✅ App firmada (si notarizas, no habrá advertencias)"
else
    echo -e "   ⚠️  App sin firmar (advertencia al primer uso)"
fi
echo ""
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
