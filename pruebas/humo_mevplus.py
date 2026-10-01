# Prueba de humo de MEV+ suelto sobre la réplica del banco de MEV Ultra:
# abre la causa, aparece el panel de MEV+, "Descargar expediente completo" produce un PDF.
import os, sys, time
import banco
from playwright.sync_api import sync_playwright

# El banco está armado para MEV Ultra: acá se le da el archivo de MEV+ y se
# aplican solo los acortamientos que existen en él (los del motor).
MEVPLUS = open(sys.argv[1], encoding='utf-8').read()
def acortar_mevplus(src):
    for antes, despues in banco.ACORTES:
        if src.count(antes) == 1: src = src.replace(antes, despues)
    return src
# El programa va entre estas dos marcas del envoltorio. Se reemplaza por
# posición y no buscando el texto de MEV Ultra, porque el banco le aplica
# después otros cambios (la espera de la lectura sola, desde la 0.9.2) y la
# búsqueda dejaba de encontrarlo (0.9.4).
INICIO = '  const correr = () => {\n'
FINAL = '\n  };\n  if (document.readyState'
assert banco.ENVOLTORIO.count(INICIO) == 1 and banco.ENVOLTORIO.count(FINAL) == 1
_i = banco.ENVOLTORIO.index(INICIO) + len(INICIO)
_f = banco.ENVOLTORIO.index(FINAL)
banco.ENVOLTORIO = banco.ENVOLTORIO[:_i] + acortar_mevplus(MEVPLUS) + banco.ENVOLTORIO[_f:]
banco.SCRIPT = acortar_mevplus(MEVPLUS)
assert 'MEV Ultra (motor' not in banco.ENVOLTORIO, 'el envoltorio sigue teniendo MEV Ultra'

