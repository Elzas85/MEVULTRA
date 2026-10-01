# Banco de pruebas de SADE+.
#
# Simula las pantallas del Expediente Electrónico (buzón de tareas y
# expediente abierto en ventana propia) y de GEDO con Playwright, con la misma
# estructura de ZK que la herramienta lee (grillas .z-listbox reconocidas por
# el título de sus cabeceras, encabezado común .module-header), y corre el
# userscript como lo haría Tampermonkey. No toca el sistema real.
#
# Uso:  python3 banco.py                 (prueba ../sade-plus.user.js)
#       SADE_SCRIPT=ruta python3 banco.py (prueba otro archivo)
#
# El almacén de Tampermonkey se simula sobre localStorage; los encargos entre
# pestañas, que en el sistema real cruzan de un módulo a otro (subdominios
# distintos), viajan en una cookie del dominio común, como lo haría el
# almacén compartido de Tampermonkey.
#
# Los tiempos del programa (latido de sesión, plazos de los encargos) se
# acortan para que el banco corra en segundos; cada acortamiento exige que el
# texto original esté en el archivo.
import base64, json, os, re, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

RAIZ = Path(__file__).resolve().parent.parent
RUTA_SCRIPT = Path(os.environ.get('SADE_SCRIPT') or (RAIZ / 'sade-plus.user.js'))
ORIGINAL = RUTA_SCRIPT.read_text(encoding='utf-8')
USUARIO = 'KINBAUMI'
OTRO = 'PEREZJ'
EE = 'https://eue-pr.apps.buenosaires.gob.ar/expedientes-web/'
GEDO = 'https://eut-pr.apps.buenosaires.gob.ar/gedo-web/'
CCOO = 'https://euc-pr.apps.buenosaires.gob.ar/ccoo-web/'

ACORTES = [
    ('const CADA_LATIDO = 5 * 60 * 1000;', 'const CADA_LATIDO = 300;'),
    ('const LATIDO_SI_ACTIVO = 15 * 60 * 1000;', 'const LATIDO_SI_ACTIVO = 1500;'),
]

def acortar(src):
    for antes, despues in ACORTES:
        n = src.count(antes)
        if n != 1:
            raise SystemExit('El banco esperaba encontrar una vez "%s" y lo encontró %d veces: hay que actualizar los acortamientos.' % (antes, n))
        src = src.replace(antes, despues)
    return src

SCRIPT = acortar(ORIGINAL)

ENVOLTORIO = r"""
(() => {
  if (!/apps\.buenosaires\.gob\.ar$/.test(location.hostname)) return;
  const COMP = 'sade.plus.encargos';
  const galleta = () => { const m = document.cookie.match(/(?:^|; )gmcomp=([^;]*)/); try { return m ? JSON.parse(decodeURIComponent(m[1])) : {}; } catch (e) { return {}; } };
  const oyentes = [];
  window.GM_getValue = (k, d) => {
    if (k.indexOf(COMP) === 0) { const o = galleta(); return (k in o && o[k] != null) ? o[k] : d; }
    const v = localStorage.getItem('gm:' + k); return v == null ? d : v;
  };
  window.GM_setValue = (k, v) => {
    if (k.indexOf(COMP) === 0) { const o = galleta(); o[k] = v; document.cookie = 'gmcomp=' + encodeURIComponent(JSON.stringify(o)) + '; domain=.apps.buenosaires.gob.ar; path=/; secure'; return; }
    localStorage.setItem('gm:' + k, v);
  };
  window.GM_deleteValue = (k) => { localStorage.removeItem('gm:' + k); };
  window.GM_addValueChangeListener = (k, fn) => { oyentes.push([k, fn]); return oyentes.length; };
  window.addEventListener('storage', (e) => {
    if (!e.key || !e.key.startsWith('gm:')) return;
    const k = e.key.slice(3);
    oyentes.forEach(([kk, fn]) => { if (kk === k) { try { fn(k, e.oldValue, e.newValue, true); } catch (x) { window.__errores.push('oyente: ' + x.message); } } });
  });
  window.unsafeWindow = window;
  window.__errores = [];
  window.__clics = [];
  window.addEventListener('error', (e) => window.__errores.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => window.__errores.push('promesa: ' + String(e.reason && e.reason.message || e.reason)));
  const correr = () => {
__SCRIPT__
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', correr); else correr();
})();
""".replace('__SCRIPT__', SCRIPT)

# ---------------------------------------------------------------- réplicas
CSS_ZK = ('.z-listbox{display:block}.z-listhead,.z-listitem{display:table-row}.z-listheader,.z-listcell{display:table-cell;padding:3px 6px;white-space:nowrap;max-width:160px;overflow:hidden;text-overflow:ellipsis}'
          '.z-listbox table{width:100%;border-collapse:collapse}.z-window{position:absolute;left:60px;top:60px;width:1200px;background:#fff;border:2px solid #888;padding:10px;z-index:5}'
          '.z-comboitem{display:block;cursor:pointer}.module-header{background:#38485c;color:#fff;padding:6px}.texto-header-unificado{margin:0 8px}')

def cabecera(usuario, modulo='Expediente Electrónico', extra_usuario=None):
    u = '<span class="texto-header-unificado">%s</span>' % usuario if usuario else ''
    otro = '<span class="texto-header-unificado">%s</span>' % extra_usuario if extra_usuario else ''
    return ('<div class="module-header"><span class="texto-header-unificado">%s</span>%s%s'
            '<span class="texto-header-unificado"><b>Módulos</b></span>'
            '<a title="Salir" href="javascript:void(0)" onclick="window.__clics.push(\'salir\')">Salir</a></div>' % (modulo, u, otro))

def celda(texto, title=None, extra=''):
    t = ' title="%s"' % title if title else ''
    return '<td class="z-listcell"%s%s>%s</td>' % (t, extra, texto)

BUZON_COLS = ['Tarea/Estado', 'Fecha Ult. Modif.', 'Número Expediente', 'Código Trámite', 'Descripción del Trámite', 'Motivo Pase', 'Motivo Caratulación', 'Usuario Anterior', 'Acciones']

