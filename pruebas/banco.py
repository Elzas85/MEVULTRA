# Banco de pruebas de MEV Ultra.
#
# Simula la MEV de la SCBA con Playwright (páginas inventadas con la estructura
# relevada: Sets.asp, resultados.asp, POSLoguin.asp, procesales.asp,
# Busqueda.asp, loguin.asp y la pantalla de validación) y corre el userscript
# como lo haría Tampermonkey. No toca la MEV real.
#
# Uso:  python3 banco.py                 (prueba ../mev-ultra.user.js)
#       MEVU_SCRIPT=ruta python3 banco.py (prueba otro archivo)
#       python3 banco.py --medir          (además cuenta las consultas de una
#                                          lectura con los Sets reales de Ignacio)
#
# Las esperas del programa (ritmo entre consultas, latido de sesión, sondeos)
# se acortan para que el banco corra en segundos. Cada acortamiento exige que
# el texto original esté en el archivo: si cambia, el banco se detiene y avisa.
#
# Qué cubre:
#   arranque y ventana; lectura completa y rápida, novedades, Set oculto por la
#   MEV; pausar y retomar sin repetir consultas; sesión vencida en medio de la
#   lectura; freno de validación; Buscar persona (campos ocultos, consulta de
#   control, "todos los organismos", sin resultados, diagnóstico); latido de
#   sesión; datos separados por cuenta; etiquetas, anotaciones y respaldo
#   cifrado; tabla, filtros y exportación; Este expediente; candado entre
#   pestañas; lectura por partes (un Set, un departamento, una jurisdicción
#   sin causas cargadas); el motor de descarga (0.8.0): PDF completo en orden
#   cronológico con el adjunto detrás de su actuación, código de la página que
#   no se ejecuta al capturar, enlaces que no son de la MEV, 404 sin
#   reintentos, 429 con Retry-After, cancelar que corta el adjunto en curso,
#   montaje y fotografía que no terminan; un 429 en la lectura; Buscar persona
#   (0.8.1) con el formato real de la respuesta ("Total Expedientes : 1"),
#   fueros Civil y Paz, diagnóstico si la MEV informa causas ilegibles, y
#   sesión cortada en medio de la búsqueda; la verificación resuelta en una
#   ventana pequeña que se cierra sola y el registro de verificaciones
#   (0.9.3); la solapa Guía (0.9.6) contra réplicas de la Guía Judicial de la
#   SCBA y del mapa del Ministerio Público; y una medición de consultas con los
#   Sets reales.
#   En cada grupo se verifica además que la jurisdicción de la sesión vuelve a
#   la original y que nunca se toca una página que modifique la cuenta.
#
# Comprobado con mutantes (errores metidos a propósito en el programa, cada
# uno detectado por el banco): sin restituir la jurisdicción; sin la lista de
# formularios prohibidos; latido sin mirar la actividad; sin los campos
# ocultos de la búsqueda; sin detectar la pantalla de validación; respaldo sin
# cifrar; sin la consulta de control; sin guardar la lectura parcial. En la
# 0.8.0: cancelar sin cortar el pedido; 404 reintentado; captura con el código
# de la página; marco de captura que queda tras un vencimiento; fotografía sin
# tope; enlace de actuación sin validar; 429 tomado como página; Retry-After
# ignorado. En la 0.9.6, sobre la Guía (veinte, todos detectados): consulta por
# GET, departamento por competencia, sin quitar acentos, sin quitar los
# enlaces de la página, sin el departamento escrito en el texto, número
# comparado como parte de otro, repetidas del Ministerio Público, subgrupo
# heredado por la fila sin rótulo, sin listados guardados, sin vencimiento,
# sin usar el guardado si falla, Actualizar sin forzar, un departamento caído
# que detiene todo, organismo de la persona sin partido, integrantes sin
# plegar, persona sin separar el cargo, sin marca de violencia, "sin
# resultados" tomado como error, POST sin cuerpo y pestaña del MPBA sin
# departamento.
#
# El motor usa pdf-lib y html2canvas de pruebas/vendor (las mismas del
# @require, con su huella comprobada). No cubre todavía el respaldo
# automático en carpeta.
import base64, hashlib, json, os, re, subprocess, sys, tempfile, time
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

RAIZ = Path(__file__).resolve().parent.parent
RUTA_SCRIPT = Path(os.environ.get('MEVU_SCRIPT') or (RAIZ / 'mev-ultra.user.js'))
ORIGINAL = RUTA_SCRIPT.read_text(encoding='utf-8')
# Pausa base entre consultas, leída del script (para la medición).
BASE_S = int(re.search(r'const RITMO = \{ base: (\d+),', ORIGINAL).group(1)) / 1000
USUARIO = 'KINBAUMI'
OTRO = 'OTRAPERSONA'

# ---------------------------------------------------------------- acortamientos
ACORTES = [
    ('const RITMO = { base: 1000, actual: 1000, max: 6000, limpias: 0 };', 'const RITMO = { base: 20, actual: 20, max: 120, limpias: 0 };'),
    ('const esperas = [5, 10, 20, 40, 60];', 'const esperas = [1, 1, 1, 1, 1];'),
    ('setInterval(latido, 60000)', 'setInterval(latido, 250)'),
    ('const LATIDO_MS = 3 * 60 * 1000;', 'const LATIDO_MS = 2500;'),
    ('}, 10000);', '}, 300);'),
    ('setInterval(comprobar, 10000);', 'setInterval(comprobar, 300);'),
    ('await sleep(3000);', 'await sleep(30);'),
    ('const LATIDO_SI_ACTIVO = 2 * 60 * 60 * 1000;', 'const LATIDO_SI_ACTIVO = 1500;'),
    ('sondeoSesionMs: 10000,', 'sondeoSesionMs: 300,'),
    # Motor de descarga (0.8.0): reintentos, pausas y topes, en milésimas.
    ('backoffBaseMs: 1500,', 'backoffBaseMs: 30,'),
    ('backoffMaxMs: 30000,', 'backoffMaxMs: 200,'),
    ('pausaBaseMs: 450,', 'pausaBaseMs: 20,'),
    ('limiteMontajeMs: 20000,', 'limiteMontajeMs: 1500,'),
    ('limiteCapturaMs: 60000,', 'limiteCapturaMs: 2500,'),
    ('esperaPedidaMaxMs: 120000,', 'esperaPedidaMaxMs: 3000,'),
]

def acortar(src):
    for antes, despues in ACORTES:
        n = src.count(antes)
        if n != 1:
            raise SystemExit('El banco esperaba encontrar una vez "%s" y lo encontró %d veces: hay que actualizar los acortamientos.' % (antes, n))
        src = src.replace(antes, despues)
    return src

SCRIPT = acortar(ORIGINAL)

# ---------------------------------------------------------------- bibliotecas del motor (0.8.0)
# pdf-lib y html2canvas, las mismas que Tampermonkey carga por @require. Se
# usan solo si están en pruebas/vendor y su huella SHA-384 coincide con la
# que declara la cabecera del script: así el banco prueba exactamente lo que
# se instala. Sin ellas, las pruebas del motor se saltean con un aviso.
VENDOR = Path(__file__).resolve().parent / 'vendor'
def biblioteca(nombre_archivo, paquete):
    ruta = VENDOR / nombre_archivo
    m = re.search(r'^// @require\s+\S*/' + re.escape(paquete) + r'@[^#\s]+#sha384=(\S+)', ORIGINAL, re.M)
    if not ruta.exists() or not m: return None
    datos = ruta.read_bytes()
    if base64.b64encode(hashlib.sha384(datos).digest()).decode() != m.group(1):
        raise SystemExit('pruebas/vendor/%s no coincide con la huella del @require: hay que reemplazarlo por la versión que declara el script.' % nombre_archivo)
    return datos.decode('utf-8')
LIB_PDF = biblioteca('pdf-lib.min.js', 'pdf-lib')
LIB_H2C = biblioteca('html2canvas.min.js', 'html2canvas')
HAY_BIBLIOTECAS = bool(LIB_PDF and LIB_H2C)

# Adjunto de prueba: un PDF de una hoja que dice "ADJUNTO DE PRUEBA".
PDF_ADJUNTO = base64.b64decode('JVBERi0xLjcKJYGBgYEKCjEgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFsgNSAwIFIgXQovQ291bnQgMQo+PgplbmRvYmoKCjIgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDEgMCBSCj4+CmVuZG9iagoKMyAwIG9iago8PAovUHJvZHVjZXIgPEZFRkYwMDcwMDA2NDAwNjYwMDJEMDA2QzAwNjkwMDYyMDAyMDAwMjgwMDY4MDA3NDAwNzQwMDcwMDA3MzAwM0EwMDJGMDAyRjAwNjcwMDY5MDA3NDAwNjgwMDc1MDA2MjAwMkUwMDYzMDA2RjAwNkQwMDJGMDA0ODAwNkYwMDcwMDA2NDAwNjkwMDZFMDA2NzAwMkYwMDcwMDA2NDAwNjYwMDJEMDA2QzAwNjkwMDYyMDAyOT4KL01vZERhdGUgKEQ6MjAyNjA5MjYyMjI5MDZaKQovQ3JlYXRvciA8RkVGRjAwNzAwMDY0MDA2NjAwMkQwMDZDMDA2OTAwNjIwMDIwMDAyODAwNjgwMDc0MDA3NDAwNzAwMDczMDAzQTAwMkYwMDJGMDA2NzAwNjkwMDc0MDA2ODAwNzUwMDYyMDAyRTAwNjMwMDZGMDA2RDAwMkYwMDQ4MDA2RjAwNzAwMDY0MDA2OTAwNkUwMDY3MDAyRjAwNzAwMDY0MDA2NjAwMkQwMDZDMDA2OTAwNjIwMDI5PgovQ3JlYXRpb25EYXRlIChEOjIwMjYwOTI2MjIyOTA2WikKPj4KZW5kb2JqCgo0IDAgb2JqCjw8Ci9UeXBlIC9Gb250Ci9TdWJ0eXBlIC9UeXBlMQovQmFzZUZvbnQgL0hlbHZldGljYQovRW5jb2RpbmcgL1dpbkFuc2lFbmNvZGluZwo+PgplbmRvYmoKCjUgMCBvYmoKPDwKL1R5cGUgL1BhZ2UKL1BhcmVudCAxIDAgUgovUmVzb3VyY2VzIDw8Ci9Gb250IDw8Ci9IZWx2ZXRpY2EtNzA5ODQ4MDc4OSA0IDAgUgo+PgovWE9iamVjdCA8PAo+PgovRXh0R1N0YXRlIDw8Cj4+Cj4+Ci9NZWRpYUJveCBbIDAgMCAzMDAgNDAwIF0KL0Fubm90cyBbIF0KL0NvbnRlbnRzIFsgNiAwIFIgXQo+PgplbmRvYmoKCjYgMCBvYmoKPDwKL0ZpbHRlciAvRmxhdGVEZWNvZGUKL0xlbmd0aCAxMDkKPj4Kc3RyZWFtCnicHYpBCsJQDET3c4qsBWkSJ/QXpKBQceGmkAsUqaLoQime36/M8GAe88I+ofLL+4rmOD8+83I7T+tWu8KibenEKHmBV55g/6vJRmtV8oktjeQugkOQB9e6wjU0vLqg03rJO3KFITHiC9KLGMcKZW5kc3RyZWFtCmVuZG9iagoKeHJlZgowIDcKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDE2IDAwMDAwIG4gCjAwMDAwMDAwNzYgMDAwMDAgbiAKMDAwMDAwMDEyNiAwMDAwMCBuIAowMDAwMDAwNTk2IDAwMDAwIG4gCjAwMDAwMDA2OTQgMDAwMDAgbiAKMDAwMDAwMDg4OSAwMDAwMCBuIAoKdHJhaWxlcgo8PAovU2l6ZSA3Ci9Sb290IDIgMCBSCi9JbmZvIDMgMCBSCj4+CgpzdGFydHhyZWYKMTA3MQolJUVPRg==')

ENVOLTORIO = r"""
(() => {
  if (location.hostname !== 'mev.scba.gov.ar' && location.hostname !== 'docs.scba.gov.ar') return;
  // Almacén de Tampermonkey simulado sobre localStorage (compartido entre las
  // pestañas del mismo contexto, como el real). Los oyentes de cambios reciben
  // los cambios de las otras pestañas por el evento storage.
  const oyentes = [];
  window.GM_getValue = (k, d) => { const v = localStorage.getItem('gm:' + k); if (v == null) return d; try { return JSON.parse(v); } catch (e) { return v; } };
  window.GM_setValue = (k, v) => { localStorage.setItem('gm:' + k, JSON.stringify(v)); };
  window.GM_deleteValue = (k) => { localStorage.removeItem('gm:' + k); };
  window.GM_listValues = () => Object.keys(localStorage).filter((k) => k.startsWith('gm:')).map((k) => k.slice(3));
  window.GM_addValueChangeListener = (k, fn) => { oyentes.push([k, fn]); return oyentes.length; };
  window.GM_removeValueChangeListener = (id) => { if (oyentes[id - 1]) oyentes[id - 1] = ['', () => {}]; };
  window.addEventListener('storage', (e) => {
    if (!e.key || !e.key.startsWith('gm:')) return;
    const k = e.key.slice(3);
    const leer = (v) => { if (v == null) return undefined; try { return JSON.parse(v); } catch (x) { return v; } };
    oyentes.forEach(([kk, fn]) => { if (kk === k) { try { fn(k, leer(e.oldValue), leer(e.newValue), true); } catch (x) { window.__errores.push('oyente: ' + x.message); } } });
  });
  // Como el de Tampermonkey: pasa las cabeceras y el cuerpo (0.9.6), abort() corta el pedido y
  // llama a onabort. Cada pedido queda anotado en window.__gm (url, hora,
  // abortado) para que las pruebas vean reintentos y cortes.
  window.__gm = [];
  window.GM_xmlhttpRequest = (d) => {
    const reg = { url: d.url, t: Date.now(), abortado: false };
    window.__gm.push(reg);
    const corte = new AbortController();
    let terminado = false;
    const ctl = { abort() { if (terminado) return; terminado = true; reg.abortado = true; corte.abort(); if (d.onabort) d.onabort({}); } };
    fetch(d.url, { method: d.method || 'GET', credentials: 'include', signal: corte.signal, body: d.data, headers: d.headers }).then(async (r) => {
      const buf = await r.arrayBuffer();
      if (terminado) return;
      terminado = true;
      const cab = [...r.headers.entries()].map(([k, v]) => k + ': ' + v).join('\r\n');
      const resp = { status: r.status, response: d.responseType === 'arraybuffer' ? buf : new TextDecoder().decode(buf), responseHeaders: cab, finalUrl: r.url };
      if (d.onload) d.onload(resp);
    }).catch((e) => { if (!terminado && d.onerror) { terminado = true; d.onerror(e); } });
    return ctl;
  };
  window.GM_download = (d) => {
    window.__descargas = window.__descargas || [];
    fetch(d.url).then((r) => r.arrayBuffer()).then((buf) => {
      let b = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i++) b += String.fromCharCode(u[i]);
      window.__descargas.push({ nombre: d.name, b64: btoa(b) });
      if (d.onload) d.onload();
    }).catch((e) => { if (d.onerror) d.onerror(e); });
  };
  // Bibliotecas de @require simuladas (Tampermonkey las carga antes del script; acá el proxy no deja bajarlas).
  if (!window.PDFLib) window.PDFLib = { PDFDocument: class {}, StandardFonts: {}, rgb: () => 0 };
  if (!window.html2canvas) window.html2canvas = async () => document.createElement('canvas');
  window.unsafeWindow = window;
  window.__errores = [];
  window.addEventListener('error', (e) => window.__errores.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => window.__errores.push('promesa: ' + String(e.reason && e.reason.message || e.reason)));
  const correr = () => {
__SCRIPT__
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', correr); else correr();
})();
""".replace('__SCRIPT__', SCRIPT)
# La lectura sola (0.9.2) arranca medio minuto después de abrir la página: en el banco
# se la aleja una hora para que no se meta en las demás pruebas; lectura_sola la acerca.
ENVOLTORIO = ENVOLTORIO.replace('ESPERA_ARRANQUE_MS = 30 * 1000', 'ESPERA_ARRANQUE_MS = 3600 * 1000')

# ---------------------------------------------------------------- la MEV simulada
# Jurisdicciones: los valores del formulario POSLoguin.asp y el nombre con que
# la MEV los escribe en el encabezado.
DEPTOS = {'80': 'Avellaneda-Lanus', '10': 'Azul', '11': 'Bahía Blanca', '12': 'Dolores', '13': 'Junín', '14': 'La Matanza', '6': 'La Plata',
          '16': 'Lomas de Zamora', '17': 'Mar del Plata', '18': 'Mercedes', '52': 'Moreno - Gral. Rodriguez', '19': 'Moron', '20': 'Necochea',
          '21': 'Olavarría', '22': 'Pergamino', '23': 'Quilmes', '24': 'San Isidro', '25': 'San Martín', '26': 'San Nicolas', '27': 'Tandil',
          '28': 'Trenque Lauquen', '49': 'Tres Arroyos', '29': 'Zarate/Campana'}

def nombre_juris(jid):
    if jid == 'SCJ': return 'SUPREMA CORTE'
    if jid == 'LPC': return 'Tribunal de Casación Penal'
    if jid == 'PZ': return 'Justicia de PAZ'
    d = DEPTOS[jid[2:]]
    return d + (' - Familia' if jid.startswith('FF') else ' - Penal' if jid.startswith('PP') else '')

def juris_de_cuerpo(qs):
    tipo = (qs.get('TipoDto') or [''])[0]
    dto = (qs.get('DtoJudElegido') or [''])[0]
    if tipo == 'SCJ': return 'SCJ'
    if tipo == 'LPC': return 'LPC'
    if tipo == 'PZ': return 'PZ'
    if qs.get('TipoF'): return 'FF' + dto
    if qs.get('TipoP'): return 'PP' + dto
    return 'CC' + dto

class Causa:
    def __init__(self, nid, pid, juris, caratula, estado='En trámite', receptoria='', expediente='', inicio='12/03/2021', ult='20/09/2026', tramite='PASE A DESPACHO', pasos=None):
        self.nid = str(nid); self.pid = pid; self.juris = juris; self.caratula = caratula; self.estado = estado
        self.receptoria = receptoria or ('SI-%s-2021' % nid); self.expediente = expediente or str(nid); self.inicio = inicio
        self.ult = ult; self.tramite = tramite
        self.pasos = pasos or [('20/09/2026', '3', tramite), ('10/08/2026', '2', 'PROVEIDO'), ('12/03/2021', '1', 'INICIO')]

class Mev:
    """Estado de una MEV simulada: sesión, jurisdicción, Sets, organismos, frenos."""
    def __init__(self, usuario=USUARIO, juris='CC24', nombre='IGNACIO KINBAUM'):
        self.usuario = usuario; self.nombre = nombre; self.juris = juris; self.juris_inicial = juris
        self.sesion = True
        self.sabotaje = None
        self.set_actual = None
        self.pedidos = []            # [{'method','path','qs','body'}]
        self.portero = {}            # fragmento de ruta -> respuestas frenadas que faltan
        self.cabeceras = {}          # fragmento de ruta -> cabeceras extra de esa página (por ejemplo X-Frame-Options)
        self.frenos_servidos = 0
        self.busqueda_ignora_texto = False
        self.juris_caidas = set()
        self.sets = []               # [{'nidset','nombre','tipo','causas':[Causa]}]
        self.orgs = {}               # pid -> (nombre, juris)
        self.todos_en = set()        # jurisdicciones cuya consulta ofrece "Todos los organismos"
        self.sueltas = []            # causas que existen en la MEV pero no están en ningún Set
        # Motor de descarga (0.8.0)
        self.adjuntos = {}           # id -> {'status', 'headers', 'body', 'colgar', 'veces'} (respuestas en orden)
        self.proveidos = {}          # idpaso -> cuerpo HTML propio, o lista de respuestas {'status','headers','html'} que se consumen
        self.filas_extra = []        # filas agregadas a procesales: (fecha, fojas, descripción, href tal cual)
        self.colgar = set()          # rutas que nunca responden (por ejemplo, una imagen)
        # Formato de la respuesta de la consulta por carátula (0.8.1). 'banco': el de siempre.
        # 'real': como la captura de Ignacio del 26/09/2026 ("Total Expedientes : 1", con espacio)
        # y, por hipótesis, el enlace de la causa sin el código del juzgado. 'ilegible': la MEV
        # declara causas pero el enlace no es a procesales.asp (para el diagnóstico).
        self.busqueda_formato = 'banco'

    # --- armado
    def organismo(self, pid, nombre, juris):
        self.orgs[pid] = (nombre, juris)
    def set_(self, nidset, nombre, causas, tipo=0, total=None):
        self.sets.append({'nidset': str(nidset), 'nombre': nombre, 'tipo': tipo, 'causas': causas, 'total': len(causas) if total is None else total})
    def causas_todas(self):
        vistas = {}
        for s in self.sets:
            for c in s['causas']: vistas[c.nid + '|' + c.pid] = c
        for c in self.sueltas: vistas[c.nid + '|' + c.pid] = c
        return list(vistas.values())

    # --- páginas
    def encabezado(self):
        return ('<table><tr><td class="fondoazul"><p>UsuarioMEV: %s</p><p>Nombre: %s</p></td>'
                '<td class="fondoazul"><p>%s</p></td><td><a href="POSloguin.asp">Cambiar Jurisdicción</a> <a href="loguin.asp">Desconectarse</a></td></tr></table>'
                % (self.usuario, self.nombre, nombre_juris(self.juris)))
    def pagina(self, cuerpo, titulo='Mesa de Entradas Virtual'):
        return '<!doctype html><html><head><meta charset="windows-1252"><title>%s</title></head><body>%s%s</body></html>' % (titulo, self.encabezado(), cuerpo)
    def login(self):
        return ('<!doctype html><html><head><meta charset="windows-1252"><title>MEV</title></head><body><h2>Ingrese los datos del Usuario</h2>'
                '<form action="POSLoguin.asp" method="post">Usuario <input type="text" name="usuario"> Clave <input type="password" name="clave">'
                '<select name="DtoJudElegido"><option value="24">San Isidro</option></select><input type="submit" name="Aceptar" value="Aceptar"></form></body></html>')
    def portero_html(self):
        return ('<!doctype html><html><head><meta charset="windows-1252"><title>Validando acceso</title></head><body><h1>Validando acceso</h1>'
                '<p>El sistema está verificando si está siendo navegado por un ser humano. Por favor espere.</p></body></html>')
    def fila_causa(self, c):
        return ('<table class="causa"><tr><td><div class="AnchoFijoCaratula"><a href="procesales.asp?nidCausa=%s&pidJuzgado=%s">%s -</a></div></td></tr>'
                '<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s - %s</td></tr></table>'
                % (c.nid, c.pid, c.caratula, c.estado, c.receptoria, c.expediente, c.inicio, c.ult, c.tramite))
    def sets_asp(self):
        filas = []
        for s in self.sets:
            filas.append('<tr><td><a href="resultados.asp?nidset=%s&sFechaDesde=&sFechaHasta=&pOrden=xCa&pOrdenAD=Asc">%s</a></td>'
                         '<td><a href="ModificarSet.asp?nidset=%s&tipodeset=%d">Modificar</a></td></tr><tr><td>Total Expedientes: %d</td></tr>'
                         % (s['nidset'], s['nombre'], s['nidset'], s['tipo'], s['total']))
        trampa = ('<form action="NuevoSet.asp" method="post"><b>Nuevo Set</b> Carátula <input type="text" name="caratula">'
                  '<select name="JuzgadoElegido">%s</select><input type="submit" name="Crear" value="Crear Set"></form>'
                  % ''.join('<option value="%s">%s</option>' % (pid, n) for pid, (n, j) in self.orgs.items() if j == self.juris))
        menu = '<p><a href="Busqueda.asp">Consulta por Carátula</a> | <a href="NuevoSet.asp">Nuevo Set</a> | <a href="Ayuda.asp">Ayuda</a></p>'
        return self.pagina(menu + trampa + '<h3>Sets de Búsqueda</h3><table>' + ''.join(filas) + '</table>')
    def organismos_del_set(self, s):
        pids = []
        for c in s['causas']:
            if c.juris == self.juris and c.pid not in pids: pids.append(c.pid)
        return pids
    def listado(self, causas, total=None, select_html=''):
        n = len(causas) if total is None else total
        cuerpo = ''.join(self.fila_causa(c) for c in causas) or '<p>La consulta NO arrojó resultados.</p>'
        return self.pagina('<p>Total expedientes: %d</p>%s%s' % (n, select_html, cuerpo))
    def resultados_get(self, qs):
        nidset = (qs.get('nidset') or [''])[0]
        s = next((x for x in self.sets if x['nidset'] == nidset), None)
        if not s: return self.pagina('<p>Set inexistente</p>')
        self.set_actual = s
        pids = self.organismos_del_set(s)
        if not pids:
            return self.pagina('<p>El Set contiene Expedientes de otra Jurisdicción o no tiene Expedientes cargados.</p>')
        sel = ('<form action="resultados.asp?sFechaDesde=&sFechaHasta=" method="post">Organismos del Set <select name="JuzgadoElegido" id="JuzgadoElegido">%s</select>'
               '<input type="submit" name="Consultar" value="Consultar"></form>' % ''.join('<option value="%s">%s</option>' % (p, self.orgs[p][0]) for p in pids))
        causas = [c for c in s['causas'] if c.pid == pids[0]]
        total = len(causas) + (s['total'] - len(s['causas']) if s['total'] > len(s['causas']) else 0)
        return self.listado(causas, total, sel)
    def resultados_post(self, qs):
        pid = (qs.get('JuzgadoElegido') or [''])[0]
        s = self.set_actual
        if not s: return self.pagina('<p>Sin Set elegido</p>')
        # Como la MEV real (25/09/2026): el total cuenta las causas del organismo aunque la
        # jurisdicción de la sesión sea otra; en ese caso no muestra ninguna.
        del_organismo = [c for c in s['causas'] if c.pid == pid]
        causas = [c for c in del_organismo if c.juris == self.juris]
        # Sabotaje de prueba: otra pestaña cambia la jurisdicción después de la enésima consulta de organismo.
        if self.sabotaje and self.sabotaje.get('quedan') is not None:
            if self.sabotaje['quedan'] == 0: self.juris = self.sabotaje['juris']; self.sabotaje['hecho'] = True; self.sabotaje['quedan'] = None
            else: self.sabotaje['quedan'] -= 1
        return self.listado(causas, len(del_organismo))
    def procesales(self, qs):
        nid = (qs.get('nidCausa') or [''])[0]; pid = (qs.get('pidJuzgado') or [''])[0]
        c = next((x for x in self.causas_todas() if x.nid == nid and x.pid == pid), None)
        if not c: return self.pagina('<p>Causa inexistente</p>')
        filas = ''.join('<tr><td>%s</td><td>%s</td><td><img src="firma.gif" alt="firmado"></td><td><a href="proveido.asp?nidCausa=%s&pidJuzgado=%s&idpaso=%d">%s</a></td></tr>'
                        % (f, fo, c.nid, c.pid, i, d) for i, (f, fo, d) in enumerate(c.pasos))
        filas += ''.join('<tr><td>%s</td><td>%s</td><td></td><td><a href="%s">%s</a></td></tr>' % (f, fo, href, d) for f, fo, d, href in self.filas_extra)
        return self.pagina('<p>Carátula: %s</p><p>Fecha inicio: %s</p><p>Nº de Receptoría: %s</p><p>Nº de Expediente: %s</p><p>Estado: %s</p>'
                           '<h4>Pasos Procesales</h4><table><tr><th>Fecha</th><th>Fojas</th><th>Firmado</th><th>Descripción</th></tr>%s</table>'
                           % (c.caratula, c.inicio, c.receptoria, c.expediente, c.estado, filas))
    def proveido(self, qs):
        paso = (qs.get('idpaso') or [''])[0]
        propio = self.proveidos.get(paso)
        if isinstance(propio, list) and propio:
            r = propio.pop(0)
            return r.get('status', 200), r.get('headers', {}), r.get('html') or self.pagina('<p>Error</p>')
        cuerpo = propio if isinstance(propio, str) else '<div id="imprime"><p>Proveído de prueba</p><div id="contenidoTxt">Texto del proveído.</div></div>'
        return 200, {}, self.pagina(cuerpo)
    def adjunto(self, route, qs):
        ident = (qs.get('id') or [''])[0]
        lista = self.adjuntos.get(ident)
        if not lista: return route.fulfill(status=404, body='')
        r = lista.pop(0) if len(lista) > 1 else lista[0]
        if r.get('colgar'): return None          # no contesta nunca
        # Como GM_xmlhttpRequest ve todas las cabeceras, la réplica las expone al fetch del simulador.
        cab = {'content-type': 'application/pdf', 'access-control-allow-origin': 'https://mev.scba.gov.ar',
               'access-control-allow-credentials': 'true', 'access-control-expose-headers': 'Retry-After, Content-Type, Content-Disposition'}
        return route.fulfill(status=r.get('status', 200), headers=dict(cab, **r.get('headers', {})), body=r.get('body', PDF_ADJUNTO))
    def busqueda_form(self):
        orgs = [(pid, n) for pid, (n, j) in self.orgs.items() if j == self.juris]
        opciones = ('<option value="0">-- Todos los Organismos --</option>' if self.juris in self.todos_en else '') + ''.join('<option value="%s">%s</option>' % o for o in orgs)
        return ('<form name="frmBusqueda" action="Busqueda.asp" method="post"><input type="hidden" name="OpcionBusqueda" value=""><input type="hidden" name="busca" value="">'
                '<table><tr><td>Tipo de consulta</td><td><input type="radio" name="TipoBusqueda" value="C" checked> Por Carátula <input type="radio" name="TipoBusqueda" value="N"> Por Número</td></tr>'
                '<tr><td>Carátula</td><td><input type="text" name="Texto" size="40"></td></tr>'
                '<tr><td>Organismo</td><td><select name="JuzgadoElegido">%s</select></td></tr></table>'
                '<input type="submit" name="Buscar" value="Buscar"></form>' % opciones)
    def busqueda_get(self):
        return self.pagina('<h3>Consulta por Carátula</h3>' + self.busqueda_form() +
                           '<form action="ModificarSet.asp" method="post">Carátula <input type="text" name="caratula"><select name="JuzgadoElegido"><option value="X">Org</option></select><input type="submit" name="Guardar" value="Guardar"></form>')
    def busqueda_post(self, qs):
        texto = (qs.get('Texto') or [''])[0]
        opcion = (qs.get('OpcionBusqueda') or [''])[0]
        busca = (qs.get('busca') or [''])[0]
        pid = (qs.get('JuzgadoElegido') or [''])[0]
        if opcion != '0' or busca != texto or self.busqueda_ignora_texto or not texto.strip():
            return self.pagina('<p>La consulta No arroja resultados</p>')
        palabras = [p for p in texto.upper().split() if p]
        halladas = [c for c in self.causas_todas() if c.juris == self.juris and (pid == '0' or c.pid == pid) and all(p in c.caratula.upper() for p in palabras)]
        if not halladas: return self.pagina('<p>La consulta No arroja resultados</p>')
        if self.busqueda_formato == 'real':
            filas = ''.join('<table class="pegada"><tr><td><input type="checkbox" name="Marcados" value="%s"><a href="procesales.asp?nidCausa=%s">%s -</a></td></tr>'
                            '<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s - %s</td></tr></table>'
                            % (c.nid, c.nid, c.caratula, c.estado, c.receptoria, c.expediente, c.inicio, c.ult, c.tramite) for c in halladas)
            return self.pagina('<p>Expresión de búsqueda Carátula: %s</p><p>Total Expedientes : %d</p>%s<p>Total Expedientes : %d</p>' % (texto, len(halladas), filas, len(halladas)))
        if self.busqueda_formato == 'ilegible':
            filas = ''.join('<p><a href="#" onclick="verCausa(%s)">%s -</a></p>' % (c.nid, c.caratula) for c in halladas)
            return self.pagina('<p>Total Expedientes : %d</p>%s' % (len(halladas), filas))
        return self.listado(halladas)

    # --- despacho
    def atender(self, route, request):
        u = urlparse(request.url)
        path = u.path
        qs = parse_qs(u.query, keep_blank_values=True)
        body = request.post_data or ''
        if body: qs.update(parse_qs(body, keep_blank_values=True))
        self.pedidos.append({'method': request.method, 'path': path, 'qs': qs, 'body': body, 'juris': self.juris})
        def responder(html, status=200):
            extra = {}
            for frag, h in self.cabeceras.items():
                if frag.lower() in path.lower(): extra.update(h)
            route.fulfill(status=status, content_type='text/html; charset=windows-1252', headers=extra or None, body=html.encode('cp1252', 'replace'))
        if u.hostname == 'docs.scba.gov.ar':
            return self.adjunto(route, qs)
        if path in self.colgar:
            return None                          # no contesta nunca
        if not path.lower().endswith('.asp'):
            return route.fulfill(status=404, body='')
        for frag, n in list(self.portero.items()):
            if frag.lower() in path.lower() and n > 0:
                self.portero[frag] = n - 1
                self.frenos_servidos += 1
                return responder(self.portero_html())
        if path.lower() == '/loguin.asp':
            return responder(self.login())
        if not self.sesion:
            return responder(self.login())
        if path.lower() == '/posloguin.asp':
            j = juris_de_cuerpo(qs)
            if j in self.juris_caidas:
                return responder(self.pagina('<p>El servicio no esta disponible para esta jurisdiccion en este momento.</p>'))
            if j[2:] in DEPTOS or j in ('SCJ', 'LPC', 'PZ'): self.juris = j
            return responder(self.pagina('<p>Jurisdicción elegida.</p>'))
        if path.lower() == '/sets.asp':
            return responder(self.sets_asp())
        if path.lower() == '/resultados.asp':
            return responder(self.resultados_post(qs) if request.method == 'POST' else self.resultados_get(qs))
        if path.lower() == '/procesales.asp':
            return responder(self.procesales(qs))
        if path.lower() == '/proveido.asp':
            status, cab, html = self.proveido(qs)
            return route.fulfill(status=status, headers=dict({'content-type': 'text/html; charset=windows-1252'}, **dict(self.cabeceras.get('proveido.asp', {}), **cab)), body=html.encode('cp1252', 'replace'))
        if path.lower() == '/busqueda.asp':
            return responder(self.busqueda_post(qs) if request.method == 'POST' else self.busqueda_get())
        if path.lower() in ('/nuevoset.asp', '/modificarset.asp', '/salir.asp'):
            return responder(self.pagina('<p>PÁGINA PROHIBIDA TOCADA</p>'))
        return responder(self.pagina('<p>Página de relleno</p>'))

    # --- consultas para las pruebas
    def pedidos_a(self, path, method=None):
        return [p for p in self.pedidos if p['path'].lower() == path.lower() and (method is None or p['method'] == method)]
    def prohibidos(self):
        return [p for p in self.pedidos if re.search(r'set|nuevo|modific|alta|baja|borr|elimin|agreg|incorpor|guard|perfil|clave|usuario', p['path'].replace('/Sets.asp', ''), re.I)
                and not re.search(r'^/Sets\.asp$', p['path'])]

