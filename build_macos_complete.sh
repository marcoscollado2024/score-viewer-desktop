#!/bin/bash
set -e

echo "====== 🚀 Score Viewer - Build para macOS ======"
echo ""

# Colores para output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Verificar que estamos en el directorio correcto
if [ ! -d "score_viewer" ]; then
    echo -e "${RED}❌ Error: Debes ejecutar este script desde el directorio raíz del proyecto${NC}"
    exit 1
fi

# Limpiar builds anteriores
echo -e "${YELLOW}🧹 Limpiando builds anteriores...${NC}"
rm -rf build/ dist/ venv_build/ dmg_temp/ *.dmg *.spec

# Crear entorno virtual temporal
echo -e "${YELLOW}📦 Creando entorno virtual temporal...${NC}"
python3 -m venv venv_build
source venv_build/bin/activate

# Instalar dependencias
echo -e "${YELLOW}📥 Instalando dependencias...${NC}"
pip install --upgrade pip
pip install -r score_viewer/requirements.txt
pip install pyinstaller pillow

# Compilar con PyInstaller
echo -e "${YELLOW}⚙️  Compilando con PyInstaller...${NC}"
pyinstaller --name "Score Viewer" \
    --windowed \
    --onedir \
    --icon=app_icon.icns \
    --add-data "score_viewer/templates:templates" \
    --add-data "score_viewer/static:static" \
    --osx-bundle-identifier "com.marcoscollado.scoreviewer" \
    --hidden-import=PIL \
    --hidden-import=PIL._tkinter_finder \
    score_viewer/launcher.py

echo -e "${GREEN}✅ Compilación exitosa${NC}"

# Crear DMG
echo -e "${YELLOW}💿 Creando DMG...${NC}"
mkdir -p dmg_temp
cp -R "dist/Score Viewer.app" dmg_temp/
ln -s /Applications dmg_temp/Applications

# Generar nombre con timestamp
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DMG_NAME="ScoreViewer-macOS-${TIMESTAMP}.dmg"

hdiutil create -volname "Score Viewer" \
    -srcfolder dmg_temp \
    -ov -format UDZO \
    "$DMG_NAME"

echo -e "${GREEN}✅ DMG creado: $DMG_NAME${NC}"

# Limpiar
echo -e "${YELLOW}🧹 Limpiando archivos temporales...${NC}"
rm -rf dmg_temp/ build/ venv_build/ *.spec
deactivate 2>/dev/null || true

# Mostrar resultado
echo ""
echo -e "${GREEN}====== ✅ BUILD COMPLETO ======${NC}"
echo ""
echo "📦 Archivo generado:"
echo "   $DMG_NAME"
echo ""
echo "📊 Tamaño:"
du -h "$DMG_NAME"
echo ""
echo "🔍 Para verificar la app:"
echo "   open dist/Score\\ Viewer.app"
echo ""
echo "⚠️  NOTA: Esta app NO está firmada ni notarizada."
echo "   macOS mostrará advertencias de seguridad."
echo ""
echo "Para firmar y notarizar necesitas:"
echo "   - Cuenta Apple Developer (\$99/año)"
echo "   - Certificado de firma"
echo "   - App-specific password"
echo ""
echo "Comandos para probar localmente:"
echo "   1. Abrir DMG: open \"$DMG_NAME\""
echo "   2. Arrastrar a Applications"
echo "   3. Ejecutar desde Applications"
echo ""