def fila_buzon(f):
    acciones = ''.join('<div class="z-comboitem" onclick="window.__clics.push(\'%s:%s\')">%s</div>' % (f['exp'], a, a) for a in f.get('acciones', ['Tramitar']))
    return ('<tr class="z-listitem">' + celda(f['estado']) + celda(f['fecha']) + celda(f['exp']) + celda(f['cod']) +
            celda(f['des'][:20] + '...', f['des']) + celda(f['pase'][:20] + ('...' if len(f['pase']) > 20 else ''), f['pase']) +
            celda(f['mot'][:20] + ('...' if len(f['mot']) > 20 else ''), f['mot']) +
            celda(f['usu'], 'Haga click aquí para ver los datos del usuario') +
            '<td class="z-listcell"><div class="z-combobox">' + acciones + '</div></td></tr>')

FILAS_BUZON = [
    {'estado': 'Iniciación', 'fecha': '22/09/2026 10:15', 'exp': 'EX-2026-13262731- -GCABA-PG', 'cod': 'PG000101A', 'des': 'INMUEBLES SUCESION HERENCIA VACANTE', 'pase': 'Para su tramitación', 'mot': 'PRESUNTA HV DE MANICO TEODORA', 'usu': 'GOMEZL', 'acciones': ['Tramitar']},
    {'estado': 'Tramitación', 'fecha': '21/09/2026 16:40', 'exp': 'EX-2026-13000001- -GCABA-PG', 'cod': 'GENE3401A', 'des': 'OFICIO JUDICIAL', 'pase': 'Se remite', 'mot': 'DESALOJO PEREZ C/ LOPEZ', 'usu': 'DIAZM', 'acciones': ['Adquirir']},
    {'estado': 'Tramitación', 'fecha': '20/09/2026 09:00', 'exp': 'EX-2026-12999999- -GCABA-PG', 'cod': 'PG000203A', 'des': 'LIQUIDACION DE CONDENAS JUDICIALES', 'pase': 'Pase', 'mot': 'HEREDEROS DE BOURREN MARIA ROSA C/ VILAS GERARDO S/ ESCRITURACION (36655-2014) [Pcia. de Bs. As., J.1ºCiv.Co. Num 12 Sec -]', 'usu': 'SUAREZR', 'acciones': ['Tramitar', 'Adquirir']},
]

def buzon_html(usuario=USUARIO, filas=None, extra_usuario=None, con_ventana=False):
    filas = FILAS_BUZON if filas is None else filas
    grilla = ('<div class="z-listbox"><table><thead class="z-listhead"><tr class="z-listhead">' +
              ''.join('<th class="z-listheader">%s</th>' % c for c in BUZON_COLS) + '</tr></thead><tbody class="z-listbox-body">' +
              ''.join(fila_buzon(f) for f in filas) + '</tbody></table></div>')
    ventana = ventana_docs_html() if con_ventana else ''
    return ('<!doctype html><html><head><meta charset="utf-8"><style>' + CSS_ZK + '</style></head><body>' + cabecera(usuario, extra_usuario=extra_usuario) +
            '<h3>Buzón de Tareas</h3><div>Consulta rápida: <input type="text" value="EX-2026-13262731- -GCABA-PG" title="Último expediente consultado"></div>' + grilla + '<div class="z-paging">1 / 1</div>' + ventana + '</body></html>')

DOC_COLS = ['Orden', 'Tipo de Documento', 'Número Documento', 'Referencia', 'Fecha de Asociación', 'Fecha de Creación', 'Acción']
DOCS = [
    {'orden': '1', 'tipo': 'PV - CARATULA EXPEDIENTE', 'num': 'PV-2026-13262740- -GCABA-PG', 'ref': 'Carátula', 'aso': '10/09/2026', 'cre': '10/09/2026'},
    {'orden': '2', 'tipo': 'IF - FORMULARIO DE DENUNCIA HERENCIA VACANTE', 'num': 'IF-2026-13262760- -GCABA-PG', 'ref': 'DENUNCIA MANICO TEODORA', 'aso': '10/09/2026', 'cre': '10/09/2026'},
    {'orden': '3', 'tipo': 'PV - PASE', 'num': 'PV-2026-13300000- -GCABA-PG', 'ref': 'Pase', 'aso': '15/09/2026', 'cre': '15/09/2026'},
    {'orden': '4', 'tipo': 'NO - NOTA', 'num': 'NO-2026-13400000- -GCABA-PG', 'ref': 'S/ EX-2025-45258294- -GCABA-DGAPEN solicita informe', 'aso': '22/09/2026', 'cre': '22/09/2026'},
]

def ventana_docs_html(expediente='EX-2026-12999999- -GCABA-PG'):
    filas = ''.join('<tr class="z-listitem">' + celda(d['orden']) + celda(d['tipo']) + celda(d['num']) + celda(d['ref'][:20] + ('...' if len(d['ref']) > 20 else ''), d['ref']) + celda(d['aso']) + celda(d['cre']) +
                    '<td class="z-listcell"><a title="Visualizar documento." href="javascript:void(0)" onclick="window.__clics.push(\'ver:%s\')">V</a> '
                    '<a title="Descargar el documento a su disco local." href="javascript:void(0)" onclick="window.__clics.push(\'bajar:%s\')">D</a> '
                    '<a title="Más Datos" href="javascript:void(0)" onclick="window.__clics.push(\'datos:%s\')">M</a></td></tr>' % (d['num'], d['num'], d['num']) for d in DOCS)
    return ('<div class="z-window z-window-overlapped"><div class="z-window-header">Expediente</div>'
            '<div>Número: <input type="text" value="%s" readonly> Estado: <span>Tramitación</span></div>'
            '<div class="z-listbox"><table><thead class="z-listhead"><tr class="z-listhead">' % expediente +
            ''.join('<th class="z-listheader">%s</th>' % c for c in DOC_COLS) + '</tr></thead><tbody class="z-listbox-body">' + filas + '</tbody></table></div><div class="z-paging"><input value="1"> / 1</div></div>')

