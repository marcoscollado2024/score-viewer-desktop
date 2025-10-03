#!/usr/bin/env python3
"""
Script para generar iconos PWA desde logo.png
"""
from PIL import Image
import os

# Rutas
LOGO_PATH = "static/images/logo.png"
ICONS_DIR = "static/icons"

# Tamaños necesarios
SIZES = [
    (192, 192, "icon-192.png"),
    (512, 512, "icon-512.png"),
    (180, 180, "apple-touch-icon.png"),
]

def generate_icons():
    """Genera iconos PWA en diferentes tamaños"""
    
    # Crear directorio si no existe
    os.makedirs(ICONS_DIR, exist_ok=True)
    
    try:
        # Abrir logo original
        logo = Image.open(LOGO_PATH)
        print(f"✅ Logo cargado: {LOGO_PATH} ({logo.size[0]}x{logo.size[1]})")
        
        # Generar cada tamaño
        for width, height, filename in SIZES:
            # Redimensionar manteniendo transparencia
            icon = logo.resize((width, height), Image.Resampling.LANCZOS)
            
            # Si tiene transparencia, mantenerla; si no, fondo blanco
            if icon.mode in ('RGBA', 'LA'):
                output_path = os.path.join(ICONS_DIR, filename)
                icon.save(output_path, 'PNG')
            else:
                # Crear imagen con fondo blanco
                background = Image.new('RGB', (width, height), (255, 255, 255))
                if icon.mode == 'RGB':
                    background.paste(icon, (0, 0))
                else:
                    background.paste(icon.convert('RGB'), (0, 0))
                output_path = os.path.join(ICONS_DIR, filename)
                background.save(output_path, 'PNG')
            
            print(f"✅ Generado: {output_path} ({width}x{height})")
        
        print(f"\n🎉 Todos los iconos generados correctamente en {ICONS_DIR}/")
        
    except FileNotFoundError:
        print(f"❌ Error: No se encontró {LOGO_PATH}")
        print("   Asegúrate de tener el archivo logo.png en static/images/")
    except Exception as e:
        print(f"❌ Error generando iconos: {e}")

if __name__ == "__main__":
    generate_icons()
