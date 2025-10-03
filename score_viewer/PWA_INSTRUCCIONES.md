# 🚀 Score Viewer - PWA (Progressive Web App)

## ✅ Implementación Completada

Tu aplicación Score Viewer ahora es una **PWA instalable** que funciona como una app nativa en escritorio.

---

## 📦 Archivos PWA Creados

### 1. **manifest.json**
- Ubicación: `static/manifest.json`
- Define: Nombre, iconos, colores, modo standalone

### 2. **service-worker.js**
- Ubicación: `static/service-worker.js`
- Función: Caché inteligente de assets
- Estrategia:
  - **Cache First:** Assets estáticos (JS, CSS, imágenes, fuentes)
  - **Network First:** HTML y API calls
  - POST requests siempre usan red

### 3. **Iconos PWA**
- Ubicación: `static/icons/`
- Generados desde tu logo.png:
  - `icon-192.png` (192×192)
  - `icon-512.png` (512×512)
  - `apple-touch-icon.png` (180×180)

### 4. **Meta Tags PWA**
- Añadidos en `index.html`
- Incluyen manifest, theme-color, iconos Apple

---

## 🎯 Cómo Instalar la PWA

### **En Chrome/Edge (Desktop):**

1. **Inicia el servidor Flask:**
   ```bash
   cd score_viewer
   python app.py
   ```

2. **Abre en navegador:**
   ```
   http://127.0.0.1:5001
   ```

3. **Busca el botón de instalación:**
   - Aparece en la barra de direcciones (icono de monitor con flecha ↓)
   - O en el menú: `⋮ → Instalar Score Viewer...`

4. **Click en "Instalar"**
   - Se abre como ventana independiente
   - Aparece icono en escritorio/dock

### **En Chrome (Android):**

1. Accede a la URL desde el móvil
2. Menú `⋮ → Añadir a pantalla de inicio`
3. La app se comporta como nativa

### **En Safari (iOS/macOS):**

1. Abre en Safari
2. Botón "Compartir" → "Añadir a pantalla de inicio" (iOS) / "Dock" (macOS)
3. La app usa `apple-touch-icon.png`

---

## ✨ Características PWA

### ✅ **Funciona Offline (Parcialmente):**
- ✅ Interfaz cargada desde caché
- ✅ Editor de código disponible
- ✅ Edición de partituras (arrastra, escala, borra)
- ✅ LocalStorage persiste ediciones
- ✅ Reproductor MIDI (si soundfonts cacheados)
- ❌ Generación de partitura (necesita Flask backend)

### ✅ **Rendimiento Optimizado:**
- Assets cacheados → Carga instantánea
- CDNs cacheados → Sin latencia de red
- Soundfonts cacheados → Reproducción más rápida

### ✅ **Experiencia Nativa:**
- Sin barra de direcciones del navegador
- Icono en escritorio como cualquier app
- Ventana independiente
- Splash screen automático

---

## 🔧 Actualizar PWA

Si haces cambios en CSS, JS o HTML:

1. **Cambia versión en `service-worker.js`:**
   ```javascript
   const CACHE_NAME = 'score-viewer-v2'; // Era v1
   ```

2. **Recarga la página en el navegador**
   - El Service Worker detectará nueva versión
   - Actualizará caché automáticamente

3. **(Opcional) Forzar actualización:**
   - DevTools (F12) → Application → Service Workers
   - Click "Update" o "Unregister"

---

## 🐛 Troubleshooting

### **El botón "Instalar" no aparece:**
- ✅ ¿Estás usando HTTPS o localhost?
- ✅ ¿El manifest.json se carga correctamente?
- ✅ Abre DevTools (F12) → Application → Manifest
- ✅ Verifica que no haya errores en consola

### **Service Worker no se registra:**
- ✅ Abre DevTools (F12) → Application → Service Workers
- ✅ Verifica que aparezca `/static/service-worker.js`
- ✅ Revisa consola por errores `[PWA]`

### **Assets no se cachean:**
- ✅ Verifica rutas en `urlsToCache` del service-worker.js
- ✅ Comprueba en DevTools → Application → Cache Storage
- ✅ Debe haber caché `score-viewer-v1`

### **La app no funciona offline:**
- ✅ Primera visita DEBE ser online (para cachear)
- ✅ Generación de partitura SIEMPRE necesita servidor Flask
- ✅ Solo visualización y edición funcionan offline

---

## 📊 Verificar Instalación

### **1. Consola del Navegador:**
Deberías ver:
```
[PWA] Service Worker registrado: /static/
[SW] Instalando Service Worker...
[SW] Cacheando archivos
[SW] Service Worker cargado
```

### **2. DevTools → Application:**
- **Manifest:** Debe mostrar "Score Viewer" con iconos
- **Service Workers:** Estado "activated and running"
- **Cache Storage:** `score-viewer-v1` con todos los assets

### **3. Probar Offline:**
- DevTools → Network → Checkbox "Offline"
- Recarga página → Debe cargar desde caché
- Generación NO funcionará (esperado)

---

## 🎉 ¡Listo!

Tu Score Viewer ahora es una PWA profesional que:
- ✅ Se instala como app nativa
- ✅ Funciona parcialmente offline
- ✅ Carga instantáneamente (caché)
- ✅ Reproduce MIDI con soundfonts reales
- ✅ Guarda ediciones en LocalStorage

**Para distribuir:**
1. Sube a un servidor con HTTPS
2. Comparte la URL
3. Los usuarios pueden instalarla con un click

---

## 📝 Notas Técnicas

### **Limitaciones (Normales en PWAs):**
- **Generación de partituras:** Necesita Flask/Python en servidor
- **Primera visita:** Debe ser online para cachear
- **Soundfonts:** ~2-3 MB por instrumento (se cachean tras primera carga)

### **Compatibilidad:**
- ✅ Chrome/Edge: 100% compatible
- ✅ Firefox: Compatible (sin instalación automática)
- ✅ Safari: Parcialmente (usa "Añadir a pantalla")
- ✅ Android: 100% compatible
- ✅ iOS: Compatible con limitaciones

---

**¿Problemas?** Abre DevTools (F12) y revisa consola para logs `[PWA]` y `[SW]`.