GEDO_COLS = ['Nombre tarea', 'Fecha últ. modif.', 'Enviado por', 'Referencia', 'Tipo doc.', 'Acciones']
GEDO_FILAS = [
    {'tarea': 'Confeccionar Documento', 'fecha': '22/09/2026', 'env': 'GOMEZL', 'ref': 'OPINIÓN LETRADA EX-2026-13262731- -GCABA-PG', 'tipo': 'IF', 'acc': ['Ejecutar', 'Adquirir tarea', 'Ver historial']},
    {'tarea': 'Revisar Documento', 'fecha': '21/09/2026', 'env': 'DIAZM', 'ref': 'LISTADO DE BIENES', 'tipo': 'IF', 'acc': ['Ejecutar', 'Eliminar tarea']},
]

def gedo_html(usuario=USUARIO):
    filas = ''.join('<tr class="z-listitem">' + celda(f['tarea']) + celda(f['fecha']) + celda(f['env']) + celda(f['ref'][:20] + ('...' if len(f['ref']) > 20 else ''), f['ref']) + celda(f['tipo']) +
                    '<td class="z-listcell">' + ''.join('<a title="%s" href="javascript:void(0)" onclick="window.__clics.push(\'gedo:%s:%s\')">%s</a> ' % (a, f['ref'][:10], a, a[0]) for a in f['acc']) + '</td></tr>' for f in GEDO_FILAS)
    return ('<!doctype html><html><head><meta charset="utf-8"><style>' + CSS_ZK + '</style></head><body>' + cabecera(usuario, 'Generador de Documentos (GEDO)') +
            '<button class="z-button" onclick="window.__clics.push(\'inicio\'); document.getElementById(\'form\').style.display=\'block\'">Inicio de Documento</button>'
            '<div id="form" class="z-window z-window-modal" style="display:none"><div class="z-window-header">Iniciar Producción de Documento</div><div>Tipo de documento: <select><option>Elija</option></select> Referencia: <input></div></div>'
            '<div class="z-listbox"><table><thead class="z-listhead"><tr class="z-listhead">' +
            ''.join('<th class="z-listheader">%s</th>' % c for c in GEDO_COLS) + '</tr></thead><tbody class="z-listbox-body">' + filas + '</tbody></table></div></body></html>')

# Mis Tareas de GEDO con la lista de Avisos, como la muestra el sistema (captura
# del autor del 29/09/2026): el buzón de tareas pendientes vacío arriba y, abajo,
# los avisos de documentos firmados. En Acciones, un botón "Descargar" con texto
# y flecha de menú (sin título) y un ícono sin rótulo.
AVISOS_COLS = ['', 'Firmante', 'Redirigido por', 'Motivo', 'Referencia', 'Fecha de envío', 'Fecha de firma', 'Número SADE', 'Número especial', 'Acciones']
AVISOS = [
    {'firm': 'Del Gaudio Micaela Soledad', 'ref': 'DESIGNA NUEVOS CURADORES AD HOC. AUTOS: "SOBRIN, ...', 'env': '28-09-2026 15:07', 'num': 'DI-2026-43503941-GCABA-DGAJG', 'esp': 'DI-2026-309-GCABA-DGAJG'},
    {'firm': 'IGNACIO ALEJANDRO KINBAUM PUCCIO POSSE', 'ref': 'RESPUESTA A RE-2026-43014420-GCABA-PG EX-2026-1326...', 'env': '28-09-2026 12:26', 'num': 'PV-2026-43448800-GCABA-DGAJG', 'esp': ''},
    {'firm': 'IGNACIO ALEJANDRO KINBAUM PUCCIO POSSE', 'ref': 'SOLICITA ACTA DE MATRIMONIO Expediente CIV 14251/2...', 'env': '17-09-2026 09:12', 'num': 'NO-2026-41909644-GCABA-DGAJG', 'esp': ''},
]

def gedo_avisos_html(usuario=USUARIO):
    pend = ('<div class="z-listbox"><table><thead class="z-listhead"><tr class="z-listhead">' +
            ''.join('<th class="z-listheader">%s</th>' % c for c in GEDO_COLS) + '</tr></thead><tbody class="z-listbox-body"></tbody></table></div>')
    filas = ''.join('<tr class="z-listitem"><td class="z-listcell"><input type="checkbox"></td>' + celda(a['firm']) + celda('') + celda('FIRMADO') + celda(a['ref']) +
                    celda(a['env']) + celda(a['env']) + celda(a['num'] + ' <a class="z-a" href="javascript:void(0)"><i class="z-icon-copy"></i></a>') + celda(a['esp']) +
                    '<td class="z-listcell"><span class="z-combobutton" onclick="window.__clics.push(\'descargar:%s\'); window.zAu.cmd0.download(\'/gedo-web/descarga?doc=%s\')">'
                    '<span class="z-combobutton-content">Descargar<span class="z-combobutton-button"><i class="z-icon-caret-down"></i></span></span></span> '
                    '<a class="z-a" href="javascript:void(0)" onclick="window.__clics.push(\'circulo:%s\')"><i class="z-icon-play-circle"></i></a></td></tr>' % (a['num'], a['num'], a['num'])
                    for a in AVISOS)
    avisos = ('<div class="z-listbox"><table><thead class="z-listhead"><tr class="z-listhead">' +
              ''.join('<th class="z-listheader">%s</th>' % c for c in AVISOS_COLS) + '</tr></thead><tbody class="z-listbox-body">' + filas + '</tbody></table></div>')
    return ('<!doctype html><html><head><meta charset="utf-8"><style>' + CSS_ZK + '</style>'
            '<script>window.zAu = { cmd0: { download: function (u) { window.__clics.push("zk-original:" + u); }, redirect: function () {} } };</script>'
            '</head><body>' + cabecera(usuario, 'Generador de Documentos (GEDO)') +
            '<div>Buzón de Tareas Pendientes</div>' + pend + '<div>Avisos</div>' + avisos + '</body></html>')

PDF_PRUEBA = b'%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'

