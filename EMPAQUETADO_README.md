# 📦 Guía de Empaquetado - Score Viewer Desktop

Esta guía explica cómo convertir tu aplicación Flask + music21 en un **ejecutable de escritorio** para macOS y Windows, sin necesidad de instalar Python.

## 🎯 Objetivo

Crear una aplicación portable que:
- ✅ Se ejecute con doble clic (sin instalar Python)
- ✅ Incluya todas las dependencias (Flask, music21, etc.)
- ✅ Funcione 100% offline
- ✅ Sea fácil de distribuir

---

## 📋 Requisitos Previos

### En tu máquina de desarrollo:
1. **Python 3.8 o superior** instalado
2. **Dependencias del proyecto** instaladas:
   ```bash
   pip install -r score_viewer/requirements.txt
   ```

### Herramienta de empaquetado:
- **PyInstaller** (se instala automáticamente con los scripts)

---

## 🚀 Opción 1: Aplicación con Carpeta (Recomendado)

**Ventajas:**
- ✅ Inicia rápido (~3-5 segundos)
- ✅ Más fácil de depurar
- ✅ Mejor rendimiento

**Desventaja:**
- ⚠️ Se genera una carpeta con múltiples archivos

### Pasos:

1. **Ejecutar el script de empaquetado:**
   ```bash
   python build_desktop.py
   ```

2. **Esperar a que finalice** (tarda ~2-5 minutos)

3. **Resultado:**
   
   **En macOS:**
   ```
   dist/ScoreViewer.app/
   ```
   - Ejecutar: `open dist/ScoreViewer.app`
   - Distribuir: Comprimir en ZIP la carpeta `dist/` completa
   
   **En Windows:**
   ```
   dist/ScoreViewer/
       ScoreViewer.exe
       (+ archivos adicionales)
   ```
   - Ejecutar: Doble clic en `ScoreViewer.exe`
   - Distribuir: Comprimir en ZIP la carpeta `dist/ScoreViewer/` completa

---

## 📦 Opción 2: Ejecutable Único (Onefile)

**Ventajas:**
- ✅ UN SOLO ARCHIVO para distribuir
- ✅ Más compacto para enviar

**Desventajas:**
- ⚠️ Tarda más en iniciar (~10-30 segundos primera vez)
- ⚠️ Descomprime archivos temporales cada vez

### Pasos:

1. **Ejecutar el script onefile:**
   ```bash
   python build_desktop_onefile.py
   ```

2. **Esperar a que finalice** (tarda ~3-7 minutos)

3. **Resultado:**
   
   **En macOS:**
   ```
   dist/ScoreViewer.app
   ```
   - Ejecutar: `open dist/ScoreViewer.app`
   - Distribuir: Solo ese archivo `.app`
   
   **En Windows:**
   ```
   dist/ScoreViewer.exe
   ```
   - Ejecutar: Doble clic en `ScoreViewer.exe`
   - Distribuir: Solo ese archivo `.exe`

---

## 🔧 Personalización Avanzada

### Cambiar el puerto o nombre

Edita `score_viewer/launcher.py`:

```python
# Cambiar puerto
app.run(host="127.0.0.1", port=8080, debug=False, use_reloader=False)

# Cambiar URL que se abre
webbrowser.open('http://127.0.0.1:8080')
```

### Añadir icono personalizado

Reemplaza estos archivos:
```
score_viewer/static/icons/icon-512.png  (para macOS)
score_viewer/static/icons/icon-512.ico  (para Windows, se genera auto)
```

### Excluir módulos innecesarios

Edita `build_desktop.py` o `build_desktop_onefile.py`:

```python
excludes=['matplotlib', 'numpy', 'scipy', 'pandas', 'PIL', 'pytest']
```

---

## 📊 Comparación de Métodos

| Característica | Opción 1 (Carpeta) | Opción 2 (Onefile) |
|---|---|---|
| **Tiempo de inicio** | ⚡ 3-5 segundos | 🐢 10-30 segundos |
| **Tamaño total** | 📦 ~200-300 MB | 📦 ~100-200 MB |
| **Archivos generados** | Carpeta con ~50 archivos | 1 solo archivo |
| **Distribución** | Comprimir carpeta completa | Enviar 1 archivo |
| **Recomendado para** | Uso frecuente, velocidad | Distribución simple |

---

## 🌍 Distribución a Usuarios

### Para macOS:

1. **Empaquetar:**
   ```bash
   cd dist
   zip -r ScoreViewer-macOS.zip ScoreViewer.app
   ```

