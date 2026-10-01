# Revisor propio para SuPJN+.
#
# No hay revisor automático disponible en este entorno (el instalador de
# paquetes contesta 403), así que este archivo hace el trabajo: separa el
# código de los textos, los comentarios y las expresiones regulares, y después
# busca los errores que de verdad aparecen en un archivo de este tamaño.
#
# Uso: python3 revisar.py <archivo.user.js>
import re
import sys
from collections import defaultdict

RESERVADAS = set('''
break case catch class const continue debugger default delete do else export extends
finally for function if import in instanceof let new return super switch this throw try
typeof var void while with yield async await of get set static true false null undefined
'''.split())

# Lo que pone el navegador, y lo que agrega Tampermonkey. Sirve para el chequeo
# 10: nada de esto está declarado en el archivo y no por eso falta.
DEL_NAVEGADOR = set('''
window document console navigator location history screen alert confirm prompt
setTimeout clearTimeout setInterval clearInterval requestAnimationFrame
cancelAnimationFrame queueMicrotask structuredClone fetch
localStorage sessionStorage indexedDB crypto performance
Promise Date Math JSON Object Array String Number Boolean RegExp Symbol BigInt
Error TypeError RangeError SyntaxError EvalError ReferenceError URIError
Map Set WeakMap WeakSet Proxy Reflect Intl
parseInt parseFloat isNaN isFinite eval
encodeURIComponent decodeURIComponent encodeURI decodeURI escape unescape atob btoa
Blob File FileReader FormData URL URLSearchParams AbortController
Headers Request Response XMLHttpRequest EventSource WebSocket
ArrayBuffer DataView Uint8Array Uint16Array Uint32Array Uint8ClampedArray
Int8Array Int16Array Int32Array Float32Array Float64Array
TextEncoder TextDecoder DOMParser XMLSerializer
MutationObserver ResizeObserver IntersectionObserver
Event CustomEvent MouseEvent KeyboardEvent PointerEvent DragEvent
Image Audio Option Node Element HTMLElement NodeFilter Range
getComputedStyle matchMedia scrollTo scrollBy open close print focus blur
GM_getValue GM_setValue GM_deleteValue GM_listValues GM_info GM_xmlhttpRequest
GM_addStyle GM_openInTab GM_setClipboard GM_notification unsafeWindow
PDFLib html2canvas showDirectoryPicker showOpenFilePicker showSaveFilePicker
Worker CompressionStream DecompressionStream CSS GM GM_download GM_addValueChangeListener GM_getResourceText
addEventListener removeEventListener dispatchEvent
'''.split())