def ccoo_html(usuario=USUARIO):
    return ('<!doctype html><html><head><meta charset="utf-8"><style>' + CSS_ZK + '</style></head><body>' + cabecera(usuario, 'Comunicaciones Oficiales (CCOO)') +
            '<button class="z-button" onclick="window.__clics.push(\'inicio\'); document.getElementById(\'form\').style.display=\'block\'">Inicio de Documento</button>'
            '<div id="form" class="z-window z-window-modal" style="display:none"><div class="z-window-header">Iniciar Producción de Documento</div><div>Tipo de nota: <select><option>Elija</option></select> Referencia: <input></div></div></body></html>')

class Sistema:
    """Estado de las réplicas: qué página sirve cada módulo y los pedidos recibidos."""
    def __init__(self):
        self.usuario = USUARIO
        self.buzon = lambda: buzon_html(self.usuario)
        self.gedo = lambda: gedo_html(self.usuario)
        self.ccoo = lambda: ccoo_html(self.usuario)
        self.pedidos = []
        self.zk_estado = 200
    def atender(self, route, request):
        u = request.url
        self.pedidos.append({'method': request.method, 'url': u, 'body': request.post_data or ''})
        if '/zkau' in u:
            return route.fulfill(status=self.zk_estado, content_type='text/plain', body='')
        if '/gedo-web/descarga' in u:
            num = u.split('doc=')[-1]
            return route.fulfill(status=200, content_type='application/octet-stream', body=PDF_PRUEBA,
                                 headers={'content-disposition': 'attachment; filename="%s.pdf"' % num})
        if '/expedientes-web/' in u: html = self.buzon()
        elif '/gedo-web/' in u: html = self.gedo()
        elif '/ccoo-web/' in u: html = self.ccoo()
        else: return route.fulfill(status=404, body='')
        route.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)

# ---------------------------------------------------------------- infraestructura
FALLAS = []
OK = [0]
def chequear(nombre, cond, detalle=''):
    if cond: OK[0] += 1
    else: FALLAS.append(nombre + (': ' + str(detalle)[:400] if detalle else '')); print('   FALLA', nombre, str(detalle)[:400])

def esperar(page, js, ms=10000, paso=100):
    fin = time.time() + ms / 1000
    while time.time() < fin:
        try:
            if page.evaluate(js): return True
        except Exception:
            pass
        page.wait_for_timeout(paso)
    return False

def contexto(browser, sistema):
    ctx = browser.new_context(viewport={'width': 1600, 'height': 900}, accept_downloads=True, ignore_https_errors=True)
    ctx.route('https://*.apps.buenosaires.gob.ar/**', sistema.atender)
    ctx.add_init_script(ENVOLTORIO)
    # ZK simulado: lo que el latido necesita para armar su pedido "dummy".
    ctx.add_init_script("window.zk = { Desktop: { $: () => ({ id: 'z_desk' }) }, ajaxURI: (a, o) => location.pathname.replace(/\\/$/, '') + '/zkau' };")
    return ctx

def abrir(ctx, url=EE + 'panelUsuario.zul'):
    page = ctx.new_page()
    page.goto(url)
    esperar(page, "!!document.querySelector('#sadeplus')", 8000)
    return page

def errores(page):
    return page.evaluate('window.__errores || []')

def clics(page):
    return page.evaluate('window.__clics || []')

def gm(page, k):
    v = page.evaluate("(k) => localStorage.getItem('gm:' + k)", k)
    return json.loads(v) if v else None

def gm_set(page, k, v):
    page.evaluate("([k, v]) => localStorage.setItem('gm:' + k, v)", [k, json.dumps(v)])

def marcas(page, usuario=USUARIO):
    return gm(page, 'sade.plus.marcas.v1@' + usuario)

def filas(page):
    return page.evaluate("[...document.querySelectorAll('#sadeplus .sadeplus-cuerpo table.sadeplus-t tbody tr')].filter((r) => r.querySelector('td[class]') || r.cells.length > 1)")

def textos_filas(page):
    return page.evaluate("[...document.querySelectorAll('#sadeplus .sadeplus-cuerpo table.sadeplus-t tbody tr')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim())")

def cartel(page):
    """El aviso, esté en la barra de la ventana o en el cartel suelto."""
    return page.evaluate("((document.querySelector('#sadeplus .sadeplus-aviso') || {}).innerText || '') + ' ' + ((document.querySelector('#sadeplus-cartel') || {}).innerText || '')")

def anotar(page, clave, texto):
    """Escribe una anotación en la ficha de una fila del buzón y vuelve al listado."""
    page.click('#sadeplus .sadeplus-toque[data-ver="%s"][data-foco="nota"]' % clave)
    esperar(page, "!!document.querySelector('#sadeplus .sadeplus-nota')", 3000)
    page.fill('#sadeplus .sadeplus-nota', texto)
    page.click('#sadeplus .sadeplus-nota-guardar')
    page.wait_for_timeout(200)
    page.click('#sadeplus .sadeplus-ficha-volver')
    page.wait_for_timeout(200)

def desplegar(page):
    """Vuelve a mostrar la ventana entera (cerrada o plegada a la barra de título)."""
    page.evaluate("() => { const w = document.querySelector('#sadeplus'); const b = document.getElementById('sadeplus-abrir'); if (getComputedStyle(w).display === 'none' && b) b.click(); }")
    page.wait_for_timeout(200)
    page.evaluate("() => { const w = document.querySelector('#sadeplus'); if (w.classList.contains('sadeplus-min')) w.querySelector('[data-a=min]').click(); }")
    page.wait_for_timeout(300)

def pestana_nueva(page, valor):
    page.evaluate("(v) => { const c = [...document.querySelectorAll('#sadeplus input[type=checkbox]')].find((x) => /pestaña nueva/i.test(x.parentElement.textContent)); if (c && c.checked !== v) c.click(); }", valor)