2. **Instruir al usuario:**
   - Descargar `ScoreViewer-macOS.zip`
   - Extraer el archivo
   - Arrastrar `ScoreViewer.app` a Aplicaciones
   - Si macOS bloquea (Gatekeeper):
     - Ir a **Preferencias del Sistema → Seguridad y Privacidad**
     - Hacer clic en **"Abrir de todos modos"**

### Para Windows:

1. **Empaquetar:**
   ```bash
   # Comprimir carpeta dist/ScoreViewer/ en ZIP
   Compress-Archive -Path dist/ScoreViewer -DestinationPath ScoreViewer-Windows.zip
   ```

2. **Instruir al usuario:**
   - Descargar `ScoreViewer-Windows.zip`
   - Extraer en cualquier carpeta
   - Doble clic en `ScoreViewer.exe`
   - Si Windows Defender bloquea:
     - Hacer clic en **"Más información"**
     - Luego **"Ejecutar de todas formas"**

---

## 🛠️ Solución de Problemas

### ❌ Error: "No module named 'music21'"

**Causa:** music21 no está instalado o PyInstaller no lo detecta.

**Solución:**
```bash
pip install music21
python build_desktop.py
```

### ❌ Error: "Failed to execute script"

**Causa:** Falta algún recurso (templates, static, etc.)

**Solución:**
- Verificar que existan:
  - `score_viewer/templates/index.html`
  - `score_viewer/static/` (con todas las carpetas)
- Ejecutar con modo debug:
  ```python
  # En build_desktop.py, cambiar:
  debug=True,
  console=True,
  ```

### ❌ macOS: "App dañada o de desarrollador no identificado"

**Solución:**
```bash
# Eliminar atributo de cuarentena
xattr -cr dist/ScoreViewer.app
```

### ❌ Windows: Antivirus bloquea el ejecutable

**Causa:** Los ejecutables de PyInstaller pueden activar falsos positivos.

**Solución:**
- Añadir excepción en el antivirus
- Firmar digitalmente el .exe (requiere certificado)

### ❌ La aplicación tarda mucho en cargar

**Solución:**
- Si usas modo **onefile**, cambia a modo **carpeta** (Opción 1)
- Excluir módulos innecesarios (ver Personalización)

---

## 📝 Notas Técnicas

### ¿Qué incluye el ejecutable?

- ✅ Python runtime embebido
- ✅ Flask y todas sus dependencias
- ✅ music21 completo (incluyendo corpus)
- ✅ Plantillas HTML
- ✅ Archivos estáticos (CSS, JS, fuentes)
- ✅ Navegador se abre automáticamente

### ¿Cómo funciona?

1. El usuario ejecuta el .exe/.app
2. Se inicia un servidor Flask local (127.0.0.1:5001)
3. Se abre automáticamente el navegador apuntando al servidor
4. El usuario usa la aplicación como una web local
5. Al cerrar, el servidor se detiene

### Limitaciones

- ⚠️ El tamaño del ejecutable es grande (~100-300 MB) debido a:
  - Python embebido
  - music21 (incluye muchas partituras de ejemplo)
  - Flask y dependencias
- ⚠️ Primera ejecución puede tardar (especialmente en onefile)
- ⚠️ No se actualiza automáticamente (hay que redistribuir)

---

## 🔒 Seguridad y Privacidad

- ✅ **100% Offline:** No requiere conexión a internet
- ✅ **Sin telemetría:** No envía datos a ningún servidor
- ✅ **Datos locales:** Todo se ejecuta en la máquina del usuario
- ✅ **Open Source:** El código es auditable

---

## 🆘 Soporte

Si encuentras problemas:

1. **Revisa los logs:**
   - macOS: Abrir `Console.app` y buscar "ScoreViewer"
   - Windows: Cambiar `console=True` en el script de build

2. **Verifica requisitos:**
   ```bash
   python --version  # Debe ser 3.8+
   pip list | grep music21
   pip list | grep flask
   ```

3. **Limpia y reconstruye:**
   ```bash
   # Eliminar builds anteriores
   rm -rf build dist *.spec
   
   # Reconstruir
   python build_desktop.py
   ```

---

## 📚 Recursos Adicionales

- [PyInstaller Documentation](https://pyinstaller.org/en/stable/)
- [music21 Documentation](https://web.mit.edu/music21/doc/)
- [Flask Documentation](https://flask.palletsprojects.com/)

---

## ✅ Checklist Final

Antes de distribuir:

- [ ] Probado en macOS
- [ ] Probado en Windows
- [ ] Iconos correctos
- [ ] Versión definida
- [ ] README incluido para usuarios
- [ ] Comprimido en ZIP
- [ ] Instrucciones de instalación claras

---

**¡Listo!** Tu aplicación Score Viewer ahora es una app de escritorio profesional, portable y lista para distribuir. 🎉
