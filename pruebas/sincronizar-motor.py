#!/usr/bin/env python3
"""Arma MEV+ a partir del módulo 1 (motor) de MEV Ultra.

Uso: python3 sincronizar-motor.py <mev-ultra.user.js> <mev-plus-anterior.user.js> <version-nueva> <salida.user.js>

El motor se copia tal cual y se le quita solo lo que es del encargo de la
ventana de MEV Ultra (ENCARGO). El encabezado y la licencia se toman del MEV+
anterior. Cada quite se verifica: si el texto esperado no está exactamente
una vez, el programa se detiene.
"""
import re, sys

ultra, previo, version, salida = sys.argv[1:5]
u = open(ultra, encoding='utf-8').read()
p = open(previo, encoding='utf-8').read()

# módulo 1 de MEV Ultra: del primer "(function () {" al primer "})();" que lo cierra
ini = u.index('\n(function () {\n') + 1
fin = u.index('\n})();\n', ini) + len('\n})();\n')
motor = u[ini:fin]

def quitar(texto, inicio, final=None, n=1):
    """Quita desde `inicio` hasta `final` inclusive (o solo `inicio`)."""
    assert texto.count(inicio) == n, ('no está una vez: ' + inicio[:60], texto.count(inicio))
    if final is None:
        return texto.replace(inicio, '')
    a = texto.index(inicio); b = texto.index(final, a) + len(final)
    return texto[:a] + texto[b:]

def cambiar(texto, viejo, nuevo, n=1):
    assert texto.count(viejo) == n, ('no está %d veces: ' % n + viejo[:60], texto.count(viejo))
    return texto.replace(viejo, nuevo)

# 1. el bloque ENCARGO al principio
motor = quitar(motor, "  // MEV Ultra: este módulo solo trabaja por encargo de la ventana, dentro del\n", "  if (!ENCARGO) return;\n\n")
# 2. datos de la pestaña About
motor = re.sub(r"nombre: 'MEV Ultra \(motor MEV\+ [\d.]+\)',", "nombre: 'MEV+ — Bajar expediente',", motor, count=1)
motor = re.sub(r"(\n    version: ')[\d.]+(',)", r"\g<1>" + version + r"\2", motor, count=1)
motor = cambiar(motor, "github: 'https://github.com/Elzas85/MEVULTRA'", "github: 'https://github.com/Elzas85/MEVPLUS'")
# 3. la entrega del PDF a la ventana
motor = quitar(motor, "    if (ENCARGO) return entregarAlPadre(blob, nombre);\n")
motor = cambiar(motor, "    corrida.cancelado = !!(ENCARGO && ENCARGO.cancelado);", "    corrida.cancelado = false;")
# 4. la sección de enlace con la ventana
motor = quitar(motor, "  // ─────────────────────────────────────────────────────────────────────\n  // Enlace con la ventana de MEV Ultra (encargo)\n",
               "  const ui = ENCARGO ? crearUiEncargo() : (function () {\n")
motor = motor  # la línea de arriba se quitó entera: se repone la forma de MEV+
motor = cambiar(motor, "    const escapar = (s) => (s || '').replace(/[&<>\"]/g, (c) =>", "  const ui = (function () {\n    const escapar = (s) => (s || '').replace(/[&<>\"]/g, (c) =>")
# 5. el arranque por encargo
motor = quitar(motor, "  if (ENCARGO) arrancarEncargo();\n")
# 6. el color de MEV+
motor = motor.replace('#0d4a2b', '#0a4d68')
assert 'ENCARGO' not in motor, 'quedó ENCARGO en el motor'
assert 'avisarPadre' not in motor and 'crearUiEncargo' not in motor

# encabezado y licencia del MEV+ anterior
cab_fin = p.index('\n(function () {\n') + 1
cabecera = p[:cab_fin]
cabecera = re.sub(r'(// @version\s+)[\d.]+', r'\g<1>' + version, cabecera, count=1)
cola = p[p.index('\n})();\n', cab_fin) + len('\n})();\n'):]
out = cabecera + motor + cola
open(salida, 'w', encoding='utf-8', newline='').write(out)
print('motor copiado: %d líneas; MEV+ %s: %d líneas' % (motor.count('\n'), version, out.count('\n')))