# ---------------------------------------------------------------- pruebas
def buzon(browser):
    print('== buzón de tareas')
    s = Sistema(); ctx = contexto(browser, s); page = abrir(ctx)
    page.wait_for_timeout(300)
    chequear('la ventana aparece sobre el buzón', page.evaluate("!!document.querySelector('#sadeplus') && getComputedStyle(document.querySelector('#sadeplus')).display !== 'none'"))
    chequear('la placa muestra el usuario del sistema', page.evaluate("document.querySelector('#sadeplus .sadeplus-cuenta').textContent.trim()") == USUARIO)
    t = textos_filas(page)
    chequear('lee las tres actuaciones', len(t) == 3, t)
    chequear('el texto truncado se completa con el title de la celda', any('HEREDEROS DE BOURREN MARIA ROSA' in x for x in t), t)
    chequear('el title que es una instrucción no reemplaza al dato (usuario anterior)', any('GOMEZL' in x for x in t) and not any('Haga click' in x for x in t), t)
    chequear('el asunto se compone con el tipo de trámite y lo parseado del motivo', any('Denuncia herencia vacante' in x and 'MANICO TEODORA' in x for x in t), t)
    chequear('la carátula judicial se parte en piezas', any('expte. 36655-2014' in x for x in t), t)
    page.fill('#sadeplus .sadeplus-busca input', 'manico')
    page.wait_for_timeout(400)
    chequear('la búsqueda filtra por cualquier campo, incluido el asunto', len(textos_filas(page)) == 1 and 'MANICO' in textos_filas(page)[0], textos_filas(page))
    page.fill('#sadeplus .sadeplus-busca input', '')
    page.wait_for_timeout(400)
    page.click('#sadeplus th[data-k="estado"]')
    page.wait_for_timeout(300)
    t = textos_filas(page)
    chequear('el clic en la cabecera ordena por esa columna', t[0].startswith('Iniciación') and t[1].startswith('Tramitación'), t)
    page.click('#sadeplus [data-ver="EX-2026-13262731--GCABA-PG"].sadeplus-ver')
    page.wait_for_timeout(300)
    f = page.evaluate("(document.querySelector('#sadeplus .sadeplus-ficha-in') || {}).innerText || ''")
    sin_latidos = [p for p in s.pedidos if '/zkau' not in p['url']]
    chequear('Ver abre la ficha con los campos del listado, sin consultar al sistema', 'INMUEBLES SUCESION HERENCIA VACANTE' in f and 'PRESUNTA HV DE MANICO TEODORA' in f and len(sin_latidos) <= 2, (f[:200], len(sin_latidos)))
    page.click('#sadeplus .sadeplus-ficha-volver')
    page.click('#sadeplus [data-a="min"]'); page.click('#sadeplus [data-a="min"]')
    page.click('#sadeplus [data-a="cerrar"]')
    chequear('cerrada, el sistema queda a la vista', page.evaluate("getComputedStyle(document.querySelector('#sadeplus')).display === 'none' && !!document.querySelector('#sadeplus-abrir')"))
    chequear('sin errores de programa', not errores(page), errores(page))
    ctx.close()

def tramitar(browser):
    print('== abrir una actuación (Tramitar, nunca Adquirir)')
    s = Sistema(); ctx = contexto(browser, s); page = abrir(ctx)
    page.wait_for_timeout(300)
    pestana_nueva(page, False)
    page.click('#sadeplus .sadeplus-tram[data-tram="EX-2026-13262731--GCABA-PG"]')
    page.wait_for_timeout(300)
    chequear('Abrir acciona la opción Tramitar del listado original', clics(page) == ['EX-2026-13262731- -GCABA-PG:Tramitar'], clics(page))
    page.evaluate("window.__clics = []")
    desplegar(page)
    page.click('#sadeplus .sadeplus-tram[data-tram="EX-2026-13000001--GCABA-PG"]')
    page.wait_for_timeout(300)
    chequear('si la fila solo ofrece Adquirir, no se acciona nada', clics(page) == [], clics(page))
    chequear('y se avisa que no hay opción Tramitar', 'no ofrece la opción Tramitar' in cartel(page), cartel(page))
    page.evaluate("window.__clics = []")
    desplegar(page)
    page.click('#sadeplus .sadeplus-tram[data-tram="EX-2026-12999999--GCABA-PG"]')
    page.wait_for_timeout(300)
    chequear('con Tramitar y Adquirir en la fila, se acciona solo Tramitar', clics(page) == ['EX-2026-12999999- -GCABA-PG:Tramitar'], clics(page))
    chequear('sin errores de programa', not errores(page), errores(page))
    ctx.close()

def cuentas(browser):
    print('== la cuenta del sistema')
    s = Sistema(); ctx = contexto(browser, s); page = abrir(ctx)
    anotar(page, 'EX-2026-13262731--GCABA-PG', 'Pedir el formulario')
    chequear('la anotación se guarda bajo el usuario', (marcas(page) or {}).get('filas', {}).get('EX-2026-13262731--GCABA-PG', {}).get('nota') == 'Pedir el formulario', marcas(page))
    chequear('y se ve en el listado', any('Pedir el formulario' in x for x in textos_filas(page)))
    # otro usuario en la misma computadora
    s.usuario = OTRO
    page2 = ctx.new_page(); page2.goto(EE + 'panelUsuario.zul'); esperar(page2, "!!document.querySelector('#sadeplus')", 5000); page2.wait_for_timeout(300)
    chequear('con otro usuario no se ve la anotación ajena', not any('Pedir el formulario' in x for x in textos_filas(page2)), textos_filas(page2))
    chequear('la placa muestra al otro usuario', page2.evaluate("document.querySelector('#sadeplus .sadeplus-cuenta').textContent.trim()") == OTRO)
    # sin usuario identificado: nada se guarda
    s.usuario = ''
    page3 = ctx.new_page(); page3.goto(EE + 'panelUsuario.zul'); esperar(page3, "!!document.querySelector('#sadeplus')", 5000); page3.wait_for_timeout(300)
    chequear('sin usuario, la placa lo dice', 'sin usuario' in page3.evaluate("document.querySelector('#sadeplus .sadeplus-cuenta').textContent"))
    chequear('sin usuario, el aviso explica que no se guardan etiquetas ni anotaciones', page3.evaluate("/No fue posible identificar/.test(document.querySelector('#sadeplus').innerText)"))
    antes = page3.evaluate("Object.keys(localStorage).filter((k) => k.includes('marcas')).length")
    page3.click('#sadeplus .sadeplus-toque[data-ver="EX-2026-13262731--GCABA-PG"][data-foco="nota"]')
    page3.wait_for_timeout(300)
    if page3.query_selector('#sadeplus .sadeplus-nota'):
        page3.fill('#sadeplus .sadeplus-nota', 'no debería guardarse'); page3.click('#sadeplus .sadeplus-nota-guardar'); page3.wait_for_timeout(200)
    chequear('sin usuario no se escribe ninguna marca', page3.evaluate("Object.keys(localStorage).filter((k) => k.includes('marcas') && k.endsWith('@'))").__len__() == 0 and marcas(page3, '') is None)
    # dos nombres distintos en el encabezado: no se elige ninguno
    s.usuario = USUARIO
    s.buzon = lambda: buzon_html(USUARIO, extra_usuario=OTRO)
    page4 = ctx.new_page(); page4.goto(EE + 'panelUsuario.zul'); esperar(page4, "!!document.querySelector('#sadeplus')", 5000); page4.wait_for_timeout(300)
    chequear('con dos usuarios en el encabezado no se elige ninguno', 'sin usuario' in page4.evaluate("document.querySelector('#sadeplus .sadeplus-cuenta').textContent"))
    chequear('sin errores de programa', not errores(page) and not errores(page2) and not errores(page3), errores(page) + errores(page2) + errores(page3))
    ctx.close()