# ---------------------------------------------------------------- Sets de prueba
def mev_chica(usuario=USUARIO, juris='CC24'):
    m = Mev(usuario, juris)
    m.organismo('SI-1', 'Juzgado en lo Civil y Comercial Nº 1 - San Isidro', 'CC24')
    m.organismo('SI-2', 'Juzgado en lo Civil y Comercial Nº 2 - San Isidro', 'CC24')
    m.organismo('SI-3', 'Juzgado en lo Civil y Comercial Nº 3 - San Isidro', 'CC24')
    m.organismo('SI-CAM', 'Cámara de Apelación en lo Civil y Comercial - Sala I - San Isidro', 'CC24')
    m.organismo('SI-TT', 'Tribunal del Trabajo Nº 1 - San Isidro', 'CC24')
    m.organismo('SIF-1', 'Juzgado de Familia Nº 1 - San Isidro', 'FF24')
    m.organismo('SIP-1', 'Juzgado de Garantías Nº 1 - San Isidro', 'PP24')
    m.organismo('Q-1', 'Juzgado en lo Civil y Comercial Nº 1 - Quilmes', 'CC23')
    m.organismo('SM-1', 'Juzgado en lo Civil y Comercial Nº 1 - San Martín', 'CC25')
    m.organismo('LZ-1', 'Juzgado en lo Civil y Comercial Nº 1 - Lomas de Zamora', 'CC16')
    m.organismo('ME-1', 'Juzgado en lo Civil y Comercial Nº 1 - Mercedes', 'CC18')
    m.organismo('PZ-PILAR', 'Juzgado de Paz Letrado de Pilar', 'PZ')
    # Todas las jurisdicciones civiles tienen juzgados (como en la MEV real); si no, la consulta por carátula no se reconoce.
    for v, n in DEPTOS.items():
        for k in (1, 2):
            pid = 'CC%s-%d' % (v, k)
            if not any(j == 'CC' + v for _, j in m.orgs.values()) or k == 2:
                m.organismo(pid, 'Juzgado en lo Civil y Comercial Nº %d - %s' % (k + 10, n), 'CC' + v)
    m.organismo('PZ-OTRO', 'Juzgado de Paz Letrado de Escobar', 'PZ')
    m.todos_en.add('CC23')
    c = {}
    c[1001] = Causa(1001, 'SI-1', 'CC24', 'MARINO TERESA S/ SUCESION AB-INTESTATO', expediente='36999', receptoria='SI-36999-2021')
    c[1002] = Causa(1002, 'SI-1', 'CC24', 'PEREZ JUAN C/ GOMEZ MARIA S/ DAÑOS Y PERJUICIOS', ult='18/09/2026', tramite='PROVEIDO')
    c[1003] = Causa(1003, 'SI-2', 'CC24', 'RODRIGUEZ ANA S/ SUCESION TESTAMENTARIA')
    c[1004] = Causa(1004, 'SI-2', 'CC24', 'LOPEZ CARLOS C/ BANCO DE PRUEBA S/ EJECUCION')
    c[1005] = Causa(1005, 'SI-2', 'CC24', '=CMD PRUEBA S/ SUCESION AB-INTESTATO')
    c[1006] = Causa(1006, 'Q-1', 'CC23', 'MARINO TERESA S/ INCIDENTE DE HONORARIOS')
    c[1007] = Causa(1007, 'SM-1', 'CC25', 'FERNANDEZ LUIS S/ SUCESION AB-INTESTATO')
    c[1008] = Causa(1008, 'Q-1', 'CC23', 'GARCIA PEDRO S/ SUCESION AB-INTESTATO')
    c[1009] = Causa(1009, 'Q-1', 'CC23', 'DIAZ ROSA C/ SUAREZ JOSE S/ COBRO')
    c[1010] = Causa(1010, 'SI-3', 'CC24', 'PRIVADA UNO S/ SUCESION AB-INTESTATO')
    c[1011] = Causa(1011, 'LZ-1', 'CC16', 'PRIVADA DOS C/ ALGUIEN S/ DESALOJO')
    c[1012] = Causa(1012, 'SIF-1', 'FF24', 'MARTINEZ SOFIA S/ DETERMINACION DE LA CAPACIDAD')
    c[1013] = Causa(1013, 'SIP-1', 'PP24', 'IMPUTADO PRUEBA S/ ESTAFA')
    c[1014] = Causa(1014, 'ME-1', 'CC18', 'MERCEDES UNO S/ SUCESION AB-INTESTATO')
    c[1015] = Causa(1015, 'ME-1', 'CC18', 'MERCEDES DOS S/ SUCESION AB-INTESTATO')
    c[1016] = Causa(1016, 'PZ-PILAR', 'PZ', 'MARINO TERESA S/ SUCESION AB-INTESTATO (PAZ)')
    m.set_(101, 'San Isidro PG', [c[1001], c[1002], c[1003], c[1004], c[1005], c[1006], c[1007]])
    m.set_(102, 'Quilmes PG', [c[1008], c[1009]])
    m.set_(103, 'Privadas', [c[1010], c[1011], c[1001]])
    m.set_(104, 'San Isidro Familia', [c[1012]])
    m.set_(105, 'Azul PG', [])
    m.set_(106, 'Lista de Causas con Autorización (232)', [c[1013]], tipo=1)
    m.set_(107, 'Mercedes PG', [c[1014], c[1015]], total=3)
    m.sueltas = [c[1016]]           # existe en la MEV, no está en ningún Set: solo la encuentra Buscar persona
    return m

def mev_real():
    """Los Sets de Ignacio con sus totales reales (Sets.asp, 07/09/2026), con
    una distribución verosímil de juzgados: sirve para contar consultas."""
    m = Mev()
    n = [2000]
    def org(pid, nombre, juris): m.organismo(pid, nombre, juris)
    def causas(juris, prefijo, cantidad, juzgados):
        out = []
        for i in range(cantidad):
            k = i % juzgados + 1
            pid = '%s-%d' % (prefijo, k)
            if pid not in m.orgs: org(pid, 'Juzgado en lo Civil y Comercial Nº %d - %s' % (k, DEPTOS.get(juris[2:], juris)), juris)
            n[0] += 1
            out.append(Causa(n[0], pid, juris, 'CAUSA %d S/ SUCESION AB-INTESTATO' % n[0]))
        return out
    # San Isidro PG: 77 = 76 en San Isidro (juzgados 1 a 16) + 1 en Quilmes + 2 en San Martín (bitácora 0.3.0)
    si = causas('CC24', 'SI', 76, 16) + causas('CC23', 'Q', 1, 1) + causas('CC25', 'SM', 2, 1)
    m.set_(201, 'San Isidro PG', si)
    m.set_(202, 'San Martin PG', causas('CC25', 'SM', 38, 8))
    m.set_(203, 'MDQ PG', causas('CC17', 'MDQ', 27, 6))
    m.set_(204, 'La Plata PG', causas('CC6', 'LP', 22, 6))
    m.set_(205, 'Lomas PG', causas('CC16', 'LZ', 22, 6))
    m.set_(206, 'Moron PG', causas('CC19', 'MO', 15, 4))
    m.set_(207, 'Mercedes PG', causas('CC18', 'ME', 11, 3))
    m.set_(208, 'La Matanza PG', causas('CC14', 'LM', 10, 3))
    m.set_(209, 'Quilmes PG', causas('CC23', 'Q', 8, 3))
    m.set_(210, 'Lanus PG', causas('CC80', 'LA', 5, 2))
    m.set_(211, 'Privadas', causas('CC24', 'SI', 1, 1) + causas('CC6', 'LP', 1, 1) + causas('CC16', 'LZ', 1, 1) + causas('CC17', 'MDQ', 1, 1) + causas('CC19', 'MO', 1, 1))
    m.set_(212, 'Zarate PG', causas('CC29', 'ZC', 5, 2))
    m.set_(213, 'Junin PG', causas('CC13', 'JU', 2, 1))
    m.set_(214, 'Avellaneda PG', causas('CC80', 'AV', 2, 1))
    m.set_(215, 'Dolores PG', causas('CC12', 'DO', 1, 1))
    m.set_(216, 'Necochea PG', causas('CC20', 'NE', 1, 1))
    m.set_(217, 'San Nicolas PG', causas('CC26', 'SN', 1, 1))
    org('PZ-1', 'Juzgado de Paz Letrado de Pilar', 'PZ')
    m.set_(218, 'Juzgados de Paz', [Causa(2999, 'PZ-1', 'PZ', 'PAZ UNO S/ SUCESION AB-INTESTATO')])
    m.set_(219, 'Azul PG', [])
    org('SIF-1', 'Juzgado de Familia Nº 1 - San Isidro', 'FF24'); org('SIP-1', 'Juzgado de Garantías Nº 1 - San Isidro', 'PP24')
    m.set_(220, 'Lista de Causas con Autorización (232)', [Causa(3001, 'SIF-1', 'FF24', 'AUT UNO'), Causa(3002, 'SIP-1', 'PP24', 'AUT DOS'), Causa(3003, 'SIF-1', 'FF24', 'AUT TRES')], tipo=1)
    m.set_(221, 'Lista de Causas con Autorización (123) Familia', [Causa(3004, 'SIF-1', 'FF24', 'FAM UNO'), Causa(3005, 'SIF-1', 'FF24', 'FAM DOS'), Causa(3006, 'SIF-1', 'FF24', 'FAM TRES')], tipo=1)
    m.set_(222, 'Lista de Causas con Autorización (379) Penal', [], tipo=1)
    return m

# ---------------------------------------------------------------- infraestructura
FALLAS = []
OK = [0]
def chequear(nombre, cond, detalle=''):
    if cond: OK[0] += 1
    else: FALLAS.append(nombre + (': ' + str(detalle)[:400] if detalle else '')); print('   FALLA', nombre, str(detalle)[:400])

def esperar(page, js, ms=20000, paso=100):
    fin = time.time() + ms / 1000
    while time.time() < fin:
        try:
            if page.evaluate(js): return True
        except Exception:
            pass
        page.wait_for_timeout(paso)
    return False

def contexto(browser, mev, bibliotecas=False):
    ctx = browser.new_context(viewport={'width': 1400, 'height': 900}, accept_downloads=True, ignore_https_errors=True)
    ctx.route('https://mev.scba.gov.ar/**', mev.atender)
    ctx.route('https://docs.scba.gov.ar/**', mev.atender)
    if bibliotecas:
        ctx.add_init_script(LIB_PDF)
        ctx.add_init_script(LIB_H2C)
    ctx.add_init_script(ENVOLTORIO)
    return ctx

def abrir(ctx, ruta='/Sets.asp'):
    page = ctx.new_page()
    page.goto('https://mev.scba.gov.ar' + ruta)
    esperar(page, "!!document.querySelector('#mvu')", 8000)
    return page

def errores(page):
    return page.evaluate('window.__errores || []')

def gm(page, k):
    return page.evaluate("(k) => { const v = localStorage.getItem('gm:' + k); return v == null ? null : JSON.parse(v); }", k)

def gm_set(page, k, v):
    page.evaluate("([k, v]) => localStorage.setItem('gm:' + k, JSON.stringify(v))", [k, v])

def indice(page, usuario=USUARIO):
    v = gm(page, 'mu.%s.indice' % usuario)
    return json.loads(v) if isinstance(v, str) else v

def marcas(page, usuario=USUARIO):
    v = gm(page, 'mu.%s.marcas' % usuario)
    return json.loads(v) if isinstance(v, str) else v

def elegir_deptos(page, nombre, ids):
    """Desplegable con casillas (0.9.1): abre, deja tildados solo `ids` (ninguno = todos) y cierra con Listo."""
    page.click('#mvu [data-e="%sBoton"]' % nombre)
    esperar(page, "document.querySelector('#mvu [data-e=\"%sPanel\"]').style.display === 'block'" % nombre, 3000)
    page.click('#mvu [data-e="%sNinguno"]' % nombre)
    for jid in ids:
        page.check('#mvu [data-e="%sPanel"] input[data-d="%s"]' % (nombre, jid))
    page.click('#mvu [data-e="%sListo"]' % nombre)
    return page.evaluate("document.querySelector('#mvu [data-e=\"%sBoton\"]').textContent" % nombre)

def leer_causas(page, modo='completa'):
    """Dispara la lectura y espera a que termine (la franja de lectura se oculta)."""
    if modo == 'completa' and page.evaluate("!!document.querySelector('#mvu [data-e=\"primera\"]')"):
        page.click('#mvu [data-e="primera"]')
    else:
        page.click('#mvu [data-t="sets"]')
        page.click('#mvu [data-e="s%s"]' % ('Completa' if modo == 'completa' else 'Rapida'))
    esperar(page, "document.querySelector('#mvu [data-e=\"lect\"]').style.display === 'flex'", 3000)
    return esperar(page, "document.querySelector('#mvu [data-e=\"lect\"]').style.display === 'none'", 60000)

def esperar_busqueda(page, ms=40000):
    """Espera a que la búsqueda más reciente deje de estar en curso y la devuelve."""
    fin = time.time() + ms / 1000
    while time.time() < fin:
        b = gm(page, 'mu.%s.busquedas' % USUARIO)
        b = (json.loads(b) if isinstance(b, str) else b) or []
        if b and b[0].get('estado') in ('terminada', 'error', 'pausada'): return b[0]
        page.wait_for_timeout(100)
    return None

def aviso_texto(page):
    return page.evaluate("document.querySelector('#mvu [data-e=\"avisoTxt\"]').textContent")

def filas_visibles(page):
    return page.evaluate("[...document.querySelectorAll('#mvu section[data-p=\"causas\"] tbody tr')].filter((r) => r.offsetParent !== null && r.querySelector('td')).length")

# ---------------------------------------------------------------- pruebas
def arranque(browser):
    print('== arranque y ventana')
    m = mev_chica()
    ctx = contexto(browser, m)
    page = abrir(ctx)
    chequear('la ventana aparece en Sets.asp', page.evaluate("!!document.querySelector('#mvu')"))
    chequear('la placa muestra el usuario de la MEV', USUARIO in page.evaluate("document.querySelector('#mvu [data-e=\"cuenta\"]').textContent"))
    chequear('sin causas leídas se ofrece la lectura completa', page.evaluate("!!document.querySelector('#mvu [data-e=\"primera\"]')"))
    chequear('sin errores de programa al cargar', not errores(page), errores(page))
    # minimizar, maximizar, cerrar y volver
    page.click('#mvu [data-e="min"]')
    chequear('minimizada queda el indicador', page.evaluate("getComputedStyle(document.querySelector('#mvu-pill')).display !== 'none'"))
    page.click('#mvu-pill [data-e="pillAbrir"]')
    chequear('el indicador vuelve a abrir la ventana', page.evaluate("getComputedStyle(document.querySelector('#mvu')).display !== 'none'"))
    page.click('#mvu [data-e="max"]')
    page.click('#mvu [data-e="max"]')
    page.click('#mvu [data-e="cerrar"]')
    chequear('cerrada no se ve la ventana', page.evaluate("getComputedStyle(document.querySelector('#mvu')).display === 'none'"))
    # pantalla de ingreso: nada
    m.sesion = False
    page2 = ctx.new_page(); page2.goto('https://mev.scba.gov.ar/Sets.asp'); page2.wait_for_timeout(800)
    chequear('en la pantalla de ingreso no se muestra nada', not page2.evaluate("!!document.querySelector('#mvu')"))
    chequear('en la pantalla de ingreso no hay pedidos del programa', all(p['path'].lower() == '/sets.asp' for p in m.pedidos[-2:]))
    ctx.close()
    # numeración y encabezado
    v = re.search(r'^// @version\s+(\S+)', ORIGINAL, re.M).group(1)
    chequear('la @version tiene un solo dígito por punto', re.fullmatch(r'\d\.\d\.\d', v), v)
    chequear('APP.version del módulo 2 coincide con la @version', ("version: 'beta " + v + "'") in ORIGINAL, v)
    motor = re.search(r"nombre: 'MEV Ultra \(motor MEV\+ ([\d.]+)\)'", ORIGINAL)
    chequear('el motor declara su versión en el encabezado', motor and ('motor de MEV+ ' + motor.group(1)) in ORIGINAL)
    chequear('pdf-lib va como @require con hash de integridad', re.search(r'^// @require\s+\S*pdf-lib\S*#sha384=', ORIGINAL, re.M))
    chequear('html2canvas va como @require con hash de integridad', re.search(r'^// @require\s+\S*html2canvas\S*#sha384=', ORIGINAL, re.M))

def lectura(browser):
    print('== lectura completa')
    m = mev_chica()
    ctx = contexto(browser, m)
    page = abrir(ctx)
    ok = leer_causas(page, 'completa')
    chequear('la lectura completa termina', ok)
    chequear('sin errores de programa', not errores(page), errores(page))
    idx = indice(page)
    causas = [c for c in idx['causas'].values() if not c.get('ausente')]
    chequear('encuentra las 15 causas distintas de todos los Sets', len(causas) == 15, len(causas))
    s101 = idx['sets']['101']
    chequear('San Isidro PG: 7 encontradas en tres jurisdicciones', s101['encontradas'] == 7 and sorted(s101['lugares'].keys()) == ['CC23', 'CC24', 'CC25'], s101)
    chequear('San Isidro PG: los tres juzgados de San Isidro', sorted(s101['lugares']['CC24']) == ['SI-1', 'SI-2'], s101['lugares'])
    chequear('una causa en dos Sets queda una vez con los dos Sets', sorted(idx['causas']['1001|SI-1']['sets']) == ['101', '103'])
    chequear('el Set de familia se lee en el fuero de familia', idx['sets']['104']['encontradas'] == 1 and 'FF24' in idx['sets']['104']['lugares'])
    chequear('la lista de autorizaciones (tipo 1) se lee en cualquier fuero', idx['sets']['106']['encontradas'] == 1 and 'PP24' in idx['sets']['106']['lugares'])
    chequear('el Set vacío no cuenta', idx['sets']['105']['encontradas'] == 0)
    chequear('Mercedes: la MEV declara 3 y muestra 2, se anota 1 oculta', idx['sets']['107']['encontradas'] == 2 and idx['sets']['107'].get('ocultas') == 1, idx['sets']['107'])
    chequear('el aviso de la oculta queda en la lectura, con el número en singular', any('Mercedes' in a and 'cuenta 3 causas y muestra 2' in a and 'La que falta figura en la cuenta del Set' in a for a in idx['lectura']['avisos']), idx['lectura']['avisos'])
    chequear('la jurisdicción de la sesión vuelve a la original', m.juris == 'CC24', m.juris)
    ultimo = m.pedidos_a('/POSLoguin.asp', 'POST')[-1]['body']
    chequear('el último cambio de jurisdicción es el de vuelta a San Isidro', 'DtoJudElegido=24' in ultimo and 'TipoF' not in ultimo and 'TipoP' not in ultimo, ultimo)
    chequear('no se tocó ninguna página que modifique la cuenta', not m.prohibidos(), m.prohibidos())
    gets = [p for p in m.pedidos_a('/resultados.asp', 'GET') if p['qs'].get('nidset')]
    chequear('cada Set se pide una sola vez por jurisdicción', len(set((p['qs']['nidset'][0], p['juris']) for p in gets)) == len(gets), len(gets))
    chequear('los organismos que no aparecen primero se piden aparte', any(p['body'].startswith('JuzgadoElegido=SI-2') for p in m.pedidos_a('/resultados.asp', 'POST')))
    chequear('la franja informa causas y tiempo', 'Lectura terminada: 15 causas' in aviso_texto(page), aviso_texto(page))
    chequear('la tabla muestra las causas', filas_visibles(page) == 15, filas_visibles(page))
    chequear('la lectura parcial se borra al terminar bien', gm(page, 'mu.%s.lecturaParcial' % USUARIO) in (None, 'null'))
    # segunda lectura: rápida, solo donde ya había causas
    m.pedidos.clear()
    ok = leer_causas(page, 'rapida')
    chequear('la lectura rápida termina', ok)
    juris_pedidas = set(juris_de_cuerpo(p['qs']) for p in m.pedidos_a('/POSLoguin.asp', 'POST'))
    chequear('la rápida solo va a las jurisdicciones con causas (y vuelve)', juris_pedidas == {'CC24', 'CC23', 'CC25', 'CC16', 'FF24', 'PP24', 'CC18'}, juris_pedidas)
    chequear('la rápida no recorre Azul ni Tandil', 'CC10' not in juris_pedidas and 'CC27' not in juris_pedidas)
    chequear('sin novedades no se marca nada', not any(c.get('nuevo') for c in indice(page)['causas'].values()))
    # novedad: cambia el último trámite de una causa
    m.sets[0]['causas'][0].ult = '24/09/2026'; m.sets[0]['causas'][0].tramite = 'SENTENCIA'
    leer_causas(page, 'rapida')
    c = indice(page)['causas']['1001|SI-1']
    chequear('un movimiento nuevo marca la causa como novedad', c.get('nuevo') and 'movimiento' in c.get('cambio', ''), c.get('cambio'))
    ctx.close()

