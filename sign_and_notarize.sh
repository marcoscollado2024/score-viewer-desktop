#!/bin/bash
# Script de firma y notarización automática para macOS
# Requiere: Certificado Developer ID Application instalado

set -e

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}    FIRMA Y NOTARIZACIÓN - Score Viewer${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"

# Verificar que existen los archivos
if [ ! -d "dist/Score Viewer.app" ]; then
    echo -e "${RED}❌ Error: No se encontró 'dist/Score Viewer.app'${NC}"
    echo "   Ejecuta primero: ./build_macos_complete.sh"
    exit 1
fi

if [ ! -f "ScoreViewer-1.0.0.dmg" ]; then
    echo -e "${RED}❌ Error: No se encontró 'ScoreViewer-1.0.0.dmg'${NC}"
    echo "   Ejecuta primero: ./build_macos_complete.sh"
    exit 1
fi

APP_PATH="dist/Score Viewer.app"
DMG_PATH="ScoreViewer-1.0.0.dmg"

# ============================================================
# PASO 1: BUSCAR CERTIFICADO DE FIRMA
# ============================================================
echo -e "\n${GREEN}🔍 PASO 1: Buscando certificado Developer ID${NC}"

SIGNING_IDENTITY=$(security find-identity -v -p codesigning | grep "Developer ID Application" | head -1 | awk -F'"' '{print $2}')

if [ -z "$SIGNING_IDENTITY" ]; then
    echo -e "${RED}❌ No se encontró certificado 'Developer ID Application'${NC}"
    echo ""
    echo "Para instalar tu certificado:"
    echo "  1. Ve a https://developer.apple.com/account/resources/certificates"
    echo "  2. Crea o descarga tu certificado 'Developer ID Application'"
    echo "  3. Haz doble clic en el .cer para instalarlo en Keychain"
    echo ""
    exit 1
fi

echo -e "${GREEN}✅ Certificado encontrado: ${SIGNING_IDENTITY}${NC}"

# ============================================================
# PASO 2: FIRMAR APLICACIÓN
# ============================================================
echo -e "\n${GREEN}✍️  PASO 2: Firmando aplicación${NC}"

# Primero firmar frameworks y bibliotecas dentro de la app
echo "Firmando dependencias internas..."
find "$APP_PATH" -type f \( -name "*.dylib" -o -name "*.so" \) -exec codesign --force --sign "$SIGNING_IDENTITY" --options runtime {} \; 2>/dev/null || true

# Firmar la app completa
echo "Firmando aplicación principal..."
codesign --deep --force --verify --verbose \
    --sign "$SIGNING_IDENTITY" \
    --options runtime \
    --timestamp \
    "$APP_PATH"

# Verificar firma
echo "Verificando firma..."
codesign --verify --deep --strict --verbose=2 "$APP_PATH"
spctl --assess --verbose=4 "$APP_PATH" 2>&1 | head -5

echo -e "${GREEN}✅ Aplicación firmada correctamente${NC}"

# ============================================================
# PASO 3: FIRMAR DMG
# ============================================================
echo -e "\n${GREEN}✍️  PASO 3: Firmando DMG${NC}"

codesign --force --sign "$SIGNING_IDENTITY" "$DMG_PATH"

echo -e "${GREEN}✅ DMG firmado correctamente${NC}"

# ============================================================
# PASO 4: NOTARIZACIÓN
# ============================================================
echo -e "\n${YELLOW}🔐 PASO 4: Notarización con Apple${NC}"
echo ""
echo -e "${YELLOW}Para notarizar necesitas:${NC}"
echo "  1. Apple ID (tu email de desarrollador)"
echo "  2. App-specific password (genera uno en https://appleid.apple.com)"
echo "  3. Team ID (de tu cuenta Apple Developer)"
echo ""
echo -e "${YELLOW}¿Tienes estos datos listos?${NC}"
echo -e "  Escribe 'si' para continuar, o presiona Enter para terminar aquí"
read -p "> " NOTARIZE_RESPONSE

if [[ "$NOTARIZE_RESPONSE" != "si" ]]; then
    echo -e "${YELLOW}⏭️  Notarización omitida${NC}"
    echo ""
    echo -e "${GREEN}✅ Firma completada. Para notarizar manualmente después:${NC}"
    echo -e "${BLUE}xcrun notarytool submit $DMG_PATH --apple-id TU_EMAIL --password TU_APP_PASSWORD --team-id TU_TEAM_ID --wait${NC}"
    echo -e "${BLUE}xcrun stapler staple $DMG_PATH${NC}"
    exit 0
fi

# Solicitar credenciales
echo ""
echo "Introduce tus credenciales de notarización:"
echo ""
read -p "Apple ID (email): " APPLE_ID
read -sp "App-specific password: " APP_PASSWORD
echo ""
read -p "Team ID: " TEAM_ID

echo ""
echo -e "${BLUE}📤 Subiendo DMG a Apple para notarización...${NC}"
echo "   (Esto puede tardar 5-15 minutos)"

# Subir para notarización
SUBMISSION_OUTPUT=$(xcrun notarytool submit "$DMG_PATH" \
    --apple-id "$APPLE_ID" \
    --password "$APP_PASSWORD" \
    --team-id "$TEAM_ID" \
    --wait 2>&1)

echo "$SUBMISSION_OUTPUT"

# Verificar si fue exitosa
if echo "$SUBMISSION_OUTPUT" | grep -q "status: Accepted"; then
    echo -e "${GREEN}✅ Notarización exitosa${NC}"
    
    # Agrapar ticket
    echo -e "${BLUE}📎 Agregando ticket de notarización al DMG...${NC}"
    xcrun stapler staple "$DMG_PATH"
    
    # Verificar
    echo "Verificando ticket..."
    xcrun stapler validate "$DMG_PATH"
    
    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}✅ PROCESO COMPLETADO - App lista para distribución${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "${GREEN}📦 Archivo listo para distribuir:${NC}"
    echo -e "   ${BLUE}$DMG_PATH${NC}"
    echo ""
    echo -e "${GREEN}🎉 Los usuarios podrán instalar sin advertencias de seguridad${NC}"
    echo ""
    
else
    echo -e "${RED}❌ Error en notarización${NC}"
    echo ""
    echo "Posibles causas:"
    echo "  - Credenciales incorrectas"
    echo "  - App-specific password expiró"
    echo "  - Team ID incorrecto"
    echo "  - Problemas con la firma de la app"
    echo ""
    echo "Para ver detalles del error:"
    SUBMISSION_ID=$(echo "$SUBMISSION_OUTPUT" | grep "id:" | awk '{print $2}' | head -1)
    if [ ! -z "$SUBMISSION_ID" ]; then
        echo -e "${BLUE}xcrun notarytool log $SUBMISSION_ID --apple-id $APPLE_ID --password $APP_PASSWORD --team-id $TEAM_ID${NC}"
    fi
    exit 1
fi