def dos_pestanas(browser):
    print('== dos pestañas no se pisan las anotaciones')
    s = Sistema(); ctx = contexto(browser, s)
    a = abrir(ctx); b = abrir(ctx)
    anotar(a, 'EX-2026-13262731--GCABA-PG', 'Desde la pestaña A')
    anotar(b, 'EX-2026-12999999--GCABA-PG', 'Desde la pestaña B')
    m = marcas(b)['filas']
    chequear('sobreviven las dos anotaciones', m.get('EX-2026-13262731--GCABA-PG', {}).get('nota') == 'Desde la pestaña A' and m.get('EX-2026-12999999--GCABA-PG', {}).get('nota') == 'Desde la pestaña B', m)
    a.wait_for_timeout(500)
    chequear('la pestaña A muestra lo que anotó B', any('Desde la pestaña B' in x for x in textos_filas(a)), textos_filas(a))
    # la misma fila desde las dos: quedan los dos textos
    anotar(a, 'EX-2026-13000001--GCABA-PG', 'Texto de A')
    b.click('#sadeplus .sadeplus-toque[data-ver="EX-2026-13000001--GCABA-PG"][data-foco="nota"]')
    esperar(b, "!!document.querySelector('#sadeplus .sadeplus-nota')", 3000)
    b.evaluate("document.querySelector('#sadeplus .sadeplus-nota').dataset.base = ''")   # B no vio el texto de A
    b.fill('#sadeplus .sadeplus-nota', 'Texto de B'); b.click('#sadeplus .sadeplus-nota-guardar'); b.wait_for_timeout(300)
    nota = marcas(b)['filas'].get('EX-2026-13000001--GCABA-PG', {}).get('nota', '')
    chequear('si las dos escriben la misma anotación, quedan los dos textos separados', 'Texto de A' in nota and 'Texto de B' in nota, nota)
    chequear('sin errores de programa', not errores(a) and not errores(b), errores(a) + errores(b))
    ctx.close()

def respaldo(browser):
    print('== respaldo cifrado')
    s = Sistema(); ctx = contexto(browser, s); page = abrir(ctx)
    anotar(page, 'EX-2026-13262731--GCABA-PG', 'Anotación secreta')
    page.click('#sadeplus .sadeplus-b:has-text("Etiquetas y archivos")')
    page.wait_for_timeout(300)
    chequear('sin contraseña no se puede exportar', page.evaluate("document.querySelector('#sadeplus [data-acc=exportar]').disabled"))
    page.fill('#sadeplus .sadeplus-contra', 'clave-de-prueba-2026')
    page.click('#sadeplus [data-acc="guardar-contra"]')
    page.wait_for_timeout(300)
    chequear('con contraseña se habilita exportar', page.evaluate("!document.querySelector('#sadeplus [data-acc=exportar]').disabled"))
    with page.expect_download(timeout=8000) as dl:
        page.click('#sadeplus [data-acc="exportar"]')
    d = dl.value
    ruta = Path('/tmp/claude-0/-home-claude/1aafe8a0-33c7-5276-a5fc-9934e25d8fec/scratchpad/respaldo-sade.bin') if Path('/tmp/claude-0').exists() else Path(os.getcwd()) / 'respaldo-sade.bin'
    d.save_as(str(ruta))
    datos = ruta.read_bytes()
    chequear('el archivo lleva la extensión propia .sadeplus', d.suggested_filename.endswith('.sadeplus'), d.suggested_filename)
    chequear('el respaldo sale cifrado', b'Anotaci' not in datos and b'secreta' not in datos)
    # se borran las marcas y se importa
    gm_set(page, 'sade.plus.marcas.v1@' + USUARIO, {'v': 1, 'etiquetas': [], 'filas': {}})
    page.reload(); esperar(page, "!!document.querySelector('#sadeplus')", 5000); page.wait_for_timeout(300)
    chequear('borradas, la anotación no está', not any('secreta' in x for x in textos_filas(page)))
    page.click('#sadeplus .sadeplus-b:has-text("Etiquetas y archivos")')
    page.wait_for_timeout(300)
    page.set_input_files('#sadeplus input[type=file]', {'name': d.suggested_filename, 'mimeType': 'application/octet-stream', 'buffer': datos})
    page.wait_for_timeout(800)
    chequear('importar restaura la anotación', (marcas(page) or {}).get('filas', {}).get('EX-2026-13262731--GCABA-PG', {}).get('nota') == 'Anotación secreta', marcas(page))
    # el respaldo de otro usuario no se importa
    s.usuario = OTRO
    page2 = ctx.new_page(); page2.goto(EE + 'panelUsuario.zul'); esperar(page2, "!!document.querySelector('#sadeplus')", 5000); page2.wait_for_timeout(300)
    page2.click('#sadeplus .sadeplus-b:has-text("Etiquetas y archivos")'); page2.wait_for_timeout(300)
    page2.set_input_files('#sadeplus input[type=file]', {'name': d.suggested_filename, 'mimeType': 'application/octet-stream', 'buffer': datos})
    page2.wait_for_timeout(800)
    chequear('el respaldo de otro usuario no se importa', not (marcas(page2, OTRO) or {}).get('filas'), marcas(page2, OTRO))
    chequear('sin errores de programa', not errores(page), errores(page))
    ctx.close()