def separar(src):
    """Devuelve (codigo, piezas). En `codigo` cada texto, comentario y expresion
    regular queda reemplazado por espacios del mismo largo, asi las posiciones y
    los numeros de linea no se mueven. `piezas` lista (tipo, inicio, fin)."""
    out = list(src)
    piezas = []
    i, n = 0, len(src)
    # Para distinguir una division de una expresion regular hace falta saber si
    # el token anterior puede terminar una expresion.
    def antes_permite_regex(pos):
        j = pos - 1
        while j >= 0 and src[j] in ' \t\r\n':
            j -= 1
        if j < 0:
            return True
        c = src[j]
        if c in ')]':
            # `if (...) /re/` es valido; `a[0] / 2` es division. Se resuelve
            # mirando la palabra que abre el parentesis.
            if c == ')':
                nivel, k = 0, j
                while k >= 0:
                    if src[k] == ')':
                        nivel += 1
                    elif src[k] == '(':
                        nivel -= 1
                        if nivel == 0:
                            break
                    k -= 1
                m = re.search(r'([A-Za-z_$][\w$]*)\s*$', src[:k])
                return bool(m and m.group(1) in ('if', 'while', 'for', 'switch'))
            return False
        if c.isalnum() or c in '_$':
            m = re.search(r'([A-Za-z_$][\w$]*)$', src[:j + 1])
            if m and m.group(1) in RESERVADAS - {'this', 'true', 'false', 'null', 'undefined', 'super'}:
                return True
            return False
        if c == '}':
            return True
        return True

    while i < n:
        c = src[i]
        if c == '/' and i + 1 < n and src[i + 1] == '/':
            j = src.find('\n', i)
            j = n if j < 0 else j
            piezas.append(('comentario', i, j))
            for k in range(i, j):
                out[k] = ' '
            i = j
        elif c == '/' and i + 1 < n and src[i + 1] == '*':
            j = src.find('*/', i + 2)
            j = n if j < 0 else j + 2
            piezas.append(('comentario', i, j))
            for k in range(i, j):
                if out[k] != '\n':
                    out[k] = ' '
            i = j
        elif c in '"\'':
            j = i + 1
            while j < n:
                if src[j] == '\\':
                    j += 2
                    continue
                if src[j] == c:
                    j += 1
                    break
                if src[j] == '\n':
                    break
                j += 1
            piezas.append(('texto', i, j))
            for k in range(i, j):
                if out[k] != '\n':
                    out[k] = ' '
            i = j
        elif c == '`':
            # En una plantilla, lo que va adentro de ${…} NO es texto: es
            # código, y ahí también puede haber datos sin escapar o nombres que
            # nadie usa. Se blanquea el texto y se deja el código a la vista.
            j = i + 1
            huecos = []          # tramos de código adentro de la plantilla
            while j < n:
                if src[j] == '\\':
                    j += 2
                    continue
                if src[j] == '`':
                    j += 1
                    break
                if src[j] == '$' and j + 1 < n and src[j + 1] == '{':
                    nivel, k = 1, j + 2
                    while k < n and nivel:
                        if src[k] == '{':
                            nivel += 1
                        elif src[k] == '}':
                            nivel -= 1
                        elif src[k] in '"\'`':
                            # Un texto adentro del hueco: se lo salta entero.
                            comilla, k = src[k], k + 1
                            while k < n and src[k] != comilla:
                                k += 2 if src[k] == '\\' else 1
                        k += 1
                    huecos.append((j + 2, k - 1))
                    j = k
                    continue
                j += 1
            piezas.append(('plantilla', i, j))
            for k in range(i, j):
                if out[k] != '\n':
                    out[k] = ' '
            # Lo que va adentro de ${…} vuelve como código, pero no crudo: ahí
            # adentro puede haber otro texto, y un texto con un paréntesis
            # ('seleccionada(s)') se leería como una llamada a una función que
            # no existe. Se lo vuelve a separar con esta misma función, que
            # siempre recibe un tramo más corto y por eso termina.
            for a, b in huecos:
                fin = min(b, j)
                if fin <= a:
                    continue
                dentro, sub = separar(src[a:fin])
                for k in range(a, fin):
                    out[k] = dentro[k - a]
                for tipo, ta, tb in sub:
                    piezas.append((tipo, a + ta, a + tb))
            i = j
        elif c == '/' and antes_permite_regex(i):
            j, clase = i + 1, False
            ok = False
            while j < n:
                d = src[j]
                if d == '\\':
                    j += 2
                    continue
                if d == '\n':
                    break
                if d == '[':
                    clase = True
                elif d == ']':
                    clase = False
                elif d == '/' and not clase:
                    j += 1
                    while j < n and src[j] in 'gimsuyvd':
                        j += 1
                    ok = True
                    break
                j += 1
            if ok:
                piezas.append(('regex', i, j))
                for k in range(i, j):
                    out[k] = ' '
                i = j
            else:
                i += 1
        else:
            i += 1
    return ''.join(out), piezas


def cierre_de_parentesis(cod, abre):
    """Posicion del parentesis que cierra el que abre en `abre`, o -1."""
    n = 0
    for i in range(abre, min(len(cod), abre + 4000)):
        if cod[i] == '(':
            n += 1
        elif cod[i] == ')':
            n -= 1
            if n == 0:
                return i
    return -1