def fechas_del_motor(page):
    """MEV+ 2.1.3: las fechas de "Elegir descarga" se escriben dd/mm/aaaa, como en SuPJN+."""
    if 'fechaIsoDesdeTexto' not in MEVPLUS:
        banco.chequear('MEV+ escribe las fechas como dd/mm/aaaa (2.1.3)', False, 'esta versión no lo tiene')
        return
    # MEV+ abre siempre minimizado (pedido del autor): un clic en el título lo abre.
    page.eval_on_selector('[data-e="titulo"]', 'e => e.click()')
    page.eval_on_selector('[data-e="navElegir"]', 'e => e.click()')
    campo = lambda e: "document.querySelector('[data-e=\"%s\"]')" % e
    estado = lambda: page.evaluate(campo('estado') + '.textContent')
    banco.chequear('las fechas del motor son campos de texto dd/mm/aaaa (2.1.3)',
                   page.evaluate("['fdesde', 'fhasta'].map((e) => { const c = document.querySelector('[data-e=\"' + e + '\"]'); return [c.type, c.placeholder].join('|'); })") == ['text|dd/mm/aaaa'] * 2)
    banco.chequear('la ayuda del campo dice entre qué fechas van las actuaciones', 'las actuaciones van del ' in page.evaluate(campo('fdesde') + '.title'), page.evaluate(campo('fdesde') + '.title'))
    page.click('[data-e="fdesde"]')
    page.keyboard.type('3102')
    banco.chequear('las barras se ponen solas', page.evaluate(campo('fdesde') + '.value') == '31/02', page.evaluate(campo('fdesde') + '.value'))
    page.keyboard.type('2026')
    banco.chequear('una fecha que no existe se marca en rojo', page.evaluate(campo('fdesde') + '.dataset.mal') == '1' and page.evaluate('getComputedStyle(' + campo('fdesde') + ').borderTopColor') == 'rgb(179, 38, 30)', page.evaluate('getComputedStyle(' + campo('fdesde') + ').borderTopColor'))
    page.eval_on_selector('[data-e="marcarf"]', 'e => e.click()')
    banco.chequear('y Marcar entre fechas no la toma: avisa', 'dd/mm/aaaa' in estado(), estado())
    page.fill('[data-e="fdesde"]', '')
    page.click('[data-e="fdesde"]')
    page.keyboard.type('010126')
    page.click('[data-e="fhasta"]')
    banco.chequear('al salir, el año de dos cifras se completa', page.evaluate(campo('fdesde') + '.value') == '01/01/2026', page.evaluate(campo('fdesde') + '.value'))
    page.keyboard.type('31122026')
    page.eval_on_selector('[data-e="marcarf"]', 'e => e.click()')
    total = page.evaluate("document.querySelectorAll('[data-e=\"lista\"] input').length")
    tildadas = page.evaluate("document.querySelectorAll('[data-e=\"lista\"] input:checked').length")
    # La causa de prueba tiene actuaciones de 2021 y de 2026: se marcan solo las de 2026.
    banco.chequear('con el rango escrito, marca solo las actuaciones de 2026', ('%d actuación(es) marcadas' % tildadas) in estado() and 0 < tildadas < total, (estado(), tildadas, total))
    page.fill('[data-e="fdesde"]', '01/01/2030')
    page.fill('[data-e="fhasta"]', '')
    page.eval_on_selector('[data-e="filtrarf"]', 'e => e.click()')
    banco.chequear('Filtrar desde 2030 no deja ninguna a la vista', 'Mostrando 0 actuación(es)' in estado(), estado())
    page.fill('[data-e="fdesde"]', '')
    page.eval_on_selector('[data-e="filtrarf"]', 'e => e.click()')
    page.eval_on_selector('[data-e="navTodo"]', 'e => e.click()')

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        m = banco.mev_chica()
        m.proveidos = {'0': banco.proveido_con('Texto del paso cero.'), '1': banco.proveido_con('Texto del paso uno.'), '2': banco.proveido_con('Texto del paso dos.')}
        ctx = banco.contexto(browser, m, bibliotecas=True)
        page = ctx.new_page()
        page.goto('https://mev.scba.gov.ar/procesales.asp?nidCausa=1001&pidJuzgado=SI-1')
        ok = banco.esperar(page, "!!document.querySelector('[data-e=\"irTodo\"]')", 10000)
        banco.chequear('MEV+ suelto muestra su panel en la causa', ok)
        banco.chequear('no hay ventana de MEV Ultra (el archivo es MEV+, no MEV Ultra)', not page.evaluate("!!document.querySelector('#mvu')"))
        fechas_del_motor(page)
        page.eval_on_selector('[data-e="irTodo"]', 'e => e.click()')
        ok = banco.esperar(page, "(window.__descargas || []).length > 0", 90000)
        banco.chequear('la descarga completa entrega un PDF', ok)
        if ok:
            d = page.evaluate("window.__descargas[0]")
            banco.chequear('el archivo es un PDF con nombre .pdf', d['nombre'].lower().endswith('.pdf') and d['b64'][:5] == 'JVBER', d['nombre'])
            txt = banco.texto_pdf(d['b64'])
            if txt is not None:
                import re
                hora = re.search(r'Descargado de la MEV el \d{1,2}/\d{1,2}/\d{4}, (\d{2}):\d{2}:\d{2}', txt)
                ahora = page.evaluate('new Date().getHours()')
                banco.chequear('la portada da la hora con reloj de 24 horas (2.1.2)', hora and int(hora.group(1)) in (ahora, (ahora - 1) % 24), (hora and hora.group(0), ahora))
        banco.chequear('sin errores de programa', not banco.errores(page), banco.errores(page))
        ctx.close(); browser.close()
    print('\n%d chequeos en verde, %d fallas' % (banco.OK[0], len(banco.FALLAS)))
    for f in banco.FALLAS: print(' - ' + f)
    sys.exit(1 if banco.FALLAS else 0)

if __name__ == '__main__':
    main()
