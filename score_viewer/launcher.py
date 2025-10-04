#!/usr/bin/env python3
"""
Launcher para Score Viewer - Ventana nativa con PyWebView
"""
import sys
import os
import time
import threading
import socket
import webview
from datetime import datetime
from app import app, run_music21_snippet_any

def find_free_port(start_port=5001, max_attempts=10):
    """Encuentra un puerto libre empezando desde start_port"""
    for port in range(start_port, start_port + max_attempts):
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.bind(('127.0.0.1', port))
            sock.close()
            return port
        except OSError:
            continue
    return start_port

def run_flask(port):
    """Ejecuta Flask en background"""
    app.run(host="127.0.0.1", port=port, debug=False, use_reloader=False, threaded=True)

class API:
    """API Python expuesta a JavaScript para operaciones nativas"""
    
    def save_xml_file(self, code):
        """
        Guarda XML usando diálogo nativo de macOS.
        Llamado desde JavaScript para exportar XML.
        """
        try:
            # Generar XML desde código Python
            xml_payload, warnings_list, err, element_line_map = run_music21_snippet_any(code)
            
            if err:
                return {'success': False, 'error': err}
            
            if not xml_payload or not xml_payload.strip():
                return {'success': False, 'error': 'XML vacío'}
            
            # Limpiar XML
            xml_payload = xml_payload.lstrip('\ufeff').strip()
            
            # Generar nombre de archivo con timestamp
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            filename = f'partitura_editada_{timestamp}.musicxml'
            
            # Usar diálogo nativo de guardado de pywebview
            result = webview.windows[0].create_file_dialog(
                webview.SAVE_DIALOG,
                save_filename=filename,
                file_types=('MusicXML (*.musicxml)', 'All files (*.*)')
            )
            
            if result:
                # Usuario seleccionó ubicación, guardar archivo
                filepath = result[0] if isinstance(result, tuple) else result
                
                with open(filepath, 'w', encoding='utf-8') as f:
                    f.write(xml_payload)
                
                return {'success': True, 'filepath': filepath}
            else:
                # Usuario canceló
                return {'success': False, 'error': 'Guardado cancelado'}
                
        except Exception as e:
            return {'success': False, 'error': str(e)}

if __name__ == "__main__":
    # Encontrar puerto libre
    port = find_free_port()
    
    # Iniciar Flask en thread separado
    flask_thread = threading.Thread(target=run_flask, args=(port,), daemon=True)
    flask_thread.start()
    
    # Esperar que Flask inicie
    time.sleep(1.5)
    
    # Mensajes
    print("🎵 Score Viewer iniciando...")
    print(f"📱 Abriendo ventana nativa en http://127.0.0.1:{port}")
    
    # Crear API para JavaScript
    api = API()
    
    # Crear y mostrar ventana nativa CON API
    webview.create_window(
        'Score Viewer',
        f'http://127.0.0.1:{port}',
        width=1400,
        height=900,
        resizable=True,
        fullscreen=False,
        min_size=(800, 600),
        js_api=api  # CRÍTICO: Exponer API Python a JavaScript
    )
    
    # Iniciar la ventana (esto bloquea hasta que se cierre)
    webview.start()
