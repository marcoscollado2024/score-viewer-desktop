# 🎼 Score Viewer Desktop

Aplicación de escritorio multiplataforma para visualizar y editar partituras musicales usando music21.

## ✨ Características

- 🖥️ **Ventana nativa** con PyWebView (sin barra de navegador)
- 🎵 **music21** integrado para análisis musical
- 🎨 Interfaz web moderna con Flask
- 📱 **Multiplataforma**: Windows, macOS y Linux
- 🔄 **Puerto dinámico**: se puede abrir/cerrar/reabrir sin problemas

## 📦 Descargas

Los ejecutables se generan automáticamente con cada commit:

### Desde GitHub Actions (Artifacts)
1. Ve a la pestaña "Actions"
2. Selecciona el workflow más reciente exitoso
3. Descarga el ejecutable para tu sistema:
   - `ScoreViewer-Windows.exe` (Windows 64-bit)
   - `ScoreViewer-macOS.dmg` (macOS)
   - `ScoreViewer-Linux` (Linux)

### Próximamente: GitHub Releases
Los ejecutables estarán disponibles en la sección Releases para descarga directa.

## 🚀 Uso

### Windows
1. Descarga `Score Viewer.exe`
2. Haz doble clic para ejecutar
3. (Windows puede mostrar advertencia - click en "Más información" → "Ejecutar de todas formas")

### macOS
1. Descarga `ScoreViewer-macOS.dmg`
2. Abre el DMG
3. Arrastra "Score Viewer" a Applications
4. Abre desde Applications

### Linux
1. Descarga `Score Viewer`
2. Dale permisos de ejecución: `chmod +x "Score Viewer"`
3. Ejecuta: `./Score\ Viewer`

## 🛠️ Compilar desde el código fuente

### Requisitos
- Python 3.11+
- pip

### Pasos

1. **Instalar dependencias:**
```bash
pip install -r score_viewer/requirements.txt
pip install pyinstaller
```

2. **macOS:**
```bash
./build_macos_complete.sh
```

3. **Windows:**
```bash
python build_windows.py
```

4. **Linux:**
```bash
pyinstaller --name "Score Viewer" --windowed --onefile \
    --add-data "score_viewer/templates:templates" \
    --add-data "score_viewer/static:static" \
    score_viewer/launcher.py
```

## 📁 Estructura del Proyecto

```
score-viewer-desktop/
├── score_viewer/              # Código fuente
│   ├── app.py                 # Aplicación Flask
│   ├── launcher.py            # Lanzador con PyWebView
│   ├── requirements.txt       # Dependencias
│   ├── templates/             # Plantillas HTML
│   └── static/                # CSS, JS, imágenes
├── .github/workflows/         # GitHub Actions
│   └── build.yml              # Compilación automática
├── build_macos_complete.sh    # Script de build macOS
├── app_icon.icns              # Icono macOS
└── README.md                  # Este archivo
```

## 🤝 Contribuir

Las contribuciones son bienvenidas. Por favor:

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📝 Licencia

Este proyecto es de código abierto y está disponible bajo la licencia MIT.

## 👤 Autor

Marcos Vicente Collado Fernández

## 🙏 Agradecimientos

- [music21](http://web.mit.edu/music21/) - Framework de análisis musical
- [Flask](https://flask.palletsprojects.com/) - Framework web
- [PyWebView](https://pywebview.flowrl.com/) - Ventanas nativas
- [PyInstaller](https://pyinstaller.org/) - Empaquetado

---

Creado con ❤️ para la comunidad musical
