# Score Viewer - Plan del Proyecto

## 1. Objetivo Principal

Crear una herramienta web local, simple y robusta para previsualizar y editar partituras musicales. El flujo de trabajo principal es:
1.  Un asistente de IA (ChatGPT, etc.) genera código Python utilizando la librería `music21`.
2.  El usuario pega este código en nuestra aplicación.
3.  La aplicación muestra una previsualización visual de la partitura.
4.  El usuario puede realizar ediciones básicas (mover, añadir, eliminar elementos) de forma gráfica.
5.  El usuario puede exportar el resultado final como un archivo MusicXML.

## 2. Arquitectura Técnica

Se abandona el enfoque anterior de una aplicación de escritorio (PySide6) por su complejidad y fragilidad. La nueva arquitectura es una **Aplicación Web Pura** que se ejecuta localmente.

*   **Backend:** Un servidor web minimalista usando **Flask**.
    *   `app.py`: Contendrá la lógica del servidor.
    *   Tendrá dos endpoints:
        1.  `/`: Sirve la página principal (frontend).
        2.  `/render`: Acepta código Python (`music21`), lo ejecuta de forma segura, convierte la partitura a formato **Vexflow**, y devuelve el resultado como JSON.
*   **Frontend:** HTML, CSS y Javascript estándar, servidos por Flask.
    *   `templates/index.html`: La estructura de la página.
    *   `static/css/style.css`: Estilos básicos.
    *   `static/js/main.js`: Lógica del cliente.
    *   **Librerías Clave:**
        *   **Vexflow:** Para renderizar la partitura en un `<canvas>` o `<svg>` a partir de los datos que envía el backend.
        *   **CodeMirror:** (Opcional, pero recomendado) Para tener un editor de código decente en el navegador.
        *   **interact.js:** (Para la fase de edición) Para facilitar el arrastrar y soltar de los elementos de la partitura.

## 3. Plan de Implementación por Fases

### Fase 1: Previsualización (MVP - Mínimo Producto Viable)
*   **[x]** Estructura del proyecto y dependencias (`Flask`, `music21`).
*   **[x]** Backend (`app.py`) capaz de recibir código y convertirlo a Vexflow.
*   **[ ]** Frontend (`index.html`, `main.js`) que pueda:
    *   Enviar el contenido del editor de texto al backend.
    *   Recibir la respuesta Vexflow.
    *   Usar la librería Vexflow.js para dibujar la partitura en pantalla.

### Fase 2: Edición - Mover Elementos
*   **[ ]** Asignar IDs únicos a los elementos SVG generados por Vexflow.
*   **[ ]** Implementar la selección de elementos con el ratón (resaltado visual).
*   **[ ]** Usar `interact.js` para permitir arrastrar y soltar los elementos seleccionados.
*   **[ ]** Registrar los cambios de posición (deltas `dx`, `dy`) en un objeto Javascript.
*   **[ ]** Crear un nuevo endpoint en Flask (`/apply-edits`) que reciba el MusicXML original y la lista de ediciones.
*   **[ ]** En el backend, usar `xml.etree.ElementTree` para parsear el XML y aplicar los deltas de posición a los elementos correspondientes.
*   **[ ]** Implementar un botón "Guardar" que envíe los datos al backend y permita descargar el MusicXML modificado.

### Fase 3: Edición - Añadir Elementos
*   **[ ]** Crear una paleta de símbolos musicales (HTML/CSS).
*   **[ ]** Implementar el arrastrar y soltar desde la paleta a la partitura.
*   **[ ]** Al soltar, registrar la adición (tipo de elemento y posición).
*   **[ ]** En el backend, la ruta `/apply-edits` deberá ser capaz de manejar ediciones de tipo "add".
*   **[ ]** Para las adiciones, en lugar de modificar el XML, se modificará el objeto `score` de `music21` en memoria (`score.insert(...)`) y se regenerará el MusicXML a partir del objeto modificado.

## 4. Estado Actual

*   Se ha creado la estructura de carpetas.
*   Se han instalado las dependencias `Flask` y `music21` en un entorno virtual.
*   Se ha creado el archivo `app.py` con la lógica básica del servidor Flask.
*   **Siguiente paso:** Crear el frontend (`index.html` y `main.js`) para completar la Fase 1.