def expediente(browser):
    print('== el expediente abierto en ventana propia')
    s = Sistema(); s.buzon = lambda: buzon_html(USUARIO, con_ventana=True)
    ctx = contexto(browser, s); page = abrir(ctx)
    page.wait_for_timeout(400)
    t = textos_filas(page)
    chequear('manda la lista de documentos: cuatro documentos, no las actuaciones del buzón', len(t) == 4 and any('FORMULARIO DE DENUNCIA' in x for x in t), t)
    cab = page.evaluate("document.querySelector('#sadeplus').innerText")
    chequear('el número del expediente sale de la ventana, no de las referencias ni del buzón', 'EX-2026-12999999' in cab.split('Orden')[0] and 'EX-2026-13262731' not in cab.split('Orden')[0] and 'EX-2025-45258294' not in cab.split('Orden')[0], cab[:300])
    chequear('el resumen dice que un pase no tiene referencia propia', any('pase, sin referencia propia' in x for x in t), t)
    chequear('el resumen nombra la actuación citada y los días desde el anterior', any('cita EX-2025-45258294' in x and 'después del anterior' in x for x in t), t)
    pestana_nueva(page, False)
    page.evaluate("window.__clics = []")
    page.click('#sadeplus [data-acc="datos"]:first-of-type') if page.query_selector('#sadeplus [data-acc="datos"]') else None
    page.wait_for_timeout(300)
    chequear('sin errores de programa', not errores(page), errores(page))
    ctx.close()

def gedo(browser):
    print('== GEDO')
    s = Sistema(); ctx = contexto(browser, s); page = abrir(ctx, GEDO + 'panelUsuario.zul')
    page.wait_for_timeout(400)
    t = textos_filas(page)
    chequear('replica el listado de tareas de GEDO', len(t) == 2 and any('OPINIÓN LETRADA' in x for x in t), t)
    botones = page.evaluate("[...document.querySelectorAll('#sadeplus .sadeplus-cuerpo button')].map((b) => b.textContent.trim())")
    chequear('ofrece Ejecutar y Ver historial', 'Ejecutar' in botones and 'Ver historial' in botones, botones)
    chequear('no ofrece Adquirir tarea ni Eliminar tarea', not any(re.search(r'adquirir|eliminar', x, re.I) for x in botones), botones)
    page.click('#sadeplus .sadeplus-cuerpo button:has-text("Ejecutar")')
    page.wait_for_timeout(300)
    chequear('Ejecutar acciona el botón del sistema, verificando su rótulo', any(c.endswith(':Ejecutar') for c in clics(page)) and not any('Adquirir' in c for c in clics(page)), clics(page))
    chequear('sin errores de programa', not errores(page), errores(page))
    ctx.close()

def gedo_avisos(browser):
    # 2.0.2: en la lista de Avisos de GEDO el botón Descargar no tiene título,
    # y hasta la 2.0.1 la ventana no ofrecía ni ver ni bajar el documento.
    print('== GEDO: Ver y Bajar en la lista de Avisos')
    s = Sistema(); s.gedo = lambda: gedo_avisos_html(USUARIO)
    ctx = contexto(browser, s); page = abrir(ctx, GEDO + 'panelUsuario.zul')
    page.wait_for_timeout(400)
    t = textos_filas(page)
    chequear('A1 lee la lista de Avisos (tres documentos), no el buzón de tareas vacío', len(t) == 3 and any('DESIGNA NUEVOS CURADORES' in x for x in t), t)
    botones = page.evaluate("[...document.querySelectorAll('#sadeplus .sadeplus-cuerpo tbody tr')].map((r) => [...r.querySelectorAll('button')].map((b) => b.textContent.trim()))")
    chequear('A2 cada fila ofrece Ver y Bajar, sin repetir el Descargar del sistema', botones and all(b[-2:] == ['Ver', 'Bajar'] and 'Descargar' not in b for b in botones), botones)
    bajadas = []
    page.on('download', lambda d: bajadas.append(d.suggested_filename))
    sel = '#sadeplus [data-gedo-doc*="PV-2026-43448800"][data-acc="%s"]'
    with page.expect_popup(timeout=8000) as pop:
        page.click(sel % 'ver')
    pv = pop.value
    ok = esperar(pv, "!!document.querySelector('iframe.sp-doc') && document.querySelector('iframe.sp-doc').src.startsWith('blob:')", 6000)
    chequear('A3 Ver abre el documento en una pestaña nueva', ok, pv.evaluate("document.body ? document.body.innerText.slice(0, 200) : ''"))
    chequear('A4 la pestaña lleva el número del documento, no el que cita la Referencia', pv.title() == 'PV-2026-43448800-GCABA-DGAJG', pv.title())
    page.wait_for_timeout(600)
    chequear('A5 Ver no baja nada', bajadas == [], bajadas)
    chequear('A6 Ver acciona el Descargar del sistema y toma su entrega', 'descargar:PV-2026-43448800-GCABA-DGAJG' in clics(page) and not any(c.startswith('zk-original') for c in clics(page)), clics(page))
    with page.expect_popup(timeout=8000) as pop2:
        page.click(sel % 'bajar')
    pb = pop2.value
    ok = esperar(pb, "!!document.querySelector('iframe.sp-doc')", 6000)
    page.wait_for_timeout(800)
    chequear('A7 Bajar lo guarda en el disco con su nombre y también lo abre', ok and bajadas == ['PV-2026-43448800-GCABA-DGAJG.pdf'], (ok, bajadas))
    chequear('A8 el ícono sin rótulo no se replica como botón', not any('circulo' in c for c in clics(page)) and all(len(b) == 2 for b in botones), botones)
    chequear('sin errores de programa', not errores(page), errores(page))
    ctx.close()

