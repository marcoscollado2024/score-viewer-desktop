# 🍎 Guía Completa - Empaquetado Profesional para macOS

## ✅ ¡Completado!

Tu aplicación Score Viewer ha sido empaquetada exitosamente como aplicación nativa de macOS.

---

## 📦 Archivos Generados

### 1. **Score Viewer.app** (en `dist/`)
- Aplicación completa lista para ejecutar
- Incluye Python, Flask, music21 y todos los recursos
- Abre navegador automáticamente en http://127.0.0.1:5001

### 2. **ScoreViewer-1.0.0.dmg**
- Instalador DMG profesional estilo Mac
- Incluye enlace a carpeta Applications
- Listo para distribuir

---

## 🚀 Uso Básico

### Probar la aplicación:
```bash
open "dist/Score Viewer.app"
```

### Reinstalar DMG:
```bash
open ScoreViewer-1.0.0.dmg
# Arrastrar "Score Viewer" a "Applications"
```

---

## 🔐 Firma y Notarización (Eliminar Advertencias)

### Estado Actual:
⚠️ La app funciona pero macOS muestra advertencia de seguridad  
Los usuarios deben: **Clic derecho → Abrir** la primera vez

### Para Eliminar Advertencias:

#### Paso 1: Obtener Certificado Developer ID

