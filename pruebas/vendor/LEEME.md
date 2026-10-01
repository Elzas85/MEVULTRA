# Bibliotecas para el banco de pruebas

Esta carpeta contiene copias exactas de las dos bibliotecas que MEV Ultra
declara en su cabecera mediante `@require` y que Tampermonkey carga antes del
programa:

| Archivo | Versión | Licencia | Origen |
|---|---|---|---|
| pdf-lib.min.js | 1.17.1 | MIT | https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js |
| html2canvas.min.js | 1.4.1 | MIT | https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js |

Estas copias son utilizadas únicamente por `banco.py`, para probar el motor de
descarga. Antes de utilizarlas, el banco calcula su huella SHA-384 y la compara
con la declarada en el `@require`: si se modifica la versión en el programa y
no se reemplazan estos archivos, el banco se detiene e informa la
discrepancia. Las copias no se instalan con MEV Ultra.