def pausa_y_retomar(browser):
    print('== pausar y retomar')
    m = mev_chica()
    ctx = contexto(browser, m)
    page = abrir(ctx)
    page.click('#mvu [data-e="primera"]')
    esperar(page, "document.querySelector('#mvu [data-e=\"lect\"]').style.display === 'flex'", 3000)
    # se deja avanzar hasta la primera jurisdicción consultada y se pausa
    esperar(page, "/[1-9]\\d* causas leídas/.test(document.querySelector('#mvu [data-e=\"lectTxt\"]').textContent)", 5000)
    page.click('#mvu [data-e="lectCancelar"]')
    ok = esperar(page, "document.querySelector('#mvu [data-e=\"lect\"]').style.display === 'none'", 10000)
    chequear('la pausa detiene la lectura', ok)
    chequear('la jurisdicción vuelve a la original al pausar', m.juris == 'CC24', m.juris)
    parcial = gm(page, 'mu.%s.lecturaParcial' % USUARIO)
    parcial = json.loads(parcial) if isinstance(parcial, str) else parcial
    chequear('queda guardada la lectura parcial con lo ya consultado', parcial and len(parcial.get('consultados') or []) >= 1, parcial and parcial.get('consultados'))
    chequear('el aviso dice que quedó guardado', 'quedó guardado' in aviso_texto(page) or 'Lectura en pausa' in aviso_texto(page), aviso_texto(page))
    hechos_antes = [(juris_de_cuerpo(p['qs']), p['qs']['nidset'][0]) for p in m.pedidos_a('/resultados.asp', 'GET') if p['qs'].get('nidset')]
    consultados = set(parcial.get('consultados') or [])
    m.pedidos.clear()
    page.click('#mvu [data-e="leer"]')
    ok = esperar(page, "document.querySelector('#mvu [data-e=\"lect\"]').style.display === 'none'", 30000)
    chequear('retomada, la lectura termina', ok)
    repetidos = [k for k in consultados if any(p['qs'].get('nidset', [''])[0] == k.split('|')[1] and juris_de_cuerpo(p['qs']) == k.split('|')[0] for p in m.pedidos_a('/resultados.asp', 'GET') if p['qs'].get('nidset'))]
    chequear('no repite lo ya consultado (%d consultados antes)' % len(consultados), not repetidos, repetidos)
    causas = [c for c in indice(page)['causas'].values() if not c.get('ausente')]
    chequear('al retomar llega a las 15 causas', len(causas) == 15, len(causas))
    chequear('sin errores de programa', not errores(page), errores(page))
    ctx.close()

def sesion_vencida(browser):
    print('== sesión vencida en medio de la lectura')
    m = mev_chica()
    ctx = contexto(browser, m)
    page = abrir(ctx)
    page.click('#mvu [data-e="primera"]')
    esperar(page, "/leídas/.test(document.querySelector('#mvu [data-e=\"lectTxt\"]').textContent)", 5000)
    m.sesion = False
    ok = esperar(page, "/Ingresar de nuevo/.test(document.querySelector('#mvu [data-e=\"lectTxt\"]').textContent)", 8000)
    chequear('avisa que la sesión se cerró y pide ingresar de nuevo', ok, page.evaluate("document.querySelector('#mvu [data-e=\"lectTxt\"]').textContent"))
    antes = len(m.pedidos_a('/resultados.asp', 'GET'))
    page.wait_for_timeout(700)
    chequear('mientras espera no sigue consultando resultados', len(m.pedidos_a('/resultados.asp', 'GET')) == antes)
    m.sesion = True
    ok = esperar(page, "document.querySelector('#mvu [data-e=\"lect\"]').style.display === 'none'", 30000)
    chequear('con la sesión de vuelta la lectura termina sola', ok)
    # 0.7.6: el corte queda registrado y se muestra en la solapa Sets
    venc = gm(page, 'mu.vencimientos'); venc = json.loads(venc) if isinstance(venc, str) else venc
    chequear('el corte de sesión queda registrado con la página y cuánto pasó desde el último pedido', venc and len(venc) >= 1 and 'resultados.asp' in venc[-1]['pagina'] and isinstance(venc[-1]['desdePedidoMs'], int) and venc[-1]['desdePedidoMs'] >= 0 and venc[-1]['desdePresenciaMs'] >= 0, venc)
    page.click('#mvu [data-t="sets"]')
    t = page.evaluate("document.querySelector('#mvu [data-e=\"sSesion\"]').textContent")
    chequear('la solapa Sets muestra los cortes de sesión de las últimas 24 horas', 'Cortes de sesión detectados en las últimas 24 horas: %d' % len(venc) in t and 'después del último pedido' in t, t)
    chequear('el corte borra el inicio de sesión anotado (0.7.7)', gm(page, 'mu.sesionDesde') in (None, 'null'), gm(page, 'mu.sesionDesde'))
    causas = [c for c in indice(page)['causas'].values() if not c.get('ausente')]
    chequear('llega a las 15 causas', len(causas) == 15, len(causas))
    chequear('la jurisdicción vuelve a la original', m.juris == 'CC24', m.juris)
    chequear('sin errores de programa', not errores(page), errores(page))
    ctx.close()

def freno(browser):
    print('== la MEV frena una página (validación)')
    m = mev_chica()
    m.portero['resultados.asp'] = 1
    ctx = contexto(browser, m)
    page = abrir(ctx)
    ok = leer_causas(page, 'completa')
    chequear('con un freno la lectura igual termina', ok)
    chequear('el freno se sirvió una vez', m.frenos_servidos == 1, m.frenos_servidos)
    chequear('la validación se pasó en un marco (nueva carga de la misma página)', any(p['path'].lower() == '/resultados.asp' for p in m.pedidos))
    idx = indice(page)
    chequear('la lectura registra el freno', idx['lectura'].get('frenos') == 1, idx['lectura'])
    chequear('el aviso final informa la verificación', 'pidió verificación 1 vez' in aviso_texto(page), aviso_texto(page))
    frenos = gm(page, 'mu.frenos')
    frenos = json.loads(frenos) if isinstance(frenos, str) else frenos
    chequear('el freno queda registrado con la página y la pausa vigente', frenos and len(frenos) == 1 and 'resultados.asp' in frenos[0]['pagina'] and frenos[0]['pausaMs'] == 20, frenos)
    # el ritmo a la vista y la vuelta al normal (0.6.1)
    chequear('el ritmo es 1 s de base, 6 s de tope y 2 horas de memoria (decisión del 25/09/2026)', 'const RITMO = { base: 1000, actual: 1000, max: 6000, limpias: 0 };' in ORIGINAL and 'const MEMORIA_RITMO_MS = 2 * 3600 * 1000;' in ORIGINAL and 'ahora() - r.t < MEMORIA_RITMO_MS' in ORIGINAL)
    page.click('#mvu [data-t="sets"]')
    t = page.evaluate("document.querySelector('#mvu section[data-p=\"sets\"]').textContent")
    chequear('la solapa Sets muestra la pausa vigente y el freno', 'Pausa vigente' in t and 'últimas 24 horas: 1' in t, t[:300])
    lento = page.evaluate("!!document.querySelector('#mvu [data-e=\"sRitmoNormal\"]')")
    ritmo = gm(page, 'mu.ritmo'); ritmo = json.loads(ritmo) if isinstance(ritmo, str) else ritmo
    if ritmo and ritmo.get('actual', 0) > 20:
        chequear('con ritmo lento se ofrece volver al normal', lento)
        page.click('#mvu [data-e="sRitmoNormal"]')
        ritmo = gm(page, 'mu.ritmo'); ritmo = json.loads(ritmo) if isinstance(ritmo, str) else ritmo
        chequear('volver al normal deja la pausa base guardada', ritmo and ritmo.get('actual') == 20, ritmo)
        chequear('y el botón desaparece', not page.evaluate("!!document.querySelector('#mvu [data-e=\"sRitmoNormal\"]')"))
    else:
        chequear('con ritmo normal no se ofrece el botón', not lento)
    causas = [c for c in idx['causas'].values() if not c.get('ausente')]
    chequear('no se perdió ninguna causa', len(causas) == 15, len(causas))
    chequear('la pantalla de validación nunca entra al índice', not any('Validando' in (c.get('caratula') or '') for c in idx['causas'].values()))
    chequear('sin errores de programa', not errores(page), errores(page))
    ctx.close()

def buscar_persona(browser):
    print('== buscar persona')
    m = mev_chica()
    ctx = contexto(browser, m)
    page = abrir(ctx)
    leer_causas(page, 'completa')
    m.pedidos.clear()
    page.click('#mvu [data-t="buscar"]')
    chequear('la solapa se llama Buscar sucesorio y el título lo dice (0.9.1)', page.evaluate("document.querySelector('#mvu [data-t=\"buscar\"]').textContent") == 'Buscar sucesorio' and page.evaluate("/Buscar un sucesorio en la MEV/.test(document.querySelector('#mvu section[data-p=\"buscar\"] h3').textContent)"))
    page.fill('#mvu [data-e="bTexto"]', 'Marino Teresa')
    rot = elegir_deptos(page, 'bAlcance', [])
    chequear('sin departamentos tildados el desplegable dice "Toda la provincia"', rot == 'Toda la provincia', rot)
    page.click('#mvu [data-e="bBuscar"]')
    b = esperar_busqueda(page)
    chequear('la búsqueda en toda la provincia termina', b is not None, page.evaluate("document.querySelector('#mvu section[data-p=\"buscar\"]').textContent.slice(0, 300)"))
    chequear('el alcance guardado es toda la provincia', b['alcance'] == 'todo', b['alcance'])
    # 0.8.4: la pausa del buscador usa el reloj que no se frena en segundo plano (sleep), no setInterval/setTimeout
    cuerpo_pausa = re.search(r'async function pausaBuscador\(\) \{(.*?)\n  \}', ORIGINAL, re.S)
    chequear('la pausa del buscador no usa setInterval ni setTimeout (se frenan en pestañas ocultas)', cuerpo_pausa and 'setInterval' not in cuerpo_pausa.group(1) and 'setTimeout' not in cuerpo_pausa.group(1) and 'await sleep(' in cuerpo_pausa.group(1) and 'RITMO.actual' in cuerpo_pausa.group(1), bool(cuerpo_pausa))
    chequear('el buscador ya no tiene una pausa fija propia', 'pausaMs: 4000' not in ORIGINAL and 'BUSCADOR.pausaMs' not in ORIGINAL)
    chequear('la pantalla dice Terminada', page.evaluate("/Terminada/.test(document.querySelector('#mvu section[data-p=\"buscar\"]').textContent)"))

    chequear('estado terminada, sin error', b['estado'] == 'terminada', (b['estado'], b.get('error')))
    halladas = sorted(r['nidCausa'] for r in b['resultados'].values())
    chequear('encuentra la causa civil, la de Quilmes (todos los organismos) y la de paz', halladas == ['1001', '1006', '1016'], halladas)
    filas = page.evaluate("[...document.querySelectorAll('#mvu section[data-p=\"buscar\"] table.grid tbody tr td:first-child .car')].map((e) => e.textContent)")
    marcas = ['SUCESION' in f.upper() for f in filas]
    chequear('en la tabla las sucesiones van primero (0.9.1)', len(filas) == 3 and any(marcas) and marcas == sorted(marcas, reverse=True), filas)
    chequear('no trae la causa penal ni las de otros nombres', '1013' not in halladas and '1002' not in halladas)
    posts = m.pedidos_a('/Busqueda.asp', 'POST')
    chequear('los campos ocultos van llenos (OpcionBusqueda=0 y busca=texto)', posts and all(p['qs'].get('OpcionBusqueda') == ['0'] and p['qs'].get('busca') == p['qs'].get('Texto') for p in posts), posts[:1])
    chequear('la eñe y los acentos van en windows-1252 (texto en mayúsculas)', all(p['qs']['Texto'][0] == p['qs']['Texto'][0].upper() for p in posts))
    chequear('hubo consulta de control con una causa conocida', b.get('controlada') is True and any(p['qs']['Texto'][0] not in ('MARINO TERESA',) for p in posts))
    chequear('no consulta cámaras ni tribunales de trabajo', not any(p['qs'].get('JuzgadoElegido', [''])[0] in ('SI-CAM', 'SI-TT') for p in posts))
    chequear('en Quilmes usa "Todos los organismos" en una sola consulta', sum(1 for p in posts if p['qs'].get('JuzgadoElegido') == ['0']) == 1)
    chequear('nunca envía un formulario que cambie la cuenta', not m.prohibidos(), m.prohibidos())
    chequear('la jurisdicción vuelve a la original', m.juris == 'CC24', m.juris)
    chequear('sin errores de programa', not errores(page), errores(page))
    # sin resultados
    m.pedidos.clear()
    page.fill('#mvu [data-e="bTexto"]', 'ZZZZ INEXISTENTE')
    rot = elegir_deptos(page, 'bAlcance', ['CC24'])
    chequear('con un departamento tildado el desplegable muestra su nombre', rot == 'San Isidro', rot)
    page.click('#mvu [data-e="bBuscar"]')
    b = esperar_busqueda(page)


    chequear('"no arroja resultados" se acepta como respuesta válida', b['estado'] == 'terminada' and not b['resultados'], (b['estado'], b.get('error')))
    # la MEV ignora el texto: la consulta de control lo detecta
    m.busqueda_ignora_texto = True
    page.fill('#mvu [data-e="bTexto"]', 'Marino Teresa')
    page.click('#mvu [data-e="bBuscar"]')
    b = esperar_busqueda(page)


    chequear('si la MEV no devuelve una causa que existe, se detiene con diagnóstico', b['estado'] == 'error' and 'no encontró una causa que sí existe' in b.get('error', '') and b.get('diagnostico'), (b['estado'], b.get('error')))
    chequear('la jurisdicción vuelve a la original también tras el error', m.juris == 'CC24', m.juris)
    # varios departamentos a la vez (0.8.3)
    m.busqueda_ignora_texto = False
    m.pedidos.clear()
    page.fill('#mvu [data-e="bTexto"]', 'Marino Teresa')
    chequear('el desplegable trae los 23 departamentos civiles y la opción Toda la provincia (0.9.1)', page.evaluate("document.querySelectorAll('#mvu [data-e=\"bAlcancePanel\"] input[data-d]').length === 23 && !!document.querySelector('#mvu [data-e=\"bAlcancePanel\"] input[data-todo]')"))
    chequear('el panel de casillas está cerrado hasta tocar el botón', page.evaluate("document.querySelector('#mvu [data-e=\"bAlcancePanel\"]').style.display === 'none'"))
    rot = elegir_deptos(page, 'bAlcance', ['CC23', 'CC24'])
    chequear('con dos tildados el botón nombra a los dos', rot == 'San Isidro y Quilmes' or rot == 'Quilmes y San Isidro', rot)
    chequear('Listo cierra el panel', page.evaluate("document.querySelector('#mvu [data-e=\"bAlcancePanel\"]').style.display === 'none'"))
    page.click('#mvu [data-e="bBuscar"]')
    b = esperar_busqueda(page)
    chequear('la búsqueda en dos departamentos termina', b is not None and b['estado'] == 'terminada', b and (b['estado'], b.get('error')))
    chequear('el alcance guarda los dos departamentos y el plan es solo ellos (más Paz)', b['alcance'] == 'CC23+CC24' and [p for p in b['plan'] if p != 'PZ'] == ['CC23', 'CC24'], (b['alcance'], b['plan']))
    juris_pedidas = set(juris_de_cuerpo(p['qs']) for p in m.pedidos_a('/POSLoguin.asp', 'POST'))
    chequear('solo cambia a esos departamentos (y a Paz), más la vuelta a la original', juris_pedidas <= {'CC23', 'CC24', 'PZ'}, juris_pedidas)
    halladas = sorted(r['nidCausa'] for r in b['resultados'].values())
    chequear('encuentra la causa civil de San Isidro, la de Quilmes y la de paz', halladas == ['1001', '1006', '1016'], halladas)
    chequear('la pantalla nombra los dos departamentos', page.evaluate("/Quilmes, San Isidro/.test(document.querySelector('#mvu section[data-p=\"buscar\"]').textContent)"))
    # cada causa encontrada se abre como las de Mis causas: en MEV Ultra, en la MEV en esta pestaña o en una nueva (0.8.3)
    page.eval_on_selector('#mvu [data-bm="1006|Q-1"]', 'e => e.click()')
    menu = page.evaluate("document.querySelector('#mvu-pop').innerText")
    chequear('la causa encontrada tiene el menú de abrir', 'Abrir en la MEV, en una pestaña nueva' in menu and 'Abrir en la MEV, en esta pestaña' in menu and 'Ver en MEV Ultra' in menu, menu)
    with ctx.expect_page() as nueva:
        page.click('#mvu-pop [data-m="nueva"]')
    p3 = nueva.value; p3.wait_for_load_state()
    chequear('abrir en pestaña nueva lleva a la causa en la MEV', 'procesales.asp' in p3.url and 'nidCausa=1006' in p3.url and 'pidJuzgado=Q-1' in p3.url, p3.url)
    p3.close()
    page.eval_on_selector('#mvu [data-bm="1006|Q-1"]', 'e => e.click()')
    page.click('#mvu-pop [data-m="ver"]')
    ok = esperar(page, "document.querySelector('#mvu section[data-p=\"exp\"]') && /1006|Sucesion|SUCESION/i.test(document.querySelector('#mvu section[data-p=\"exp\"]').textContent)", 8000)
    chequear('"Ver en MEV Ultra" abre la causa en la solapa Este expediente', ok)
    # las causas encontradas quedan guardadas con la búsqueda al recargar la página
    page2 = abrir(ctx)
    page2.click('#mvu [data-t="buscar"]')
    chequear('al volver a abrir la MEV, la búsqueda conserva sus causas encontradas', page2.evaluate("/MARINO|1006/i.test(document.querySelector('#mvu section[data-p=\"buscar\"]').textContent) && !!document.querySelector('#mvu [data-bm]')"))
    page2.close()
    chequear('la jurisdicción vuelve a la original', m.juris == 'CC24', m.juris)
    chequear('sin errores de programa', not errores(page), errores(page))
    ctx.close()

def latido(browser):
    print('== latido de sesión y cerrar sesión')
    m = mev_chica()
    ctx = contexto(browser, m)
    page = abrir(ctx)
    page.mouse.click(600, 700)                      # la persona toca algo
    n0 = len(m.pedidos_a('/Sets.asp'))
    gm_set(page, 'mu.actividad', int(time.time() * 1000))
    page.wait_for_timeout(900)
    chequear('con un pedido reciente no se pide nada', len(m.pedidos_a('/Sets.asp')) == n0, len(m.pedidos_a('/Sets.asp')) - n0)
    gm_set(page, 'mu.actividad', int(time.time() * 1000) - 60000)
    page.wait_for_timeout(900)
    chequear('sin pedidos durante el plazo y con la persona presente, se pide Sets.asp una vez', len(m.pedidos_a('/Sets.asp')) == n0 + 1, len(m.pedidos_a('/Sets.asp')) - n0)
    # la persona deja la PC: no se mantiene la sesión
    page.wait_for_timeout(1800)
    n1 = len(m.pedidos_a('/Sets.asp'))
    gm_set(page, 'mu.actividad', int(time.time() * 1000) - 60000)
    page.wait_for_timeout(900)
    chequear('con la PC sola no se toca la sesión', len(m.pedidos_a('/Sets.asp')) == n1, len(m.pedidos_a('/Sets.asp')) - n1)
    page.keyboard.press('Shift')                    # vuelve
    gm_set(page, 'mu.actividad', int(time.time() * 1000) - 60000)
    page.wait_for_timeout(900)
    chequear('al volver la persona, el latido sigue', len(m.pedidos_a('/Sets.asp')) == n1 + 1, len(m.pedidos_a('/Sets.asp')) - n1)
    # 0.7.5: con la pestaña fuera de la vista (leyendo un documento en otra pestaña o programa) el latido sigue
    page.evaluate("Object.defineProperty(document, 'hidden', { get: () => true, configurable: true })")
    page.keyboard.press('Shift')
    n2 = len(m.pedidos_a('/Sets.asp'))
    gm_set(page, 'mu.actividad', int(time.time() * 1000) - 60000)
    page.wait_for_timeout(900)
    chequear('con la pestaña fuera de la vista y la persona presente, el latido sigue (0.7.5)', len(m.pedidos_a('/Sets.asp')) == n2 + 1, len(m.pedidos_a('/Sets.asp')) - n2)
    page.evaluate("delete document.hidden")
    # 0.7.5: la presencia se comparte entre pestañas: una pestaña nueva, sin que la persona la toque, late si tocó otra
    page2 = abrir(ctx)
    page.wait_for_timeout(1800)                     # vence la presencia propia de las dos
    n3 = len(m.pedidos_a('/Sets.asp'))
    gm_set(page, 'mu.actividad', int(time.time() * 1000) - 60000)
    page.wait_for_timeout(900)
    chequear('con la PC sola, ninguna pestaña late', len(m.pedidos_a('/Sets.asp')) == n3, len(m.pedidos_a('/Sets.asp')) - n3)
    gm_set(page, 'mu.presencia', int(time.time() * 1000))   # la persona tocó otra pestaña de la MEV
    gm_set(page, 'mu.actividad', int(time.time() * 1000) - 60000)
    page.wait_for_timeout(900)
    # (con el latido acortado a 250 ms las dos pestañas pueden latir casi a la vez; en la MEV real el intervalo es de un minuto)
    chequear('la presencia anotada desde otra pestaña mantiene el latido (0.7.5)', len(m.pedidos_a('/Sets.asp')) - n3 in (1, 2), len(m.pedidos_a('/Sets.asp')) - n3)
    page2.close()
    m.sesion = False
    page.mouse.click(600, 700)
    gm_set(page, 'mu.actividad', int(time.time() * 1000) - 60000)
    ok = esperar(page, "/La sesión de la MEV se cerró/.test(document.querySelector('#mvu [data-e=\"avisoTxt\"]').textContent)", 3000)
    chequear('si la sesión venció, avisa', ok)
    # 0.8.2: mientras siga vencida, los latidos siguientes no anotan un corte nuevo cada vez
    for _ in range(4):
        gm_set(page, 'mu.actividad', int(time.time() * 1000) - 60000)
        page.wait_for_timeout(500)
    venc = gm(page, 'mu.vencimientos'); venc = json.loads(venc) if isinstance(venc, str) else venc
    chequear('un solo corte registrado aunque el latido la encuentre vencida varias veces (0.8.2)', venc and len(venc) == 1, venc)
    ctx.close()
    # cerrar sesión con el enlace de salida de la MEV: en la MEV real se
    # titula "Desconectarse" y apunta a loguin.asp (0.9.8)
    m = mev_chica()
    ctx = contexto(browser, m)
    page = abrir(ctx)
    otra = abrir(ctx)
    chequear('la barra tiene el botón Cerrar sesión', page.evaluate("!!document.querySelector('#mvu [data-e=\"salir\"]')"))
    page.click('#mvu [data-e="salir"]')
    ok = esperar(page, "location.pathname.toLowerCase() === '/loguin.asp'", 4000)
    chequear('Cerrar sesión usa el Desconectarse de la propia MEV (0.9.8)', ok, page.url)
    chequear('el cierre queda anotado como voluntario (0.9.8)', bool(gm(otra, 'mu.cierreVoluntario')), gm(otra, 'mu.cierreVoluntario'))
    # la otra pestaña encuentra la sesión cerrada: no es un corte de la MEV
    m.sesion = False
    gm_set(otra, 'mu.vencimientos', [])
    otra.mouse.click(600, 700)
    gm_set(otra, 'mu.actividad', int(time.time() * 1000) - 60000)
    otra.wait_for_timeout(1500)
    venc = gm(otra, 'mu.vencimientos'); venc = json.loads(venc) if isinstance(venc, str) else venc
    chequear('un cierre voluntario no se registra como corte (0.9.8)', not venc, venc)
    chequear('ni se avisa que la sesión se cerró (0.9.8)', not esperar(otra, "/La sesión de la MEV se cerró/.test(document.querySelector('#mvu [data-e=\"avisoTxt\"]').textContent)", 800))
    otra.close()
    # al volver a ingresar se borra la marca, y un corte real se registra
    m.sesion = True
    page = abrir(ctx)
    marca = gm(page, 'mu.cierreVoluntario'); marca = json.loads(marca) if isinstance(marca, str) else marca
    chequear('al ingresar de nuevo se borra la marca del cierre voluntario (0.9.8)', not marca, marca)
    m.sesion = False
    page.mouse.click(600, 700)
    gm_set(page, 'mu.actividad', int(time.time() * 1000) - 60000)
    ok = esperar(page, "/La sesión de la MEV se cerró/.test(document.querySelector('#mvu [data-e=\"avisoTxt\"]').textContent)", 3000)
    venc = gm(page, 'mu.vencimientos'); venc = json.loads(venc) if isinstance(venc, str) else venc
    chequear('después del reingreso, un corte real se registra y se avisa (0.9.8)', ok and len(venc or []) == 1, (ok, venc))
    ctx.close()
    # sin el enlace en la página, usa la misma dirección que la MEV
    m = mev_chica()
    ctx = contexto(browser, m)
    page = abrir(ctx, '/procesales.asp?nidCausa=1001&pidJuzgado=SI-1')
    page.evaluate("document.querySelectorAll('a[href*=\"loguin\"]').forEach((a) => a.remove())")
    page.click('#mvu [data-e="salir"]')
    ok = esperar(page, "location.pathname.toLowerCase() === '/loguin.asp'", 4000)
    chequear('sin el enlace en la página, Cerrar sesión va igual a loguin.asp (0.9.8)', ok, page.url)
    ctx.close()

def cuentas(browser):
    print('== datos separados por cuenta')
    m = mev_chica()
    ctx = contexto(browser, m)
    page = abrir(ctx)
    leer_causas(page, 'completa')
    chequear('el índice queda bajo la cuenta que lo leyó', indice(page) is not None)
    m.usuario = OTRO; m.nombre = 'OTRA PERSONA'
    page2 = ctx.new_page(); page2.goto('https://mev.scba.gov.ar/Sets.asp')
    esperar(page2, "!!document.querySelector('#mvu')", 5000)
    chequear('con otro usuario la placa cambia', OTRO in page2.evaluate("document.querySelector('#mvu [data-e=\"cuenta\"]').textContent"))
    chequear('con otro usuario no se ve ninguna causa ajena', page2.evaluate("!!document.querySelector('#mvu [data-e=\"primera\"]')"))
    chequear('el índice del otro usuario no existe', indice(page2, OTRO) is None)
    ctx.close()