def encargos(browser):
    print('== encargos a otra pestaña (Documento GEDO, Nota CCOO)')
    s = Sistema(); ctx = contexto(browser, s); page = abrir(ctx)
    page.wait_for_timeout(300)
    with ctx.expect_page(timeout=8000) as nueva:
        page.click('#sadeplus [data-ini="gedo"]')
    p2 = nueva.value
    p2.wait_for_load_state()
    ok = esperar(p2, "(window.__clics || []).includes('inicio')", 8000)
    chequear('la pestaña nueva abre GEDO y acciona "Inicio de Documento"', ok and '/gedo-web/' in p2.url, (p2.url, clics(p2)))
    chequear('queda a la vista la ventana "Iniciar Producción de Documento" y nada completado', p2.evaluate("document.getElementById('form').style.display === 'block' && document.querySelector('#form input').value === ''"))
    ok = esperar(p2, "/SADE\\+/.test(document.body.innerText) && /Iniciar Producci/.test(document.body.innerText)", 8000)
    chequear('el recuadro de SADE+ en la pestaña nueva informa el resultado', ok)
    chequear('en la pestaña nueva no se despliega el listado', not p2.evaluate("!!document.querySelector('#sadeplus') && getComputedStyle(document.querySelector('#sadeplus')).display !== 'none'"))
    with ctx.expect_page(timeout=8000) as nueva2:
        page.click('#sadeplus [data-ini="nota"]')
    p3 = nueva2.value
    p3.wait_for_load_state()
    ok = esperar(p3, "(window.__clics || []).includes('inicio')", 8000)
    chequear('la nota de CCOO también abre su formulario en una pestaña nueva', ok and '/ccoo-web/' in p3.url, (p3.url, clics(p3)))
    # una pestaña ajena no toma el encargo: otra pestaña de GEDO abierta a mano no acciona nada
    p4 = ctx.new_page(); p4.goto(GEDO + 'panelUsuario.zul'); p4.wait_for_timeout(1200)
    chequear('una pestaña de GEDO abierta a mano no toma ningún encargo', 'inicio' not in clics(p4), clics(p4))
    chequear('sin errores de programa', not errores(page) and not errores(p2) and not errores(p3), errores(page) + errores(p2) + errores(p3))
    ctx.close()

def sesion(browser):
    print('== latido de sesión y cerrar sesión')
    s = Sistema(); ctx = contexto(browser, s); page = abrir(ctx)
    page.mouse.click(700, 500)
    page.wait_for_timeout(900)
    latidos = lambda: [p for p in s.pedidos if '/zkau' in p['url'] and 'cmd_0=dummy' in p['body']]
    chequear('con la persona presente se avisa al sistema que la página sigue en uso', len(latidos()) >= 1, len(latidos()))
    chequear('el aviso es el pedido vacío de ZK, con su escritorio', all('dtid=z_desk' in p['body'] and 'opt_0=i' in p['body'] for p in latidos()))
    page.wait_for_timeout(1800)
    n = len(latidos())
    page.wait_for_timeout(900)
    chequear('con la computadora sola el latido se detiene', len(latidos()) == n, len(latidos()) - n)
    page.keyboard.press('Shift')
    page.wait_for_timeout(700)
    chequear('al volver la persona, sigue', len(latidos()) > n, len(latidos()) - n)
    s.zk_estado = 401
    page.mouse.click(700, 500)
    ok = esperar(page, "/vencida/i.test(document.querySelector('#sadeplus .sadeplus-cuenta').textContent) || document.querySelector('#sadeplus .sadeplus-cuenta').className.includes('mal')", 4000)
    chequear('si el sistema rechaza el aviso, la placa marca la sesión vencida', ok, page.evaluate("document.querySelector('#sadeplus .sadeplus-cuenta').outerHTML"))
    ctx.close()
    s = Sistema(); ctx = contexto(browser, s); page = abrir(ctx)
    page.click('#sadeplus .sadeplus-salir')
    page.wait_for_timeout(300)
    chequear('Cerrar sesión acciona el Salir del encabezado del sistema', 'salir' in clics(page), clics(page))
    ctx.close()

def archivo():
    print('== el archivo')
    v = re.search(r'^// @version\s+(\S+)', ORIGINAL, re.M).group(1)
    chequear('la @version tiene un solo dígito por punto', re.fullmatch(r'\d\.\d\.\d', v), v)
    chequear('el archivo es anónimo: sin autor, sin licencia, sin correo', not re.search(r'@author|@license|@copyright|estudiojuridicokinbaum', ORIGINAL))
    chequear('ninguna línea de código que nombre "Adquirir" acciona nada, y la lista de vedadas la incluye', not any('.click(' in l for l in ORIGINAL.split('\n') if 'dquirir' in l) and re.search(r'ACC_VEDADAS = /adquirir', ORIGINAL))

PRUEBAS = [archivo, buzon, tramitar, cuentas, dos_pestanas, respaldo, expediente, gedo, gedo_avisos, encargos, sesion]

def main():
    elegidas = [a for a in sys.argv[1:] if not a.startswith('--')]
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for fn in PRUEBAS:
            if elegidas and fn.__name__ not in elegidas: continue
            try:
                fn(browser) if fn.__code__.co_argcount else fn()
            except Exception as e:
                FALLAS.append(fn.__name__ + ': excepción ' + repr(e)[:300]); print('   EXCEPCIÓN', fn.__name__, repr(e)[:300])
        browser.close()
    print('\n%d chequeos en verde, %d fallas' % (OK[0], len(FALLAS)))
    for f in FALLAS: print(' - ' + f)
    sys.exit(1 if FALLAS else 0)

if __name__ == '__main__':
    main()