1. Ve a [Apple Developer](https://developer.apple.com/account/resources/certificates)
2. Crea un certificado **"Developer ID Application"**
3. Descarga el archivo `.cer`
4. Haz doble clic para instalarlo en Keychain

#### Paso 2: Firmar y Notarizar

```bash
./sign_and_notarize.sh
```

El script:
1. ✅ Busca automáticamente tu certificado
2. ✅ Firma la app y el DMG
3. ✅ Te guía en el proceso de notarización
4. ✅ Sube a Apple para aprobación (~5-15 min)
5. ✅ Agrapa el ticket al DMG

#### Credenciales Necesarias para Notarización:

1. **Apple ID**: Tu email de desarrollador
2. **App-Specific Password**: 
   - Genera uno en https://appleid.apple.com
   - Sección "Sign-In and Security" → "App-Specific Passwords"
3. **Team ID**:
   - Ve a https://developer.apple.com/account
   - Copia tu "Team ID" (10 caracteres)

#### Notarización Manual (Alternativa):

Si prefieres hacerlo manualmente:

```bash
# 1. Subir para notarizar
xcrun notarytool submit ScoreViewer-1.0.0.dmg \
  --apple-id TU_EMAIL@example.com \
  --password xxxx-xxxx-xxxx-xxxx \
  --team-id XXXXXXXXXX \
  --wait

# 2. Agrapar ticket
xcrun stapler staple ScoreViewer-1.0.0.dmg

# 3. Verificar
xcrun stapler validate ScoreViewer-1.0.0.dmg
```

---

## 🔄 Reconstruir la Aplicación

Si haces cambios al código:

```bash
# Limpiar todo
rm -rf build dist venv_build *.dmg *.spec app_icon.icns

# Reconstruir
./build_macos_complete.sh
```

---

## 📊 Estructura del Proyecto

```
Partituras/
├── score_viewer/              # Tu aplicación Flask
│   ├── app.py                 # Backend
│   ├── launcher.py            # Launcher que abre navegador
│   ├── templates/             # HTML
│   └── static/                # CSS, JS, iconos
│
├── build_macos_complete.sh    # 🔨 Script principal de empaquetado
├── sign_and_notarize.sh       # 🔐 Script de firma y notarización
│
├── dist/
│   └── Score Viewer.app       # ✅ App compilada
│
└── ScoreViewer-1.0.0.dmg      # ✅ DMG para distribuir
```

---

## 🎯 Distribución a Usuarios

### Opción A: Con Firma y Notarización (Recomendado)

1. Ejecuta `./sign_and_notarize.sh`
2. Sube `ScoreViewer-1.0.0.dmg` a tu sitio web
3. Los usuarios:
   - Descargan el DMG
   - Abren y arrastran a Applications
   - ✅ **Sin advertencias de seguridad**

### Opción B: Sin Firma (Funciona pero con advertencia)

1. Distribuye `ScoreViewer-1.0.0.dmg`
2. Instruye a los usuarios:
   - Descargar DMG
   - Arrastrar a Applications
   - Primera vez: **Clic derecho → Abrir**
   - Aceptar advertencia

---

## 🛠️ Personalización

### Cambiar Versión:

Edita `build_macos_complete.sh`:
```bash
APP_VERSION="2.0.0"  # Línea 26
```

### Cambiar Nombre de App:

Edita `build_macos_complete.sh`:
```bash
APP_NAME="Mi App"  # Línea 24
```

### Cambiar Bundle ID:

Edita `build_macos_complete.sh`:
```bash
APP_BUNDLE_ID="com.tuempresa.tuapp"  # Línea 25
```

### Cambiar Icono:

Reemplaza:
```bash
score_viewer/static/icons/icon-512.png
```

---

## 📐 Requisitos del Sistema

### Para Compilar (tu Mac):
- macOS 10.15 o superior
- Python 3.8+
- Xcode Command Line Tools: `xcode-select --install`

### Para Usuarios Finales:
- macOS 10.15 o superior
- **NO necesitan Python instalado**
- **NO necesitan dependencias**
- Solo descargar y arrastrar a Applications

---

## 🔍 Solución de Problemas

### Error: "Developer ID Application not found"

**Solución:**
1. Ve a [Apple Developer Certificates](https://developer.apple.com/account/resources/certificates)
2. Crea certificado "Developer ID Application"
3. Descarga e instala haciendo doble clic

### Error: "Failed to notarize"

**Causas comunes:**
- App-specific password incorrecto o expirado
- Team ID incorrecto
- Certificado no es "Developer ID Application"

**Solución:**
```bash
# Ver logs de notarización
xcrun notarytool log SUBMISSION_ID \
  --apple-id tu@email.com \
  --password xxxx-xxxx-xxxx-xxxx \
  --team-id XXXXXXXXXX
```

### La app no abre o se cierra inmediatamente

**Solución:**
```bash
# Ver logs de la app
Console.app → Buscar "Score Viewer"
```

O ejecutar desde terminal para ver errores:
```bash
"dist/Score Viewer.app/Contents/MacOS/ScoreViewer"
```

### Error: "externally-managed-environment"

✅ **Solucionado:** El script usa entorno virtual automáticamente

---

## 📝 Checklist de Distribución

Antes de distribuir:

- [ ] Probado en macOS limpio
- [ ] App firmada (opcional pero recomendado)
- [ ] DMG notarizado (opcional pero recomendado)
- [ ] Versión actualizada
- [ ] README para usuarios incluido
- [ ] Enlace de descarga funcionando
- [ ] Instrucciones de instalación claras

---

## 💡 Consejos Profesionales

### 1. Actualizar la App

Cuando lances versión nueva:
- Incrementa `APP_VERSION` en el script
- Reconstruye: `./build_macos_complete.sh`
- Notariza el nuevo DMG
- Avisa a usuarios de la actualización

### 2. Reducir Tamaño

El DMG pesa ~44 MB. Para reducir:
- Edita `build_macos_complete.sh`
- Añade a `excludes`: más módulos innecesarios
- Ejemplo: `'tkinter', 'unittest', 'test'`

### 3. Versión Universal (Intel + Apple Silicon)

Para compilar versión universal:
```bash
# En build_macos_complete.sh, añadir a EXE:
target_arch='universal2'
```

### 4. Auto-actualización

Para añadir sistema de actualizaciones automáticas:
- Usa framework Sparkle
- O implementa comprobación manual en tu app

---

## 📞 Soporte

### Logs de Compilación:
```bash
cat build/ScoreViewer/warn-ScoreViewer.txt
```

### Verificar Firma:
```bash
codesign -dv --verbose=4 "dist/Score Viewer.app"
spctl --assess --verbose=4 "dist/Score Viewer.app"
```

### Verificar Notarización:
```bash
xcrun stapler validate ScoreViewer-1.0.0.dmg
```

---

## 🎉 ¡Listo!

Tu aplicación Score Viewer está empaquetada profesionalmente para macOS.

**Archivos importantes:**
- ✅ `ScoreViewer-1.0.0.dmg` → Distribución
- ✅ `dist/Score Viewer.app` → Testing local
- 🔧 `build_macos_complete.sh` → Reconstruir
- 🔐 `sign_and_notarize.sh` → Firmar

**Próximos pasos:**
1. Probar la app en tu Mac
2. Firmar y notarizar con tu certificado
3. Distribuir el DMG a usuarios
4. ¡Disfrutar de tu app de escritorio!

---

**Nota:** Para Windows, el proceso es similar pero usa scripts `.bat` y firma con certificados Authenticode.