def parametros_balanceados(cod, abre):
    fin = cierre_de_parentesis(cod, abre)
    return cod[abre + 1:fin] if fin > 0 else ''


def linea_de(src, pos):
    return src.count('\n', 0, pos) + 1


def revisar(ruta):
    src = open(ruta, encoding='utf-8').read()
    cod, piezas = separar(src)
    avisos = []

    def aviso(clase, pos, texto):
        avisos.append((clase, linea_de(src, pos), texto))

    # 1. Llaves, parentesis y corchetes equilibrados.
    pila = []
    pares = {')': '(', ']': '[', '}': '{'}
    for i, c in enumerate(cod):
        if c in '([{':
            pila.append((c, i))
        elif c in ')]}':
            if not pila or pila[-1][0] != pares[c]:
                aviso('estructura', i, 'cierra "%s" sin su apertura' % c)
                break
            pila.pop()
    if pila:
        aviso('estructura', pila[-1][1], 'queda sin cerrar "%s"' % pila[-1][0])

    # 2. Declaraciones que no se usan en ningun otro lado.
    usos = defaultdict(int)
    for m in re.finditer(r'[A-Za-z_$][\w$]*', cod):
        usos[m.group(0)] += 1
    decl = re.compile(r'\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=')
    for m in decl.finditer(cod):
        nom = m.group(1)
        if usos[nom] <= 1:
            aviso('sin usar', m.start(1), 'se declara "%s" y no se usa en ningun otro lado' % nom)
    for m in re.finditer(r'\bfunction\s+([A-Za-z_$][\w$]*)', cod):
        nom = m.group(1)
        # Una función con nombre escrita como expresión, tipo
        # `(function arranca(){…})()` o `x = function f(){…}`, no es una
        # declaración: el nombre está solo para que se lo vea en los errores.
        antes = cod[:m.start()].rstrip()
        if antes.endswith('(') or antes.endswith('=') or antes.endswith(','):
            continue
        if usos[nom] <= 1:
            aviso('sin usar', m.start(1), 'se declara la funcion "%s" y nadie la llama' % nom)

    # 3. Declarar dos veces el mismo nombre con const/let en el mismo bloque.
    #    Se aproxima por nivel de llave.
    #    La variable de un `for (let i …)` vive solo en ese for: dos for
    #    seguidos con la misma letra no son una repeticion (corregido el
    #    25/09/2026: daba tres avisos falsos en MEV Ultra).
    en_for = set(m.start(1) for m in re.finditer(r'\bfor\s*\(\s*(?:const|let)\s+([A-Za-z_$][\w$]*)', cod))
    nivel, niveles = 0, defaultdict(set)
    for m in re.finditer(r'[{}]|\b(?:const|let)\s+([A-Za-z_$][\w$]*)', cod):
        t = m.group(0)
        if t == '{':
            nivel += 1
        elif t == '}':
            niveles.pop(nivel, None)
            nivel -= 1
        elif m.start(1) not in en_for:
            nom = m.group(1)
            if nom in niveles[nivel]:
                aviso('repetida', m.start(1), 'se vuelve a declarar "%s" en el mismo bloque' % nom)
            niveles[nivel].add(nom)

    # 4. Asignacion adentro de una condicion (suele ser un == que falta).
    for m in re.finditer(r'\b(?:if|while)\s*\(([^()]*)\)', cod):
        c = m.group(1)
        if re.search(r'[^=!<>+\-*/%&|^]=[^=]', c):
            aviso('sospechoso', m.start(1), 'asignacion adentro de una condicion')

    # 5. Claves repetidas adentro de un mismo objeto literal. Se recorre llave
    #    por llave: dos objetos en la misma linea son dos objetos distintos.
    abiertas = []
    for i, c in enumerate(cod):
        if c == '{':
            abiertas.append({'ini': i, 'claves': {}})
        elif c == '}':
            if abiertas:
                abiertas.pop()
        elif c == ':' and abiertas:
            m = re.search(r'([A-Za-z_$][\w$]*)\s*$', cod[max(0, i - 60):i])
            if not m:
                continue
            antes = cod[max(0, i - 200):i - len(m.group(1))].rstrip()
            # Solo cuenta como clave si viene despues de "{" o de ",".
            if not antes.endswith('{') and not antes.endswith(','):
                continue
            k = m.group(1)
            obj = abiertas[-1]
            if k in obj['claves']:
                aviso('repetida', i, 'la clave "%s" aparece dos veces en el mismo objeto' % k)
            obj['claves'][k] = i

    # 6. Atrapar sin hacer nada y sin explicar por que.
    for m in re.finditer(r'\bcatch\s*\([^)]*\)\s*\{([^{}]*)\}', cod):
        cuerpo = m.group(1)
        ini, fin = m.start(1), m.end(1)
        tiene_comentario = any(t == 'comentario' and ini <= a < fin for t, a, b in piezas)
        if not cuerpo.strip() and not tiene_comentario:
            aviso('silencio', m.start(1), 'se atrapa un error, no se hace nada y no se explica por que')

    # 7. Promesas sin atrapar el error.
    for m in re.finditer(r'\.then\s*\(', cod):
        resto = cod[m.start():m.start() + 600]
        if '.catch(' not in resto and resto.count(',') == 0:
            aviso('promesa', m.start(), 'un .then sin .catch ni segundo argumento')

    # 8. Datos metidos en la pagina sin escapar. Se mira la instruccion entera,
    #    no la linea: casi siempre ocupa varios renglones. Se quitan los tramos
    #    que ya pasan por esc(...) y se avisa si queda pegado con + algun dato
    #    suelto (una variable o una propiedad, no el resultado de una funcion,
    #    que arma su propio HTML).
    SEGUROS = {'Math', 'String', 'Number', 'JSON', 'Date', 'Object', 'Array'}

    def sin_esc(txt):
        out, i = [], 0
        while i < len(txt):
            m = re.compile(r'\besc\s*\(').search(txt, i)
            if not m:
                out.append(txt[i:])
                break
            out.append(txt[i:m.start()])
            nivel, j = 1, m.end()
            while j < len(txt) and nivel:
                if txt[j] == '(':
                    nivel += 1
                elif txt[j] == ')':
                    nivel -= 1
                j += 1
            i = j
        return ''.join(out)

    #    Se busca en TODO el archivo, no solo en las asignaciones a innerHTML:
    #    la mayor parte del HTML la arman funciones que devuelven texto.
    #    El disparador es un texto entrecomillado que contiene una etiqueta y
    #    que sigue pegado con + a un dato.
    for tipo, a, b in piezas:
        if tipo not in ('texto', 'plantilla'):
            continue
        cuerpo = src[a:b]
        if not re.search(r'<[A-Za-z/]', cuerpo):
            continue
        # Lo que viene pegado despues de ese texto.
        resto = sin_esc(cod[b:b + 300])
        d = re.match(r'\s*\+\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*(?=[+;,)\]}]|$)', resto)
        if not d:
            continue
        nom = d.group(1)
        if nom.split('.')[0] in SEGUROS or nom in RESERVADAS:
            continue
        aviso('escape', b, 'se arma HTML pegando "%s" sin esc()' % nom)

    # 9. Comparar con == o != (menos con null, que es idiomatico).
    for m in re.finditer(r'[^=!<>]([=!])=[^=]', cod):
        ini = m.start(1)
        ctx = cod[max(0, ini - 40):ini + 40]
        if 'null' in ctx or 'undefined' in ctx:
            continue
        aviso('comparacion', ini, 'comparacion con %s= en vez de %s==' % (m.group(1), m.group(1)))

    # 10. Se llama a algo que no existe.
    #
    #     Está por un error propio: el 23/09/2026, al partir una función grande
    #     en funciones chicas, una de las chicas quedó llamada pero sin
    #     escribir. El programa se cortaba al dibujar el listado y no mostraba
    #     ninguna causa. Ni el banco de pruebas ni este revisor lo detectaron:
    #     las pruebas cubrían el cálculo y no el dibujado, y acá no había nada
    #     que comprobara que lo que el programa llama exista.
    #
    #     El criterio es al revés del chequeo 2: para cada nombre que se llama
    #     como función, se mira si en alguna parte del archivo está declarado.
    #     Se declara de muchas formas, así que se juntan todas; de más, a
    #     propósito, porque dar por declarado algo que no lo está deja pasar un
    #     error y dar por no declarado algo que sí lo está inventa uno.
    declarados = set()

    def sumar(txt):
        for x in re.findall(r'[A-Za-z_$][\w$]*', txt or ''):
            declarados.add(x)

    #     function nombre, const/let/var nombre, class nombre
    for m in re.finditer(r'\b(?:function|class)\s*\*?\s*([A-Za-z_$][\w$]*)', cod):
        declarados.add(m.group(1))
    for m in re.finditer(r'\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)', cod):
        declarados.add(m.group(1))
    #     const {a, b} = … y const [a, b] = …
    for m in re.finditer(r'\b(?:const|let|var)\s*[{\[]([^}\]]*)[}\]]', cod):
        sumar(m.group(1))
    #     los parámetros: de una función con nombre, de una flecha con
    #     paréntesis, de una flecha de un solo argumento, de un método y de un
    #     catch.
    for m in re.finditer(r'\bfunction\s*\*?\s*[A-Za-z_$][\w$]*\s*\(([^()]*)\)', cod):
        sumar(m.group(1))
    for m in re.finditer(r'\bfunction\s*\*?\s*\(([^()]*)\)', cod):
        sumar(m.group(1))
    for m in re.finditer(r'\(([^()]*)\)\s*=>', cod):
        sumar(m.group(1))
    for m in re.finditer(r'([A-Za-z_$][\w$]*)\s*=>', cod):
        declarados.add(m.group(1))
    for m in re.finditer(r'([A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*\{', cod):
        declarados.add(m.group(1))
        sumar(m.group(2))
    for m in re.finditer(r'\bcatch\s*\(([^()]*)\)', cod):
        sumar(m.group(1))
    #     Un parametro con valor por defecto que lleva parentesis, tipo
    #     `function f(url, cortar = () => x())`, no entra en las expresiones de
    #     arriba (no admiten parentesis adentro): se recorre la lista de
    #     parametros contando parentesis (corregido el 25/09/2026).
    for m in re.finditer(r'\bfunction\s*\*?\s*[A-Za-z_$]?[\w$]*\s*\(', cod):
        sumar(parametros_balanceados(cod, m.end() - 1))
    for m in re.finditer(r'\b([A-Za-z_$][\w$]*)\s*\(', cod):
        fin = cierre_de_parentesis(cod, m.end() - 1)
        if fin > 0 and re.match(r'\s*(?:=>|\{)', cod[fin + 1:fin + 4]):
            sumar(cod[m.end():fin])

    #     Ahora las llamadas. Se saltea lo que lleva punto adelante (es un
    #     método de otra cosa) y lo que es una palabra del lenguaje.
    vistos = set()
    for m in re.finditer(r'([A-Za-z_$][\w$]*)\s*\(', cod):
        nom = m.group(1)
        if nom in RESERVADAS or nom in DEL_NAVEGADOR or nom in declarados or nom in vistos:
            continue
        j = m.start(1) - 1
        while j >= 0 and cod[j] in ' \t\r\n':
            j -= 1
        if j >= 0 and cod[j] in '.?':
            continue
        vistos.add(nom)
        aviso('no existe', m.start(1), 'se llama a "%s" y no esta declarada en ninguna parte' % nom)

    # 11. Temporizadores guardados que nunca se limpian.
    guardados = set(re.findall(r'\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*=\s*set(?:Timeout|Interval)\s*\(', cod))
    limpiados = set(re.findall(r'\bclear(?:Timeout|Interval)\s*\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)', cod))
    for nom in sorted(guardados - limpiados):
        pos = cod.find(nom + ' = set')
        avisos.append(('temporizador', linea_de(src, pos if pos >= 0 else 0),
                       'se guarda el temporizador "%s" y nunca se lo limpia' % nom))

    return avisos, src