def marcas_y_respaldo(browser):
    print('== etiquetas, anotaciones y respaldo cifrado')
    m = mev_chica()
    ctx = contexto(browser, m)
    page = abrir(ctx)
    leer_causas(page, 'completa')
    page.click('#mvu [data-t="datos"]')
    chequear('sin contraseña no se puede exportar', page.evaluate("document.querySelector('#mvu [data-e=\"dExportar\"]').disabled"))
    page.fill('#mvu [data-e="dNueva"]', 'Urgente'); page.click('#mvu [data-e="dCrear"]')
    chequear('se crea la etiqueta', any(e['nombre'] == 'Urgente' for e in marcas(page)['etiquetas']))
    page.fill('#mvu [data-e="dContra"]', 'clave-de-prueba'); page.click('#mvu [data-e="dContraOk"]')
    esperar(page, "!document.querySelector('#mvu [data-e=\"dExportar\"]').disabled", 3000)
    chequear('con contraseña se habilita exportar', page.evaluate("!document.querySelector('#mvu [data-e=\"dExportar\"]').disabled"))
    # una etiqueta y una anotación sobre una causa, por programa (mismo almacén que la interfaz)
    mk = marcas(page)
    etq = next(e for e in mk['etiquetas'] if e['nombre'] == 'Urgente')
    mk['filas']['1001|SI-1'] = {'etq': [etq['id']], 'anot': 'Ver el 30/09', 't': int(time.time() * 1000)}
    gm_set(page, 'mu.%s.marcas' % USUARIO, json.dumps(mk))
    page.reload(); esperar(page, "!!document.querySelector('#mvu')", 5000)
    chequear('la anotación se ve en la tabla', page.evaluate("document.querySelector('#mvu section[data-p=\"causas\"]').textContent.includes('Ver el 30/09')"))
    page.click('#mvu [data-t="datos"]')
    page.click('#mvu [data-e="dExportar"]')
    ok = esperar(page, "(window.__descargas || []).length > 0", 8000)
    chequear('exportar genera el archivo', ok)
    d = page.evaluate("window.__descargas[0]")
    chequear('el archivo lleva la extensión propia .mevu y el usuario', d['nombre'].endswith('.mevu') and USUARIO in d['nombre'], d['nombre'])
    import base64
    datos = base64.b64decode(d['b64'])
    chequear('el respaldo sale cifrado (no se lee la anotación)', b'Ver el 30/09' not in datos and b'Urgente' not in datos)
    chequear('queda registrada la fecha de la última exportación', gm(page, 'mu.%s.respaldo' % USUARIO) is not None)
    # se borran las marcas y se importa
    gm_set(page, 'mu.%s.marcas' % USUARIO, json.dumps({'etiquetas': [], 'filas': {}, 'version': 1}))
    page.reload(); esperar(page, "!!document.querySelector('#mvu')", 5000)
    page.click('#mvu [data-t="datos"]')
    page.set_input_files('#mvu [data-e="dArchivo"]', {'name': d['nombre'], 'mimeType': 'application/octet-stream', 'buffer': datos})
    ok = esperar(page, "/Importado/.test(document.querySelector('#mvu [data-e=\"avisoTxt\"]').textContent)", 8000)
    chequear('importar restaura las marcas', ok and marcas(page)['filas'].get('1001|SI-1', {}).get('anot') == 'Ver el 30/09', aviso_texto(page))
    # otra cuenta no puede importar este respaldo
    m.usuario = OTRO
    page2 = ctx.new_page(); page2.goto('https://mev.scba.gov.ar/Sets.asp'); esperar(page2, "!!document.querySelector('#mvu')", 5000)
    page2.click('#mvu [data-t="datos"]')
    page2.fill('#mvu [data-e="dContra"]', 'clave-de-prueba'); page2.click('#mvu [data-e="dContraOk"]')
    page2.set_input_files('#mvu [data-e="dArchivo"]', {'name': d['nombre'], 'mimeType': 'application/octet-stream', 'buffer': datos})
    ok = esperar(page2, "/No se pudo importar/.test(document.querySelector('#mvu [data-e=\"avisoTxt\"]').textContent)", 8000)
    chequear('el respaldo de otro usuario se rechaza', ok and 'es del usuario' in aviso_texto(page2), aviso_texto(page2))
    chequear('sin errores de programa', not errores(page) and not errores(page2), errores(page) + errores(page2))
    ctx.close()

def tabla(browser):
    print('== tabla, filtros y exportación')
    m = mev_chica()
    ctx = contexto(browser, m)
    page = abrir(ctx)
    leer_causas(page, 'completa')
    chequear('15 filas', filas_visibles(page) == 15, filas_visibles(page))
    page.fill('#mvu [data-e="buscar"]', 'sucesion')
    esperar(page, "document.querySelector('#mvu [data-e=\"infoCausas\"]').textContent.startsWith('8')", 3000)
    chequear('el buscador filtra por palabra (8 sucesiones)', filas_visibles(page) == 8, filas_visibles(page))
    page.fill('#mvu [data-e="buscar"]', '')
    page.select_option('#mvu [data-e="fDepto"]', 'CC23')
    esperar(page, "document.querySelector('#mvu [data-e=\"infoCausas\"]').textContent.startsWith('3')", 3000)
    chequear('el filtro por departamento (Quilmes: 3)', filas_visibles(page) == 3, filas_visibles(page))
    page.click('#mvu [data-e="fLimpiar"]')
    esperar(page, "document.querySelector('#mvu [data-e=\"infoCausas\"]').textContent.startsWith('15')", 3000)
    chequear('quitar filtros vuelve a las 15', filas_visibles(page) == 15, filas_visibles(page))
    page.select_option('#mvu [data-e="pp"]', '5')
    chequear('paginado de a 5', filas_visibles(page) == 5, filas_visibles(page))
    page.click('#mvu [data-e="csv"]')
    ok = esperar(page, "(window.__descargas || []).length > 0", 8000)
    chequear('exportar genera el archivo CSV', ok)
    import base64
    d = page.evaluate("window.__descargas[0]")
    csv = base64.b64decode(d['b64']).decode('utf-8')
    chequear('el CSV lleva marca de orden de bytes y separador punto y coma', csv.startswith('﻿') and ';' in csv.splitlines()[0])
    chequear('exporta las 15 causas (sin el paginado)', len([l for l in csv.splitlines() if l.strip()]) == 16, len(csv.splitlines()))
    chequear('una carátula que empieza con = se neutraliza para Excel', "\"'=CMD" in csv)
    chequear('sin errores de programa', not errores(page), errores(page))
    ctx.close()

def expediente(browser):
    print('== este expediente')
    m = mev_chica()
    ctx = contexto(browser, m)
    page = abrir(ctx)
    leer_causas(page, 'completa')
    page.fill('#mvu [data-e="buscar"]', '36999')
    esperar(page, "document.querySelector('#mvu [data-e=\"infoCausas\"]').textContent.startsWith('1 de')", 3000)
    page.click('#mvu section[data-p="causas"] [data-a="abrir"]')
    ok = esperar(page, "/PASE A DESPACHO/.test(document.querySelector('#mvu section[data-p=\"exp\"]').textContent)", 8000)
    chequear('abre la causa y lista sus pasos procesales', ok, page.evaluate("document.querySelector('#mvu section[data-p=\"exp\"]').textContent.slice(0, 300)"))
    t = page.evaluate("document.querySelector('#mvu section[data-p=\"exp\"]').textContent")
    chequear('muestra los datos de la carátula', 'MARINO TERESA' in t and '36999' in t, t[:400])
    chequear('lista las tres actuaciones', t.count('20/09/2026') >= 1 and 'INICIO' in t and 'PROVEIDO' in t)
    chequear('sin errores de programa', not errores(page), errores(page))
    # abrir la causa desde procesales.asp: se lee la propia página, sin pedirla de nuevo
    m.pedidos.clear()
    page2 = ctx.new_page(); page2.goto('https://mev.scba.gov.ar/procesales.asp?nidCausa=1001&pidJuzgado=SI-1')
    ok = esperar(page2, "/PASE A DESPACHO/.test((document.querySelector('#mvu section[data-p=\"exp\"]') || {}).textContent || '')", 8000)
    chequear('en procesales.asp abre directo "Este expediente"', ok)
    chequear('sin volver a pedir la página', len(m.pedidos_a('/procesales.asp')) == 1, len(m.pedidos_a('/procesales.asp')))
    ctx.close()

def candado(browser):
    print('== candado entre pestañas')
    m = mev_chica()
    ctx = contexto(browser, m)
    page = abrir(ctx)
    page2 = abrir(ctx)
    page.click('#mvu [data-e="primera"]')
    esperar(page, "/leídas/.test(document.querySelector('#mvu [data-e=\"lectTxt\"]').textContent)", 5000)
    page2.click('#mvu [data-e="leer"]')
    ok = esperar(page2, "/Otra pestaña/.test(document.querySelector('#mvu [data-e=\"avisoTxt\"]').textContent)", 3000)
    chequear('la segunda pestaña no lee mientras lee la primera', ok, aviso_texto(page2))
    esperar(page, "document.querySelector('#mvu [data-e=\"lect\"]').style.display === 'none'", 30000)
    page2.wait_for_timeout(500)
    chequear('la otra pestaña recibe el índice leído', page2.evaluate("!document.querySelector('#mvu [data-e=\"primera\"]')"))
    ctx.close()

def lectura_varios_deptos(browser):
    print('== leer varios departamentos a la vez desde Sets (0.9.1)')
    m = mev_chica()
    ctx = contexto(browser, m)
    page = abrir(ctx)
    leer_causas(page, 'completa')
    page.click('#mvu [data-t="sets"]')
    chequear('sin departamentos tildados el botón está apagado', page.evaluate("document.querySelector('#mvu [data-e=\"sReleerDepto\"]').disabled"))
    rot = elegir_deptos(page, 'sDepto', ['CC23', 'CC17'])
    txt = page.evaluate("document.querySelector('#mvu [data-e=\"sReleerDepto\"]').textContent")
    chequear('con dos tildados el botón dice cuántos va a leer y el desplegable los nombra', txt == 'Leer esos 2 departamentos' and 'Quilmes' in rot and 'Mar del Plata' in rot, (txt, rot))
    # al cambiar de solapa y volver, lo tildado se conserva
    page.click('#mvu [data-t="causas"]')
    page.click('#mvu [data-t="sets"]')
    rot2 = page.evaluate("document.querySelector('#mvu [data-e=\"sDeptoBoton\"]').textContent")
    chequear('lo tildado se conserva al repintar la solapa', rot2 == rot, rot2)
    m.pedidos.clear()
    page.click('#mvu [data-e="sReleerDepto"]')
    ok = esperar(page, "document.querySelector('#mvu [data-e=\"lect\"]').style.display === 'flex'", 3000) and esperar(page, "document.querySelector('#mvu [data-e=\"lect\"]').style.display === 'none'", 40000)
    chequear('la lectura de los dos departamentos termina', ok)
    juris_pedidas = [juris_de_cuerpo(p['qs']) for p in m.pedidos_a('/POSLoguin.asp', 'POST')]
    chequear('entra en los dos y en ningún otro (y vuelve a la original)', set(juris_pedidas) <= {'CC23', 'CC17', 'CC24'} and 'CC23' in juris_pedidas and 'CC17' in juris_pedidas, juris_pedidas)
    idx = indice(page)
    causas = [c for c in idx['causas'].values() if not c.get('ausente')]
    chequear('no se pierde ninguna causa', len(causas) == 15, len(causas))
    chequear('la lectura queda anotada con las dos jurisdicciones', idx['lectura'].get('modo') == 'completa', idx['lectura'])
    chequear('la jurisdicción vuelve a la original', m.juris == 'CC24', m.juris)
    chequear('sin errores de programa', not errores(page), errores(page))
    ctx.close()

def motor_validacion(browser):
    print('== motor: validación pedida a la persona desde el primer momento y pasada sola, por señal o a mano (0.9.1)')
    if sin_bibliotecas('motor_validacion'): return
    chequear('la clave de la señal de página buena es la misma en el motor y en la ventana', ORIGINAL.count("const SENAL_PAGINA = 'mu.senal.pagina';") == 2)
    chequear('la espera humana no vigila con setInterval y el sondeo sin marco es cada minuto', 'function crearEsperaHumana(url, rotulo)' in ORIGINAL and "if (corrida.cancelado) terminar('Cancelado.');" not in ORIGINAL and 'sondeoManualMs: 60000' in ORIGINAL)
    orden = lambda page, ident, o: page.evaluate("([o, id]) => { const f = document.getElementById('marcoPrueba'); f.contentWindow.postMessage({ mevultra: 'ordenes', orden: o, id }, location.origin); }", [o, ident])
    msgs = lambda page: page.evaluate("window.__enc.msgs")
    tiene = lambda page, patron: any(re.search(patron, x['texto'] or '') for x in msgs(page))

    # 1) El marco oculto la pasa solo; la ayuda se pidió enseguida, con la página y el rótulo.
    m = mev_chica()
    m.portero['proveido.asp'] = 1
    ctx = contexto(browser, m, bibliotecas=True)
    page = abrir(ctx)
    t0 = time.time()
    encargar(page, 'val1')
    ok = esperar(page, "window.__enc.msgs.some((x) => x.tipo === 'ayuda' && x.texto)", 15000)
    ayuda = next((x for x in msgs(page) if x['tipo'] == 'ayuda' and x['texto']), None)
    chequear('pide ayuda enseguida (no a los 3 minutos), con la actuación trabada y su rótulo', ok and time.time() - t0 < 8 and ayuda and 'proveido.asp' in ayuda['url'] and ayuda['rotulo'] == 'la actuación' and 'abrí la página en otra pestaña' in ayuda['texto'], ayuda)
    chequear('el aviso dice que intenta pasarla solo', ayuda and 'Intento pasarla solo' in ayuda['texto'], ayuda and ayuda['texto'])
    enc = esperar_fin(page, 90000)
    chequear('la descarga termina sola: el marco oculto pasó el portero', tiene(page, r'Validación superada sola') and enc['pdf'], [x['texto'] for x in msgs(page)][-4:])
    chequear('la ayuda se retira al pasar', [x for x in msgs(page) if x['tipo'] == 'ayuda'][-1]['texto'] == '')
    pedidos = m.pedidos_a('/proveido.asp')
    primero = pedidos[0]['qs'].get('idpaso') if pedidos else None
    repetidos = [p for p in pedidos if p['qs'].get('idpaso') == primero]
    chequear('la actuación frenada se pidió tres veces (fetch frenado, marco oculto, fetch bueno)', primero is not None and len(repetidos) == 3, (primero, len(repetidos)))
    txt = ' '.join((texto_pdf(enc['pdf']) or '').split())
    chequear('el anexo cuenta la validación en singular', 'interpuso 1 vez la pantalla' in txt, txt[-400:])
    chequear('sin errores de programa', not errores(page), errores(page))
    ctx.close()

    # 2) Otra pestaña de la MEV carga bien: la descarga prueba enseguida, sin esperar el próximo intento.
    m = mev_chica()
    m.portero['proveido.asp'] = 2
    ctx = contexto(browser, m, bibliotecas=True)
    page = abrir(ctx)
    encargar(page, 'val2')
    esperar(page, "window.__enc.msgs.some((x) => x.tipo === 'ayuda' && x.texto)", 15000)
    t0 = time.time()
    page2 = abrir(ctx)   # una pestaña nueva de la MEV con sesión anota la señal
    ok = esperar(page, "window.__enc.msgs.some((x) => /sigue pidiendo validación/.test(x.texto || ''))", 8000)
    chequear('al cargar otra pestaña de la MEV, la descarga prueba enseguida (y la MEV todavía frena)', ok and time.time() - t0 < 6, [x['texto'] for x in msgs(page)][-3:])
    enc = esperar_fin(page, 90000)
    chequear('después pasa sola con el marco y termina', tiene(page, r'Validación superada sola') and enc['pdf'], [x['texto'] for x in msgs(page)][-3:])
    chequear('sin errores de programa', not errores(page) and not errores(page2), errores(page) + errores(page2))
    ctx.close()

    # 3) La pestaña vuelve a estar a la vista: prueba enseguida.
    m = mev_chica()
    m.portero['proveido.asp'] = 2
    ctx = contexto(browser, m, bibliotecas=True)
    page = abrir(ctx)
    marco = encargar(page, 'val3')
    esperar(page, "window.__enc.msgs.some((x) => x.tipo === 'ayuda' && x.texto)", 15000)
    t0 = time.time()
    marco.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
    ok = esperar(page, "window.__enc.msgs.some((x) => /sigue pidiendo validación/.test(x.texto || ''))", 8000)
    chequear('al volver a la pestaña, prueba enseguida', ok and time.time() - t0 < 6, [x['texto'] for x in msgs(page)][-3:])
    enc = esperar_fin(page, 90000)
    chequear('y termina cuando la MEV deja de frenar', enc['pdf'] and tiene(page, r'Validación superada'), [x['texto'] for x in msgs(page)][-3:])
    ctx.close()

    # 4) "Ya validé: seguir" insiste a mano; si la MEV sigue frenando, se trabaja en el marco vivo.
    m = mev_chica()
    m.portero['proveido.asp'] = 4
    ctx = contexto(browser, m, bibliotecas=True)
    page = abrir(ctx)
    encargar(page, 'val4')
    esperar(page, "window.__enc.msgs.some((x) => x.tipo === 'ayuda' && x.texto)", 15000)
    orden(page, 'val4', 'seguir')
    ok = esperar(page, "window.__enc.msgs.some((x) => /Sigo desde donde quedé/.test(x.texto || ''))", 8000)
    chequear('el botón reanuda en el acto', ok, [x['texto'] for x in msgs(page)][-3:])
    enc = esperar_fin(page, 120000)
    txt = ' '.join((texto_pdf(enc['pdf']) or '').split())
    chequear('la descarga termina igual y el PDF trae la actuación', enc['pdf'] and 'Texto del proveído' in txt, txt[-300:])
    chequear('sin errores de programa', not errores(page), errores(page))
    ctx.close()

    # 5) Cancelar en medio de la espera corta en el acto.
    m = mev_chica()
    m.portero['proveido.asp'] = 9
    ctx = contexto(browser, m, bibliotecas=True)
    page = abrir(ctx)
    encargar(page, 'val5')
    esperar(page, "window.__enc.msgs.some((x) => x.tipo === 'ayuda' && x.texto)", 15000)
    t0 = time.time()
    orden(page, 'val5', 'cancelar')
    enc = esperar_fin(page, 30000)
    chequear('cancelar durante la espera termina enseguida', time.time() - t0 < 10 and enc['msgs'][-1]['tipo'] == 'fin', (round(time.time() - t0, 1), enc['msgs'][-1]))
    chequear('sin errores de programa', not errores(page), errores(page))
    ctx.close()

    # 6) La MEV no se deja encuadrar (X-Frame-Options): el marco oculto no puede cargar y el
    #    sondeo de respaldo es el que comprueba que ya pasó.
    m = mev_chica()
    m.portero['proveido.asp'] = 1
    m.cabeceras = {'proveido.asp': {'X-Frame-Options': 'DENY'}}
    ctx = contexto(browser, m, bibliotecas=True)
    page = abrir(ctx)
    t0 = time.time()
    encargar(page, 'val7')
    enc = esperar_fin(page, 90000)
    chequear('si el marco no puede cargar, el sondeo de respaldo la da por pasada y la descarga termina', tiene(page, r'Validación superada sola') and enc['pdf'] and time.time() - t0 < 60, ([x['texto'] for x in msgs(page)][-3:], round(time.time() - t0)))
    chequear('sin errores de programa', not errores(page), errores(page))
    ctx.close()

    # 7) El repositorio de documentos frena un adjunto: siete pedidos del motor reciben el portero
    #    (más que los 5 reintentos), y el marco oculto que se carga entre pedido y pedido para dejar
    #    la cookie también recibe uno cada vez (13 porteros en total). Se pide ayuda con el rótulo
    #    "el adjunto" y la dirección de docs, la validación no gasta reintentos y el adjunto termina
    #    en el PDF. Con las esperas del portero acortadas, para que la prueba dure segundos.
    global ENVOLTORIO
    envoltorio_normal = ENVOLTORIO
    ENVOLTORIO = ENVOLTORIO.replace('esperaValidacionBaseMs: 5000', 'esperaValidacionBaseMs: 300').replace('precalentadoOpacoMs: 8000', 'precalentadoOpacoMs: 150').replace('sondeoManualMs: 60000', 'sondeoManualMs: 1000')
    chequear('las esperas del portero se pudieron acortar para la prueba', ENVOLTORIO != envoltorio_normal)
    try:
        m = mev_chica()
        m.proveidos = {'0': proveido_con('Paso cero con adjunto.', ADJUNTO_A1)}
        portero_docs = {'status': 200, 'headers': {'content-type': 'text/html; charset=windows-1252'}, 'body': m.portero_html().encode('cp1252', 'replace')}
        m.adjuntos = {'A1': [portero_docs] * 13 + [{'status': 200}]}
        ctx = contexto(browser, m, bibliotecas=True)
        page = abrir(ctx)
        marco = encargar(page, 'val6')
        ok = esperar(page, "window.__enc.msgs.some((x) => x.tipo === 'ayuda' && /docs\\.scba\\.gov\\.ar/.test(x.url || ''))", 40000)
        ayuda = next((x for x in msgs(page) if x['tipo'] == 'ayuda' and 'docs.scba.gov.ar' in (x['url'] or '')), None)
        chequear('con un adjunto frenado la ayuda apunta al repositorio de documentos y dice "el adjunto"', ok and ayuda and ayuda['rotulo'] == 'el adjunto', ayuda)
        enc = esperar_fin(page, 120000)
        gm_pedidos = marco.evaluate('window.__gm') if not marco.is_detached() else []
        chequear('el motor pidió el adjunto ocho veces (siete frenos y la buena) sin darse por perdido', enc['pdf'] and sum(1 for g in gm_pedidos if 'id=A1' in g['url']) == 8, (bool(enc['pdf']), len([g for g in gm_pedidos if 'id=A1' in g['url']])))
        chequear('el PDF trae el adjunto', 'ADJUNTO DE PRUEBA' in ' '.join((texto_pdf(enc['pdf']) or '').split()), [x['texto'] for x in msgs(page)][-3:])
        chequear('sin errores de programa', not errores(page), errores(page))
        ctx.close()
    finally:
        ENVOLTORIO = envoltorio_normal

def descarga_con_validacion(browser):
    print('== ventana: la ayuda de la validación abre la página trabada (0.9.1)')
    if sin_bibliotecas('descarga_con_validacion'): return
    m = mev_chica()
    m.portero['proveido.asp'] = 1
    ctx = contexto(browser, m, bibliotecas=True)
    page = abrir(ctx)
    leer_causas(page, 'completa')
    page.click('#mvu [data-t="causas"]')
    # se encola la primera causa desde el botón de bajar de su fila
    page.eval_on_selector('#mvu section[data-p="causas"] button[data-a="bajar"]', 'e => e.click()')
    page.click('#mvu [data-t="desc"]')
    ok = esperar(page, "!!document.querySelector('#mvu [data-e=\"dAbrir\"]')", 20000)
    txt = page.evaluate("(() => { const b = document.querySelector('#mvu [data-e=\"dAbrir\"]'); return b ? b.textContent : ''; })()")
    chequear('la solapa Descargas ofrece verificar en la ventanita (0.9.3)', ok and txt == 'Verificar', txt)
    chequear('y el botón para insistir a mano', page.evaluate("(() => { const b = document.querySelector('#mvu [data-e=\"dSeguir\"]'); return b ? b.textContent : ''; })()") == 'Ya validé: seguir')
    page.evaluate("() => { window.__abierta = ''; window.open = (u) => { window.__abierta = String(u); return null; }; }")
    page.click('#mvu [data-e="dAbrir"]')
    abierta = page.evaluate("window.__abierta")
    chequear('"Abrir" abre la actuación trabada, no el listado de la causa', '/proveido.asp' in abierta and 'idpaso=' in abierta, abierta)
    ok = esperar(page, "!document.querySelector('#mvu [data-e=\"dAbrir\"]')", 60000)
    chequear('la ayuda desaparece cuando la validación pasa sola', ok)
    chequear('sin errores de programa', not errores(page), errores(page))
    ctx.close()

def ventanita_de_verificacion(browser):
    print('== la verificación se resuelve en una ventanita que se cierra sola (0.9.3)')
    m = mev_chica()
    original = m.atender
    estado = {'activo': False, 'servidos': 0}
    def atender(route, request):
        # la MEV frena el primer pedido de organismo (POST): se valida en la página del Set
        if estado['activo'] and estado['servidos'] < 1 and '/resultados.asp' in request.url and request.method == 'POST':
            estado['servidos'] += 1
            m.pedidos.append({'method': 'POST', 'path': '/resultados.asp', 'qs': {}, 'body': '', 'juris': m.juris, 'freno': True})
            return route.fulfill(status=200, content_type='text/html; charset=windows-1252', body=m.portero_html().encode('cp1252'))
        return original(route, request)
    m.atender = atender
    ctx = contexto(browser, m)
    page = abrir(ctx)
    estado['activo'] = True
    page.click('#mvu [data-e="primera"]')
    ok = esperar(page, "!!document.querySelector('#mvu [data-e=\"lectAbrirVerif\"]')", 20000)
    chequear('con un freno en un POST, la barra ofrece Verificar enseguida (sin probar sola en otra página)', ok, page.evaluate("document.querySelector('#mvu [data-e=\"lectTxt\"]').textContent"))
    page.wait_for_timeout(1500)
    chequear('mientras espera, la lectura no sigue sola', page.evaluate("!!document.querySelector('#mvu [data-e=\"lectAbrirVerif\"]')"))
    with page.expect_popup() as info:
        page.click('#mvu [data-e="lectAbrirVerif"]')
    ventana = info.value
    try:
        ventana.wait_for_load_state('load', timeout=8000)
        nombre = ventana.evaluate('window.name')
        url = ventana.url
    except Exception as e:
        nombre, url = '', repr(e)
    chequear('se abre una ventanita con la página del Set (no Sets.asp)', nombre == 'mu-verificacion' and 'resultados.asp' in url and 'nidset=' in url, (nombre, url))
    cerro = False
    for _ in range(80):
        if ventana.is_closed(): cerro = True; break
        page.wait_for_timeout(100)
    chequear('la ventanita se cierra sola cuando la página carga bien', cerro)
    ok = esperar(page, "document.querySelector('#mvu [data-e=\"lect\"]').style.display === 'none'", 60000)
    idx = indice(page) or {'causas': {}}
    causas = [c for c in idx['causas'].values() if not c.get('ausente')]
    chequear('la lectura sigue sola y termina con las 15 causas', ok and len(causas) == 15, len(causas))
    frenos = gm(page, 'mu.frenos'); frenos = json.loads(frenos) if isinstance(frenos, str) else frenos
    chequear('el registro anota cuánto tardó en resolverse', frenos and frenos[-1].get('resueltaMs') is not None and frenos[-1]['pagina'] == '/resultados.asp', frenos)
    page.click('#mvu [data-t="sets"]')
    filas = page.eval_on_selector_all('#mvu [data-e="sFrenos"] tbody tr', 'f => f.map(x => x.textContent)')
    resumen = page.evaluate("(() => { const d = document.querySelector('#mvu [data-e=\"sFrenos\"] summary'); return d ? d.textContent : ''; })()")
    chequear('la solapa Sets muestra las verificaciones de las últimas 24 horas', resumen.endswith('(1)') and len(filas) == 1 and '/resultados.asp' in filas[0], (resumen, filas))
    chequear('la jurisdicción vuelve a la original', m.juris == 'CC24', m.juris)
    # una página de la MEV abierta como ventanita: no muestra la ventana de MEV Ultra y avisa que cargó bien
    gm_set(page, 'mu.verificacionLista', None)
    otra = ctx.new_page()
    otra.goto('https://mev.scba.gov.ar/robots.txt')
    otra.evaluate("window.name = 'mu-verificacion'")
    otra.goto('https://mev.scba.gov.ar/Sets.asp')
    otra.wait_for_timeout(1500)
    chequear('en la ventanita MEV Ultra no abre su ventana ni tareas: solo avisa que la página cargó', not otra.evaluate("!!document.querySelector('#mvu')") and gm(page, 'mu.verificacionLista') is not None, (otra.evaluate("!!document.querySelector('#mvu')"), gm(page, 'mu.verificacionLista')))
    otra.close()
    chequear('sin errores de programa', not errores(page), errores(page))
    ctx.close()

def panel_de_departamentos(browser):
    print('== el panel de departamentos queda dentro de la ventana; ejemplo inventado en Buscar sucesorio (0.9.4)')
    chequear('el ejemplo del campo de Buscar sucesorio es un nombre inventado', 'por ejemplo: PEREZ JUAN"' in ORIGINAL)
    medida = """(n) => { const p = document.querySelector('#mvu [data-e="' + n + 'Panel"]'); const r = p.getBoundingClientRect();
      const l = document.querySelector('#mvu [data-e="' + n + 'Listo"]'); const b = l.getBoundingClientRect();
      const e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return { izq: r.left, der: r.right, ancho: innerWidth, listoVisible: e === l, derecha: p.style.right }; }"""
    for ancho, zoom in ((1400, 100), (1920, 100), (1366, 120)):
        m = mev_chica()
        ctx = contexto(browser, m)
        ctx.add_init_script("localStorage.setItem('gm:mu.pref', JSON.stringify({ zoom: %d }))" % zoom)
        page = ctx.new_page()
        page.set_viewport_size({'width': ancho, 'height': 900})
        page.goto('https://mev.scba.gov.ar/Sets.asp')
        esperar(page, "!!document.querySelector('#mvu')", 8000)
        page.click('#mvu [data-t="buscar"]')
        page.click('#mvu [data-e="bAlcanceBoton"]')
        r = page.evaluate(medida, 'bAlcance')
        chequear('Buscar sucesorio, %d píxeles, zoom %d%%: el panel no se sale por la derecha y Listo se ve' % (ancho, zoom),
                 r['der'] <= r['ancho'] and r['izq'] >= 0 and r['listoVisible'], r)
        chequear('Buscar sucesorio, %d píxeles, zoom %d%%: el panel se alinea con el borde derecho del botón' % (ancho, zoom), r['derecha'] == '0px', r)
        page.click('#mvu [data-e="bAlcanceListo"]')
        if ancho == 1400:
            page.click('#mvu [data-t="causas"]')
            leer_causas(page, 'completa')
            page.click('#mvu [data-t="sets"]')
            page.click('#mvu [data-e="sDeptoBoton"]')
            r = page.evaluate(medida, 'sDepto')
            chequear('Sets: el panel, que entra, queda alineado a la izquierda como antes', r['derecha'] == '' and r['der'] <= r['ancho'] and r['listoVisible'], r)
            page.click('#mvu [data-e="sDeptoListo"]')
            page.click('#mvu [data-t="buscar"]')
            page.click('#mvu [data-e="bAlcanceBoton"]')
            r2 = page.evaluate(medida, 'bAlcance')
            chequear('al volver a abrirlo se vuelve a medir (queda dentro)', r2['der'] <= r2['ancho'] and r2['listoVisible'], r2)
        chequear('sin errores de programa', not errores(page), errores(page))
        ctx.close()

