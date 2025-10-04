#!/bin/bash
# Script para firmar correctamente TODAS las dependencias para notarización

set -e

APP_PATH="dist/Score Viewer.app"
SIGNING_IDENTITY="Developer ID Application: Marcos Vicente Collado Fernández (4FW4YDCWXC)"

echo "🔐 Firmando todas las dependencias correctamente..."

# 1. Firmar TODAS las bibliotecas dinámicas primero
echo "📚 Firmando bibliotecas .dylib..."
find "$APP_PATH" -type f -name "*.dylib" -exec codesign --force --sign "$SIGNING_IDENTITY" --options runtime --timestamp {} \;

echo "📚 Firmando módulos .so..."
find "$APP_PATH" -type f -name "*.so" -exec codesign --force --sign "$SIGNING_IDENTITY" --options runtime --timestamp {} \;

# 2. Firmar frameworks si existen
echo "📦 Firmando frameworks..."
find "$APP_PATH/Contents/Frameworks" -type d -name "*.framework" -exec codesign --force --sign "$SIGNING_IDENTITY" --options runtime --timestamp {} \; 2>/dev/null || true

# 3. Firmar el ejecutable principal
echo "⚙️  Firmando ejecutable principal..."
codesign --force --sign "$SIGNING_IDENTITY" --options runtime --timestamp "$APP_PATH/Contents/MacOS/Score Viewer"

# 4. Finalmente, firmar el bundle completo
echo "📦 Firmando aplicación completa..."
codesign --force --sign "$SIGNING_IDENTITY" --options runtime --timestamp "$APP_PATH"

# 5. Verificar
echo "✅ Verificando firma..."
codesign --verify --deep --strict --verbose=2 "$APP_PATH"

echo "✅ ¡Todas las dependencias firmadas correctamente!"