# Casos mirados uno por uno el 23/09/2026 y comprobados sanos. Se listan acá
# para que una revisión limpia dé cero y cualquier aviso nuevo salte a la vista.
# Si alguno deja de ser cierto, se saca de esta lista y vuelve a avisar.
#
# La revisión de ese día: de los 48 avisos de "escape", 47 eran datos del propio
# programa (claves internas, números, HTML ya armado) y uno solo venía del PJN,
# B.total, que el programa ya obliga a ser número antes de usarlo.
_SANOS = {
    # números
    'n': 'un número', 'colspan': 'un número', 'antes': 'un número', 'despues': 'un número',
    'i': 'un número', 'paginas': 'un número', 'desdeN': 'un número', 'p': 'un número',
    'L.length': 'un número', 's.filas.length': 'un número', 'ver.length': 'un número',
    'c.w': 'un número', 'D.total': 'un número', 'B.leidas': 'un número',
    'B.total': 'lo que informa el PJN, que el programa ya obliga a ser número antes de usarlo',
    # claves y nombres que escribe el propio programa
    'k': 'una clave interna del programa', 'v': 'la solapa, clave interna',
    'tabla': 'la tabla, clave interna', 'clave': 'la solapa del expediente, clave interna',
    'otra': 'la otra lista, clave interna', 'a': 'el nombre de la acción, que escribe el programa',
    'c.k': 'la columna, clave interna', 'r.c': 'el resultado de la nota, clave interna',
    'clase': 'el estado del trabajo, clave interna',
    'sinBajar': 'un texto fijo del propio programa',
    # HTML ya armado por el programa
    'cab': 'el encabezado, que ya viene armado como HTML',
    'filas': 'las filas, que ya vienen armadas como HTML',
    'nav': 'la barra de la Guía, ya armada como HTML',
    'integ': 'los integrantes, ya armados como HTML',
    'subs': 'las dependencias, ya armadas como HTML',
    'barra': 'la barra, ya armada como HTML',
    'cuerpo': 'el cuerpo, ya armado como HTML',
}
REVISADOS = {('escape', 'se arma HTML pegando "%s" sin esc()' % nom): por
             for nom, por in _SANOS.items()}

if __name__ == '__main__':
    todos = '--todos' in sys.argv[1:]
    ruta = [a for a in sys.argv[1:] if not a.startswith('--')][0]
    avisos, src = revisar(ruta)
    sanos = [a for a in avisos if (a[0], a[2]) in REVISADOS]
    if not todos:
        avisos = [a for a in avisos if (a[0], a[2]) not in REVISADOS]
    por_clase = defaultdict(list)
    for clase, ln, texto in avisos:
        por_clase[clase].append((ln, texto))
    total = 0
    for clase in sorted(por_clase):
        items = sorted(set(por_clase[clase]))
        total += len(items)
        print('\n== %s (%d)' % (clase, len(items)))
        for ln, texto in items[:40]:
            print('  linea %-6d %s' % (ln, texto))
        if len(items) > 40:
            print('  ... y %d mas' % (len(items) - 40))
    if not total:
        print('Sin avisos nuevos.')
    print('\n%d avisos en total, sobre %d lineas (%d casos ya mirados y sanos quedaron afuera; con --todos se ven)'
          % (total, src.count('\n') + 1, len(sanos)))
    sys.exit(1 if total else 0)