def lectura_sola(browser):
    print('== lee e indexa sola al entrar si la última lectura tiene más de 6 horas (0.9.2)')
    chequear('los plazos de la lectura sola están declarados como se decidió (6 h, medio minuto, media hora)', 'LECTURA_SOLA_MS = 6 * 3600 * 1000' in ORIGINAL and 'ESPERA_ARRANQUE_MS = 30 * 1000' in ORIGINAL and 'REVISION_SOLA_MS = 30 * 60 * 1000' in ORIGINAL)
    global ENVOLTORIO
    envoltorio_normal = ENVOLTORIO
    ENVOLTORIO = ENVOLTORIO.replace('ESPERA_ARRANQUE_MS = 3600 * 1000', 'ESPERA_ARRANQUE_MS = 800').replace('REVISION_SOLA_MS = 30 * 60 * 1000', 'REVISION_SOLA_MS = 2500')
    chequear('los plazos se pudieron acortar para la prueba', ENVOLTORIO != envoltorio_normal)
    try:
        m = mev_chica()
        ctx = contexto(browser, m)
        page = abrir(ctx)
        # 1) Cuenta nueva: nunca se leyó. Sin tocar nada, arranca una lectura completa.
        ok = esperar(page, "document.querySelector('#mvu [data-e=\"lect\"]').style.display === 'flex'", 6000)
        txt = page.evaluate("document.querySelector('#mvu [data-e=\"lectTxt\"]').textContent")
        chequear('sin lectura previa arranca sola una lectura y la barra dice que es automática', ok and txt.startswith('Lectura automática'), txt)
        ok = esperar(page, "document.querySelector('#mvu [data-e=\"lect\"]').style.display === 'none'", 60000)
        idx = indice(page)
        chequear('termina, es completa y deja las 15 causas', ok and idx['lectura']['modo'] == 'completa' and len([c for c in idx['causas'].values() if not c.get('ausente')]) == 15, (ok, idx['lectura'].get('modo')))
        chequear('la jurisdicción vuelve a la original', m.juris == 'CC24', m.juris)
        # 2) Con la lectura fresca, otra pestaña no lee (ni en el arranque ni en la revisión siguiente).
        m.pedidos.clear()
        page2 = abrir(ctx)
        page2.wait_for_timeout(4000)
        chequear('con la última lectura reciente no se lee de nuevo', not m.pedidos_a('/POSLoguin.asp', 'POST') and not m.pedidos_a('/resultados.asp'), len(m.pedidos))
        chequear('y no hay avisos de "otra pestaña está leyendo"', 'Otra pestaña' not in aviso_texto(page2), aviso_texto(page2))
        page2.close()
        # 3) La última lectura tiene 7 horas y hay una novedad: se lee sola (rápida) y se indexan sus actuaciones.
        idx['lectura']['fecha'] = int(time.time() * 1000) - 7 * 3600 * 1000
        gm_set(page, 'mu.%s.indice' % USUARIO, idx)
        m.sets[0]['causas'][0].ult = '26/09/2026'; m.sets[0]['causas'][0].tramite = 'SENTENCIA'
        m.pedidos.clear()
        page3 = abrir(ctx)
        ok = esperar(page3, "document.querySelector('#mvu [data-e=\"lect\"]').style.display === 'flex'", 6000)
        chequear('con la última lectura vieja arranca sola', ok)
        ok = esperar(page3, "document.querySelector('#mvu [data-e=\"lect\"]').style.display === 'none'", 60000)
        idx = indice(page3)
        c = idx['causas']['1001|SI-1']
        chequear('es rápida, termina y detecta la novedad', ok and idx['lectura']['modo'] == 'rapida' and c.get('nuevo') and 'SENTENCIA' in c.get('cambio', ''), (idx['lectura'].get('modo'), c.get('cambio')))
        ok = esperar(page3, "localStorage.getItem('gm:mu.%s.act.1001|SI-1') != null" % USUARIO, 40000)
        reg = gm(page3, 'mu.%s.act.1001|SI-1' % USUARIO)
        reg = json.loads(reg) if isinstance(reg, str) else reg
        chequear('después de la lectura se indexan solas las actuaciones de la causa con novedad', ok and reg and len(reg.get('pasos') or []) >= 1, (ok, bool(reg)))
        chequear('solo se pidió el listado y las actuaciones de esa causa', len(m.pedidos_a('/procesales.asp')) == 1 and len(m.pedidos_a('/proveido.asp')) >= 1, (len(m.pedidos_a('/procesales.asp')), len(m.pedidos_a('/proveido.asp'))))
        chequear('la jurisdicción vuelve a la original', m.juris == 'CC24', m.juris)
        # 4) Apagada desde Sets, no lee aunque la última lectura sea vieja.
        page3.click('#mvu [data-t="sets"]')
        page3.uncheck('#mvu [data-e="sSola"]')
        pref = gm(page3, 'mu.pref'); pref = json.loads(pref) if isinstance(pref, str) else pref
        chequear('la casilla de Sets apaga la lectura sola y queda guardada', pref and pref.get('lecturaSola') is False, pref)
        idx = indice(page3); idx['lectura']['fecha'] = int(time.time() * 1000) - 7 * 3600 * 1000
        gm_set(page3, 'mu.%s.indice' % USUARIO, idx)
        m.pedidos.clear()
        page4 = abrir(ctx)
        page4.wait_for_timeout(4000)
        chequear('apagada, no lee sola', not m.pedidos_a('/POSLoguin.asp', 'POST') and not m.pedidos_a('/resultados.asp'), len(m.pedidos))
        chequear('sin errores de programa', not errores(page) and not errores(page3) and not errores(page4), errores(page) + errores(page3) + errores(page4))
        ctx.close()
    finally:
        ENVOLTORIO = envoltorio_normal

