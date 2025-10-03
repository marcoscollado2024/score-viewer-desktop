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
from app import app

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
    
    # Crear y mostrar ventana nativa
    webview.create_window(
        'Score Viewer',
        f'http://127.0.0.1:{port}',
        width=1400,
        height=900,
        resizable=True,
        fullscreen=False,
        min_size=(800, 600)
    )
    
    # Iniciar la ventana (esto bloquea hasta que se cierre)
    webview.start()