def medir(browser):
    print('== medición: consultas de una lectura con los Sets reales')
    m = mev_real()
    ctx = contexto(browser, m)
    page = abrir(ctx)
    t0 = time.time()
    ok = leer_causas(page, 'completa')
    t1 = time.time() - t0
    idx = indice(page)
    causas = [c for c in idx['causas'].values() if not c.get('ausente')]
    total_esperado = len(m.causas_todas())
    chequear('la lectura completa con los Sets reales termina', ok)
    chequear('encuentra todas las causas (%d)' % total_esperado, len(causas) == total_esperado, len(causas))
    pos = len(m.pedidos_a('/POSLoguin.asp', 'POST')); gets = len(m.pedidos_a('/resultados.asp', 'GET')); posts = len(m.pedidos_a('/resultados.asp', 'POST')); sets = len(m.pedidos_a('/Sets.asp'))
    total = pos + gets + posts + sets
    print('   completa: %d consultas (%d cambios de jurisdicción, %d Sets, %d organismos, %d Sets.asp); a %s s por consulta: %d min %d s; el banco tardó %.1f s'
          % (total, pos, gets, posts, sets, str(BASE_S).replace('.', ','), (total * BASE_S) // 60, (total * BASE_S) % 60, t1))
    m.pedidos.clear()
    t0 = time.time()
    ok = leer_causas(page, 'rapida')
    t1 = time.time() - t0
    pos = len(m.pedidos_a('/POSLoguin.asp', 'POST')); gets = len(m.pedidos_a('/resultados.asp', 'GET')); posts = len(m.pedidos_a('/resultados.asp', 'POST')); sets = len(m.pedidos_a('/Sets.asp'))
    total = pos + gets + posts + sets
    chequear('la lectura rápida termina', ok)
    print('   rápida: %d consultas (%d cambios de jurisdicción, %d Sets, %d organismos, %d Sets.asp); a %s s por consulta: %d min %d s; el banco tardó %.1f s'
          % (total, pos, gets, posts, sets, str(BASE_S).replace('.', ','), (total * BASE_S) // 60, (total * BASE_S) % 60, t1))
    chequear('sin errores de programa', not errores(page), errores(page))
    ctx.close()

def lectura_por_partes(browser):
    print('== lectura por partes (un Set, un departamento)')
    m = mev_chica()
    ctx = contexto(browser, m)
    page = abrir(ctx)
    leer_causas(page, 'completa')
    # cambia una causa de Quilmes (Set 102) y una de San Isidro (Set 101)
    m.sets[1]['causas'][0].ult = '25/09/2026'; m.sets[1]['causas'][0].tramite = 'SENTENCIA'
    m.sets[0]['causas'][1].ult = '25/09/2026'; m.sets[0]['causas'][1].tramite = 'AUDIENCIA'
    m.pedidos.clear()
    page.click('#mvu [data-t="sets"]')
    page.click('#mvu [data-releer="102"]')
    ok = esperar(page, "document.querySelector('#mvu [data-e=\"lect\"]').style.display === 'flex'", 3000) and esperar(page, "document.querySelector('#mvu [data-e=\"lect\"]').style.display === 'none'", 30000)
    chequear('releer un Set termina', ok)
    juris_pedidas = [juris_de_cuerpo(p['qs']) for p in m.pedidos_a('/POSLoguin.asp', 'POST')]
    chequear('releer un Set va solo a donde está ese Set y vuelve', juris_pedidas == ['CC23', 'CC24'], juris_pedidas)
    sets_pedidos = set(p['qs']['nidset'][0] for p in m.pedidos_a('/resultados.asp', 'GET') if p['qs'].get('nidset'))
    chequear('solo se pide ese Set', sets_pedidos == {'102'}, sets_pedidos)
    idx = indice(page)
    chequear('los demás Sets se conservan en el índice', len(idx['sets']) == 7 and idx['sets']['101']['encontradas'] == 7, {k: v.get('encontradas') for k, v in idx['sets'].items()})
    chequear('la novedad del Set releído se detecta', idx['causas']['1008|Q-1'].get('nuevo') and 'SENTENCIA' in idx['causas']['1008|Q-1'].get('cambio', ''))
    chequear('la causa del Set no releído sigue como estaba', not idx['causas']['1002|SI-1'].get('nuevo'))
    chequear('ninguna causa queda como ausente', not any(c.get('ausente') for c in idx['causas'].values()))
    page.click('#mvu [data-t="causas"]')
    chequear('la tabla sigue con las 15 causas', filas_visibles(page) == 15, filas_visibles(page))
    # un departamento
    m.pedidos.clear()
    page.click('#mvu [data-t="sets"]')
    elegir_deptos(page, 'sDepto', ['CC24'])
    page.click('#mvu [data-e="sReleerDepto"]')
    ok = esperar(page, "document.querySelector('#mvu [data-e=\"lect\"]').style.display === 'flex'", 3000) and esperar(page, "document.querySelector('#mvu [data-e=\"lect\"]').style.display === 'none'", 30000)
    chequear('releer un departamento termina', ok)
    juris_pedidas = set(juris_de_cuerpo(p['qs']) for p in m.pedidos_a('/POSLoguin.asp', 'POST'))
    chequear('releer un departamento no sale de esa jurisdicción', juris_pedidas == {'CC24'}, juris_pedidas)
    sets_pedidos = set(p['qs']['nidset'][0] for p in m.pedidos_a('/resultados.asp', 'GET') if p['qs'].get('nidset'))
    chequear('pide los Sets que tienen causas ahí (101 y 103)', sets_pedidos == {'101', '103'}, sets_pedidos)
    idx = indice(page)
    chequear('la novedad de San Isidro se detecta ahora', idx['causas']['1002|SI-1'].get('nuevo') and 'AUDIENCIA' in idx['causas']['1002|SI-1'].get('cambio', ''))
    chequear('los Sets siguen completos en el índice', len(idx['sets']) == 7 and idx['sets']['102']['encontradas'] == 2)
    chequear('la jurisdicción vuelve a la original', m.juris == 'CC24', m.juris)
    # un Set con una sola causa: los textos van en singular (0.8.2)
    page.click('#mvu [data-t="sets"]')
    page.click('#mvu [data-releer="104"]')
    ok = esperar(page, "document.querySelector('#mvu [data-e=\"lect\"]').style.display === 'flex'", 3000) and esperar(page, "document.querySelector('#mvu [data-e=\"lect\"]').style.display === 'none'", 30000)
    chequear('releer un Set de una causa termina', ok)
    chequear('la franja habla de 1 causa, en singular', aviso_texto(page).startswith('Lectura terminada: 1 causa en'), aviso_texto(page))
    t = page.evaluate("document.querySelector('#mvu section[data-p=\"sets\"]').textContent")
    chequear('la solapa Sets dice 1 causa y N consultas en su número', '· 1 causa ·' in t and 'consultas ·' in t, t[:400])
    chequear('sin errores de programa', not errores(page), errores(page))
    ctx.close()

def marco_de_descarga(browser):
    print('== el marco de descarga usa las bibliotecas cargadas por @require (0.7.3)')
    # La MEV manda una política de seguridad (CSP) script-src * 'unsafe-inline' sin 'unsafe-eval':
    # prohíbe ejecutar texto como programa. Por eso las bibliotecas no pueden ir como @resource
    # más eval (así fue la 0.7.2 y falló en la MEV real): van como @require y las carga Tampermonkey.
    chequear('la cabecera no declara @resource ni pide GM_getResourceText', not re.search(r'^// @resource', ORIGINAL, re.M) and 'GM_getResourceText' not in ORIGINAL)
    chequear('el script no ejecuta texto como programa (eval / new Function), que la MEV prohíbe', not re.search(r'\beval\b|new\s+Function\b', ORIGINAL))
    m = mev_chica()
    ctx = contexto(browser, m)
    page = abrir(ctx)
    page.evaluate("() => { window.__mensajes = []; window.addEventListener('message', (e) => { if (e.data && e.data.mevultra === 'encargo') window.__mensajes.push(e.data); }); }")
    gm_set(page, 'mu.encargo.prueba1', {'urls': None})
    page.evaluate("() => { const f = document.createElement('iframe'); f.src = 'https://mev.scba.gov.ar/procesales.asp?nidCausa=1001&pidJuzgado=SI-1#mevultra-encargo=prueba1'; f.style.cssText = 'width:900px;height:600px'; document.body.appendChild(f); }")
    esperar(page, "(window.__mensajes || []).length > 0", 15000)
    msgs = page.evaluate("window.__mensajes")
    chequear('el marco oculto arranca la descarga e informa su estado a la ventana', msgs and msgs[0]['tipo'] in ('estado', 'progreso'), msgs[:2])
    chequear('sin errores de programa en la ventana', not errores(page), errores(page))
    ctx.close()

def tiempo_de_sesion(browser):
    print('== tiempo de sesión en la barra y aviso (0.7.7)')
    m = mev_chica()
    ctx = contexto(browser, m)
    page = abrir(ctx)
    t = page.evaluate("document.querySelector('#mvu [data-e=\"sesion\"]').textContent")
    chequear('sin saber cuándo se ingresó, la placa muestra el tiempo aproximado', t == 'Sesión: ~0 min', t)
    d = gm(page, 'mu.sesionDesde'); d = json.loads(d) if isinstance(d, str) else d
    chequear('y queda anotado como aproximado', d and d.get('t') and not d.get('exacto'), d)
    # llegando desde la pantalla de ingreso, el inicio es exacto
    page.goto('https://mev.scba.gov.ar/loguin.asp')
    page.evaluate("location.href = '/POSLoguin.asp'")
    esperar(page, "!!document.querySelector('#mvu')", 8000)
    d = gm(page, 'mu.sesionDesde'); d = json.loads(d) if isinstance(d, str) else d
    t = page.evaluate("document.querySelector('#mvu [data-e=\"sesion\"]').textContent")
    chequear('al llegar desde la pantalla de ingreso, el inicio queda exacto y la placa lo muestra sin ~', d and d.get('exacto') and t == 'Sesión: 0 min', (d, t))
    page.click('#mvu [data-t="sets"]')
    t = page.evaluate("document.querySelector('#mvu [data-e=\"sSesion\"]').textContent")
    chequear('la solapa Sets muestra la hora de inicio de la sesión', 'Sesión iniciada las' in t and '(hace 0 min)' in t, t)
    # pasados 40 minutos la placa marca el tiempo y NO aconseja cerrar la sesión (0.8.1: las tareas siguen siempre)
    gm_set(page, 'mu.sesionDesde', {'t': int(time.time() * 1000) - 41 * 60000, 'exacto': True})
    page2 = abrir(ctx)
    t = page2.evaluate("document.querySelector('#mvu [data-e=\"sesion\"]').textContent")
    avisa = esperar(page2, "/cerrá la sesión|lleva 41 minutos/.test(document.querySelector('#mvu [data-e=\"avisoTxt\"]').textContent)", 2500)
    chequear('a los 40 minutos la placa marca el tiempo y no aconseja cerrar la sesión (0.8.1)', t == 'Sesión: 41 min' and not avisa, (t, aviso_texto(page2)))
    chequear('sin errores de programa', not errores(page) and not errores(page2), errores(page) + errores(page2))
    ctx.close()

def descarga_con_sesion_vencida(browser):
    print('== la descarga espera el reingreso si la sesión vence (0.7.7)')
    m = mev_chica()
    ctx = contexto(browser, m)
    page = abrir(ctx)
    page.evaluate("() => { window.__mensajes = []; window.addEventListener('message', (e) => { if (e.data && e.data.mevultra === 'encargo') window.__mensajes.push(e.data); }); }")
    gm_set(page, 'mu.encargo.prueba2', {'urls': None})
    page.evaluate("() => { const f = document.createElement('iframe'); f.src = 'https://mev.scba.gov.ar/procesales.asp?nidCausa=1001&pidJuzgado=SI-1#mevultra-encargo=prueba2'; f.style.cssText = 'width:900px;height:600px'; document.body.appendChild(f); }")
    esperar(page, "(window.__mensajes || []).length > 0", 15000)
    m.sesion = False
    ok = esperar(page, "window.__mensajes.some((x) => /La sesión de la MEV venció/.test(x.texto || ''))", 15000)
    chequear('con la sesión vencida, la descarga avisa y espera en vez de terminar', ok and not any(x['tipo'] == 'fin' for x in page.evaluate("window.__mensajes")), page.evaluate("window.__mensajes.slice(-3)"))
    antes = len(m.pedidos_a('/proveido.asp'))
    page.wait_for_timeout(1200)
    chequear('mientras espera no sigue pidiendo actuaciones', len(m.pedidos_a('/proveido.asp')) == antes, len(m.pedidos_a('/proveido.asp')) - antes)
    m.sesion = True
    ok = esperar(page, "window.__mensajes.some((x) => /Sesión recuperada/.test(x.texto || ''))", 15000)
    chequear('cuando la sesión vuelve, avisa que sigue', ok, page.evaluate("window.__mensajes.slice(-3)"))
    ok = esperar(page, "(() => { const i = window.__mensajes.findIndex((x) => /Sesión recuperada/.test(x.texto || '')); return i >= 0 && window.__mensajes.slice(i + 1).some((x) => x.tipo === 'estado' || x.tipo === 'progreso'); })()", 15000)
    chequear('y la descarga continúa desde donde estaba', ok and len(m.pedidos_a('/proveido.asp')) > antes, (len(m.pedidos_a('/proveido.asp')) - antes, page.evaluate("window.__mensajes.slice(-3)")))
    chequear('sin errores de programa en la ventana', not errores(page), errores(page))
    ctx.close()

def juris_cambiada(browser):
    print('== otra pestaña cambia la jurisdicción en medio de la lectura (0.7.8)')
    m = mev_chica()
    m.sabotaje = {'quedan': 0, 'juris': 'CC6'}   # tras la primera consulta de organismo, la sesión queda en La Plata
    ctx = contexto(browser, m)
    page = abrir(ctx)
    ok = leer_causas(page, 'completa')
    chequear('la lectura termina', ok)
    chequear('el sabotaje se ejecutó', m.sabotaje.get('hecho'), m.sabotaje)
    idx = indice(page)
    causas = [c for c in idx['causas'].values() if not c.get('ausente')]
    chequear('igual encuentra las 15 causas', len(causas) == 15, len(causas))
    avisos = idx['lectura']['avisos']
    chequear('avisa que la jurisdicción apareció cambiada y que se repuso', any('apareció cambiada a La Plata' in a and 'se repitió la consulta' in a for a in avisos), avisos)
    chequear('no atribuye a la MEV causas que no muestra por la jurisdicción cambiada', not any('muestra 0' in a for a in avisos), avisos)
    chequear('la jurisdicción vuelve a la original', m.juris == 'CC24', m.juris)
    chequear('sin errores de programa', not errores(page), errores(page))
    ctx.close()

def departamento_sin_causas(browser):
    print('== leer un departamento que todavía no tiene causas cargadas (0.7.9)')
    m = mev_chica()
    ctx = contexto(browser, m)
    page = abrir(ctx)
    leer_causas(page, 'completa')
    antes = indice(page)
    lugares101 = sorted(antes['sets']['101']['lugares'].keys())
    # aparece un Set nuevo con una causa de Mar del Plata (como "Causas MDQ" de Ignacio)
    c = Causa(1101, 'CC17-2', 'CC17', 'MARPLATENSE UNO S/ SUCESION AB-INTESTATO')
    m.set_(108, 'Causas MDQ', [c])
    page.click('#mvu [data-t="causas"]')
    page.click('#mvu [data-t="sets"]')
    opciones = page.evaluate("() => { const p = document.querySelector('#mvu [data-e=\"sDeptoPanel\"]'); const out = []; let g = null; for (const el of p.children) { if (el.classList.contains('msel-g')) { g = [el.textContent, []]; out.push(g); } else if (el.tagName === 'LABEL') { const i = el.querySelector('input[data-d]'); if (i && g) g[1].push(i.dataset.d); } } return out; }")
    grupos = dict(opciones)
    todas = sum(grupos.values(), [])
    chequear('la lista trae Mar del Plata entre las que no tienen causas', 'CC17' in grupos.get('Sin causas cargadas · Civil y Comercial', []), opciones)
    chequear('la lista trae San Isidro entre las que tienen causas', 'CC24' in grupos.get('Con causas cargadas', []), opciones)
    chequear('están todas las jurisdicciones: civil, familia y penal de cada departamento, paz, Suprema Corte y Casación (0.8.0)',
             all(('CC' + v) in todas and ('FF' + v) in todas and ('PP' + v) in todas for v in DEPTOS) and {'PZ', 'SCJ', 'LPC'} <= set(todas) and len(todas) == len(set(todas)) == 3 * len(DEPTOS) + 3, len(todas))
    chequear('Familia de Mar del Plata figura entre las de familia sin causas', 'FF17' in grupos.get('Sin causas cargadas · Familia', []), list(grupos.keys()))
    m.pedidos.clear()
    elegir_deptos(page, 'sDepto', ['CC17'])
    page.click('#mvu [data-e="sReleerDepto"]')
    ok = esperar(page, "document.querySelector('#mvu [data-e=\"lect\"]').style.display === 'flex'", 3000) and esperar(page, "document.querySelector('#mvu [data-e=\"lect\"]').style.display === 'none'", 30000)
    chequear('leer Mar del Plata termina', ok)
    juris_pedidas = set(juris_de_cuerpo(p['qs']) for p in m.pedidos_a('/POSLoguin.asp', 'POST'))
    chequear('no sale de Mar del Plata (y vuelve a la original)', juris_pedidas <= {'CC17', 'CC24'} and 'CC17' in juris_pedidas, juris_pedidas)
    idx = indice(page)
    chequear('encuentra la causa de Mar del Plata', '1101|CC17-2' in idx['causas'] and not idx['causas']['1101|CC17-2'].get('ausente'), list(idx['causas'].keys())[-3:])
    chequear('el Set nuevo queda con su lugar', list(idx['sets'].get('108', {}).get('lugares', {}).keys()) == ['CC17'], idx['sets'].get('108'))
    chequear('las demás causas siguen', len([x for x in idx['causas'].values() if not x.get('ausente')]) == 16)
    chequear('el Set 101 conserva todos sus lugares', sorted(idx['sets']['101']['lugares'].keys()) == lugares101, idx['sets']['101']['lugares'])
    # Familia de Mar del Plata, sin causas cargadas: entra la lista de autorizaciones a la que le falta una causa (0.8.0)
    m.organismo('MDQF-1', 'Juzgado de Familia Nº 1 - Mar del Plata', 'FF17')
    lista = [x for x in m.sets if x['nidset'] == '106'][0]
    lista['causas'].append(Causa(1102, 'MDQF-1', 'FF17', 'M. P. S/ ALIMENTOS'))
    lista['total'] = len(lista['causas'])
    m.pedidos.clear()
    page.click('#mvu [data-t="causas"]')
    page.click('#mvu [data-t="sets"]')
    elegir_deptos(page, 'sDepto', ['FF17'])
    page.click('#mvu [data-e="sReleerDepto"]')
    ok = esperar(page, "document.querySelector('#mvu [data-e=\"lect\"]').style.display === 'flex'", 3000) and esperar(page, "document.querySelector('#mvu [data-e=\"lect\"]').style.display === 'none'", 30000)
    idx = indice(page)
    chequear('leer Familia de Mar del Plata encuentra la causa de la lista de autorizaciones', ok and '1102|MDQF-1' in idx['causas'], list(idx['causas'].keys())[-3:])
    sets_pedidos = set(p['qs']['nidset'][0] for p in m.pedidos_a('/resultados.asp', 'GET') if p['qs'].get('nidset'))
    chequear('en Familia no consulta los Sets civiles completos', '106' in sets_pedidos and '101' not in sets_pedidos and '102' not in sets_pedidos, sets_pedidos)
    # releer San Isidro no borra los otros lugares del Set 101 (Quilmes, San Martín)
    page.click('#mvu [data-t="sets"]')
    elegir_deptos(page, 'sDepto', ['CC24'])
    page.click('#mvu [data-e="sReleerDepto"]')
    ok = esperar(page, "document.querySelector('#mvu [data-e=\"lect\"]').style.display === 'flex'", 3000) and esperar(page, "document.querySelector('#mvu [data-e=\"lect\"]').style.display === 'none'", 30000)
    idx = indice(page)
    chequear('releer un departamento no le borra al Set sus otros lugares', ok and sorted(idx['sets']['101']['lugares'].keys()) == lugares101, idx['sets']['101']['lugares'])
    chequear('la jurisdicción vuelve a la original', m.juris == 'CC24', m.juris)
    chequear('sin errores de programa', not errores(page), errores(page))
    ctx.close()

# ---------------------------------------------------------------- motor de descarga (0.8.0)
ESCUCHA_ENCARGO = """() => {
  window.__enc = { msgs: [], pdf: null, nombre: '' };
  window.addEventListener('message', async (e) => {
    const d = e.data;
    if (!d || d.mevultra !== 'encargo') return;
    window.__enc.msgs.push({ tipo: d.tipo, texto: d.texto || '', url: d.url || '', rotulo: d.rotulo || '', t: Date.now() });
    if (d.tipo === 'archivo') {
      const u = new Uint8Array(await d.blob.arrayBuffer());
      let b = ''; for (let i = 0; i < u.length; i += 8192) b += String.fromCharCode.apply(null, u.subarray(i, i + 8192));
      window.__enc.pdf = btoa(b); window.__enc.nombre = d.nombre;
      e.source.postMessage({ mevultra: 'ordenes', orden: 'archivoGuardado', id: d.id, via: 'prueba' }, location.origin);
    }
  });
}"""

def encargar(page, ident, nid='1001', pid='SI-1', urls=None):
    """Abre el marco de descarga como lo hace la ventana y devuelve el marco."""
    page.evaluate(ESCUCHA_ENCARGO)
    gm_set(page, 'mu.encargo.' + ident, {'urls': urls, 't': int(time.time() * 1000)})
    page.evaluate("([src]) => { const f = document.createElement('iframe'); f.id = 'marcoPrueba'; f.src = src; f.style.cssText = 'width:900px;height:600px'; document.body.appendChild(f); }",
                  ['https://mev.scba.gov.ar/procesales.asp?nidCausa=%s&pidJuzgado=%s#mevultra-encargo=%s' % (nid, pid, ident)])
    esperar(page, "window.__enc.msgs.length > 0", 15000)
    return next(f for f in page.frames if 'mevultra-encargo=' + ident in f.url)

def esperar_fin(page, ms=60000):
    esperar(page, "window.__enc.msgs.some((x) => x.tipo === 'fin')", ms)
    return page.evaluate("window.__enc")

def texto_pdf(b64):
    """Texto del PDF (pdftotext, del paquete poppler), o None si no está instalado."""
    if not b64: return ''
    with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as f:
        f.write(base64.b64decode(b64)); ruta = f.name
    try:
        return subprocess.run(['pdftotext', '-layout', ruta, '-'], capture_output=True, text=True, timeout=60).stdout
    except FileNotFoundError:
        return None
    finally:
        os.unlink(ruta)

def paginas_pdf(page, b64):
    return page.evaluate("async (b64) => { const d = await PDFLib.PDFDocument.load(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))); return d.getPageCount(); }", b64)

def proveido_con(texto, extra=''):
    return '<div id="imprime"><p>Proveído</p><div id="contenidoTxt">%s</div>%s</div>' % (texto, extra)

ADJUNTO_A1 = '<p><a href="https://docs.scba.gov.ar/Documentos?id=A1">VER ADJUNTO</a></p>'

def sin_bibliotecas(nombre):
    if HAY_BIBLIOTECAS: return False
    print('   (se saltea: faltan pruebas/vendor/pdf-lib.min.js y html2canvas.min.js)')
    return True

def enlaces_de_actuacion(browser):
    print('== enlaces de las actuaciones: una sola regla en la ventana y en el motor (0.8.0)')
    copias = re.findall(r'  function urlDeActuacion\(href, base\) \{.*?\n  \}\n', ORIGINAL, re.S)
    chequear('la regla del enlace está en los dos módulos y es idéntica', len(copias) == 2 and copias[0] == copias[1], len(copias))
    m = mev_chica()
    raros = [('01/09/2026', '9', 'RARO JAVASCRIPT', "javascript:window.top.__ejecutado='proveido.asp'"),
             ('02/09/2026', '9', 'RARO OTRO ORIGEN', 'https://otro.example/proveido.asp?x=1'),
             ('03/09/2026', '9', 'RARO RUTA PARECIDA', '/carpeta/proveido.asp.php?x=1'),
             ('04/09/2026', '9', 'RARO HTTP', 'http://mev.scba.gov.ar/proveido.asp?x=1'),
             ('05/09/2026', '9', 'RARO MALFORMADO', 'https://[proveido.asp')]
    m.filas_extra = raros
    ctx = contexto(browser, m)
    pedidos_fuera = []
    ctx.on('request', lambda r: pedidos_fuera.append(r.url) if 'otro.example' in r.url or r.url.startswith('http://') else None)
    page = abrir(ctx, '/procesales.asp?nidCausa=1001&pidJuzgado=SI-1')
    esperar(page, "!!document.querySelector('#mvu section[data-p=\"exp\"] tbody tr')", 8000)
    sin = page.eval_on_selector_all('#mvu section[data-p="exp"] tbody tr', "trs => trs.filter(t => /sin enlace válido/.test(t.textContent)).map(t => t.textContent)")
    buenas = page.eval_on_selector_all('#mvu section[data-p="exp"] tbody tr [data-a="ver"]', "b => b.length")
    chequear('la ventana marca las 5 filas con enlaces que no son de la MEV', len(sin) == 5 and all('RARO' in x for x in sin), sin)
    chequear('las actuaciones buenas conservan Ver y Bajar', buenas >= 3, buenas)
    page.click('#mvu [data-e="xTodas"]')
    n_sel = page.evaluate("document.querySelector('#mvu [data-e=\"xCont\"]').textContent")
    chequear('"Todas" no elige las filas sin enlace válido', n_sel.startswith('3 seleccionadas'), n_sel)
    chequear('ninguna dirección rara se pidió ni se ejecutó', not pedidos_fuera and not page.evaluate('window.__ejecutado'), pedidos_fuera)
    chequear('sin errores de programa', not errores(page), errores(page))
    ctx.close()

def motor_pdf(browser):
    print('== motor: PDF completo, orden, adjunto, código de la página y enlaces raros (0.8.0)')
    if sin_bibliotecas('motor_pdf'): return
    m = mev_chica()
    m.proveidos = {
        '0': proveido_con('Texto del paso cero, el mas nuevo.', ADJUNTO_A1),
        '1': proveido_con('Texto del paso uno. <img src="x.gif" onerror="window.top.__ejecutado=2"><a href="javascript:window.top.__ejecutado=3" id="malo">enlace</a>',
                          '<script>window.top.__ejecutado = 1;</script><meta http-equiv="refresh" content="0;url=https://otro.example/">'),
        '2': proveido_con('Texto del paso dos, el inicio.'),
    }
    m.adjuntos = {'A1': [{'status': 200}]}
    m.filas_extra = [('15/09/2026', '9', 'RARO JAVASCRIPT', "javascript:window.top.__ejecutado='proveido.asp'")]
    ctx = contexto(browser, m, bibliotecas=True)
    fuera = []
    ctx.on('request', lambda r: fuera.append(r.url) if 'otro.example' in r.url else None)
    page = abrir(ctx)
    encargar(page, 'pdf1')
    enc = esperar_fin(page, 90000)
    fin = [x for x in enc['msgs'] if x['tipo'] == 'fin']
    chequear('la descarga termina con "Listo"', fin and fin[0]['texto'].startswith('Listo'), fin)
    chequear('entrega el PDF a la ventana', bool(enc['pdf']), enc.get('nombre'))
    if not enc['pdf']: ctx.close(); return
    txt = texto_pdf(enc['pdf'])
    if txt is None:
        print('   (sin pdftotext: no se revisa el texto del PDF)')
    else:
        i2, i1, i0, ia = (txt.find(x) for x in ('paso dos', 'paso uno', 'paso cero', 'ADJUNTO DE PRUEBA'))
        chequear('el PDF va de la más vieja a la más nueva, con el adjunto detrás de su actuación', -1 not in (i2, i1, i0, ia) and i2 < i1 < i0 < ia, (i2, i1, i0, ia))
        chequear('la actuación con enlace raro queda asentada en el anexo', 'no es una actuación suya' in txt.replace('\n', ' ') or 'no es una actuaci' in txt, txt[-600:])
        hora = re.search(r'Descargado de la MEV el \d{1,2}/\d{1,2}/\d{4}, (\d{2}):\d{2}:\d{2}', txt)
        ahora = page.evaluate('new Date().getHours()')
        chequear('la portada da la hora de la descarga con reloj de 24 horas (motor 2.1.2)', hora and int(hora.group(1)) in (ahora, (ahora - 1) % 24), (hora and hora.group(0), ahora))
    chequear('ninguna fecha con hora se escribe con toLocaleString(\'es-AR\') sin reloj de 24 horas', not re.search(r"toLocaleString\('es-AR'\)", ORIGINAL.replace("(Math.round(ms / 100) / 10).toLocaleString('es-AR')", '')))
    chequear('el PDF tiene páginas (portada, actuaciones, adjunto)', paginas_pdf(page, enc['pdf']) >= 3)
    chequear('el código del proveído no se ejecutó al capturarlo (script, onerror, javascript:, recarga)', not page.evaluate('window.__ejecutado') and not fuera, (page.evaluate('window.__ejecutado'), fuera))
    paginas = set(p['path'].lower() for p in m.pedidos if not p['path'].lower().endswith(('.gif', '.png', '.jpg', '.css')))
    chequear('solo se pidieron páginas de la MEV y el adjunto', paginas <= {'/procesales.asp', '/proveido.asp', '/sets.asp', '/documentos'}, paginas)
    chequear('sin errores de programa', not errores(page), errores(page))
    ctx.close()

def motor_errores(browser):
    print('== motor: 404 sin reintentos, 429 con Retry-After, portero con 403 (0.8.0)')
    if sin_bibliotecas('motor_errores'): return
    m = mev_chica()
    m.proveidos = {
        '0': proveido_con('Paso cero con dos adjuntos.', ADJUNTO_A1 + '<p><a href="https://docs.scba.gov.ar/Documentos?id=NOHAY">VER ADJUNTO</a></p>'),
        '1': [{'status': 429, 'headers': {'Retry-After': '1'}}],
        '2': [{'status': 404}],
    }
    m.adjuntos = {'A1': [{'status': 429, 'headers': {'Retry-After': '1'}}, {'status': 200}], 'NOHAY': [{'status': 404}]}
    ctx = contexto(browser, m, bibliotecas=True)
    page = abrir(ctx)
    marco = encargar(page, 'err1')
    enc = esperar_fin(page, 90000)
    gm_pedidos = marco.evaluate('window.__gm') if not marco.is_detached() else []
    a1 = [g for g in gm_pedidos if 'id=A1' in g['url']]
    nohay = [g for g in gm_pedidos if 'id=NOHAY' in g['url']]
    chequear('el adjunto con 429 se pide dos veces y espera lo que dice Retry-After', len(a1) == 2 and a1[1]['t'] - a1[0]['t'] >= 900, [(g['t'] - a1[0]['t']) for g in a1] if a1 else a1)
    chequear('el adjunto con 404 se pide una sola vez', len(nohay) == 1, len(nohay))
    prov1 = [p for p in m.pedidos_a('/proveido.asp') if p['qs'].get('idpaso') == ['1']]
    prov2 = [p for p in m.pedidos_a('/proveido.asp') if p['qs'].get('idpaso') == ['2']]
    chequear('la actuación con 429 se vuelve a pedir y se lee', len(prov1) == 2, len(prov1))
    chequear('la actuación con 404 se pide una sola vez', len(prov2) == 1, len(prov2))
    txt = texto_pdf(enc['pdf']) or ''
    plano = ' '.join(txt.split())
    chequear('el anexo dice por qué faltan (HTTP 404)', plano.count('HTTP 404') >= 2, plano[-700:])
    chequear('igual entrega el PDF con lo que pudo', bool(enc['pdf']))
    chequear('sin errores de programa', not errores(page), errores(page))
    ctx.close()

def motor_cancelar(browser):
    print('== motor: cancelar corta el adjunto que se está bajando (0.8.0)')
    if sin_bibliotecas('motor_cancelar'): return
    m = mev_chica()
    m.proveidos = {'0': proveido_con('Paso cero con adjunto lento.', ADJUNTO_A1)}
    m.adjuntos = {'A1': [{'colgar': True}]}
    ctx = contexto(browser, m, bibliotecas=True)
    page = abrir(ctx)
    marco = encargar(page, 'can1')
    ok = esperar(page, "window.__enc.msgs.some((x) => /Adjunto 1 de 1|Bajando adjunto/.test(x.texto))", 60000)
    chequear('llega a bajar el adjunto lento', ok)
    t0 = time.time()
    page.evaluate("() => { const f = document.getElementById('marcoPrueba'); f.contentWindow.postMessage({ mevultra: 'ordenes', orden: 'cancelar', id: 'can1' }, location.origin); }")
    enc = esperar_fin(page, 30000)
    tarda = time.time() - t0
    gm_pedidos = marco.evaluate('window.__gm') if not marco.is_detached() else []
    a1 = [g for g in gm_pedidos if 'id=A1' in g['url']]
    chequear('el pedido del adjunto se abortó', a1 and a1[0]['abortado'], a1)
    chequear('no se empezó otro intento después de cancelar', len(a1) == 1, len(a1))
    chequear('la descarga termina enseguida (no espera el minuto sin datos)', tarda < 15, round(tarda, 1))
    txt = ' '.join((texto_pdf(enc['pdf']) or '').split())
    chequear('entrega el PDF parcial y el anexo dice que el adjunto no se bajó', bool(enc['pdf']) and 'No se pudo bajar el adjunto' in txt and 'cancelado' in txt, txt[-500:])
    chequear('sin errores de programa', not errores(page), errores(page))
    ctx.close()

def motor_montaje_vencido(browser):
    print('== motor: un proveído que no termina de cargar no traba la descarga (0.8.0)')
    if sin_bibliotecas('motor_montaje_vencido'): return
    m = mev_chica()
    # Paso 0: una hoja de estilos que no llega nunca (el montaje no termina).
    # Paso 1: una imagen que no llega nunca (el montaje termina, la fotografía no).
    m.proveidos = {'0': '<link rel="stylesheet" href="/colgada.css">' + proveido_con('Paso cero con estilos que no cargan nunca.'),
                   '1': proveido_con('Paso uno con una imagen que no carga nunca. <img src="/colgada.gif">')}
    m.colgar = {'/colgada.css', '/colgada.gif'}
    ctx = contexto(browser, m, bibliotecas=True)
    page = abrir(ctx)
    marco = encargar(page, 'mon1')
    enc = esperar_fin(page, 60000)
    restos = marco.evaluate("[...document.querySelectorAll('iframe')].filter((f) => f.style.left === '-99999px').length") if not marco.is_detached() else -1
    txt = ' '.join((texto_pdf(enc['pdf']) or '').split())
    chequear('el montaje que no termina vence y queda asentado', 'timeout montando el proveído' in txt, txt[-700:])
    chequear('la fotografía que no termina vence y queda asentada', 'la captura no terminó' in txt, txt[-700:])
    chequear('las dos actuaciones conservan su texto', 'Paso cero con estilos' in txt and 'Paso uno con una imagen' in txt)
    chequear('no quedan marcos de captura en la página', restos == 0, restos)
    chequear('la descarga termina y entrega el PDF', bool(enc['pdf']))
    chequear('sin errores de programa', not errores(page), errores(page))
    ctx.close()

def busqueda_con_sesion_vencida(browser):
    print('== la búsqueda espera el reingreso si la sesión vence y sigue desde donde estaba (0.8.1)')
    m = mev_chica()
    # la sesión se corta después de la cuarta consulta por carátula
    original = m.atender
    estado = {'posts': 0, 'activo': False}
    def atender(route, request):
        if estado['activo'] and '/busqueda.asp' in request.url.lower() and request.method == 'POST':
            estado['posts'] += 1
            if estado['posts'] == 4: m.sesion = False
        return original(route, request)
    m.atender = atender
    ctx = contexto(browser, m)
    page = abrir(ctx)
    leer_causas(page, 'completa')
    m.pedidos.clear()
    estado['activo'] = True
    page.click('#mvu [data-t="buscar"]')
    page.fill('#mvu [data-e="bTexto"]', 'Marino Teresa')
    elegir_deptos(page, 'bAlcance', [])
    page.click('#mvu [data-e="bBuscar"]')
    ok = esperar(page, "/sesión de la MEV se cerró/.test(document.querySelector('#mvu [data-e=\"lectTxt\"]').textContent) && /la búsqueda sigue sola/.test(document.querySelector('#mvu [data-e=\"lectTxt\"]').textContent)", 20000)
    chequear('con la sesión cortada, la búsqueda avisa y espera en vez de terminar con error', ok, page.evaluate("document.querySelector('#mvu [data-e=\"lectTxt\"]').textContent"))
    b = gm(page, 'mu.%s.busquedas' % USUARIO); b = (json.loads(b) if isinstance(b, str) else b) or [{}]
    chequear('mientras espera, la búsqueda sigue en curso', b[0].get('estado') == 'curso', b[0].get('estado'))
    hechos_antes = len(b[0].get('hechos', []))
    m.sesion = True
    b = esperar_busqueda(page, 60000)
    chequear('al volver la sesión, la búsqueda termina', b is not None and b['estado'] == 'terminada', b and (b['estado'], b.get('error')))
    halladas = sorted(r['nidCausa'] for r in (b or {}).get('resultados', {}).values())
    chequear('encuentra lo mismo que sin corte', halladas == ['1001', '1006', '1016'], halladas)
    claves = [(p['juris'], p['qs'].get('JuzgadoElegido', [''])[0], p['qs'].get('Texto', [''])[0]) for p in m.pedidos_a('/Busqueda.asp', 'POST')]
    repetidas = [k for k in set(claves) if claves.count(k) > 1 and k[2] == 'MARINO TERESA']
    chequear('no repite juzgados ya consultados (salvo el que se cortó)', len(repetidas) <= 1, repetidas)
    chequear('la jurisdicción vuelve a la original', m.juris == 'CC24', m.juris)
    chequear('sin errores de programa', not errores(page), errores(page))
    ctx.close()

def busqueda_formato_real(browser):
    print('== búsqueda: la respuesta real de la MEV ("Total Expedientes : 1") y los fueros elegidos (0.8.1)')
    m = mev_chica()
    m.sueltas.append(Causa(1201, 'SI-TT', 'CC24', 'ACOSTA JULIAN S/ DESPIDO'))
    m.sueltas.append(Causa(1202, 'SI-2', 'CC24', 'BRAVO ELENA Y ACOSTA JULIAN S/ SUCESION AB INTESTATO'))
    m.busqueda_formato = 'real'
    ctx = contexto(browser, m)
    page = abrir(ctx)
    m.pedidos.clear()
    page.click('#mvu [data-t="buscar"]')
    page.fill('#mvu [data-e="bTexto"]', 'Acosta')
    elegir_deptos(page, 'bAlcance', ['CC24'])
    page.click('#mvu [data-e="bBuscar"]')
    b = esperar_busqueda(page)
    halladas = sorted(r['nidCausa'] for r in (b or {}).get('resultados', {}).values())
    chequear('con el formato real encuentra la sucesión (antes daba 0)', b and b['estado'] == 'terminada' and halladas == ['1202'], (b and b['estado'], halladas, b and b.get('error')))
    r = (b or {}).get('resultados', {}).get('1202|SI-2', {})
    chequear('la causa queda con su juzgado aunque el enlace no lo traiga', r.get('organismo', '').startswith('Juzgado en lo Civil y Comercial Nº 2'), r)
    chequear('guarda qué respondió la MEV en cada juzgado', b and any('Total Expedientes: 1' in x['texto'] for x in b.get('respuestas', [])) and any('no arroja resultados' in x['texto'] for x in b.get('respuestas', [])), b and b.get('respuestas', [])[:3])
    chequear('sin causa conocida, la búsqueda figura como "sin comprobar"', page.evaluate("/Terminada, sin comprobar/.test(document.querySelector('#mvu section[data-p=\"buscar\"]').textContent)"))
    posts = [p['qs'].get('JuzgadoElegido', [''])[0] for p in m.pedidos_a('/Busqueda.asp', 'POST')]
    chequear('no entra al tribunal de trabajo ni a familia', 'SI-TT' not in posts and not any(p['juris'].startswith('FF') for p in m.pedidos_a('/Busqueda.asp', 'POST')), posts)
    chequear('solo se ofrecen Civil y Comercial y Justicia de Paz (buscador de sucesiones)', page.eval_on_selector_all('#mvu [data-e="bFueros"] input[data-f]', "i => i.map(x => x.dataset.f).join(',')") == 'civil,paz')
    chequear('nunca encuentra la causa del tribunal de trabajo', '1201' not in halladas, halladas)
    # solo Justicia de Paz
    m.pedidos.clear()
    page.fill('#mvu [data-e="bTexto"]', 'Marino')
    page.uncheck('#mvu [data-e="bFueros"] input[data-f="civil"]')
    elegir_deptos(page, 'bAlcance', [])
    page.click('#mvu [data-e="bBuscar"]')
    b = esperar_busqueda(page)
    pedidos = m.pedidos_a('/Busqueda.asp', 'POST')
    halladas = sorted(r['nidCausa'] for r in (b or {}).get('resultados', {}).values())
    chequear('solo Paz: entra únicamente en la Justicia de Paz y encuentra la sucesión de paz', pedidos and all(p['juris'] == 'PZ' for p in pedidos) and halladas == ['1016'], (set(p['juris'] for p in pedidos), halladas))
    # ninguno tildado: no arranca
    page.uncheck('#mvu [data-e="bFueros"] input[data-f="paz"]')
    antes = len(json.loads(gm(page, 'mu.%s.busquedas' % USUARIO)) if isinstance(gm(page, 'mu.%s.busquedas' % USUARIO), str) else gm(page, 'mu.%s.busquedas' % USUARIO) or [])
    page.click('#mvu [data-e="bBuscar"]')
    page.wait_for_timeout(300)
    chequear('sin ningún fuero tildado avisa y no arranca', 'Tildá al menos un fuero' in aviso_texto(page), aviso_texto(page))
    page.check('#mvu [data-e="bFueros"] input[data-f="civil"]')
    elegir_deptos(page, 'bAlcance', ['CC24'])
    # la MEV declara causas y el listado no se puede leer: diagnóstico, no "0 encontradas"
    m.busqueda_formato = 'ilegible'
    page.fill('#mvu [data-e="bTexto"]', 'Bravo')
    page.click('#mvu [data-e="bBuscar"]')
    b = esperar_busqueda(page)
    chequear('si la MEV informa causas y no se pueden leer, se detiene con diagnóstico', b and b['estado'] == 'error' and 'no pudo leerlas' in (b.get('error') or '') and 'Enlaces de la respuesta' in (b.get('diagnostico') or ''), b and (b['estado'], b.get('error')))
    chequear('la jurisdicción vuelve a la original', m.juris == 'CC24', m.juris)
    chequear('sin errores de programa', not errores(page), errores(page))
    ctx.close()

def lectura_con_429(browser):
    print('== lectura: un 429 de la MEV se espera y no se toma como página vacía (0.8.0)')
    m = mev_chica()
    original = m.atender
    estado = {'servidos': 0}
    def atender(route, request):
        if '/resultados.asp' in request.url and request.method == 'POST' and estado['servidos'] < 1:
            estado['servidos'] += 1
            m.pedidos.append({'method': 'POST', 'path': '/resultados.asp', 'qs': {}, 'body': '', 'juris': m.juris, 'e429': True})
            return route.fulfill(status=429, headers={'Retry-After': '1', 'content-type': 'text/html'}, body='<html><body>Too Many Requests</body></html>')
        return original(route, request)
    m.atender = atender
    ctx = contexto(browser, m)
    page = abrir(ctx)
    ok = leer_causas(page, 'completa')
    idx = indice(page) or {'causas': {}}
    causas = [c for c in idx['causas'].values() if not c.get('ausente')]
    chequear('la lectura termina y encuentra las 15 causas pese al 429', ok and len(causas) == 15, (len(causas), aviso_texto(page)))
    chequear('el 429 se sirvió', estado['servidos'] == 1)
    chequear('sin errores de programa', not errores(page), errores(page))
    ctx.close()

def indices(browser):
    print('== índices: personas y planilla de sucesiones (0.9.0)')
    m = mev_chica()
    # una carátula con dos causantes y una demanda con dos demandados
    for c in m.causas_todas():
        if c.nid == '1008': c.caratula = 'GARCIA PEDRO Y GARCIA ROSA S/ SUCESION AB-INTESTATO'
        if c.nid == '1009': c.caratula = 'DIAZ ROSA C/ SUAREZ JOSE Y OTROS S/ COBRO'
    ctx = contexto(browser, m)
    page = abrir(ctx)
    leer_causas(page, 'completa')
    page.click('#mvu [data-t="indices"]')
    texto = lambda: page.evaluate("document.querySelector('#mvu [data-e=\"iCuerpo\"]').innerText")
    fila = lambda nombre: page.evaluate("(n) => { const tr = [...document.querySelectorAll('#mvu [data-e=\"iCuerpo\"] tbody tr')].find((t) => t.cells[0].innerText.trim() === n); return tr ? [...tr.cells].map((c) => c.innerText.trim()) : null; }", nombre)
    t = fila('MARINO TERESA')
    chequear('Personas: MARINO TERESA figura como causante, con la sucesión y el incidente', t and t[1].startswith('Causante') and t[3] == '2' and 'INCIDENTE DE HONORARIOS' in t[2] and 'Quilmes' in t[2], t)
    chequear('una carátula con "Y" da dos causantes', (fila('GARCIA PEDRO') or [None, None])[1] == 'Causante' and (fila('GARCIA ROSA') or [None, None])[1] == 'Causante', (fila('GARCIA PEDRO'), fila('GARCIA ROSA')))
    chequear('en una demanda, actora y demandada; "OTROS" no es una persona', (fila('DIAZ ROSA') or [None])[1] == 'Actora' and (fila('SUAREZ JOSE') or [None])[1] == 'Demandada' and fila('OTROS') is None, (fila('DIAZ ROSA'), fila('SUAREZ JOSE')))
    chequear('el objeto de la causa no se toma como persona', fila('SUCESION AB-INTESTATO') is None and fila('COBRO') is None)
    cuenta = lambda: page.evaluate("document.querySelector('#mvu [data-e=\"iCuenta\"]').textContent")
    chequear('la cuenta de personas está en su número', re.fullmatch(r'\d+ personas', cuenta()), cuenta())
    page.fill('#mvu [data-e="iTexto"]', 'marino')
    chequear('el filtro deja solo la persona buscada', cuenta() == '1 persona' and 'MARINO TERESA' in texto(), cuenta())
    page.fill('#mvu [data-e="iTexto"]', '')
    # planilla de sucesiones
    page.click('#mvu [data-e="iSucesiones"]')
    idx = indice(page)
    suc_esperadas = [c for c in idx['causas'].values() if not c.get('ausente') and re.search(r'SUCESI|TESTAMENT', c['caratula'], re.I)]
    chequear('Sucesiones: una fila por causa sucesoria', cuenta() == plural_es(len(suc_esperadas), 'sucesión', 'sucesiones'), (cuenta(), len(suc_esperadas)))
    t = fila('MARINO TERESA')
    chequear('la fila trae causante, tipo, departamento y estado', t and t[1] == 'ab intestato' and t[2] == 'San Isidro' and 'Juzgado' in t[3], t)
    chequear('la testamentaria y la vacante se distinguen', (fila('RODRIGUEZ ANA') or [None, None])[1] == 'testamentaria', fila('RODRIGUEZ ANA'))
    # exportar
    page.evaluate("window.__descargas = []")
    page.click('#mvu [data-e="iExportar"]')
    ok = esperar(page, "(window.__descargas || []).length > 0", 8000)
    d = page.evaluate("window.__descargas[0]") if ok else None
    import base64
    csv = base64.b64decode(d['b64']).decode('utf-8') if d else ''
    chequear('la planilla de sucesiones se exporta como .csv con sus columnas', d and d['nombre'].startswith('MEV-Ultra-sucesiones-') and csv.startswith('\ufeff"Causante";"Tipo";"Carátula"') and 'MARINO TERESA' in csv, d and d['nombre'])
    # el menú de cada sucesión
    page.eval_on_selector('#mvu [data-im="1001|SI-1"]', 'e => e.click()')
    chequear('cada sucesión tiene el menú de la causa', 'Abrir en la MEV, en una pestaña nueva' in page.evaluate("document.querySelector('#mvu-pop').innerText"))
    chequear('sin errores de programa', not errores(page), errores(page))
    ctx.close()

def esperar_indexacion(page, ms=60000):
    """Espera a que la indexación en curso termine (el botón Detener aparece y desaparece)."""
    esperar(page, "!!document.querySelector('#mvu [data-e=\"aDetener\"]')", 5000)
    return esperar(page, "!document.querySelector('#mvu [data-e=\"aDetener\"]')", ms)

def indice_actuaciones(browser):
    print('== índice de actuaciones: indexar, buscar, no repetir, sesión vencida, cola pendiente (0.9.0)')
    m = mev_chica()
    # cada paso tiene su texto: idpaso 0, 1 y 2 (todas las causas comparten los mismos idpaso en la réplica)
    m.proveidos = {'0': proveido_con('Se ordena publicar EDICTOS por un día en el Boletín Oficial.'), '1': proveido_con('Téngase presente la declaratoria de herederos solicitada.'), '2': proveido_con('Por iniciada la sucesión. Publíquense edictos.')}
    ctx = contexto(browser, m)
    page = abrir(ctx)
    leer_causas(page, 'completa')
    page.click('#mvu [data-t="indices"]')
    page.click('#mvu [data-e="iActuaciones"]')
    texto = lambda: page.evaluate("document.querySelector('#mvu [data-e=\"iCuerpo\"]').innerText")
    chequear('sin nada indexado lo dice y ofrece indexar las que faltan', '0 causas indexadas' in texto() and page.evaluate("!!document.querySelector('#mvu [data-e=\"aFaltan\"]') && !document.querySelector('#mvu [data-e=\"aFaltan\"]').disabled"), texto()[:200])
    # una causa desde su menú (Mis causas)
    m.pedidos.clear()
    page.click('#mvu [data-t="causas"]')
    page.fill('#mvu [data-e="buscar"]', '36999')
    esperar(page, "document.querySelector('#mvu [data-e=\"infoCausas\"]').textContent.startsWith('1 de')", 3000)
    page.click('#mvu section[data-p="causas"] tbody tr [data-a="menu"]')
    page.click('#mvu-pop [data-m="indexar"]')
    ok = esperar(page, "/Indexación terminada/.test(document.querySelector('#mvu [data-e=\"avisoTxt\"]').textContent)", 15000)
    chequear('indexar una causa desde su menú termina y avisa', ok and '1 causa, 3 actuaciones nuevas' in aviso_texto(page), aviso_texto(page))
    chequear('pidió el listado y cada actuación una vez', len(m.pedidos_a('/procesales.asp')) == 1 and len(m.pedidos_a('/proveido.asp')) == 3, (len(m.pedidos_a('/procesales.asp')), len(m.pedidos_a('/proveido.asp'))))
    chequear('no cambió la jurisdicción de la sesión', not m.pedidos_a('/POSLoguin.asp', 'POST'))
    page.click('#mvu [data-t="indices"]')
    page.click('#mvu [data-e="iActuaciones"]')
    chequear('el estado dice 1 causa indexada y 3 actuaciones', '1 causa indexada · 3 actuaciones' in texto(), texto()[:200])
    page.fill('#mvu [data-e="iTexto"]', 'declaratoria herederos')
    page.wait_for_timeout(500)
    filas = page.evaluate("[...document.querySelectorAll('#mvu [data-e=\"iCuerpo\"] tbody tr')].map((t) => [...t.cells].map((c) => c.innerText.trim()))")
    chequear('la búsqueda encuentra la actuación por sus palabras, con recorte y enlace', len(filas) == 1 and 'MARINO TERESA' in filas[0][0] and 'PROVEIDO' in filas[0][2] and 'declaratoria' in filas[0][3] and page.evaluate("document.querySelector('#mvu [data-e=\"iCuerpo\"] tbody a[href*=\"proveido.asp\"]') !== null"), filas)
    page.fill('#mvu [data-e="iTexto"]', 'edictos')
    page.wait_for_timeout(500)
    chequear('sin acentos ni mayúsculas: "edictos" encuentra EDICTOS y edictos', page.evaluate("document.querySelectorAll('#mvu [data-e=\"iCuerpo\"] tbody tr').length") == 2)
    page.fill('#mvu [data-e="iTexto"]', 'palabra inexistente')
    page.wait_for_timeout(500)
    chequear('sin coincidencias lo dice', 'Ninguna actuación indexada' in texto())
    page.fill('#mvu [data-e="iTexto"]', '')
    page.wait_for_timeout(300)
    # actualizar: la causa ya indexada no vuelve a pedir sus actuaciones
    m.pedidos.clear()
    page.click('#mvu [data-e="aActualizar"]')
    ok = esperar_indexacion(page)
    chequear('actualizar una causa ya indexada pide solo el listado', ok and len(m.pedidos_a('/procesales.asp')) == 1 and len(m.pedidos_a('/proveido.asp')) == 0, (ok, len(m.pedidos_a('/procesales.asp')), len(m.pedidos_a('/proveido.asp'))))
    # las que faltan, con la sesión vencida en el medio: espera y sigue con la misma causa
    m.pedidos.clear()
    page.click('#mvu [data-e="aFaltan"]')
    esperar(page, "(() => { const e = document.querySelector('#mvu [data-e=\"aAvance\"]'); return e && /actuación/.test(e.textContent); })()", 5000)
    m.sesion = False
    ok = esperar(page, "/Esperando que ingreses/.test((document.querySelector('#mvu [data-e=\"aAvance\"]') || {}).textContent || '')", 8000)
    chequear('con la sesión vencida, la indexación espera el reingreso', ok, page.evaluate("(document.querySelector('#mvu [data-e=\"aAvance\"]') || {}).textContent"))
    antes = len(m.pedidos_a('/proveido.asp'))
    page.wait_for_timeout(700)
    chequear('mientras espera no pide actuaciones', len(m.pedidos_a('/proveido.asp')) == antes)
    m.sesion = True
    ok = esperar(page, "!document.querySelector('#mvu [data-e=\"aDetener\"]')", 60000)
    chequear('con la sesión de vuelta termina de indexar todas', ok and '14 causas' in aviso_texto(page), (ok, aviso_texto(page)))
    idx_n = page.evaluate("(() => { const t = document.querySelector('#mvu [data-e=\"iCuerpo\"]').innerText; const m = t.match(/(\\d+) causas indexadas · (\\d+) actuaciones/); return m ? [+m[1], +m[2]] : null; })()")
    chequear('quedan 15 causas y 45 actuaciones indexadas', idx_n == [15, 45], idx_n)
    chequear('la cola quedó vacía', not gm(page, 'mu.%s.actCola' % USUARIO) or gm(page, 'mu.%s.actCola' % USUARIO) in ('[]', []), gm(page, 'mu.%s.actCola' % USUARIO))
    # una cola pendiente (pestaña cerrada a mitad de camino) se ofrece continuar
    gm_set(page, 'mu.%s.actCola' % USUARIO, ['1001|SI-1', '1003|SI-2'])
    page2 = abrir(ctx)
    page2.click('#mvu [data-t="indices"]')
    page2.click('#mvu [data-e="iActuaciones"]')
    chequear('una cola pendiente se ofrece continuar', page2.evaluate("!!document.querySelector('#mvu [data-e=\"aContinuar\"]') && /pendiente \\(2\\)/.test(document.querySelector('#mvu [data-e=\"aContinuar\"]').textContent)"))
    page2.close()
    chequear('sin errores de programa', not errores(page), errores(page))
    ctx.close()

def fechas_como_supjn(browser):
    """0.9.5: las fechas se escriben dd/mm/aaaa, como en SuPJN+, y no con el campo del navegador."""
    print('== fechas escritas como dd/mm/aaaa, como en SuPJN+ (0.9.5)')
    chequear('el programa no tiene campos de fecha del navegador', 'type="date"' not in ORIGINAL and 'type=date' not in ORIGINAL)
    m = mev_chica()
    ctx = contexto(browser, m)
    page = abrir(ctx)
    leer_causas(page, 'completa')
    info = "document.querySelector('#mvu [data-e=\"infoCausas\"]').textContent"
    campo = lambda e: "document.querySelector('#mvu [data-e=\"%s\"]')" % e
    chequear('ninguna fecha del navegador en la ventana', page.evaluate("document.querySelectorAll('#mvu input[type=date]').length") == 0)
    chequear('el filtro Últ. mov. usa dos campos de texto dd/mm/aaaa',
             page.evaluate("['fDesde', 'fHasta'].map((e) => { const c = document.querySelector('#mvu [data-e=\"' + e + '\"]'); return [c.type, c.placeholder, c.getAttribute('inputmode')].join('|'); })") == ['text|dd/mm/aaaa|numeric'] * 2)
    sel = '#mvu [data-e="fDesde"]'
    page.click(sel)
    page.keyboard.type('0101')
    chequear('las barras se ponen solas', page.evaluate(campo('fDesde') + '.value') == '01/01', page.evaluate(campo('fDesde') + '.value'))
    chequear('a medio escribir no se filtra', page.evaluate(info).startswith('15'), page.evaluate(info))
    page.keyboard.type('2030')
    esperar(page, info + ".startsWith('0')", 3000)
    chequear('con la fecha entera se filtra (ninguna causa desde el 01/01/2030)', page.evaluate(info).startswith('0'), page.evaluate(info))
    page.keyboard.press('Backspace')
    page.wait_for_timeout(300)
    chequear('al corregirla, mientras está a medio escribir sigue el filtro anterior', page.evaluate(info).startswith('0'), page.evaluate(info))
    page.keyboard.type('0')
    page.fill(sel, '')
    esperar(page, info + ".startsWith('15')", 3000)
    chequear('al borrarla se quita el filtro', page.evaluate(info).startswith('15'), page.evaluate(info))
    page.click(sel)
    page.keyboard.type('31022026')
    chequear('una fecha que no existe se marca en rojo', page.evaluate(campo('fDesde') + ".classList.contains('mal')"))
    chequear('y no se toma', page.evaluate(info).startswith('15'), page.evaluate(info))
    page.fill(sel, '')
    page.click(sel)
    page.keyboard.type('010130')
    page.click('#mvu [data-e="fHasta"]')
    esperar(page, info + ".startsWith('0')", 3000)
    chequear('al salir, el año de dos cifras se completa', page.evaluate(campo('fDesde') + '.value') == '01/01/2030', page.evaluate(campo('fDesde') + '.value'))
    chequear('y se filtra con esa fecha', page.evaluate(info).startswith('0'), page.evaluate(info))
    page.click('#mvu [data-e="fLimpiar"]')
    esperar(page, info + ".startsWith('15')", 3000)
    chequear('Quitar filtros vacía los dos campos', page.evaluate("[" + campo('fDesde') + ".value, " + campo('fHasta') + ".value]") == ['', ''])
    # Este expediente
    page.fill('#mvu [data-e="buscar"]', '36999')
    esperar(page, info + ".startsWith('1 de')", 3000)
    page.click('#mvu section[data-p="causas"] [data-a="abrir"]')
    esperar(page, "/PASE A DESPACHO/.test(document.querySelector('#mvu section[data-p=\"exp\"]').textContent)", 8000)
    cont = "document.querySelector('#mvu [data-e=\"xCont\"]').textContent"
    chequear('en el expediente, las fechas también son de texto',
             page.evaluate("['xDesde', 'xHasta'].map((e) => { const c = document.querySelector('#mvu [data-e=\"' + e + '\"]'); return [c.type, c.placeholder].join('|'); })") == ['text|dd/mm/aaaa'] * 2)
    page.click('#mvu [data-e="xDesde"]')
    page.keyboard.type('0103')
    page.click('#mvu [data-e="xMarcarF"]')
    chequear('Marcar entre fechas con una fecha a medio escribir avisa', 'dd/mm/aaaa' in aviso_texto(page), aviso_texto(page))
    chequear('y marca el campo en rojo', page.evaluate(campo('xDesde') + ".classList.contains('mal')"))
    page.fill('#mvu [data-e="xDesde"]', '')
    page.click('#mvu [data-e="xDesde"]')
    page.keyboard.type('01012030')
    page.click('#mvu [data-e="xFiltrarF"]')
    esperar(page, cont + ".indexOf('0 a la vista') >= 0", 3000)
    chequear('Filtrar por fechas usa la fecha escrita (ninguna desde 2030)', '0 a la vista' in page.evaluate(cont), page.evaluate(cont))
    chequear('sin errores de programa', not errores(page), errores(page))
    ctx.close()



# ---------------------------------------------------------------- Guía (0.9.6)
# Réplica de la Guía Judicial de la SCBA (organismos.asp y personal.asp, POST de
# formulario en windows-1252) y del mapa de dependencias del Ministerio Público
# (/mapa?department=...), con la estructura relevada el 30/09/2026 y datos
# inventados. Solo para esta prueba.
from urllib.parse import parse_qs as _parse_qs

CORS_GUIA = {'access-control-allow-origin': 'https://mev.scba.gov.ar', 'access-control-allow-credentials': 'true'}

# (id, padre, nombre, fuero, departamento de asiento, renglones, integrantes)
ORGANISMOS_SCBA = [
    ('1167', 'Suprema Corte de Justicia', 'Secretaría Civil y Comercial y de Familia', 'Civil y Comercial', 'La Plata',
     [('Calle', '13 <b>Intersección:</b> 47 y 48 <b>CP:</b> 1900'), ('Correo electrónico', 'seccivil@jusbuenosaires.gov.ar')], [('Secretario', 'Dr. Inventado Uno')]),
    ('860', '', 'Juzgado en lo Civil y Comercial Nº &nbsp;1 - San Isidro', 'Civil y Comercial', 'San Isidro',
     [('Calle', 'Ituzaingo <b>Nro:</b> 340 - Piso 2 <b>CP:</b> 1642'), ('Correo electrónico', 'jcc1-si@jusbuenosaires.gov.ar')], [('Jueza', 'Dra. Persona Inventada'), ('Secretario', 'Dr. Otro Inventado')]),
    ('864', '', 'Juzgado en lo Civil y Comercial Nº &nbsp;5 - San Isidro', 'Civil y Comercial', 'San Isidro',
     [('Calle', 'Ituzaingo <b>Nro:</b> 340 - Piso 4 <b>CP:</b> 1642'), ('Telediscado', '011 <b>Conmutador/es:</b> 4732-6400 <b>Interno/s:</b> 1 - <a href="turnosjudiciales2.asp?idrep=864&amp;buscando=buscar">Ver turnos &gt;&gt;</a>'), ('Correo electrónico', 'jcc5-si@jusbuenosaires.gov.ar')],
     [('Juez', 'Dr. Quinto Inventado'), ('Secretaria', 'Dra. Sec Uno'), ('Secretario', 'Dr. Sec Dos'), ('Auxiliar Letrada', 'Dra. Aux Uno'), ('Auxiliar Letrado', 'Dr. Aux Dos'), ('Auxiliar Letrada', 'Dra. Aux Tres')]),
    ('874', '', 'Juzgado en lo Civil y Comercial Nº &nbsp;15 - San Isidro', 'Civil y Comercial', 'San Isidro',
     [('Calle', 'Ituzaingo <b>Nro:</b> 340 <b>CP:</b> 1642')], [('Juez', 'Dr. Quince Inventado')]),
    ('852', '', 'Cámara de Apelación en lo Civil y Comercial - San Isidro', 'Civil y Comercial', 'San Isidro',
     [('Calle', 'Ituzaingo <b>Nro:</b> 340 - Piso 10 <b>CP:</b> 1642')], [('Presidenta', 'Dra. Camarista Inventada')]),
    ('1206', '', 'Juzgado de Familia Nº &nbsp;1 - San Isidro', 'Familia', 'San Isidro',
     [('Calle', 'Avenida 12 de octubre <b>CP:</b> 1629')], [('Juez', 'Dr. Familia Inventado')]),
    ('950', '', 'Juzgado en lo Civil y Comercial Nº &nbsp;5 - Morón', 'Civil y Comercial', 'Morón',
     [('Calle', 'Colón <b>Nro:</b> 151 <b>CP:</b> 1708')], [('Juez', 'Dr. Moronense Inventado')]),
    ('1400', '', 'Juzgado en lo Correccional Nº &nbsp;4 - Quilmes', 'Penal', 'Quilmes',
     [('Calle', 'Hipólito Yrigoyen <b>Nro:</b> 475 <b>CP:</b> 1878'), ('Asiento', 'QUILMES - Partido: QUILMES - Dpto: Quilmes')], [('Juez', 'Dr. Pablo Inventado Marcote')]),
    ('1401', '', 'Juzgado en lo Correccional Nº &nbsp;4 - Quilmes', 'Penal', 'Quilmes',
     [('Calle', 'Otra calle <b>CP:</b> 1878'), ('Asiento', 'BERAZATEGUI - Partido: BERAZATEGUI - Dpto: Quilmes')], [('Juez', 'Dr. Descentralizado Inventado')]),
    ('1500', '', 'Juzgado de Paz - ALBERTI', 'Justicia de Paz', 'Mercedes',
     [('Asiento', 'ALBERTI - Partido: ALBERTI - Dpto: Mercedes')], [('Juez', 'Dr. Alberti Inventado')]),
    ('1501', '', 'Juzgado de Paz - BRAGADO', 'Justicia de Paz', 'Mercedes',
     [('Calle', 'Belgrano <b>Nro:</b> 1140 <b>CP:</b> 6640'), ('Asiento', 'BRAGADO - Partido: BRAGADO - Dpto: Mercedes')], [('Jueza', 'Dra. Laura Inventada Pérez')]),
]

PERSONAL_SCBA = [
    ('Jueza', 'Dra. Laura Inventada Pérez', 'Juzgado de Paz', 'Calle: Belgrano - Nro: 1140<br> CP: 6640 BRAGADO - Partido: BRAGADO - Dto: Mercedes<br> Telediscado: 02342 - Tel/Fax: 422254'),
    ('Juez', 'Dr. Pablo Pérez Marcote', 'Juzgado en lo Correccional Nº 4', 'Calle: Hipólito Yrigoyen - Nro: 475<br> CP: 1878 QUILMES - Partido: QUILMES - Dto: Quilmes<br> Telediscado: 011 - Conmutador/es: 6065-9500'),
]

def _pagina_scba(cuerpo):
    return ('<html><head><meta charset="windows-1252"></head><body><div id="fixedmenu"></div><div id="correo"></div>'
            '<form name="menu" method="post" action="organismos.asp?"><input name="textorep"></form>%s</body></html>' % cuerpo)

def _ficha_scba(o):
    oid, padre, nombre, fuero, depto, renglones, gente = o
    titulo = '<p>%s<b>%s</b></p>' % ((padre + '<br>') if padre else '', nombre)
    enlaces = '&nbsp;&nbsp;<small><a href="localidades.asp?localidad=X&amp;marcadores=-34.' + oid + ',-58.5&amp;id=1">Ubicar en mapa &gt;&gt;</a>&nbsp;&nbsp;<a href="organismosedificio.asp?edificio=1">Ver edificio&gt;&gt;</a></small>'
    datos = '<p><b>Fuero: </b>%s</p>' % fuero
    if not any(r == 'Asiento' for r, _ in renglones):
        datos += '<p><b>Asiento:</b> %s - Partido: %s - Dpto: %s</p>' % (depto.upper(), depto.upper(), depto)
    datos += ''.join('<p><b>%s:</b> %s%s</p>' % (r, v, enlaces if r == 'Calle' else '') for r, v in renglones)
    qr = '<div style="float:right"><a href="/qr/qrguiajudicial.asp?titulo=x&amp;comp=y&amp;id=%s"><img src="/imagenes/qr.png"><br>Generar Qr</a></div>' % oid
    filas = '<tr><td colspan="3"><br></td></tr><tr style="background-color:#55bbcf;"><td colspan="2">%s</td><td></td></tr>' % titulo
    filas += '<tr><td colspan="3">%s%s</td></tr>' % (qr, datos)
    filas += ''.join('<tr><td><p><b>%s</b></p></td><td><p>%s <i></i></p></td><td></td></tr>' % gg for gg in gente)
    return filas

def _bloques(filas_por_item, tope):
    out = []
    for i in range(0, len(filas_por_item), tope):
        out.append('<div id="%d" style="position:absolute;visibility:hidden"><table>%s</table></div>' % (i // tope + 1, ''.join(filas_por_item[i:i + tope])))
    return ''.join(out)

SIN_RESULTADOS_HTML = '<div id="suconsulta" class="marcoguia"><table><tr><td><p class="center">Su consulta no arroja resultados</p></td></tr></table></div><div id="nada"></div>'

def _sin_tildes(s):
    import unicodedata
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')

class GuiaSim:
    def __init__(self):
        self.pedidos = []
        self.scba_roto = False
        self.mpba_falla = set()
    def campos(self, body):
        return {k: v[0] for k, v in _parse_qs(body, keep_blank_values=True, encoding='latin-1').items()}
    def organismos(self, method, body):
        if method != 'POST': return _pagina_scba('')            # la Guía real no da resultados por GET
        if self.scba_roto: return _pagina_scba('<p>Página en mantenimiento</p>')
        c = self.campos(body)
        tope = int(c.get('tope') or '25')
        sel = [o for o in ORGANISMOS_SCBA
               if (not c.get('fuero') or c['fuero'] == o[3])
               and (not c.get('asdeptos') or c['asdeptos'] == _sin_tildes(o[4]))]
        if c.get('deptos'): sel = []                              # la app consulta por asiento, no por competencia
        if not sel: return _pagina_scba(SIN_RESULTADOS_HTML)
        return _pagina_scba(_bloques([_ficha_scba(o) for o in sel], tope))
    def personal(self, method, body):
        c = self.campos(body)
        ap = c.get('apellido', '').lower()
        sel = [p for p in PERSONAL_SCBA if ap and ap in _sin_tildes(p[1]).lower() and (not c.get('cargo') or c['cargo'] in ('Juez',))]
        if not sel: return _pagina_scba(SIN_RESULTADOS_HTML)
        filas = ['<tr><td><p>%s<br>%s</p></td><td width="1"></td><td><p>%s</p></td><td width="1"></td><td><p>%s</p></td></tr>' % p for p in sel]
        return _pagina_scba(_bloques(filas, int(c.get('tope') or '25')))
    def mpba(self, path, query):
        q = _parse_qs(query)
        slug = (q.get('department') or [''])[0]
        if path != '/mapa' or not slug: return 404, '<p>no</p>'
        if slug in self.mpba_falla: return 500, '<p>Error</p>'
        return 200, mapa_mpba(slug)
    def atender(self, route, request):
        u = urlparse(request.url)
        body = request.post_data or ''
        self.pedidos.append({'host': u.hostname, 'path': u.path, 'method': request.method, 'body': body, 'query': u.query})
        if u.hostname == 'www.scba.gov.ar':
            html = self.personal(request.method, body) if u.path.endswith('personal.asp') else self.organismos(request.method, body)
            return route.fulfill(status=200, headers=dict(CORS_GUIA, **{'content-type': 'text/html; charset=windows-1252'}), body=html.encode('cp1252', 'replace'))
        status, html = self.mpba(u.path, u.query)
        return route.fulfill(status=status, headers=dict(CORS_GUIA, **{'content-type': 'text/html; charset=utf-8'}), body=html.encode('utf-8'))
    def a(self, host, path=None):
        return [p for p in self.pedidos if p['host'] == host and (path is None or p['path'] == path)]

def _enlace_mp(slug, oficina, nombre):
    return '<div class="col-md-3"><div class="btogrisshadow"><a class="protected-link" href="/mapa?department=%s&amp;office=%s#delegacion"><div class="btn-u">%s</div></a></div></div>' % (slug, oficina, nombre)

def _seccion_mp(t1, t2, partes):
    cuerpo = ''
    for p in partes:
        if isinstance(p, str): cuerpo += '<div><b>%s</b></div>' % p
        else:
            clase, slug, lista = p
            cuerpo += '<div class="%s">%s</div>' % (clase, ''.join(_enlace_mp(slug, o, n) for o, n in lista))
    return ('<div class="accordion-item"><h2 class="accordion-header"><button class="accordion-button"><b><span>%s<br></span><span>%s</span></b></button></h2>'
            '<div class="accordion-collapse collapse"><div class="accordion-body">%s</div></div></div>' % (t1, t2, cuerpo))

def mapa_mpba(slug):
    if slug == 'sanisidro':
        items = [
            _seccion_mp('Unidades', 'Fiscales', [('row', slug, [('2708', 'FISCALIA GENERAL DEPARTAMENTAL'), ('2716', 'UNIDAD FUNCIONAL DE INSTRUCCION Y JUICIO Nº 11'), ('2712', 'UNIDAD FUNCIONAL DE FLAGRANCIA Nº 1')]),
                                                  'Unidades Fiscales Descentralizadas', ('row', slug, [('2777', 'UNIDAD FUNCIONAL DE INSTRUCCION Y JUICIO Nº 11 DESCENTRALIZADA SAN FERNANDO')]),
                                                  'Unidades Fiscales del Fuero de Responsabilidad Penal Juvenil', ('row', slug, [('2758', 'FISCALIA DE RESPONSABILIDAD PENAL JUVENIL Nº 1 DESCENTRALIZADA PILAR')]),
                                                  ('row center-block', slug, [('2767', 'UNIDAD FUNCIONAL DE INSTRUCCION Nº 14 DESCENTRALIZADA PILAR')])]),
            _seccion_mp('Unidades', 'de la Defensa', [('row', slug, [('2743', 'DEFENSORIA GENERAL DEPARTAMENTAL'), ('2722', 'DEFENSORIA CIVIL Nº 3'), ('2737', 'DEFENSORIA DE JUICIO Nº 2 EN LO CORRECCIONAL')])]),
            _seccion_mp('Unidades del', 'Ministerio Público Tutelar', ['Menores e Incapaces Asesores', ('row', slug, [('2749', 'ASESORIA DE INCAPACES Nº 2')]), 'Curadurías', ('row', slug, [('2799', 'CURADURIA OFICIAL DE SAN ISIDRO')])]),
            _seccion_mp('Unidades', 'Casas de Justicia', []),
            _seccion_mp('Unidades', 'Violencia Familiar y de Género', [('row center-block', slug, [('2767', 'UNIDAD FUNCIONAL DE INSTRUCCION Nº 14 DESCENTRALIZADA PILAR')])]),
        ]
    elif slug in ('laplata', 'mardelplata', 'quilmes'):
        n = {'laplata': '3000', 'mardelplata': '3100', 'quilmes': '3200'}[slug]
        items = [_seccion_mp('Unidades', 'Fiscales', [('row', slug, [(n, 'UNIDAD FUNCIONAL DE FLAGRANCIA Nº 1'), (str(int(n) + 1), 'UNIDAD FUNCIONAL DE INSTRUCCION Nº 2')])]),
                 _seccion_mp('Unidades', 'de la Defensa', [('row', slug, [(str(int(n) + 2), 'DEFENSORIA CIVIL Nº 1')])])]
    else:
        items = [_seccion_mp('Unidades', 'Fiscales', [('row', slug, [('4%03d' % (abs(hash(slug)) % 1000), 'FISCALIA GENERAL DEPARTAMENTAL')])])]
    deptos = ''.join('<a href="/mapa?department=%s#deptomb">Departamento Judicial</a>' % s for s in ['avellaneda', 'azul'])
    return '<html><head><meta charset="utf-8"></head><body>%s<div id="deptomb"></div><div class="accordion" id="accordionMapa">%s</div></body></html>' % (deptos, ''.join(items))

def guia(browser):
    """0.9.6: solapa Guía (Guía Judicial de la SCBA y mapa del Ministerio Público)."""
    print('== Guía judicial y Ministerio Público (0.9.6)')
    m = mev_chica()
    g = GuiaSim()
    ctx = contexto(browser, m)
    ctx.route('https://www.scba.gov.ar/**', g.atender)
    ctx.route('https://www.mpba.gov.ar/**', g.atender)
    ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin='https://mev.scba.gov.ar')
    page = abrir(ctx)
    jurisdiccion_antes = len(m.pedidos_a('/POSLoguin.asp'))
    page.click('#mvu [data-t="guia"]')
    cuerpo = "document.querySelector('#mvu [data-e=\"gCuerpo\"]')"
    texto = cuerpo + '.textContent'
    filas = "[...document.querySelectorAll('#mvu [data-e=\"gCuerpo\"] tbody tr')].map((r) => r.cells[0].textContent.trim())"
    def buscar(espera):
        page.click('#mvu section[data-p="guia"] [data-g="buscar"]')
        return esperar(page, espera, 15000)
    def escribir(t):
        page.fill('#mvu [data-e="gTexto"]', t)
    def hasta(cond, ms=5000):
        fin = time.time() + ms / 1000
        while time.time() < fin and not cond(): page.wait_for_timeout(50)
    chequear('G1 la solapa Guía muestra el formulario con siete opciones',
             page.evaluate("document.querySelectorAll('#mvu [data-e=\"gModo\"] option').length") == 7)
    # Organismos de la SCBA
    escribir('civil 5')
    buscar(texto + ".length > 0")
    chequear('G2 sin departamento ni fuero, avisa y no consulta', 'Elegí un departamento' in page.evaluate(texto) and not g.a('www.scba.gov.ar'), page.evaluate(texto))
    page.select_option('#mvu [data-e="gDepto"]', 'sanisidro')
    page.select_option('#mvu [data-e="gFuero"]', 'Civil y Comercial')
    buscar(filas + ".length > 0")
    chequear('G3 civil 5 en San Isidro trae solo el Juzgado Nº 5 (no el 15)', page.evaluate(filas) == ['Juzgado en lo Civil y Comercial Nº 5 - San Isidro'], page.evaluate(filas))
    p = g.a('www.scba.gov.ar', '/guia/organismos.asp')
    cuerpo_post = p[-1]['body'] if p else ''
    chequear('G4 la consulta es un POST con el departamento como asiento y el fuero',
             p and p[-1]['method'] == 'POST' and 'asdeptos=San+Isidro' in cuerpo_post and 'fuero=Civil+y+Comercial' in cuerpo_post and 'deptos=&' in cuerpo_post and 'tope=100' in cuerpo_post and 'buscar=Buscar' in cuerpo_post, cuerpo_post)
    t = page.evaluate(texto)
    chequear('G5 domicilio sin los enlaces de la página, integrantes y correo con enlace',
             'Calle: Ituzaingo Nro: 340 - Piso 4 CP: 1642' in t and 'Ubicar en mapa' not in t and 'Ver turnos' not in t and 'Juez: Dr. Quinto Inventado' in t
             and page.evaluate("!!document.querySelector('#mvu [data-e=\"gCuerpo\"] a[href=\"mailto:jcc5-si@jusbuenosaires.gov.ar\"]')"), t[:600])
    mapa = page.evaluate("document.querySelector('#mvu [data-e=\"gCuerpo\"] a[data-g=\"mapa\"]').href")
    chequear('G5b el mapita abre Google Maps en la ubicación que publica la Guía', mapa == 'https://www.google.com/maps/search/?api=1&query=-34.864%2C-58.5', mapa)
    chequear('G6 más de cuatro integrantes: los demás quedan plegados', page.evaluate("!!document.querySelector('#mvu [data-e=\"gCuerpo\"] details')"))
    page.click('#mvu [data-e="gCuerpo"] [data-g="copiar"]')
    esperar(page, "/copiados/.test(document.querySelector('#mvu [data-e=\"avisoTxt\"]').textContent)", 3000)
    copiado = page.evaluate('navigator.clipboard.readText()')
    chequear('G7 Copiar deja nombre, domicilio e integrantes en el portapapeles',
             copiado.startswith('Juzgado en lo Civil y Comercial Nº 5 - San Isidro') and 'Correo electrónico: jcc5-si@jusbuenosaires.gov.ar' in copiado and 'Juez: Dr. Quinto Inventado' in copiado, copiado)
    n = len(g.a('www.scba.gov.ar'))
    escribir('cámara')
    buscar(filas + ".join('|').indexOf('Cámara') >= 0")
    chequear('G8 otra búsqueda en el mismo departamento y fuero no vuelve a consultar', len(g.a('www.scba.gov.ar')) == n and page.evaluate(filas) == ['Cámara de Apelación en lo Civil y Comercial - San Isidro'], page.evaluate(filas))
    page.click('#mvu [data-e="gCuerpo"] [data-g="actualizar"]')
    hasta(lambda: len(g.a('www.scba.gov.ar')) == n + 1)
    esperar(page, filas + ".length === 1", 5000)
    chequear('G9 Actualizar vuelve a consultar', len(g.a('www.scba.gov.ar')) == n + 1)
    page.select_option('#mvu [data-e="gDepto"]', '')
    page.select_option('#mvu [data-e="gFuero"]', '')
    escribir('civil 5 morón')
    buscar(filas + ".join('|').indexOf('Morón') >= 0")
    ult = g.a('www.scba.gov.ar')[-1]['body']
    chequear('G10 el departamento escrito en el texto se usa, sin acentos', 'asdeptos=Moron&' in ult and page.evaluate(filas) == ['Juzgado en lo Civil y Comercial Nº 5 - Morón'], [ult, page.evaluate(filas)])
    escribir('zzz')
    page.select_option('#mvu [data-e="gDepto"]', 'necochea')
    buscar(texto + ".indexOf('Sin resultados') >= 0")
    chequear('G11 sin resultados de la Guía: lo dice, sin error', 'Sin resultados con esos datos' in page.evaluate(texto) and 'no respondió' not in page.evaluate(texto), page.evaluate(texto))
    g.scba_roto = True
    page.select_option('#mvu [data-e="gDepto"]', 'azul')
    buscar(texto + ".indexOf('no respondió como se esperaba') >= 0")
    chequear('G12 si la página cambia, avisa que no respondió como se esperaba', 'no respondió como se esperaba' in page.evaluate(texto), page.evaluate(texto))
    g.scba_roto = False
    chequear('G13 nunca consulta la Guía de la SCBA por GET', all(x['method'] == 'POST' for x in g.a('www.scba.gov.ar')))
    escribir('texto sin buscar')
    page.click('#mvu [data-t="causas"]')
    page.click('#mvu [data-t="guia"]')
    chequear('G13b al volver a la solapa se conserva lo escrito', page.evaluate("document.querySelector('#mvu [data-e=\"gTexto\"]').value") == 'texto sin buscar'
             and page.evaluate("document.querySelector('#mvu [data-e=\"gDepto\"]').value") == 'azul')
    # Magistrados y funcionarios
    page.select_option('#mvu [data-e="gModo"]', 'per')
    escribir('Pérez')
    page.select_option('#mvu [data-e="gCargo"]', 'Juez')
    buscar(filas + ".length === 2")
    ult = g.a('www.scba.gov.ar', '/guia/personal.asp')[-1]['body'] if g.a('www.scba.gov.ar', '/guia/personal.asp') else ''
    chequear('G14 personal: POST con el apellido sin acentos y el cargo', 'apellido=Perez&' in ult and 'cargo=Juez&' in ult, ult)
    chequear('G15 personal: cargo y nombre de cada persona', page.evaluate(filas) == ['JuezaDra. Laura Inventada Pérez', 'JuezDr. Pablo Pérez Marcote'], page.evaluate(filas))
    mapa = page.evaluate("document.querySelector('#mvu [data-e=\"gCuerpo\"] a[data-g=\"mapa\"]').href")
    chequear('G15b el mapita de una persona busca el domicilio en Google Maps', mapa == 'https://www.google.com/maps/search/?api=1&query=Belgrano%201140%2C%20BRAGADO%2C%20Provincia%20de%20Buenos%20Aires', mapa)
    page.click('#mvu [data-e="gCuerpo"] tbody tr:nth-child(1) [data-g="verOrg"]')
    esperar(page, filas + ".length > 0 && document.querySelector('#mvu [data-e=\"gModo\"]').value === 'org'", 8000)
    ult = g.a('www.scba.gov.ar')[-1]['body']
    chequear('G16 el organismo de una persona lleva a sus datos, en su departamento y su partido (el juzgado de paz de Bragado, no el de Alberti)',
             page.evaluate("document.querySelector('#mvu [data-e=\"gDepto\"]').value") == 'mercedes' and 'asdeptos=Mercedes&' in ult and page.evaluate(filas) == ['Juzgado de Paz - BRAGADO'],
             [ult, page.evaluate(filas)])
    # Ministerio Público
    page.select_option('#mvu [data-e="gModo"]', 'fis')
    escribir('')
    page.select_option('#mvu [data-e="gDepto"]', 'sanisidro')
    buscar(filas + ".length > 0")
    chequear('G17 fiscalías de San Isidro: las seis, sin repetir la de violencia', len(page.evaluate(filas)) == 6, page.evaluate(filas))
    t = page.evaluate(texto)
    chequear('G18 con sección, subgrupo y marca de violencia', 'Unidades Fiscales Descentralizadas' in t and 'Fuero de Responsabilidad Penal Juvenil' in t and 'Violencia familiar y de género' in t, t[:500])
    seccion_ufi14 = page.evaluate("[...document.querySelectorAll('#mvu [data-e=\"gCuerpo\"] tbody tr')].filter((r) => /Nº 14/.test(r.cells[0].textContent)).map((r) => r.cells[1].textContent.trim())")
    chequear('G18b la fila sin rótulo (center-block) no hereda el subgrupo anterior', seccion_ufi14 == ['Unidades Fiscales'], seccion_ufi14)
    page.select_option('#mvu [data-e="gModo"]', 'mp')
    escribir('')
    buscar(filas + ".length > 6")
    chequear('G18c todo el Ministerio Público del departamento, sin repetir la UFI de violencia', len(page.evaluate(filas)) == 11, page.evaluate(filas))
    page.select_option('#mvu [data-e="gModo"]', 'fis')
    escribir('UFI 14')
    buscar(filas + ".length === 1")
    chequear('G19 UFI 14 encuentra la Unidad Funcional de Instrucción Nº 14', page.evaluate(filas) == ['UNIDAD FUNCIONAL DE INSTRUCCION Nº 14 DESCENTRALIZADA PILARViolencia familiar y de género'], page.evaluate(filas))
    guardado = gm(page, 'mu.guia.mpba.sanisidro')
    guardado = json.loads(guardado) if isinstance(guardado, str) else guardado
    chequear('G20 el listado del departamento queda guardado', guardado and len(guardado.get('fichas', [])) == 12 and guardado.get('ts'), guardado and len(guardado.get('fichas', [])))
    n = len(g.a('www.mpba.gov.ar'))
    page.select_option('#mvu [data-e="gModo"]', 'def')
    escribir('civil 3')
    buscar(filas + ".length === 1")
    chequear('G21 defensorías del mismo departamento sin volver a pedir la página', len(g.a('www.mpba.gov.ar')) == n and page.evaluate(filas) == ['DEFENSORIA CIVIL Nº 3'], page.evaluate(filas))
    with ctx.expect_page() as nueva:
        page.click('#mvu [data-e="gCuerpo"] [data-g="abrirMP"]')
    mapa = page.evaluate("document.querySelector('#mvu [data-e=\"gCuerpo\"] a[data-g=\"mapa\"]').href")
    chequear('G21b en el Ministerio Público, el mapita busca por nombre y departamento', mapa == 'https://www.google.com/maps/search/?api=1&query=DEFENSORIA%20CIVIL%20N%C2%BA%203%2C%20Departamento%20Judicial%20San%20Isidro%2C%20Provincia%20de%20Buenos%20Aires', mapa)
    chequear('G22 Ver en el MPBA abre la página del departamento', nueva.value.url == 'https://www.mpba.gov.ar/mapa?department=sanisidro#deptomb', nueva.value.url)
    nueva.value.close()
    page.bring_to_front()
    n = len(g.a('www.mpba.gov.ar'))          # la pestaña nueva también pidió la página
    page.click('#mvu [data-e="gCuerpo"] [data-g="actualizar"]')
    hasta(lambda: len(g.a('www.mpba.gov.ar')) == n + 1)
    esperar(page, filas + ".length === 1", 5000)
    chequear('G23 Actualizar vuelve a leer el departamento', len(g.a('www.mpba.gov.ar')) == n + 1)
    page.select_option('#mvu [data-e="gModo"]', 'fis')
    page.select_option('#mvu [data-e="gDepto"]', '')
    escribir('flagrancia la plata')
    buscar(filas + ".length > 0")
    pedidos = [x['query'] for x in g.a('www.mpba.gov.ar')[n + 1:]]
    chequear('G24 "la plata" en el texto: solo La Plata, sin Mar del Plata', pedidos == ['department=laplata'] and page.evaluate(filas) == ['UNIDAD FUNCIONAL DE FLAGRANCIA Nº 1'] and 'La Plata' in page.evaluate(texto) and 'Mar del Plata' not in page.evaluate(texto), [pedidos, page.evaluate(filas)])
    # Vigencia del listado guardado: más de siete días se vuelve a leer; si no se puede, se usa el guardado con un aviso.
    viejo = int(time.time() * 1000) - 8 * 24 * 3600 * 1000
    guardada = {'id': '9', 'nombre': 'UNIDAD FUNCIONAL DE INSTRUCCION GUARDADA Nº 9', 'tipo': 'fis', 'depto': 'junin', 'grupo': ''}
    gm_set(page, 'mu.guia.mpba.junin', {'ts': viejo, 'fichas': [guardada]})
    gm_set(page, 'mu.guia.mpba.pergamino', {'ts': viejo, 'fichas': [dict(guardada, depto='pergamino')]})
    escribir('')
    page.select_option('#mvu [data-e="gDepto"]', 'junin')
    antes = len(g.a('www.mpba.gov.ar'))
    buscar(filas + ".join('|').indexOf('FISCALIA GENERAL') >= 0")
    chequear('G24b un listado guardado hace más de siete días se vuelve a leer', len(g.a('www.mpba.gov.ar')) == antes + 1 and page.evaluate(filas) == ['FISCALIA GENERAL DEPARTAMENTAL'], page.evaluate(filas))
    g.mpba_falla = {'pergamino'}
    page.select_option('#mvu [data-e="gDepto"]', 'pergamino')
    buscar(filas + ".join('|').indexOf('GUARDADA') >= 0")
    chequear('G24c si no se puede releer, usa el guardado y lo avisa', page.evaluate(filas) == ['UNIDAD FUNCIONAL DE INSTRUCCION GUARDADA Nº 9'] and 'Pergamino: no se pudo actualizar' in page.evaluate(texto), page.evaluate(texto)[:300])
    page.select_option('#mvu [data-e="gDepto"]', '')
    g.mpba_falla = {'azul'}
    escribir('flagrancia')
    buscar(texto + ".indexOf('coincidencia') >= 0")
    t = page.evaluate(texto)
    leidos = sorted(set(x['query'] for x in g.a('www.mpba.gov.ar')))
    chequear('G25 en todos los departamentos: lee los veinte y sigue aunque uno falle',
             len(leidos) == 20 and 'Azul: no se pudo leer' in t and len(page.evaluate(filas)) == 4, [len(leidos), t[:300], page.evaluate(filas)])
    # Fiscalía de Estado
    n = len(g.pedidos)
    page.select_option('#mvu [data-e="gModo"]', 'fe')
    chequear('G26 Fiscalía de Estado: enlace al sitio, sin consultas',
             page.evaluate("!!document.querySelector('#mvu [data-e=\"gCuerpo\"] a[href=\"https://www2.fepba.gov.ar/\"]')") and len(g.pedidos) == n
             and page.evaluate("document.querySelector('#mvu [data-e=\"gCampos\"]').style.display") == 'none')
    chequear('G27 la Guía no cambia la jurisdicción de la MEV ni toca páginas prohibidas', len(m.pedidos_a('/POSLoguin.asp')) == jurisdiccion_antes and not m.prohibidos())
    chequear('G28 sin errores de programa', not errores(page), errores(page))
    ctx.close()


def plural_es(n, uno, varios):
    return '%d %s' % (n, uno if n == 1 else varios)

def listado_como_supjn(browser):
    # 0.9.9: el listado de Mis causas con la disposición de SuPJN+ y las
    # fechas en placas de color según su antigüedad.
    print('== listado con la disposición de SuPJN+ y fechas en placas (0.9.9)')
    import datetime
    hoy = datetime.date.today()
    dd = lambda d: d.strftime('%d/%m/%Y')
    m = mev_chica()
    cs = {c.nid: c for c in m.causas_todas()}
    cs['1002'].ult = dd(hoy + datetime.timedelta(days=1))      # posterior a hoy: como la del día
    cs['1003'].ult = dd(hoy)
    cs['1004'].ult = dd(hoy - datetime.timedelta(days=7))      # siete días: azul
    cs['1005'].ult = dd(hoy - datetime.timedelta(days=8))      # ocho días: naranja
    cs['1006'].estado = 'Archivado'
    cs['1007'].estado = 'Paralizado'
    cs['1008'].estado = 'Fuera del Organismo'
    ctx = contexto(browser, m)
    page = abrir(ctx)
    leer_causas(page, 'completa')
    S = '#mvu section[data-p="causas"] '
    chequear('L1 la búsqueda está en la barra de Mis causas y no en la barra de título', page.evaluate("!!document.querySelector('#mvu section[data-p=\"causas\"] .lbarra [data-e=\"buscar\"]') && !document.querySelector('#mvu .bar [data-e=\"buscar\"]')"))
    orden = page.evaluate("[...document.querySelector('#mvu section[data-p=\"causas\"] .lbarra').children].map((e) => e.dataset.e || e.className)")
    chequear('L2 la barra tiene la búsqueda primero y Exportar y Columnas a la derecha', orden[0] == 'buscar' and orden[-1] == 'der', orden)
    chequear('L3 renglón de estado, barra de la selección, tabla y pie, en ese orden', page.evaluate("[...document.querySelector('#mvu section[data-p=\"causas\"]').children].map((e) => e.className).join(',')") == 'lbarra,lest,lacc,envoltura,lpie')
    fondo = page.evaluate("getComputedStyle(document.querySelector('#mvu section[data-p=\"causas\"] table.grid th[data-c=\"caratula\"]')).backgroundColor")
    chequear('L4 la cabecera de la tabla va en el verde de la ventana, con letra blanca', fondo == 'rgb(13, 74, 43)', fondo)
    flechas = page.evaluate("[...document.querySelectorAll('#mvu section[data-p=\"causas\"] table.grid th')].filter((t) => t.querySelector('.fl')).length")
    chequear('L5 todas las columnas que se ordenan muestran su flecha', flechas >= 10, flechas)
    tit = page.evaluate("[...document.querySelectorAll('#mvu section[data-p=\"causas\"] table.grid th[data-c]')].map((t) => t.dataset.c).filter((x) => x !== 'sel' && x !== 'acc')")
    chequear('L6 orden de columnas como en SuPJN+: número, receptoría, etiquetas, organismo, departamento, carátula, partes, estado, fecha', tit[:9] == ['expediente', 'receptoria', 'etiquetas', 'organismo', 'depto', 'caratula', 'partes', 'estado', 'ultFecha'], tit)
    def placa(nid, col):
        return page.evaluate("(([n, c]) => { const tr = [...document.querySelectorAll('#mvu section[data-p=\"causas\"] tbody tr[data-k]')].find((r) => r.dataset.k.startsWith(n + '|')); const e = tr && tr.querySelector('td[data-c=\"' + c + '\"] .' + (c === 'estado' ? 'placa' : 'fh')); return e ? e.className + '|' + e.textContent : ''; })", [nid, col])
    page.select_option(S.strip() + ' [data-e="pp"]', '50')
    chequear('L7 fecha posterior a hoy: placa verde, con el mismo texto', placa('1002', 'ultFecha') == 'fh hoy|' + dd(hoy + datetime.timedelta(days=1)), placa('1002', 'ultFecha'))
    chequear('L8 fecha de hoy: placa verde', placa('1003', 'ultFecha').startswith('fh hoy|'), placa('1003', 'ultFecha'))
    chequear('L9 siete días atrás: placa azul', placa('1004', 'ultFecha').startswith('fh semana|'), placa('1004', 'ultFecha'))
    chequear('L10 ocho días atrás: placa naranja', placa('1005', 'ultFecha').startswith('fh vieja|'), placa('1005', 'ultFecha'))
    est = page.evaluate("[getComputedStyle(document.querySelector('#mvu .fh')).color, getComputedStyle(document.querySelector('#mvu .fh')).fontSize, getComputedStyle(document.querySelector('#mvu .fh')).fontWeight].join('|')")
    chequear('L11 la placa de fecha lleva letra blanca, en negrita, de 14,5 píxeles', est == 'rgb(255, 255, 255)|14.5px|700', est)
    colores = [placa('1001', 'estado'), placa('1006', 'estado'), placa('1007', 'estado'), placa('1008', 'estado')]
    chequear('L12 estado en placa: en trámite verde, archivado gris, paralizado rojo, otro azul', [x.split('|')[0] for x in colores] == ['placa verde', 'placa gris', 'placa rojo', 'placa azul'], colores)
    ancho = page.evaluate("(() => { const e = document.querySelector('#mvu section[data-p=\"causas\"] td[data-c=\"ultFecha\"] .fh'); const td = e.closest('td'); return [e.getBoundingClientRect().right <= td.getBoundingClientRect().right + 0.5, Math.round(td.getBoundingClientRect().width)]; })()")
    chequear('L13 la placa de la fecha entra entera en su columna', ancho[0], ancho)
    partes = page.evaluate("(() => { const tr = [...document.querySelectorAll('#mvu section[data-p=\"causas\"] tbody tr[data-k]')].find((r) => r.dataset.k.startsWith('1009|')); return tr.querySelector('td[data-c=\"partes\"]').innerHTML; })()")
    chequear('L14 partes con el rol adelante', '<span class="rol">Actora:</span> DIAZ ROSA' in partes and '<span class="rol">Demandada:</span> SUAREZ JOSE' in partes, partes)
    bts = page.evaluate("[...document.querySelector('#mvu section[data-p=\"causas\"] tbody tr[data-k] td[data-c=\"acc\"]').querySelectorAll('button')].map((b) => b.dataset.a)")
    chequear('L15 botones de la fila: Abrir, pestaña nueva, bajar y más', bts == ['abrir', 'nuevaPestana', 'bajar', 'menu'], bts)
    with ctx.expect_page() as nueva:
        page.click(S + 'tbody tr[data-k] [data-a="nuevaPestana"]')
    np_ = nueva.value
    chequear('L16 la flecha abre la causa en la MEV en una pestaña nueva', 'procesales.asp?nidCausa=' in np_.url, np_.url)
    np_.close()
    acc = page.inner_text('#mvu [data-e="accCausas"]')
    chequear('L17 sin selección: "Ninguna seleccionada" y los botones apagados', acc.startswith('Ninguna seleccionada') and page.evaluate("[...document.querySelectorAll('#mvu [data-e=\"accCausas\"] button')].every((b) => b.disabled)"), acc)
    page.click(S + 'tbody tr[data-k] [data-a="sel"]')
    chequear('L18 con una seleccionada: Bajar, Elegir actuaciones y Quitar selección se encienden', page.inner_text('#mvu [data-e="accCausas"]').startswith('1 seleccionada') and page.evaluate("[...document.querySelectorAll('#mvu [data-e=\"accCausas\"] button')].every((b) => !b.disabled)"))
    page.click('#mvu [data-e="elegirSel"]')
    ok = esperar(page, "document.querySelector('#mvu section[data-p=\"exp\"]').classList.contains('on')", 8000)
    chequear('L19 Elegir actuaciones abre la causa seleccionada', ok)
    esperar(page, "!!document.querySelector('#mvu section[data-p=\"exp\"] td[data-c=\"fecha\"] .fh')", 10000)
    fx = page.evaluate("document.querySelector('#mvu section[data-p=\"exp\"] td[data-c=\"fecha\"] .fh') ? document.querySelector('#mvu section[data-p=\"exp\"] td[data-c=\"fecha\"] .fh').className : ''")
    chequear('L20 dentro de la causa, la fecha de las actuaciones va en placa', fx.startswith('fh '), fx)
    page.click('#mvu .tabs button[data-t="causas"]')
    page.click('#mvu [data-e="selNada"]')
    chequear('L21 Quitar selección vacía la selección', page.inner_text('#mvu [data-e="accCausas"]').startswith('Ninguna seleccionada'))
    page.fill('#mvu [data-e="buscar"]', 'sucesion')
    esperar(page, "/filtro puesto/.test(document.querySelector('#mvu [data-e=\"infoCausas\"]').textContent)", 3000)
    info = page.inner_text('#mvu [data-e="infoCausas"]')
    chequear('L22 el renglón de estado avisa el filtro puesto, en el mismo renglón de la cuenta', 'hay un filtro puesto: búsqueda' in info and info.startswith('8 de'), info)
    page.click('#mvu [data-e="fQuitar"]')
    esperar(page, "!/filtro puesto/.test(document.querySelector('#mvu [data-e=\"infoCausas\"]').textContent)", 3000)
    chequear('L23 Quitar los filtros los quita y borra la búsqueda', page.input_value('#mvu [data-e="buscar"]') == '' and 'filtro' not in page.inner_text('#mvu [data-e="infoCausas"]'))
    page.select_option('#mvu [data-e="pp"]', '5')
    pie = page.inner_text('#mvu [data-e="pag"]')
    chequear('L24 el pie dice qué se muestra y el tamaño de página', 'Mostrando 1 a 5 de 15' in pie and '5 por página' in pie, pie)
    page.click('#mvu [data-e="pag"] button[data-pg="1"]')
    chequear('L25 el paginado avanza', 'Mostrando 6 a 10 de 15' in page.inner_text('#mvu [data-e="pag"]'))
    page.click('#mvu [data-e="cols"]')
    chequear('L26 la columna Novedad puede volver a mostrarse desde Columnas', page.evaluate("!!document.querySelector('#mvu-pop input[data-c=\"nuevo\"]')"))
    page.keyboard.press('Escape')
    chequear('L27 sin errores de programa', not errores(page), errores(page))
    ctx.close()
    # Una preferencia anterior a la 0.9.9 (columnas reordenadas y Partes oculta)
    # pasa una sola vez a la disposición de SuPJN+.
    m2 = mev_chica()
    ctx = contexto(browser, m2)
    page = abrir(ctx)
    leer_causas(page, 'completa')
    gm_set(page, 'mu.pref', {'columnas': ['caratula', 'organismo', 'expediente'], 'ocultas': ['partes', 'inicio', 'sets'], 'anchos': {'caratula': 600}, 'receptoriaVisible': True})
    page.reload(); page.wait_for_selector('#mvu', state='attached'); page.wait_for_timeout(600)
    tit = page.evaluate("[...document.querySelectorAll('#mvu section[data-p=\"causas\"] table.grid th[data-c]')].map((t) => t.dataset.c)")
    p = gm(page, 'mu.pref'); p = json.loads(p) if isinstance(p, str) else p
    chequear('L28 una configuración anterior pasa una vez a la disposición nueva, con Partes a la vista', tit[1:3] == ['expediente', 'receptoria'] and 'partes' in tit and p.get('listadoSupjn') is True and not p.get('anchos'), (tit, p))
    p['columnas'] = ['caratula'] + [x for x in tit if x != 'caratula']
    gm_set(page, 'mu.pref', p)
    page.reload(); page.wait_for_selector('#mvu', state='attached'); page.wait_for_timeout(600)
    tit2 = page.evaluate("[...document.querySelectorAll('#mvu section[data-p=\"causas\"] table.grid th[data-c]')].map((t) => t.dataset.c)")
    chequear('L29 después de esa vez, el orden que elija el usuario se respeta', tit2[0] == 'caratula', tit2)
    chequear('L30 sin errores de programa al recargar', not errores(page), errores(page))
    ctx.close()


PRUEBAS = [arranque, lectura, pausa_y_retomar, sesion_vencida, freno, buscar_persona, latido, cuentas, marcas_y_respaldo, tabla, expediente, candado, lectura_por_partes, marco_de_descarga, tiempo_de_sesion, descarga_con_sesion_vencida, juris_cambiada, indices, indice_actuaciones, departamento_sin_causas, enlaces_de_actuacion, motor_pdf, motor_errores, motor_cancelar, motor_montaje_vencido, lectura_con_429, busqueda_con_sesion_vencida, busqueda_formato_real, lectura_varios_deptos, motor_validacion, descarga_con_validacion, ventanita_de_verificacion, panel_de_departamentos, fechas_como_supjn, guia, listado_como_supjn, lectura_sola, medir]

def main():
    elegidas = [a for a in sys.argv[1:] if not a.startswith('--')]
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for fn in PRUEBAS:
            if elegidas and fn.__name__ not in elegidas: continue
            try:
                fn(browser)
            except Exception as e:
                FALLAS.append(fn.__name__ + ': excepción ' + repr(e)[:300]); print('   EXCEPCIÓN', fn.__name__, repr(e)[:300])
        browser.close()
    print('\n%d chequeos en verde, %d fallas' % (OK[0], len(FALLAS)))
    for f in FALLAS: print(' - ' + f)
    sys.exit(1 if FALLAS else 0)

if __name__ == '__main__':
    main()
