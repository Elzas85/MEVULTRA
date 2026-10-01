// ==UserScript==
// @name         MEV Ultra
// @namespace    https://mev.scba.gov.ar/
// @version      0.5.1
// @description  Una sola ventana sobre la MEV de la SCBA: reúne en una tabla todas las causas de todos tus Sets de Búsqueda, recorriendo cada jurisdicción y cada organismo; filtra, ordena, busca y marca novedades; busca a una persona por su nombre en todos los juzgados civiles y comerciales y de paz de la provincia; muestra el expediente por dentro; etiquetas y anotaciones con respaldo cifrado. Incluye MEV+ completo para bajar el expediente en un PDF único, fiel y cronológico. No instalar junto con MEV+.
// @author       Ignacio Kinbaum
// @license      GPL-3.0-or-later
// @copyright    2026, Ignacio Kinbaum (estudiojuridicokinbaum@gmail.com)
// @homepageURL  https://github.com/Elzas85/MEVULTRA
// @supportURL   https://github.com/Elzas85/MEVULTRA/issues
// @updateURL    https://raw.githubusercontent.com/Elzas85/MEVULTRA/main/mev-ultra.user.js
// @downloadURL  https://raw.githubusercontent.com/Elzas85/MEVULTRA/main/mev-ultra.user.js
// @match        https://mev.scba.gov.ar/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_addValueChangeListener
// @grant        unsafeWindow
// @connect      docs.scba.gov.ar
// @connect      mev.scba.gov.ar
// @require      https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js#sha384=weMABwrltA6jWR8DDe9Jp5blk+tZQh7ugpCsF3JwSA53WZM9/14PjS5LAJNHNjAI
// @require      https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js#sha384=ZZ1pncU3bQe8y31yfZdMFdSpttDoPmOZg2wguVK9almUodir1PghgT0eY7Mrty8H
// ==/UserScript==
/*
 * MEV Ultra
 * Copyright (C) 2026  Ignacio Kinbaum  <estudiojuridicokinbaum@gmail.com>
 * Licencia GNU GPL v3 o posterior (texto completo al final del archivo).
 *
 * El archivo tiene dos módulos:
 *
 *   MÓDULO 1 — el motor de MEV+ 2.0.1, completo, sin cambios en su forma de
 *   capturar, bajar adjuntos, atravesar la validación ni armar el PDF. En
 *   MEV Ultra trabaja por encargo de la ventana: corre dentro de un marco
 *   oculto que abre procesales.asp de la causa a bajar, recibe qué
 *   actuaciones bajar, informa su avance a la ventana y le entrega el PDF.
 *   Su panel propio no se muestra: esas funciones están en la ventana.
 *
 *   MÓDULO 2 — la ventana de MEV Ultra (ver su encabezado, más abajo).
 */

/*
 * MEV SCBA — Bajar expediente completo (fiel)
 * Copyright (C) 2026  Ignacio Kinbaum  <estudiojuridicokinbaum@gmail.com>
 *
 * Este programa es software libre: usted puede redistribuirlo y/o
 * modificarlo bajo los términos de la Licencia Pública General GNU (GPL)
 * publicada por la Free Software Foundation, en su versión 3 o, a su
 * elección, cualquier versión posterior.
 *
 * Este programa se distribuye con la esperanza de que sea útil, pero SIN
 * NINGUNA GARANTÍA; ni siquiera la garantía implícita de COMERCIABILIDAD o
 * IDONEIDAD PARA UN PROPÓSITO PARTICULAR. Véase la Licencia Pública General
 * GNU para más detalles.
 *
 * Usted debería haber recibido una copia de la Licencia Pública General GNU
 * junto con este programa. Si no, véase <https://www.gnu.org/licenses/>.
 *
 * ---------------------------------------------------------------------------
 *
 * QUÉ HACE
 *
 * Arma un PDF único con el expediente entero, en orden cronológico, con
 * esta secuencia: proveído o escrito, sus adjuntos, siguiente actuación.
 * No redacta ni recompone nada — una versión previa volvía a componer el
 * texto en Helvetica y eso producía un documento nuevo, no el expediente.
 *
 *   · Cada actuación se captura renderizando el bloque #imprime de
 *     proveido.asp — exactamente lo que la MEV muestra e imprime, con su
 *     encabezado, su tipografía y su diagramación.
 *   · Los adjuntos se incorporan como vienen: las páginas del PDF original
 *     se copian sin recomponer, así que conservan firma, sellos y formato.
 *   · Cada adjunto queda inmediatamente detrás del proveído o escrito al
 *     que pertenece, en el mismo orden en que la MEV los presenta.
 *
 * VALIDACIÓN ANTI-BOT (EL PORTERO)
 *
 * La MEV ahora interpone "Validando acceso… El sistema está verificando si
 * está siendo navegado por un ser humano". Esa pantalla se sirve con
 * HTTP 200, así que el fetch la traía como si fuera el proveído y el PDF
 * salía con 300 páginas de cartel. Ahora:
 *
 *   1. Se detecta la pantalla antes de usar el HTML (nunca entra al PDF).
 *   2. Una sola compuerta frena TODOS los pedidos mientras dura la
 *      validación: no se martilla el servidor con veinte requests que van
 *      a rebotar igual.
 *   3. Se resuelve sola cargando la URL en un marco oculto — ahí sí corre
 *      el JavaScript del desafío y queda puesta la cookie — con esperas
 *      crecientes de 5s, 10s, 20s, 40s, 60s, 60s y cuenta regresiva a la
 *      vista.
 *   4. Si aun así no cede, el panel pide intervención humana sin perder
 *      nada de lo descargado: abrís la MEV en otra pestaña, pasás la
 *      validación y el script se reanuda solo (sondea cada 10s) o con el
 *      botón "Ya validé — seguir".
 *   5. El ritmo se adapta: cada validación frena el paso entre pedidos
 *      (hasta 6s) y solo se acelera de nuevo tras 20 respuestas limpias.
 *      Además hay un descanso cada 25 actuaciones. La validación se
 *      dispara por velocidad; la forma de no verla es no correr.
 *   6. Se puede cancelar en cualquier momento: arma el PDF con lo que haya
 *      y deja constancia en el anexo de incidencias.
 *
 * EXPEDIENTES GRANDES (desde 1.9.0)
 *
 * Un expediente de varios cientos de MB trababa la PC: todas las capturas
 * quedaban en memoria como lienzos sin comprimir, todos los adjuntos como
 * bytes sueltos, y el armado final hacía save(), load() y save() del
 * documento entero. Ahora:
 *
 *   1. Cada captura pasa a JPEG apenas se toma y el lienzo se libera.
 *   2. Capturas y adjuntos esperan el armado en Blobs, que el navegador
 *      guarda fuera de la memoria de la pestaña.
 *   3. El PDF se arma por tramos de hasta CONFIG.tramoMaxMB (500 MB). Cada
 *      tramo lleno se escribe objeto por objeto y se suelta antes de seguir.
 *   4. La unión no recarga los tramos: el archivo final es la suma de lo
 *      escrito más el árbol de páginas, el catálogo y la tabla xref. Sale un
 *      solo PDF, con la portada y el índice adelante como siempre.
 *      La tabla xref va en flujo, con offsets del ancho necesario (1.9.1): la
 *      de pdf-lib truncaba a 32 bits y rompía los archivos de más de 4 GB.
 *   5. Pasados CONFIG.descargaDirectaMB (100 MB) se guarda con <a download>,
 *      sin pasar el archivo por GM_download.
 *   6. Espacio (1.9.2): Chrome guarda los Blobs en disco hasta un décimo del
 *      disco y, si no entran, los deja rotos sin avisar. Cada adjunto y cada
 *      pedazo del PDF se prueban al guardarlos. Si falta espacio al bajar
 *      adjuntos, la bajada se corta, se sueltan los últimos adjuntos hasta
 *      dejar dos tramos libres y el PDF se arma con lo que haya; el anexo lo
 *      asienta. Si falta al escribir el PDF, se espera hasta un minuto a que
 *      el navegador libere lugar y, si no, se avisa en lugar de descargar un
 *      archivo dañado. Una captura ilegible queda como texto, con su
 *      incidencia, y el anexo sigue en tantas hojas como haga falta.
 *
 * ADJUNTOS Y CORTE DE HOJA (1.9.3)
 *
 * Revisión de una descarga completa (expediente 70549, San Martín) contra la
 * MEV. Se corrigieron dos fallas propias y se descartaron tres sospechas:
 *
 *   1. Adjuntos perdidos sin aviso. La MEV publica los documentos en
 *      docs.scba.gov.ar y escribe la ruta de dos maneras: "Documentos" en los
 *      escritos y "documentos" en los trámites sin texto de proveído (informes
 *      de mandamientos, oficios recibidos). El selector CSS distinguía
 *      mayúsculas, así que esos adjuntos no se veían, no se bajaban y ni
 *      siquiera figuraban en el anexo. Ahora el enlace se reconoce sin
 *      distinguir mayúsculas y, además, se toma como adjunto todo control
 *      rotulado "VER ADJUNTO"; si de alguno no se puede leer el enlace, queda
 *      asentado en el anexo con su nombre.
 *   2. Hoja en blanco y renglones partidos. La captura se cortaba en tramos
 *      iguales al alto útil de la hoja: el renglón que caía justo en el corte
 *      quedaba partido en dos páginas y una cola de pocas filas vacías salía
 *      como una hoja en blanco. Ahora el corte se busca en una franja sin
 *      tinta (hasta un cuarto de hoja hacia arriba) y el fondo del final se
 *      descarta. La capa de texto sigue alineada porque toma el límite real
 *      de cada tramo, no un alto fijo.
 *
 * No eran fallas de la aplicación, y quedan anotadas para no volver sobre
 * ellas: los trámites repetidos el mismo día (dos "PASE A" idénticos) son dos
 * pasos distintos de la MEV; las certificaciones notariales que llegan con una
 * sola página son así en la MEV (la escritura reproducida no se publica ahí);
 * y un escrito que la Cámara marca como "Privado" no aparece en la MEV.
 *
 * HOJAS APROVECHADAS (2.0.0)
 *
 * El PDF se veía chico y con mucho blanco (expediente 36213, San Isidro:
 * 199 páginas, cada actuación ocupaba en promedio el 44% de su hoja y el
 * texto salía a 6,6 puntos). Dos causas:
 *
 *   1. Ancho. La MEV diagrama su página a 1104 px fijos (estilo2014.css,
 *      clases .marco y .contenido) y la captura se reducía a esa escala para
 *      entrar en la A4. Ahora el bloque imprimible se diagrama a 760 px: el
 *      texto de la MEV corre dentro de ese ancho y sale a 10 puntos, una vez
 *      y media más grande. No cambia el contenido, solo el ancho de renglón.
 *   2. Una hoja por actuación. Un "Agréguese" de tres renglones ocupaba una
 *      hoja entera. Ahora las actuaciones van una detrás de otra, separadas
 *      por un filete gris; la que no entra sigue en la hoja siguiente,
 *      cortada siempre en una fila sin tinta (nunca a mitad de renglón). Un
 *      proveído de hasta el 40% de una hoja no se parte: si no entra entero,
 *      pasa a la hoja siguiente. Los adjuntos siguen en sus hojas propias,
 *      detrás de su actuación, y el índice apunta a la página donde empieza
 *      cada una.
 *
 * ESTRUCTURA RELEVADA (agosto 2026)
 *   procesales.asp   table con Fecha | Fojas | Firmado | Descripción,
 *                    cada fila enlaza a proveido.asp (orden descendente)
 *   proveido.asp     #imprime = bloque imprimible completo
 *                    #contenidoTxt = texto del escrito o la resolución
 *   adjuntos         docs.scba.gov.ar/Documentos y docs.scba.gov.ar/documentos
 *                    (la MEV usa las dos grafías) — OTRO HOST, por eso hace
 *                    falta GM_xmlhttpRequest y no alcanza un fetch
 */
/* global PDFLib, html2canvas, GM_xmlhttpRequest, GM_download */
(function () {
  'use strict';

  // El @match cubre todo el dominio (para que Tampermonkey inyecte también en
  // procesales.asp?nidCausa=...&pidJuzgado=..., que es como abre la causa).
  // Este guard limita el panel a la página del listado de actuaciones.
  if (!/\/procesales\.asp/i.test(location.pathname)) return;

  // MEV Ultra: este módulo solo trabaja por encargo de la ventana, dentro del
  // marco oculto que ella abre con #mevultra-encargo=ID. El encargo (qué
  // actuaciones bajar) viaja por el almacén de Tampermonkey.
  const ENCARGO = (function () {
    const m = location.hash.match(/mevultra-encargo=([\w-]+)/);
    const enMarco = (() => { try { return window.frameElement !== null; } catch (e) { return true; } })();
    if (!m || !enMarco) return null;
    let datos = null;
    try { const v = GM_getValue('mu.encargo.' + m[1]); datos = typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { datos = null; }
    return datos ? Object.assign({ id: m[1] }, datos) : { id: m[1], urls: null, perdido: true };
  })();
  if (!ENCARGO) return;

  // Datos de la pestaña About. Editá acá el GitHub cuando tengas el repo.
  const APP = {
    nombre: 'MEV Ultra (motor MEV+ 2.0.1)',
    version: '2.0.1',
    autor: 'Ignacio Kinbaum',
    anio: '2026',
    mail: 'estudiojuridicokinbaum@gmail.com',
    licencia: 'GPL-3.0-or-later',
    licenciaUrl: 'https://www.gnu.org/licenses/gpl-3.0.html',
    github: 'https://github.com/Elzas85/MEVULTRA'
  };

  const CONFIG = {
    escala: 2,                    // resolución de la captura (2 ≈ 190 dpi)
    calidadJpeg: 0.78,            // 0.78 mantiene legible el cuerpo del texto
    // Ancho de diagramación (2.0.0). La MEV fija su página en 1104 px
    // (estilo2014.css: .marco y .contenido). Llevada así al ancho de una A4,
    // la letra de 14 px quedaba en 6,6 puntos. Ahora el bloque imprimible se
    // diagrama a anchoCaptura: el texto corre dentro de ese ancho y sale a
    // 10 puntos. No cambia el contenido, solo el ancho en que se acomoda.
    anchoRender: 780,             // px de viewport para renderizar el proveído
    anchoCaptura: 760,            // px del bloque imprimible (menos que el viewport: sin barra de desplazamiento)
    capaTextoBuscable: true,

    // Corte de las capturas en hojas (1.9.3). El corte se hace en una franja
    // sin tinta: desde el alto útil de la hoja se sube, como máximo, esta
    // fracción de hoja buscando dos filas limpias seguidas. Una fila es
    // limpia si sus píxeles oscuros no superan la tolerancia (proporción del
    // ancho), que deja pasar las líneas verticales de los recuadros.
    corteRetrocesoMax: 0.25,
    corteToleranciaTinta: 0.004,

    // Hojas aprovechadas (2.0.0). Antes cada actuación empezaba en una hoja
    // nueva y un proveído corto dejaba el resto en blanco. Ahora la captura
    // se corta en franjas (siempre en una fila sin tinta) y las actuaciones
    // van una detrás de otra, separadas por un filete.
    franjaFraccion: 1 / 6,        // alto de cada franja, en fracción de hoja
    franjaRetroceso: 0.5,         // cuánto de la franja se sube buscando dónde cortar
    separacionPt: 12,             // espacio entre una actuación y la siguiente
    minimoRestantePt: 70,         // con menos lugar libre, la actuación empieza en hoja nueva
    juntarHastaFraccion: 0.4,     // una captura de hasta el 40% de la hoja no se parte entre dos hojas

    // Armado por tramos. Cuando lo acumulado supera este peso, el tramo se
    // escribe al almacenamiento del navegador y se libera; al final todos los
    // tramos se unen en un solo PDF sin volver a cargarlos en memoria.
    tramoMaxMB: 500,
    // Desde este peso el PDF se guarda directamente con <a download>: el
    // navegador lo lee del almacenamiento sin copiarlo a la extensión.
    descargaDirectaMB: 100,

    // Caídas del servidor (5xx, red)
    reintentos: 5,
    backoffBaseMs: 1500,
    backoffMaxMs: 30000,

    // Ritmo. La validación anti-bot se dispara por velocidad, así que el
    // paso se ajusta solo: se frena cuando la MEV protesta y recién
    // acelera tras una racha limpia.
    pausaBaseMs: 450,
    pausaMaxMs: 6000,
    jitter: 0.4,                  // ±40% para no marcar un pulso de máquina
    descansoCada: 25,             // actuaciones
    descansoMs: 6000,

    // Portero anti-bot
    esperaValidacionBaseMs: 5000,
    esperaValidacionMaxMs: 60000,
    reintentosValidacion: 6,      // ≈ 3 min antes de pedir ayuda humana
    limiteMarcoMs: 45000,         // tope para que el marco atraviese el desafío
    sondeoManualMs: 10000,        // cada cuánto se chequea durante la espera manual
    precalentadoOpacoMs: 8000     // marco a otro host (docs) para dejar la cookie
  };

  const SEL = {
    linkActuacion: 'a[href*="proveido.asp"]',
    imprimible: '#imprime',
    contenido: '#contenidoTxt',
    // Controles que pueden llevar a un adjunto. El filtro fino lo hacen
    // RE_ADJUNTO_URL y RE_VER_ADJUNTO: el selector solo junta candidatos.
    adjunto: 'a, button, input[type="button"], input[type="submit"]'
  };

  // Enlaces del repositorio de documentos. La MEV escribe la ruta de las dos
  // formas, "Documentos" y "documentos" (esta última en los trámites sin
  // texto de proveído), y un selector CSS distingue mayúsculas: por eso la
  // comparación va por expresión regular, sin distinguir.
  const RE_ADJUNTO_URL = /docs\.scba\.gov\.ar|(?:^|[\/?&])documentos\?/i;
  // Rótulo con el que la MEV presenta cada adjunto.
  const RE_VER_ADJUNTO = /ver\s+adjunto/i;

  const RUIDO = /Para copiar y pegar|seleccione desde aqu|sin incluir esta l[íi]nea|hasta aqu[íi]|^-{3,}$/i;

  // Huellas de la pantalla de validación. Se mira el HTML crudo, no el
  // texto renderizado, porque el cartel viaja con HTTP 200 y hay que
  // descartarlo antes de tratarlo como una actuación.
  const SENAL_PORTERO = new RegExp([
    'validando\\s+acceso',
    'siendo\\s+navegado\\s+por\\s+un\\s+ser\\s+humano',
    'verificando\\s+si\\s+est[aá]',
    'vuelva\\s+a\\s+cargar\\s+la\\s+p[aá]gina',
    'checking\\s+your\\s+browser',
    'just\\s+a\\s+moment',
    'cf[-_]browser[-_]verification',
    'challenge-platform',
    '_Incapsula_'
  ].join('|'), 'i');

  // Marcas de que lo recibido ES el expediente y no el portero. La fuerte
  // manda sola: el cartel de validación nunca trae el bloque imprimible,
  // así que un proveído que en su texto diga "validando acceso" no se
  // confunde con el portero.
  const SENAL_FUERTE = /id\s*=\s*["']?(imprime|contenidoTxt)\b/i;
  const SENAL_CONTENIDO = /proveido\.asp/i;

  // Reloj que no se frena con la pestaña en segundo plano. Chrome demora los
  // temporizadores de una pestaña que no está a la vista (verificado el
  // 24/09/2026: una espera de 0,1 s tardaba 1 s dentro del marco de la
  // descarga, y pasados unos minutos llega a una por minuto), y la descarga
  // se arrastraba hasta darse por cortada. Los temporizadores de un Worker
  // no se demoran. Si el Worker no se puede crear, se usa el reloj común.
  const sleep = (function () {
    let reloj = null;
    let siguienteId = 0;
    const pendientes = new Map();
    const liberarTodos = () => { pendientes.forEach((r) => r()); pendientes.clear(); };
    try {
      const fuente = 'onmessage=function(e){setTimeout(function(){postMessage(e.data.id)},e.data.ms)}';
      reloj = new Worker(URL.createObjectURL(new Blob([fuente], { type: 'text/javascript' })));
      reloj.onmessage = (e) => { const r = pendientes.get(e.data); if (r) { pendientes.delete(e.data); r(); } };
      reloj.onerror = () => { reloj = null; liberarTodos(); };
    } catch (e) { reloj = null; }
    return (ms) => new Promise((r) => {
      if (!reloj) { setTimeout(r, ms); return; }
      const id = ++siguienteId;
      pendientes.set(id, r);
      reloj.postMessage({ id, ms: Math.max(0, +ms || 0) });
    });
  })();
  const limpiar = (s) => (s || '').replace(/[ \t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const log = (...a) => console.log('%c[MEV]', 'color:#0a6;font-weight:bold', ...a);
  const backoff = (i) => Math.min(CONFIG.backoffBaseMs * Math.pow(2, i - 1), CONFIG.backoffMaxMs);

  function aWinAnsi(s) {
    return (s || '')
      .replace(/[‘’´`]/g, "'").replace(/[“”]/g, '"')
      .replace(/[–—]/g, '-').replace(/…/g, '...')
      .replace(/[^\x0A\x20-\x7E\xA0-\xFF]/g, ' ');
  }

  function parsearFecha(txt) {
    const m = (txt || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (!m) return null;
    const f = new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    return isNaN(f) ? null : f;
  }

  const iso = (f) => f
    ? `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`
    : 'sin-fecha';

  const nombreSeguro = (s, max = 60) =>
    (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s.-]+/g, '').replace(/\s+/g, '_').slice(0, max) || 'sin_nombre';

  // Estado de la corrida, para poder cancelar sin perder lo bajado.
  const corrida = { cancelado: false, procesadas: 0, sinEspacio: false };

  // ─────────────────────────────────────────────────────────────────────
  // El portero
  // ─────────────────────────────────────────────────────────────────────
  /**
   * Una única compuerta para toda la corrida. Cuando la MEV interpone la
   * validación, TODOS los pedidos esperan acá: si cada uno intentara
   * resolverla por su cuenta, veinte recargas simultáneas confirmarían
   * justamente lo que el sistema sospecha.
   */
  const portero = {
    bloqueo: null,      // promesa viva mientras se atraviesa la validación
    esperas: 0,         // cuántas veces frenó la corrida
    segundos: 0,        // cuánto se perdió esperando, en total
    pausa: CONFIG.pausaBaseMs,
    aciertos: 0
  };

  /**
   * ¿Esto es el cartel de validación o el expediente? El orden importa:
   * si el HTML trae las marcas del proveído y ninguna huella del portero,
   * es contenido bueno; recién después se buscan las huellas.
   */
  function esPantallaValidacion(html) {
    if (!html || !html.trim()) return true;              // respuesta vacía: portero
    if (SENAL_FUERTE.test(html)) return false;
    if (SENAL_CONTENIDO.test(html) && !SENAL_PORTERO.test(html)) return false;
    if (SENAL_PORTERO.test(html)) return true;
    // Cascarón corto que se recarga solo: es el portero aunque cambie el texto.
    if (html.length < 3000 && /http-equiv\s*=\s*["']?\s*refresh/i.test(html)) return true;
    return false;
  }

  async function esperarConCuenta(ms, prefijo) {
    const fin = Date.now() + ms;
    while (Date.now() < fin) {
      if (corrida.cancelado) return;
      ui.estado(`${prefijo} ${Math.ceil((fin - Date.now()) / 1000)}s`);
      await sleep(Math.min(1000, Math.max(50, fin - Date.now())));
    }
  }

  function crearMarco() {
    const marco = document.createElement('iframe');
    marco.style.cssText =
      `position:fixed;left:-99999px;top:0;width:${CONFIG.anchoRender}px;height:1400px;border:0;visibility:visible`;
    document.body.appendChild(marco);
    return marco;
  }

  /**
   * Navega de verdad a la URL dentro de un marco oculto. Es la única forma
   * de que corra el JavaScript del desafío y quede la cookie: un fetch
   * devuelve el cartel para siempre, porque no ejecuta nada.
   * Si a los pocos segundos el marco sigue mostrando el portero se lo
   * recarga, que es exactamente lo que pide el cartel.
   */
  async function navegarEnMarco(url, limiteMs) {
    const marco = crearMarco();
    const t0 = Date.now();
    let ultimoEmpujon = Date.now();
    marco.src = url;
    try {
      while (Date.now() - t0 < limiteMs) {
        if (corrida.cancelado) throw new Error('cancelado');
        await sleep(400);
        let doc = null;
        try { doc = marco.contentDocument; } catch (e) { doc = null; }
        if (!doc || doc.readyState !== 'complete') continue;
        // about:blank también informa "complete": si no navegó todavía o el
        // cuerpo está vacío, no hay nada que juzgar.
        const navegó = doc.location && doc.location.href && doc.location.href !== 'about:blank';
        const conCuerpo = doc.body && doc.body.innerHTML.trim().length > 200;
        // Si a los 10s el marco sigue en about:blank, la MEV no se deja
        // encuadrar (X-Frame-Options): no tiene sentido esperar los 45.
        if (!navegó && Date.now() - t0 > 10000) throw new Error('el marco no pudo cargar la página');
        if (!navegó || !conCuerpo) continue;
        const html = doc.documentElement ? doc.documentElement.outerHTML : '';
        if (html && !esPantallaValidacion(html)) {
          await sleep(220);                   // que terminen de pintar sellos e imágenes
          return { marco, doc, html };
        }
        if (Date.now() - ultimoEmpujon > CONFIG.esperaValidacionBaseMs) {
          ultimoEmpujon = Date.now();
          try { marco.contentWindow.location.reload(); } catch (e) { marco.src = url; }
        }
      }
      throw new Error('el marco no pudo atravesar la validación');
    } catch (e) {
      marco.remove();
      throw e;
    }
  }

  /** Sondeo liviano: un solo pedido, sin reintentos, para ver si ya pasó. */
  async function sondear(url) {
    try {
      const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) return false;
      const html = new TextDecoder('windows-1252').decode(await res.arrayBuffer());
      return !esPantallaValidacion(html);
    } catch (e) { return false; }
  }

  /** Punto de entrada único: si ya hay una validación en curso, se cuelga de esa. */
  function atravesarValidacion(url, opciones) {
    if (portero.bloqueo) return portero.bloqueo;
    portero.esperas++;
    portero.pausa = Math.min(Math.round(portero.pausa * 1.8) || CONFIG.pausaBaseMs, CONFIG.pausaMaxMs);
    portero.aciertos = 0;
    const t0 = Date.now();
    portero.bloqueo = resolverValidacion(url, opciones || {})
      .finally(() => {
        portero.segundos += Math.round((Date.now() - t0) / 1000);
        portero.bloqueo = null;
      });
    return portero.bloqueo;
  }

  async function resolverValidacion(url, { mismoOrigen = true } = {}) {
    const t0 = Date.now();
    ui.estado('La MEV pidió validar que sos una persona. Esperando…');
    for (let i = 1; i <= CONFIG.reintentosValidacion; i++) {
      if (corrida.cancelado) return;
      const espera = Math.min(CONFIG.esperaValidacionBaseMs * Math.pow(2, i - 1), CONFIG.esperaValidacionMaxMs);
      await esperarConCuenta(espera, `Validando acceso — intento ${i}/${CONFIG.reintentosValidacion}, reintento en`);
      if (corrida.cancelado) return;

      let pasó = false;
      if (mismoOrigen) {
        // El marco ejecuta el desafío; con la cookie puesta, el fetch
        // vuelve a servir para el resto de la corrida.
        try {
          const { marco } = await navegarEnMarco(url, CONFIG.limiteMarcoMs);
          marco.remove();
          pasó = true;
        } catch (e) { pasó = false; }
        if (!pasó) pasó = await sondear(url);   // por si el marco viene bloqueado por cabeceras
      } else {
        // Otro host (docs.scba.gov.ar): no se puede leer el marco, pero
        // cargarlo igual deja la cookie de ese dominio.
        const marco = crearMarco();
        marco.src = url;
        await sleep(CONFIG.precalentadoOpacoMs);
        marco.remove();
        pasó = true;                            // se verifica al reintentar la descarga
      }

      if (pasó) {
        ui.estado(`Validación superada tras ${Math.round((Date.now() - t0) / 1000)}s. Sigo donde estaba.`);
        return;
      }
    }
    return esperarValidacionManual(url);
  }

  /**
   * Última instancia: la validación no cede sola. No se pierde nada de lo
   * bajado — la corrida queda congelada hasta que alguien la destrabe en
   * otra pestaña. El script sondea igual, así que en general se reanuda
   * solo, sin que haga falta tocar el botón.
   */
  function esperarValidacionManual(url) {
    return new Promise((resolve) => {
      let listo = false;
      const terminar = (mensaje) => {
        if (listo) return;
        listo = true;
        clearInterval(reloj);
        ui.ocultarAyuda();
        ui.estado(mensaje);
        resolve();
      };
      ui.pedirAyuda({
        texto: 'La MEV insiste con la validación. Abrí la causa en otra pestaña, pasá el control y volvé: la descarga sigue desde donde quedó.',
        onAbrir: () => window.open(url, '_blank', 'noopener'),
        onSeguir: () => terminar('Sigo desde donde quedé.')
      });
      const reloj = setInterval(async () => {
        if (corrida.cancelado) return terminar('Cancelado.');
        if (await sondear(url)) terminar('Validación superada. Sigo desde donde quedé.');
      }, CONFIG.sondeoManualMs);
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // Red
  // ─────────────────────────────────────────────────────────────────────
  /** Tras cada respuesta limpia se afloja el freno, pero de a poco. */
  async function pausaAdaptativa() {
    portero.aciertos++;
    if (portero.aciertos % 20 === 0 && portero.pausa > CONFIG.pausaBaseMs) {
      portero.pausa = Math.max(CONFIG.pausaBaseMs, Math.round(portero.pausa * 0.8));
    }
    const j = 1 + (Math.random() * 2 - 1) * CONFIG.jitter;
    await sleep(Math.max(120, Math.round(portero.pausa * j)));
  }

  /** Página propia de la MEV. La MEV sirve Latin-1: con UTF-8 se rompe todo. */
  async function pedirHtmlCrudo(url) {
    let ultimo = null;
    for (let i = 0; i <= CONFIG.reintentos; i++) {
      if (corrida.cancelado) throw new Error('cancelado');
      if (portero.bloqueo) await portero.bloqueo;   // nadie pasa mientras hay validación
      if (i > 0) await esperarConCuenta(backoff(i), `MEV caída — reintento ${i}/${CONFIG.reintentos} en`);
      try {
        const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
        if ([429, 500, 502, 503, 504].includes(res.status)) { ultimo = new Error('HTTP ' + res.status); continue; }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const buf = await res.arrayBuffer();
        await pausaAdaptativa();
        const html = new TextDecoder('windows-1252').decode(buf);
        if (ENCARGO && /Ingrese(?:\s|&nbsp;)+los(?:\s|&nbsp;)+datos/i.test(html)) { ENCARGO.sesionVencida = true; corrida.cancelado = true; throw new Error('la sesión de la MEV venció'); }
        return html;
      } catch (e) { ultimo = e; }
    }
    throw new Error(`sin respuesta tras ${CONFIG.reintentos} reintentos (${ultimo && ultimo.message})`);
  }

  /**
   * Trae la actuación sorteando al portero, en tres pasos: fetch (rápido),
   * validación + fetch, y por último trabajar sobre el documento vivo del
   * marco, que es lo que funciona incluso si la cookie no viaja al fetch.
   */
  async function obtenerActuacion(url) {
    let html = await pedirHtmlCrudo(url);
    if (!esPantallaValidacion(html)) return { html, docVivo: null, marco: null };

    await atravesarValidacion(url);
    if (corrida.cancelado) throw new Error('cancelado');

    html = await pedirHtmlCrudo(url);
    if (!esPantallaValidacion(html)) return { html, docVivo: null, marco: null };

    const { marco, doc, html: htmlVivo } = await navegarEnMarco(url, CONFIG.limiteMarcoMs);
    return { html: htmlVivo, docVivo: doc, marco };
  }

  /** Adjunto: vive en docs.scba.gov.ar, otro origen. Sin GM no hay forma. */
  function pedirBinario(url) {
    const gm = typeof GM_xmlhttpRequest !== 'undefined'
      ? GM_xmlhttpRequest
      : (typeof GM !== 'undefined' && GM.xmlHttpRequest);
    if (!gm) return Promise.reject(new Error('GM_xmlhttpRequest no disponible — revisá los @grant'));
    return new Promise((resolve, reject) => {
      gm({
        method: 'GET', url, responseType: 'arraybuffer', timeout: 120000,
        onload: (r) => (r.status >= 200 && r.status < 300)
          ? resolve({ bytes: new Uint8Array(r.response), headers: r.responseHeaders || '' })
          : reject(new Error('HTTP ' + r.status)),
        onerror: () => reject(new Error('error de red')),
        ontimeout: () => reject(new Error('timeout'))
      });
    });
  }

  /** Un adjunto que llega como HTML cortito casi nunca es un adjunto. */
  function binarioEsPortero(bytes, headers) {
    if (!bytes || !bytes.length) return true;
    const magic = String.fromCharCode.apply(null, bytes.slice(0, 4));
    if (magic === '%PDF') return false;
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return false;         // PNG
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) return false;         // JPEG
    const ct = ((headers.match(/content-type:\s*([^\r\n;]+)/i) || [])[1] || '').toLowerCase();
    if (ct && !/html|text|xml/.test(ct)) return false;                // binario raro, pero binario
    const txt = new TextDecoder('windows-1252').decode(bytes.slice(0, 4096));
    return esPantallaValidacion(txt);
  }

  async function pedirBinarioConReintento(url) {
    let ultimo = null;
    for (let i = 0; i <= CONFIG.reintentos; i++) {
      if (corrida.cancelado) throw new Error('cancelado');
      if (portero.bloqueo) await portero.bloqueo;
      if (i > 0) await sleep(backoff(i));
      try {
        const r = await pedirBinario(url);
        if (binarioEsPortero(r.bytes, r.headers)) {
          ui.estado('El repositorio de documentos pidió validación. Esperando…');
          await atravesarValidacion(url, { mismoOrigen: false });
          ultimo = new Error('pantalla de validación en lugar del adjunto');
          continue;
        }
        await pausaAdaptativa();
        return r;
      } catch (e) { ultimo = e; }
    }
    throw ultimo || new Error('falló la descarga');
  }

  // ─────────────────────────────────────────────────────────────────────
  // Captura fiel del proveído
  // ─────────────────────────────────────────────────────────────────────
  /**
   * Monta el HTML del proveído en un iframe fuera de pantalla y lo
   * fotografía. El <base> es imprescindible: sin él las rutas relativas
   * (el sello de firma digital, los estilos) se resuelven contra
   * about:blank y la captura sale sin ellos.
   */
  function montarEnIframe(html) {
    return new Promise((resolve, reject) => {
      const marco = crearMarco();
      const conBase = html.replace(/<head([^>]*)>/i, `<head$1><base href="${location.origin}/">`);
      const doc = marco.contentDocument;
      doc.open();
      doc.write(conBase);
      doc.close();
      const listo = () => setTimeout(() => resolve({ marco, doc }), 220);
      if (doc.readyState === 'complete') listo();
      else marco.addEventListener('load', listo, { once: true });
      setTimeout(() => reject(new Error('timeout montando el proveído')), 20000);
    });
  }

  /**
   * Dónde cae cada palabra dentro de lo que se va a fotografiar, en píxeles
   * CSS relativos al propio elemento. Se mide sobre el mismo diseño que va a
   * la imagen, así la capa de texto invisible del PDF queda encima de la
   * misma palabra: seleccionar o buscar marca lo que se ve, no un texto
   * corrido en otra parte de la hoja.
   */
  function medirPalabras(objetivo) {
    const doc = objetivo.ownerDocument;
    const vista = doc.defaultView;
    const base = objetivo.getBoundingClientRect();
    const rango = doc.createRange();
    const out = [];
    const recorrido = doc.createTreeWalker(objetivo, 4 /* NodeFilter.SHOW_TEXT */);
    for (let n = recorrido.nextNode(); n; n = recorrido.nextNode()) {
      const padre = n.parentElement;
      if (!padre || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(padre.tagName)) continue;
      if (!/\S/.test(n.nodeValue)) continue;
      const est = vista.getComputedStyle(padre);
      if (est.visibility === 'hidden' || est.display === 'none' || Number(est.opacity) === 0) continue;
      const re = /\S+/g;
      let m;
      while ((m = re.exec(n.nodeValue))) {
        rango.setStart(n, m.index);
        rango.setEnd(n, m.index + m[0].length);
        // Una palabra partida entre dos renglones da dos cajas: se toma la primera.
        const r = rango.getClientRects()[0];
        if (!r || r.width < 1 || r.height < 1) continue;
        out.push({ t: m[0], x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height });
      }
    }
    return out;
  }

  /**
   * Ancho de diagramación (2.0.0). La MEV fija la página en 1104 px con las
   * clases de estilo2014.css; esas reglas se sueltan y el bloque imprimible
   * se fija en CONFIG.anchoCaptura, así el texto corre dentro de ese ancho.
   * El ancho queda fijo en píxeles a propósito: la medición de las palabras
   * y html2canvas diagraman lo mismo aunque uno de los dos marcos tenga
   * barra de desplazamiento.
   */
  const ESTILO_ANCHO =
    'html,body{min-width:0!important;margin:0!important}' +
    '.marco,.contenido,.superamplia,.superamplia2,.amplia,.masamplia,.guiajudicial,.guiajudicial2,' +
    '.AnchoFijoCaratula,.OverflowHidden{width:auto!important;min-width:0!important;max-width:100%!important;' +
    'margin-left:0!important;margin-right:0!important}' +
    'table.marco,table.contenido,table.guiajudicial,table.guiajudicial2{width:100%!important}' +
    'img{max-width:100%!important;height:auto!important}' +
    'body{overflow-wrap:break-word}';

  function inyectarEstiloAncho(doc) {
    const estilo = doc.createElement('style');
    estilo.textContent = ESTILO_ANCHO;
    (doc.head || doc.documentElement).appendChild(estilo);
  }

  function fijarAnchoObjetivo(objetivo) {
    objetivo.style.setProperty('width', CONFIG.anchoCaptura + 'px', 'important');
    objetivo.style.setProperty('min-width', '0', 'important');
    objetivo.style.setProperty('max-width', 'none', 'important');
    objetivo.style.setProperty('box-sizing', 'border-box', 'important');
  }

  /** Ancho fijo en píxeles puesto en el propio elemento (atributo width o estilo en línea), o null. */
  function anchoExplicito(el) {
    const m = /^(\d+(?:\.\d+)?)px$/.exec((el.style && el.style.width) || '') ||
      /^(\d+(?:\.\d+)?)$/.exec(el.getAttribute('width') || '');
    return m ? Number(m[1]) : null;
  }

  /**
   * Los anchos fijos que la MEV pensó para su página de 1104 px (una celda
   * de 820 al lado de la firma, un desplegable de 1090) se achican en la
   * misma proporción, así las columnas guardan la relación entre sí. Las
   * imágenes no: conservan su tamaño.
   */
  function escalarAnchosFijos(objetivo, k) {
    objetivo.querySelectorAll('*').forEach((el) => {
      if (el.tagName === 'IMG') return;
      const w = anchoExplicito(el);
      if (w !== null) el.style.setProperty('width', Math.round(w * k) + 'px', 'important');
    });
  }

  /** Elementos del bloque que todavía se pasan del ancho de la captura. */
  function excedidos(objetivo) {
    return [...objetivo.querySelectorAll('*')]
      .filter((el) => el.getBoundingClientRect().width > CONFIG.anchoCaptura + 1);
  }

  /** Suelta el ancho fijo de un elemento: la tabla ocupa el ancho disponible y el resto se acomoda. */
  function soltarAncho(el) {
    const s = el.style;
    s.setProperty('width', el.tagName === 'TABLE' ? '100%' : 'auto', 'important');
    s.setProperty('min-width', '0', 'important');
    s.setProperty('max-width', '100%', 'important');
    const ws = el.ownerDocument.defaultView.getComputedStyle(el).whiteSpace;
    if (ws === 'nowrap') s.setProperty('white-space', 'normal', 'important');
    else if (ws === 'pre') s.setProperty('white-space', 'pre-wrap', 'important');
  }

  function ajustarAncho(doc, objetivo) {
    const anchoOriginal = objetivo.scrollWidth;
    inyectarEstiloAncho(doc);
    fijarAnchoObjetivo(objetivo);
    if (anchoOriginal > CONFIG.anchoCaptura) escalarAnchosFijos(objetivo, CONFIG.anchoCaptura / anchoOriginal);
    // Hasta tres pasadas: soltar un contenedor puede dejar a la vista el
    // ancho fijo de lo que tiene adentro.
    for (let pasada = 0; pasada < 3; pasada++) {
      const lista = excedidos(objetivo);
      if (!lista.length) return;
      lista.forEach(soltarAncho);
    }
  }

  async function fotografiar(doc) {
    const objetivo = doc.querySelector(SEL.imprimible) || doc.body;
    try { ajustarAncho(doc, objetivo); } catch (e) { log('no se pudo ajustar el ancho', e); }
    let palabras = [];
    try { palabras = medirPalabras(objetivo); } catch (e) { log('no se pudo medir el texto', e); }
    const lienzo = await html2canvas(objetivo, {
      scale: CONFIG.escala,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      windowWidth: CONFIG.anchoRender,
      width: objetivo.scrollWidth,
      height: objetivo.scrollHeight
    });
    lienzo.palabras = palabras;
    lienzo.anchoCss = objetivo.scrollWidth;
    return lienzo;
  }

  async function capturarProveido(html) {
    const { marco, doc } = await montarEnIframe(html);
    try { return await fotografiar(doc); } finally { marco.remove(); }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Lectura de la causa
  // ─────────────────────────────────────────────────────────────────────
  /**
   * La tabla de actuaciones es la que más FILAS PROPIAS con link tiene.
   * Contar links sueltos no sirve: la MEV envuelve la página entera en una
   * table.marco que, contada así, gana siempre con una única fila.
   */
  function tablaActuaciones() {
    let mejor = null, max = 0;
    for (const t of document.querySelectorAll('table')) {
      const n = [...t.rows].filter((r) => r.querySelector(SEL.linkActuacion)).length;
      if (n > max) { max = n; mejor = t; }
    }
    return max >= 1 ? mejor : null;
  }

  function datosExpediente() {
    const texto = document.body.innerText.replace(/[ \t ]+/g, ' ');
    const campo = (etiqueta) => {
      const m = texto.match(new RegExp(etiqueta + '\\s*:?\\s*([^\\n]{2,160})', 'i'));
      return m ? m[1].trim() : '';
    };
    const lineas = document.body.innerText.split('\n').map((l) => l.trim()).filter(Boolean);
    const i = lineas.findIndex((l) => /^(Juzgado|Tribunal|C[áa]mara|Juzg\.|Unidad|Fiscal[íi]a|Defensor[íi]a)\b/i.test(l));
    const organismo = i < 0 ? '' : lineas[i] +
      (lineas[i + 1] && lineas[i + 1].length < 40 && !/Volver|Datos|Car[áa]tula/i.test(lineas[i + 1])
        ? ' — ' + lineas[i + 1] : '');
    return {
      caratula: campo('Car[áa]tula'),
      receptoria: campo('N[°º] de Receptor[íi]a'),
      expediente: campo('N[°º] de Expediente'),
      inicio: campo('Fecha inicio'),
      estado: campo('Estado'),
      organismo
    };
  }

  function leerFilas(tabla) {
    const out = [];
    [...tabla.rows].forEach((fila) => {
      const link = fila.querySelector(SEL.linkActuacion);
      if (!link) return;
      const celdas = [...fila.cells].map((c) => limpiar(c.innerText));
      const fechaTexto = celdas.find((c) => parsearFecha(c)) || '';
      out.push({
        url: link.href,
        fecha: parsearFecha(fechaTexto),
        fechaTexto,
        fojas: celdas[1] || '',
        firmado: !!fila.querySelector('img[src*="firma"]'),
        descripcion: limpiar(link.innerText) || celdas[3] || '',
        captura: null,
        texto: '',
        adjuntos: [],
        incidencias: []
      });
    });
    return out;
  }

  function extraerTexto(doc) {
    const cont = doc.querySelector(SEL.contenido);
    if (!cont) return '';
    const clon = cont.cloneNode(true);
    clon.querySelectorAll('script,style').forEach((n) => n.remove());
    return limpiar(clon.innerText.split('\n').filter((l) => !RUIDO.test(l.trim())).join('\n'));
  }

  const textoDe = (el) => (el.textContent || el.value || '');
  const atributo = (el, nombre) => (el.getAttribute ? (el.getAttribute(nombre) || '') : '');

  /**
   * URL del adjunto al que lleva un control. Casi siempre es su href, pero
   * la MEV también arma el enlace por script, así que si el href no sirve se
   * busca una dirección dentro del onclick o de los datos del elemento.
   */
  function urlDeAdjunto(el, base) {
    const candidatos = [];
    const href = atributo(el, 'href');
    if (href && !/^\s*(javascript:|#|\s*$)/i.test(href)) candidatos.push(href);
    const codigo = [href, atributo(el, 'onclick'), atributo(el, 'data-url'), atributo(el, 'data-href')]
      .filter(Boolean).join(' ');
    const m = codigo.match(/['"]([^'"\s]*(?:documentos\?|\.asp\?|\.pdf|\.png|\.jpe?g)[^'"\s]*)['"]/i);
    if (m) candidatos.push(m[1]);
    for (const c of candidatos) {
      try { return new URL(c, base || location.href).href; } catch (e) { /* prueba el siguiente */ }
    }
    return null;
  }

  /** Nombre con el que la MEV rotula el adjunto (la celda que acompaña al enlace). */
  function etiquetaDeAdjunto(el) {
    const propio = limpiar(textoDe(el));
    if (propio && !RE_VER_ADJUNTO.test(propio)) return propio;
    const fila = el.closest ? el.closest('tr') : null;
    const deFila = limpiar((fila ? fila.textContent : '') || '').replace(/ver\s+adjunto/gi, '').trim();
    return deFila || propio || 'adjunto';
  }

  async function procesarActuacion(act, capturar = true) {
    let marcoVivo = null;
    try {
      const { html, docVivo, marco } = await obtenerActuacion(act.url);
      marcoVivo = marco;
      // El documento vivo del marco ya tiene todo cargado; si vino por
      // fetch se parsea, que para leer texto y adjuntos alcanza.
      const doc = docVivo || new DOMParser().parseFromString(html, 'text/html');
      act.texto = extraerTexto(doc);

      // Se busca primero en el bloque imprimible; si ahí no hay nada se
      // barre el documento entero, porque no toda actuación arma la
      // ficha igual y un adjunto perdido es una foja perdida. Cuenta tanto
      // el enlace al repositorio como cualquier control rotulado
      // "VER ADJUNTO": así ningún adjunto queda afuera en silencio.
      const raiz = doc.querySelector(SEL.imprimible) || doc.body || doc;
      const buscar = (ambito) => [...ambito.querySelectorAll(SEL.adjunto)]
        .filter((el) => RE_VER_ADJUNTO.test(textoDe(el)) || RE_ADJUNTO_URL.test(atributo(el, 'href')));
      let controles = buscar(raiz);
      if (!controles.length && raiz !== doc) controles = buscar(doc);
      const vistas = new Set();
      act.adjuntos = [];
      for (const el of controles) {
        const etiqueta = etiquetaDeAdjunto(el);
        const url = urlDeAdjunto(el, act.url);
        if (!url) {
          act.incidencias.push(`La MEV muestra un adjunto ("${etiqueta}") del que no se pudo leer el enlace. Verificarlo en la MEV.`);
          continue;
        }
        if (vistas.has(url)) continue;
        vistas.add(url);
        act.adjuntos.push({ url, etiqueta });
      }

      if (capturar) {
        try {
          act.captura = await digitalizar(docVivo ? await fotografiar(docVivo) : await capturarProveido(html));
        } catch (e) {
          act.incidencias.push(`No se pudo capturar la presentación original: ${e.message}. Queda solo el texto.`);
        }
      }
    } catch (e) {
      act.incidencias.push(`No se pudo leer la actuación: ${e.message}`);
    } finally {
      if (marcoVivo) marcoVivo.remove();
    }
    return act;
  }

  /**
   * Chrome no avisa cuando un Blob no entra en su almacenamiento (en una PC
   * de escritorio, hasta un décimo del disco): el Blob queda roto y recién
   * falla al leerlo. Se lo prueba leyendo su último byte, que no cuesta nada.
   */
  const SIN_ESPACIO = 'Chrome se quedó sin espacio para archivos temporales (usa hasta un décimo del disco)';
  async function blobLegible(blob) {
    if (!blob || !blob.size) return true;
    try { await blob.slice(blob.size - 1).arrayBuffer(); return true; } catch (e) { return false; }
  }

  async function bajarAdjunto(act, adj, orden) {
    try {
      const { bytes, headers } = await pedirBinarioConReintento(adj.url);
      const ct = ((headers.match(/content-type:\s*([^\r\n;]+)/i) || [])[1] || '').toLowerCase();
      const cd = (headers.match(/filename\*?=(?:UTF-8'')?"?([^"\r\n;]+)/i) || [])[1] || '';
      const magic = String.fromCharCode.apply(null, bytes.slice(0, 4));
      // El adjunto queda en un Blob hasta el armado: el navegador lo guarda
      // fuera de la memoria de la pestaña y no se acumulan cientos de MB.
      adj.blob = new Blob([bytes], { type: ct || 'application/octet-stream' });
      if (!(await blobLegible(adj.blob))) {
        adj.blob = null;
        corrida.sinEspacio = true;          // corta la bajada de adjuntos
        throw new Error(SIN_ESPACIO);
      }
      adj.contentType = ct;
      adj.tipo = (magic === '%PDF' || /pdf/.test(ct)) ? 'pdf'
        : (/image\/(png|jpe?g)/.test(ct)) ? 'imagen' : 'otro';
      const original = cd ? decodeURIComponent(cd) : '';
      const ext = adj.tipo === 'pdf' ? 'pdf'
        : /png/.test(ct) ? 'png' : /jpe?g/.test(ct) ? 'jpg'
          : (original.split('.').pop() || 'bin').slice(0, 4);
      adj.nombre = original ||
        `${String(orden).padStart(3, '0')}_${iso(act.fecha)}_${nombreSeguro(act.descripcion, 45)}.${ext}`;
      adj.carpeta = adj.nombre;
    } catch (e) {
      act.incidencias.push(`No se pudo bajar el adjunto "${adj.etiqueta}": ${e.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Armado del PDF
  // ─────────────────────────────────────────────────────────────────────
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const A4 = [595.28, 841.89];
  const M = 22;   // margen chico: aprovecha más la hoja (antes 40)

  function envolver(texto, fuente, tam, ancho) {
    const out = [];
    for (const parrafo of aWinAnsi(texto).split('\n')) {
      if (!parrafo.trim()) { out.push(''); continue; }
      let linea = '';
      for (const palabra of parrafo.split(/\s+/)) {
        const prueba = linea ? linea + ' ' + palabra : palabra;
        if (fuente.widthOfTextAtSize(prueba, tam) > ancho && linea) { out.push(linea); linea = palabra; }
        else linea = prueba;
      }
      out.push(linea);
    }
    return out;
  }

  /**
   * Marca, para un rango de filas del lienzo, cuáles están limpias: sin
   * píxeles claramente más oscuros que el fondo de la propia fila. El fondo
   * se toma como el valor más claro de la fila, así una franja gris uniforme
   * también cuenta como limpia. Se toleran unos pocos píxeles oscuros por
   * fila (CONFIG.corteToleranciaTinta) para no confundir con texto las
   * líneas verticales de los recuadros.
   */
  function filasLimpias(lienzo, desde, hasta) {
    const alto = hasta - desde;
    const ancho = lienzo.width;
    const limpias = new Uint8Array(Math.max(0, alto));
    if (alto <= 0) return limpias;
    const { data } = lienzo.getContext('2d').getImageData(0, desde, ancho, alto);
    const tolerancia = Math.max(2, Math.round(ancho * CONFIG.corteToleranciaTinta));
    const lum = (i) => (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    for (let f = 0; f < alto; f++) {
      const base = f * ancho * 4;
      let fondo = 0;
      for (let x = 0; x < ancho; x++) { const l = lum(base + x * 4); if (l > fondo) fondo = l; }
      let oscuros = 0;
      for (let x = 0; x < ancho && oscuros <= tolerancia; x++) if (lum(base + x * 4) < fondo - 48) oscuros++;
      limpias[f] = oscuros <= tolerancia ? 1 : 0;
    }
    return limpias;
  }

  /**
   * Última fila con tinta, más un margen. Lo que queda debajo es fondo: si
   * se lo dejaba, una cola de pocas filas vacías que excedía la hoja salía
   * como una página en blanco (así apareció una hoja vacía en el 70549).
   */
  function finConTinta(lienzo) {
    const franja = 256;
    for (let hasta = lienzo.height; hasta > 0; hasta -= franja) {
      const desde = Math.max(0, hasta - franja);
      const limpias = filasLimpias(lienzo, desde, hasta);
      for (let f = limpias.length - 1; f >= 0; f--) {
        if (!limpias[f]) return Math.min(lienzo.height, desde + f + 1 + 12 * CONFIG.escala);
      }
    }
    return lienzo.height;       // captura sin tinta: se deja entera
  }

  /**
   * Fila donde cortar entre 'minimo' y 'ideal' sin partir un renglón: la
   * más baja que tenga, junto con la anterior, dos filas limpias seguidas.
   * Si no hay ninguna (una imagen alta, por ejemplo), se corta en el ideal.
   */
  function buscarCorte(lienzo, ideal, minimo) {
    const limpias = filasLimpias(lienzo, minimo, ideal);
    for (let f = limpias.length - 1; f >= 1; f--) {
      if (limpias[f] && limpias[f - 1]) return minimo + f;
    }
    return ideal;
  }

  /**
   * Límites de cada tramo, en filas del lienzo: [0, c1, c2, …, fin].
   * Ningún tramo supera altoTramoPx (desde 2.0.0, el alto de una franja).
   */
  function calcularCortes(lienzo, altoTramoPx, retroceso = CONFIG.corteRetrocesoMax) {
    let fin = lienzo.height;
    try { fin = finConTinta(lienzo); } catch (e) { log('no se pudo medir el final de la captura', e); }
    const cortes = [0];
    let inicio = 0;
    while (fin - inicio > altoTramoPx) {
      const ideal = inicio + altoTramoPx;
      const minimo = Math.max(inicio + 1, ideal - Math.floor(altoTramoPx * retroceso));
      let corte = ideal;
      try { corte = buscarCorte(lienzo, ideal, minimo); } catch (e) { corte = ideal; }
      cortes.push(corte);
      inicio = corte;
    }
    cortes.push(fin);
    return cortes;
  }

  /** Un tramo del lienzo, de la fila 'desde' a la fila 'hasta', pasado a JPEG. */
  async function comprimirTramo(lienzo, desde, hasta) {
    const alto = hasta - desde;
    if (alto < 1) return null;
    const corte = document.createElement('canvas');
    corte.width = lienzo.width;
    corte.height = alto;
    corte.getContext('2d').drawImage(lienzo, 0, desde, lienzo.width, alto, 0, 0, lienzo.width, alto);
    const blob = await new Promise((resolver, rechazar) => corte.toBlob(
      (b) => (b ? resolver(b) : rechazar(new Error('no se pudo comprimir la captura'))),
      'image/jpeg', CONFIG.calidadJpeg));
    corte.width = corte.height = 0;
    return { blob, alto, desde };
  }

  /**
   * Pasa la captura a JPEG en el momento en que se toma y suelta el lienzo.
   * Desde 2.0.0 se corta en franjas de CONFIG.franjaFraccion de hoja, sin
   * reescalar, para que el armado las acomode una detrás de otra y siga en
   * la hoja siguiente cuando no entran. Cada corte cae en una franja sin
   * tinta (no parte renglones ni sellos) y el fondo vacío del final se
   * descarta. Un lienzo a escala 2 ocupa decenas de MB sin comprimir; los
   * JPEG quedan en Blob, fuera de la pestaña.
   */
  async function digitalizar(lienzo) {
    // Un lienzo sin medidas dejaría el corte en tramos sin fin.
    if (!lienzo.width || !lienzo.height) throw new Error('la captura salió vacía');
    const escala = (A4[0] - M * 2) / lienzo.width;
    const altoFranjaPx = Math.max(40, Math.floor((A4[1] - M * 2) * CONFIG.franjaFraccion / escala));
    const cortes = calcularCortes(lienzo, altoFranjaPx, CONFIG.franjaRetroceso);
    const tramos = [];
    for (let t = 0; t < cortes.length - 1; t++) {
      const tramo = await comprimirTramo(lienzo, cortes[t], cortes[t + 1]);
      if (tramo) tramos.push(tramo);
    }
    const captura = {
      ancho: lienzo.width, palabras: lienzo.palabras, anchoCss: lienzo.anchoCss,
      escala, tramos,
      bytes: tramos.reduce((n, t) => n + t.blob.size, 0)
    };
    lienzo.width = lienzo.height = 0;      // libera ya la memoria del lienzo
    return captura;
  }

  // ── Hoja en curso del armado (2.0.0) ──────────────────────────────────
  // 'hoja' es { pagina, indice, y }: la página donde sigue el armado, su
  // número dentro del documento y la altura (en puntos, desde abajo) donde
  // empieza el lugar libre. pagina en null quiere decir "empezar hoja nueva".

  function hojaNueva(pdf, hoja) {
    hoja.pagina = pdf.addPage(A4);
    hoja.indice = pdf.getPageCount() - 1;
    hoja.y = A4[1] - M;
  }

  const libreEnHoja = (hoja) => (hoja.pagina ? hoja.y - M : 0);

  /** Espacio y filete gris entre una actuación y la siguiente. */
  function trazarSeparador(hoja) {
    const medio = hoja.y - CONFIG.separacionPt / 2;
    hoja.pagina.drawLine({
      start: { x: M, y: medio }, end: { x: A4[0] - M, y: medio },
      thickness: 0.5, color: rgb(0.75, 0.75, 0.75)
    });
    hoja.y -= CONFIG.separacionPt;
  }

  /**
   * Dónde empieza una captura: sigue en la hoja en curso, después del
   * separador, salvo que quede poco lugar, que no entre ni su primera franja
   * o que la captura sea corta y no entre entera (esa va a hoja nueva, para
   * no partir un proveído breve).
   */
  function prepararInicio(pdf, hoja, altoTotalPt, altoPrimeraPt) {
    if (hoja.pagina) {
      const libre = libreEnHoja(hoja) - CONFIG.separacionPt;
      const corta = altoTotalPt <= (A4[1] - M * 2) * CONFIG.juntarHastaFraccion;
      const noEntra = altoPrimeraPt > libre || (corta && altoTotalPt > libre);
      if (libre < CONFIG.minimoRestantePt || noEntra) hoja.pagina = null;
    }
    if (hoja.pagina) trazarSeparador(hoja);
    else hojaNueva(pdf, hoja);
  }

  /**
   * Vuelca al PDF la captura ya digitalizada, franja por franja, a partir de
   * la hoja en curso. Devuelve el número (base 0) de la página donde empieza,
   * que es el que va al índice.
   */
  async function volcarCaptura(pdf, captura, textoBuscable, fuente, hoja) {
    const anchoUtil = A4[0] - M * 2;
    const { escala } = captura;
    // Primero se leen todos los tramos: si alguno no se puede leer, la
    // captura no queda a medias en el PDF.
    const imagenes = [];
    for (const tramo of captura.tramos) imagenes.push(new Uint8Array(await tramo.blob.arrayBuffer()));
    const altoTotal = captura.tramos.reduce((n, t) => n + t.alto * escala, 0);
    const altoPrimera = captura.tramos.length ? captura.tramos[0].alto * escala : 0;
    prepararInicio(pdf, hoja, altoTotal, altoPrimera);
    const inicio = hoja.indice;
    const ubicaciones = [];
    for (const [k, tramo] of captura.tramos.entries()) {
      const img = await pdf.embedJpg(imagenes[k]);
      imagenes[k] = null;
      tramo.blob = null;
      const alto = tramo.alto * escala;
      if (alto > libreEnHoja(hoja) + 0.5) hojaNueva(pdf, hoja);
      hoja.pagina.drawImage(img, { x: M, y: hoja.y - alto, width: anchoUtil, height: alto });
      ubicaciones.push({ pagina: hoja.pagina, arriba: hoja.y });
      hoja.y -= alto;
    }
    agregarCapaTexto(ubicaciones, captura, textoBuscable, fuente);
    return inicio;
  }

  /** Capa invisible: mantiene el Ctrl+F sobre una página que es imagen. */
  function agregarCapaTexto(ubicaciones, captura, textoBuscable, fuente) {
    if (!CONFIG.capaTextoBuscable || !ubicaciones.length) return;
    try {
      // Cada palabra va encima de la misma palabra de la imagen y con su tamaño.
      if (captura.palabras && captura.palabras.length && captura.anchoCss) {
        capaAlineada(ubicaciones, captura, captura.escala, fuente);
      } else if (textoBuscable) {
        capaCorrida(ubicaciones, textoBuscable, fuente);
      }
    } catch (e) { log('capa de texto omitida', e); }
  }

  /**
   * Sin medidas de las palabras (no debería pasar): el texto corrido, que al
   * menos deja buscar aunque no coincida con la imagen.
   */
  function capaCorrida(ubicaciones, textoBuscable, fuente) {
    const paginas = [...new Set(ubicaciones.map((u) => u.pagina))];
    const lineas = envolver(textoBuscable, fuente, 7, A4[0] - M * 2);
    let p = 0, y = ubicaciones[0].arriba;
    for (const l of lineas) {
      if (y < M) { p++; y = A4[1] - M; if (p >= paginas.length) break; }
      if (l) paginas[p].drawText(l, { x: M, y, size: 7, font: fuente, opacity: 0 });
      y -= 9;
    }
  }

  /**
   * Texto invisible (modo de dibujo 3, el mismo que usan los PDF con OCR)
   * palabra por palabra. Cada una va en la página y el lugar donde quedó en
   * la imagen, con la altura de su renglón, y se estira o se angosta en
   * horizontal hasta medir lo mismo que en la imagen. Así la selección cubre
   * exactamente la palabra que se ve, aunque la letra de la MEV no sea Helvetica.
   */
  function capaAlineada(ubicaciones, captura, escala, fuente) {
    const { pushGraphicsState, popGraphicsState, beginText, endText, setFontAndSize,
      setTextRenderingMode, TextRenderingMode, setCharacterSqueeze, setTextMatrix, showText } = PDFLib;
    const r = captura.ancho / captura.anchoCss;          // px del lienzo por px CSS
    // Límites de cada tramo en filas del lienzo.
    const tramos = captura.tramos.map((tr) => ({ desde: tr.desde, alto: tr.alto }));
    // Desde 2.0.0 varias franjas (y varias actuaciones) comparten página:
    // las palabras se agrupan por página y cada franja sabe a qué altura quedó.
    const porPagina = new Map();
    const listaDe = (pagina) => {
      if (!porPagina.has(pagina)) porPagina.set(pagina, []);
      return porPagina.get(pagina);
    };
    for (const p of captura.palabras) {
      const texto = aWinAnsi(p.t).trim();
      if (!texto) continue;
      const arriba = p.y * r;
      const altoPx = p.h * r;
      // El tramo (la página) es el que contiene el centro de la palabra.
      // Los tramos no miden todos lo mismo: se busca por sus límites.
      const centro = arriba + altoPx / 2;
      let t = -1;
      for (let k = 0; k < tramos.length; k++) {
        if (centro >= tramos[k].desde && centro < tramos[k].desde + tramos[k].alto) { t = k; break; }
      }
      if (t < 0 || t >= ubicaciones.length) continue;
      const alto = altoPx * escala;                       // en puntos
      const tam = alto * 0.89;                            // cuerpo de la letra
      const natural = fuente.widthOfTextAtSize(texto, tam);
      if (!(natural > 0) || tam < 0.5) continue;
      listaDe(ubicaciones[t].pagina).push({
        texto, tam,
        x: M + p.x * r * escala,
        y: ubicaciones[t].arriba - (arriba - tramos[t].desde) * escala - alto * 0.81,   // línea de base
        estira: Math.max(20, Math.min(400, 100 * (p.w * r * escala) / natural))
      });
    }
    porPagina.forEach((lista, pagina) => {
      if (!lista.length) return;
      pagina.setFont(fuente);
      const clave = pagina.fontKey;
      const ops = [pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
      for (const w of lista) {
        // El espacio del final no se ve ni cuenta para el ancho: está para que al
        // copiar o buscar las palabras no salgan pegadas.
        ops.push(setFontAndSize(clave, w.tam), setCharacterSqueeze(w.estira),
          setTextMatrix(1, 0, 0, 1, w.x, w.y), showText(fuente.encodeText(w.texto + ' ')));
      }
      ops.push(endText(), popGraphicsState());
      for (let k = 0; k < ops.length; k += 2000) pagina.pushOperators(...ops.slice(k, k + 2000));
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // Escritura por tramos
  // ─────────────────────────────────────────────────────────────────────
  const { PDFContext, PDFRef, PDFDict, PDFArray, PDFStream, PDFName, PDFNull, PDFHexString, PDFString,
    PDFInvalidObject, PDFObjectStream, PDFRawStream } = PDFLib;

  /** Cuántos bytes hacen falta para escribir n (sin operadores de 32 bits). */
  const bytesPara = (n) => { let b = 1; while (n >= Math.pow(256, b)) b++; return b; };

  /** Comprime en formato zlib, que es lo que espera el filtro FlateDecode. */
  async function comprimirFlate(bytes) {
    if (typeof CompressionStream !== 'function') return null;
    const flujo = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(flujo).arrayBuffer());
  }

  const ascii = (s) => {
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
    return b;
  };

  /**
   * Recorre los objetos directos contenidos en obj y llama a fn por cada
   * referencia indirecta. Si fn devuelve un objeto, reemplaza la referencia.
   * 'vistos' evita procesar dos veces un mismo diccionario compartido.
   */
  function recorrerRefs(obj, fn, vistos) {
    if (!(obj instanceof PDFDict || obj instanceof PDFArray || obj instanceof PDFStream)) return;
    if (vistos.has(obj)) return;
    vistos.add(obj);
    if (obj instanceof PDFStream) { recorrerRefs(obj.dict, fn, vistos); return; }
    if (obj instanceof PDFDict) {
      for (const [clave, valor] of obj.entries()) {
        if (valor instanceof PDFRef) { const nueva = fn(valor); if (nueva) obj.set(clave, nueva); }
        else recorrerRefs(valor, fn, vistos);
      }
      return;
    }
    for (let i = 0; i < obj.size(); i++) {
      const valor = obj.get(i);
      if (valor instanceof PDFRef) { const nueva = fn(valor); if (nueva) obj.set(i, nueva); }
      else recorrerRefs(valor, fn, vistos);
    }
  }

  /**
   * Escribe el PDF final de a pedazos. Cada tramo (un documento de pdf-lib)
   * se serializa objeto por objeto, con numeración nueva, y los bytes pasan
   * a Blobs: el navegador los guarda fuera de la memoria de la pestaña y, si
   * crecen, en disco. La unión no vuelve a cargar nada: el archivo final es
   * la suma de esos Blobs más el árbol de páginas, el catálogo, los datos
   * del documento y la tabla de referencias cruzadas, escritos al final.
   * Antes el armado hacía save(), load() y otra vez save() del expediente
   * entero, con tres o cuatro copias completas vivas al mismo tiempo.
   * Como save(), agrupa los objetos chicos en flujos de objetos comprimidos
   * y cierra con una tabla de referencias en flujo: el archivo pesa lo mismo
   * que con el armado anterior.
   */
  class EscritorPdf {
    constructor() {
      this.ctx = PDFContext.create();
      this.partes = [];              // Blobs ya escritos
      this.pendiente = [];           // bytes que todavía no pasaron a Blob
      this.pesoPendiente = 0;
      this.offset = 0;               // posición en el archivo final
      this.xref = [];                // número → offset, o { flujo, indice }
      this.lote = [];                // objetos chicos esperando su flujo
      this.sinVerificar = [];        // pedazos guardados que falta comprobar
      this.siguiente = 1;
      this.nRaiz = this.reservar();
      this.nCatalogo = this.reservar();
      this.nInfo = this.reservar();
      this.escribir(ascii('%PDF-1.7\n%'));
      this.escribir(new Uint8Array([0xE2, 0xE3, 0xCF, 0xD3, 0x0A, 0x0A]));
    }

    reservar() { return this.siguiente++; }

    escribir(bytes) {
      this.pendiente.push(bytes);
      this.pesoPendiente += bytes.length;
      this.offset += bytes.length;
      if (this.pesoPendiente >= 16 * 1048576) this.volcar();
    }

    volcar() {
      if (!this.pendiente.length) return;
      const datos = this.pendiente;
      this.partes.push(new Blob(datos));
      this.sinVerificar.push({ indice: this.partes.length - 1, datos });
      this.pendiente = [];
      this.pesoPendiente = 0;
    }

    /**
     * Comprueba los pedazos recién guardados. Chrome libera el lugar de un
     * Blob recién cuando la recolección de basura suelta el objeto: si un
     * pedazo no entró, se espera a que se libere espacio y se lo vuelve a
     * guardar (hasta un minuto). Si no hay caso, se corta con aviso en vez
     * de descargar un PDF dañado.
     */
    async asegurar() {
      for (const { indice, datos } of this.sinVerificar.splice(0)) {
        let espera = 1000;
        while (!(await blobLegible(this.partes[indice]))) {
          if (espera > 32000) {
            throw new Error(`${SIN_ESPACIO}. No se pudo guardar el PDF: liberá espacio en el disco ` +
              'o bajá el expediente en partes, por rango de fechas.');
          }
          ui.estado(`Esperando que el navegador libere espacio para el PDF (${Math.round(espera / 1000)} s)…`);
          await sleep(espera);
          espera *= 2;
          this.partes[indice] = new Blob(datos);
        }
      }
    }

    objeto(numero, obj) {
      this.xref[numero] = this.offset;
      this.escribir(ascii(`${numero} 0 obj\n`));
      const bytes = new Uint8Array(obj.sizeInBytes());
      obj.copyBytesInto(bytes, 0);
      this.escribir(bytes);
      this.escribir(ascii('\nendobj\n'));
    }

    /** Los objetos sin flujo propio van de a 50 en un flujo de objetos. */
    guardar(numero, obj) {
      if (obj instanceof PDFStream || obj instanceof PDFInvalidObject) { this.objeto(numero, obj); return; }
      this.lote.push([PDFRef.of(numero), obj]);
      if (this.lote.length >= 50) this.cerrarLote();
    }

    cerrarLote() {
      if (!this.lote.length) return;
      const numero = this.reservar();
      const flujo = PDFObjectStream.withContextAndObjects(this.ctx, this.lote, true);
      this.lote.forEach(([ref], indice) => { this.xref[ref.objectNumber] = { flujo: numero, indice }; });
      this.lote = [];
      this.objeto(numero, flujo);
    }

    /**
     * Escribe un documento de pdf-lib como tramo y devuelve las referencias
     * nuevas de sus páginas, en orden. Solo se escribe lo alcanzable desde
     * las páginas; el catálogo, los datos y el árbol de páginas del tramo
     * se descartan, porque el documento final tiene los suyos.
     */
    async volcarDocumento(doc) {
      await doc.flush();
      const ctx = doc.context;
      const paginas = doc.getPages().map((p) => p.ref);
      const TIPO = PDFName.of('Type');
      const PAGES = PDFName.of('Pages');
      const tagCatalogo = ctx.trailerInfo.Root instanceof PDFRef ? ctx.trailerInfo.Root.tag : '';
      const tagInfo = ctx.trailerInfo.Info instanceof PDFRef ? ctx.trailerInfo.Info.tag : '';
      const nodos = new Set();
      for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
        if (obj instanceof PDFDict && obj.get(TIPO) === PAGES) nodos.add(ref.tag);
      }
      const excluido = (tag) => tag === tagCatalogo || tag === tagInfo || nodos.has(tag);

      // Marcado: qué objetos se alcanzan desde las páginas.
      const alcanzables = new Map();
      const pila = [...paginas];
      const vistosMarca = new WeakSet();
      while (pila.length) {
        const ref = pila.pop();
        if (alcanzables.has(ref.tag) || excluido(ref.tag)) continue;
        const obj = ctx.lookup(ref);
        if (obj === undefined) continue;            // referencia colgada: queda null
        alcanzables.set(ref.tag, ref);
        recorrerRefs(obj, (r) => { if (!alcanzables.has(r.tag)) pila.push(r); }, vistosMarca);
      }

      // Numeración nueva, conservando el orden original.
      const orden = [...alcanzables.values()].sort((a, b) =>
        a.objectNumber - b.objectNumber || a.generationNumber - b.generationNumber);
      const nuevo = new Map();
      for (const ref of orden) nuevo.set(ref.tag, PDFRef.of(this.reservar()));
      const raiz = PDFRef.of(this.nRaiz);
      const traducir = (r) => nuevo.get(r.tag) ||
        (r.tag === tagCatalogo ? PDFRef.of(this.nCatalogo)
          : r.tag === tagInfo ? PDFRef.of(this.nInfo)
            : nodos.has(r.tag) ? raiz : PDFNull);

      // Escritura: cada objeto se reescribe, se vuelca y se suelta.
      const vistosEscritura = new WeakSet();
      let desdeUltimaPausa = 0;
      for (const ref of orden) {
        const obj = ctx.lookup(ref);
        recorrerRefs(obj, traducir, vistosEscritura);
        const antes = this.offset;
        this.guardar(nuevo.get(ref.tag).objectNumber, obj);
        ctx.delete(ref);
        if (this.sinVerificar.length) await this.asegurar();
        desdeUltimaPausa += this.offset - antes;
        if (desdeUltimaPausa >= 32 * 1048576) { desdeUltimaPausa = 0; await sleep(0); }   // que la página respire
      }
      this.cerrarLote();
      this.volcar();
      await this.asegurar();
      return paginas.map((r) => nuevo.get(r.tag));
    }

    /** Cierra el archivo: árbol de páginas, catálogo, datos y tabla de referencias. */
    async cerrar({ paginas, titulo, asunto, creador }) {
      const ctx = this.ctx;
      const ahora = new Date();
      const lib = 'pdf-lib (https://github.com/Hopding/pdf-lib)';
      this.objeto(this.nRaiz, ctx.obj({ Type: 'Pages', Kids: paginas, Count: paginas.length }));
      this.objeto(this.nCatalogo, ctx.obj({ Type: 'Catalog', Pages: PDFRef.of(this.nRaiz) }));
      const info = ctx.obj({});
      info.set(PDFName.of('Title'), PDFHexString.fromText(titulo));
      info.set(PDFName.of('Subject'), PDFHexString.fromText(asunto));
      info.set(PDFName.of('Creator'), PDFHexString.fromText(creador));
      info.set(PDFName.of('Producer'), PDFHexString.fromText(lib));
      info.set(PDFName.of('CreationDate'), PDFString.fromDate(ahora));
      info.set(PDFName.of('ModDate'), PDFString.fromDate(ahora));
      this.objeto(this.nInfo, info);
      this.cerrarLote();

      // Tabla de referencias en flujo, armada acá y no con PDFCrossRefStream:
      // pdf-lib calcula los bytes de cada campo con desplazamientos de 32 bits
      // y corrompe los offsets que pasan los 4 GB. Además la tabla clásica
      // (offsets de 10 dígitos) no llega a 10 GB.
      const nTabla = this.reservar();
      const total = this.siguiente;
      const inicioTabla = this.offset;
      this.xref[nTabla] = inicioTabla;
      let mayor = 0;
      for (let i = 1; i < total; i++) {
        const e = this.xref[i];
        if (e === undefined) throw new Error(`objeto ${i} sin escribir`);
        mayor = Math.max(mayor, typeof e === 'number' ? e : e.flujo);
      }
      const w2 = bytesPara(mayor);
      const ancho = 1 + w2 + 2;
      const filas = new Uint8Array(total * ancho);
      const poner = (pos, valor, bytes) => {
        for (let k = bytes - 1; k >= 0; k--) { filas[pos + k] = valor % 256; valor = Math.floor(valor / 256); }
      };
      poner(1 + w2, 65535, 2);                    // objeto 0: libre, generación 65535
      for (let i = 1; i < total; i++) {
        const e = this.xref[i];
        const pos = i * ancho;
        if (typeof e === 'number') { filas[pos] = 1; poner(pos + 1, e, w2); }
        else { filas[pos] = 2; poner(pos + 1, e.flujo, w2); poner(pos + 1 + w2, e.indice, 2); }
      }
      const id = [...crypto.getRandomValues(new Uint8Array(16))]
        .map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
      const comprimida = await comprimirFlate(filas);
      const dict = ctx.obj({
        Type: 'XRef',
        Size: total,
        W: [1, w2, 2],
        Root: PDFRef.of(this.nCatalogo),
        Info: PDFRef.of(this.nInfo),
        ID: [PDFHexString.of(id), PDFHexString.of(id)]
      });
      if (comprimida) dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
      this.objeto(nTabla, PDFRawStream.of(dict, comprimida || filas));
      this.escribir(ascii(`startxref\n${inicioTabla}\n%%EOF`));
      this.volcar();
      await this.asegurar();
      const blob = new Blob(this.partes, { type: 'application/pdf' });
      this.partes = [];
      return blob;
    }
  }

  async function armarPdf(datos, actuaciones) {
    const limite = CONFIG.tramoMaxMB * 1048576;
    const escritor = new EscritorPdf();
    const paginasCuerpo = [];      // referencias finales, en orden
    let tramos = 0;
    let paginasPrevias = 0;        // páginas de los tramos ya escritos
    let cuerpo = null, f = null, peso = 0;
    // Hoja en curso (2.0.0): las capturas siguen en ella mientras haya lugar.
    const hoja = { pagina: null, indice: -1, y: 0 };

    const abrirTramo = async () => {
      cuerpo = await PDFDocument.create();
      f = {
        normal: await cuerpo.embedFont(StandardFonts.Helvetica),
        bold: await cuerpo.embedFont(StandardFonts.HelveticaBold)
      };
      peso = 0;
      hoja.pagina = null;
    };
    // El tramo lleno se escribe y se suelta antes de seguir con el próximo.
    const cerrarTramo = async (avance) => {
      tramos++;
      ui.progreso(avance, `Guardando el tramo ${tramos} del PDF (${Math.round(peso / 1048576)} MB)…`);
      paginasPrevias += cuerpo.getPageCount();
      paginasCuerpo.push(...await escritor.volcarDocumento(cuerpo));
      cuerpo = null;
      f = null;
    };

    await abrirTramo();
    const indice = [];

    for (const [n, act] of actuaciones.entries()) {
      let desde = paginasPrevias + cuerpo.getPageCount() + 1;
      let capturada = false;
      if (act.captura) {
        try {
          desde = paginasPrevias + await volcarCaptura(cuerpo, act.captura, act.texto, f.normal, hoja) + 1;
          peso += act.captura.bytes;
          capturada = true;
        } catch (e) {
          act.incidencias.push(`No se pudo incorporar la captura: ${e.message}. Queda solo el texto.`);
        }
        act.captura = null;
      }
      if (!capturada) {
        // Sin captura, al menos no se pierde el contenido.
        hoja.pagina = null;
        desde = paginasPrevias + cuerpo.getPageCount() + 1;
        const pag = cuerpo.addPage(A4);
        let y = A4[1] - M;
        pag.drawText(aWinAnsi(`${act.fechaTexto}  —  ${act.descripcion}`).slice(0, 95),
          { x: M, y, size: 10, font: f.bold });
        y -= 20;
        for (const l of envolver(act.texto || '(sin texto)', f.normal, 9, A4[0] - M * 2)) {
          if (y < M) break;
          if (l) pag.drawText(l, { x: M, y, size: 9, font: f.normal });
          y -= 12;
        }
      }

      // Los adjuntos van en hojas propias; la actuación siguiente empieza después.
      const paginasAntesDeAdjuntos = cuerpo.getPageCount();
      for (const adj of act.adjuntos) {
        if (!adj.blob) continue;
        try {
          if (adj.tipo === 'pdf') {
            // Se copian las páginas del original: nada se recompone.
            const bytes = new Uint8Array(await adj.blob.arrayBuffer());
            const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
            const pgs = await cuerpo.copyPages(src, src.getPageIndices());
            pgs.forEach((p) => cuerpo.addPage(p));
            peso += bytes.length;
          } else if (adj.tipo === 'imagen') {
            const bytes = new Uint8Array(await adj.blob.arrayBuffer());
            const img = /png/.test(adj.contentType)
              ? await cuerpo.embedPng(bytes) : await cuerpo.embedJpg(bytes);
            peso += bytes.length;
            const pag = cuerpo.addPage(A4);
            // Se agranda para llenar la hoja (sin el tope de 1x que antes dejaba
            // las imágenes chicas y perdidas en el medio). Mantiene proporción.
            const esc = Math.min((A4[0] - M * 2) / img.width, (A4[1] - M * 2) / img.height);
            pag.drawImage(img, {
              x: (A4[0] - img.width * esc) / 2, y: (A4[1] - img.height * esc) / 2,
              width: img.width * esc, height: img.height * esc
            });
          } else {
            act.incidencias.push(`Adjunto en formato no fusionable (${adj.contentType || 'desconocido'}): ${adj.nombre}. No se incorporó al PDF; se abre desde la MEV: ${adj.url}`);
          }
        } catch (e) {
          act.incidencias.push(`No se pudo incorporar "${adj.nombre || adj.etiqueta}": ${e.message}`);
        } finally {
          adj.blob = null;
        }
      }

      if (cuerpo.getPageCount() !== paginasAntesDeAdjuntos) hoja.pagina = null;

      indice.push({
        n: n + 1, fecha: act.fechaTexto.split(' ')[0],
        desc: act.descripcion, adj: act.adjuntos.length, pagina: desde
      });
      ui.progreso((n + 1) / actuaciones.length,
        `Armando PDF ${n + 1}/${actuaciones.length}` + (tramos ? ` · tramo ${tramos + 1}` : ''));

      // Tramo lleno: se escribe y se libera. El último queda abierto para
      // el anexo de incidencias.
      if (peso >= limite && n < actuaciones.length - 1) {
        await cerrarTramo((n + 1) / actuaciones.length);
        await abrirTramo();
      }
    }

    const incidencias = actuaciones.flatMap((a, i) =>
      a.incidencias.map((t) => `Actuación ${i + 1} — ${a.fechaTexto} — ${a.descripcion}\n    ${t}`));
    if (portero.esperas) {
      incidencias.unshift(`Validación anti-bot — la MEV interpuso ${portero.esperas} vez/veces la pantalla de verificación humana ` +
        `(${portero.segundos}s de espera en total). Las actuaciones afectadas se reintentaron; si alguna quedó sin captura figura más abajo.`);
    }
    if (incidencias.length) {
      let pag = cuerpo.addPage(A4);
      let y = A4[1] - M;
      pag.drawText('ANEXO — INCIDENCIAS DE LA DESCARGA', { x: M, y, size: 11, font: f.bold, color: rgb(0.6, 0.1, 0.1) });
      y -= 22;
      const cuerpoTxt = 'Lo que sigue no pudo incorporarse. Verificalo a mano en la MEV antes de dar el expediente por completo.\n\n' + incidencias.join('\n\n');
      for (const l of envolver(cuerpoTxt, f.normal, 9, A4[0] - M * 2)) {
        // El anexo sigue en otra hoja: antes se cortaba al llenar la primera.
        if (y < M) { pag = cuerpo.addPage(A4); y = A4[1] - M; }
        if (l) pag.drawText(l, { x: M, y, size: 9, font: f.normal });
        y -= 12;
      }
    }
    await cerrarTramo(1);

    // Portada + índice. El offset depende del largo del índice.
    const porPagina = 44;
    const pagsIndice = Math.max(1, Math.ceil(indice.length / porPagina));
    const offset = 1 + pagsIndice;
    const frente = await PDFDocument.create();
    const ff = {
      normal: await frente.embedFont(StandardFonts.Helvetica),
      bold: await frente.embedFont(StandardFonts.HelveticaBold)
    };
    const portada = frente.addPage(A4);
    let y = A4[1] - 150;
    const centrado = (txt, tam, fuente, color) => {
      const t = aWinAnsi(txt);
      portada.drawText(t, {
        x: (A4[0] - fuente.widthOfTextAtSize(t, tam)) / 2, y, size: tam, font: fuente,
        color: color || rgb(0, 0, 0)
      });
      y -= tam + 10;
    };
    centrado('EXPEDIENTE JUDICIAL', 9, ff.normal, rgb(0.45, 0.45, 0.45));
    y -= 14;
    for (const l of envolver(datos.caratula || '(sin carátula)', ff.bold, 17, A4[0] - 130)) {
      portada.drawText(l, { x: (A4[0] - ff.bold.widthOfTextAtSize(l, 17)) / 2, y, size: 17, font: ff.bold });
      y -= 23;
    }
    y -= 18;
    if (datos.expediente) centrado(`Expediente N° ${datos.expediente}`, 11, ff.normal);
    if (datos.receptoria) centrado(`Receptoría ${datos.receptoria}`, 10, ff.normal);
    if (datos.organismo) centrado(datos.organismo, 10, ff.normal);
    if (datos.inicio) centrado(`Inicio: ${datos.inicio}`, 10, ff.normal);
    y -= 22;
    const nAdj = actuaciones.reduce((n, a) => n + a.adjuntos.length, 0);
    centrado(`${actuaciones.length} actuaciones · ${nAdj} adjuntos`, 9.5, ff.normal, rgb(0.4, 0.4, 0.4));
    centrado(`Descargado de la MEV el ${new Date().toLocaleString('es-AR')}`, 8.5, ff.normal, rgb(0.45, 0.45, 0.45));
    if (incidencias.length) {
      y -= 14;
      centrado(`${incidencias.length} incidencia(s) — ver anexo al final`, 9, ff.bold, rgb(0.62, 0.09, 0.09));
    }

    for (let p = 0; p < pagsIndice; p++) {
      const pag = frente.addPage(A4);
      let yy = A4[1] - M;
      pag.drawText(p === 0 ? 'ÍNDICE DE ACTUACIONES' : 'ÍNDICE (continuación)',
        { x: M, y: yy, size: 11, font: ff.bold, color: rgb(0.04, 0.22, 0.33) });
      yy -= 20;
      for (const e of indice.slice(p * porPagina, (p + 1) * porPagina)) {
        const izq = aWinAnsi(`${String(e.n).padStart(3, ' ')}.  ${e.fecha}   ${e.desc}${e.adj ? '  [' + e.adj + ' adj.]' : ''}`).slice(0, 95);
        const der = String(e.pagina + offset);
        pag.drawText(izq, { x: M, y: yy, size: 8, font: ff.normal });
        pag.drawText(der, { x: A4[0] - M - ff.normal.widthOfTextAtSize(der, 8), y: yy, size: 8, font: ff.normal });
        yy -= 11.5;
      }
    }

    // La portada y el índice se escriben al final, pero en el árbol de
    // páginas van primero: el orden de lectura no depende del orden en disco.
    const paginasFrente = await escritor.volcarDocumento(frente);
    ui.estado('Uniendo el PDF…');
    const blob = await escritor.cerrar({
      paginas: [...paginasFrente, ...paginasCuerpo],
      titulo: aWinAnsi(datos.caratula || 'Expediente MEV'),
      asunto: aWinAnsi(`Expediente ${datos.expediente} — ${datos.organismo}`),
      creador: 'MEV SCBA userscript'
    });
    return { blob, tramos };
  }

  /**
   * Catálogo = las filas de la tabla, ya ordenadas cronológicamente. Es lo
   * que muestra la lista de casillas y lo que se recorta al elegir. Guarda
   * solo los datos de la fila, sin el trabajo de captura.
   */
  function construirCatalogo() {
    const tabla = tablaActuaciones();
    if (!tabla) return null;
    const filas = leerFilas(tabla);
    if (!filas.length) return null;
    // La lista se muestra de la más nueva a la más vieja (como la propia MEV).
    // El PDF, en cambio, se arma cronológico (se ordena al bajar).
    const conFecha = filas.filter((f) => f.fecha).length;
    if (conFecha >= Math.max(1, filas.length / 2)) {
      filas.sort((a, b) => (b.fecha ? b.fecha.getTime() : 0) - (a.fecha ? a.fecha.getTime() : 0));
    }
    // Sin fechas confiables se deja el orden de la tabla, que ya es nueva→vieja.
    return filas;
  }

  /** Copia fresca de una entrada del catálogo para trabajar sin ensuciarla. */
  const nuevaActuacion = (m) => ({
    url: m.url, fecha: m.fecha, fechaTexto: m.fechaTexto,
    fojas: m.fojas, firmado: m.firmado, descripcion: m.descripcion,
    captura: null, texto: '', adjuntos: [], incidencias: []
  });

  // ─────────────────────────────────────────────────────────────────────
  // Proceso principal
  // ─────────────────────────────────────────────────────────────────────
  /**
   * Guarda el blob. GM_download falla en silencio cuando Tampermonkey está
   * en modo "Native" y el nombre trae subcarpetas, así que sus errores se
   * escuchan y hay caída a un <a download> común.
   */
  function descargar(blob, nombre) {
    if (ENCARGO) return entregarAlPadre(blob, nombre);
    const url = URL.createObjectURL(blob);
    const porAncla = () => {
      const a = document.createElement('a');
      a.href = url; a.download = nombre;
      document.body.appendChild(a); a.click(); a.remove();
    };
    // Un PDF grande va directo por <a download>: el navegador lo toma del
    // almacenamiento del Blob. GM_download tendría que pasarle el archivo
    // entero a la extensión, otra copia completa en memoria.
    const grande = blob.size >= CONFIG.descargaDirectaMB * 1048576;
    // El enlace se revoca con margen: con varios cientos de MB, la escritura
    // a disco puede tardar más que los tres minutos de antes.
    const margen = Math.max(180000, Math.ceil(blob.size / (100 * 1048576)) * 120000);
    return new Promise((resolve) => {
      if (grande || typeof GM_download !== 'function') { porAncla(); return resolve('ancla'); }
      let resuelto = false;
      const listo = (via) => { if (!resuelto) { resuelto = true; resolve(via); } };
      // Se confía en los callbacks de GM_download y en su propio timeout. NO se
      // usa un temporizador de pared aparte: con un PDF grande, GM_download
      // tarda y ese temporizador disparaba una SEGUNDA descarga por <a download>
      // (el famoso "me baja dos veces"). El fallback a ancla es solo ante error
      // o timeout real, y queda blindado por 'resuelto' para no duplicar.
      try {
        GM_download({
          url, name: nombre, saveAs: false, timeout: 300000,
          onload: () => listo('GM_download'),
          onerror: (e) => {
            log('GM_download falló, cayendo a <a download>', e);
            porAncla(); listo('ancla');
          },
          ontimeout: () => {
            log('GM_download agotó su tiempo, cayendo a <a download>');
            porAncla(); listo('ancla');
          }
        });
      } catch (e) {
        log('GM_download tiró excepción, cayendo a <a download>', e);
        porAncla(); listo('ancla');
      }
    }).finally(() => setTimeout(() => URL.revokeObjectURL(url), margen));
  }

  async function bajarExpediente(todo) {
    if (ui.corriendo()) { corrida.cancelado = true; ui.estado('Cancelando — armo el PDF con lo que haya…'); return; }
    corrida.cancelado = !!(ENCARGO && ENCARGO.cancelado);
    corrida.procesadas = 0;
    corrida.sinEspacio = false;
    portero.esperas = 0;
    portero.segundos = 0;
    portero.pausa = CONFIG.pausaBaseMs;
    portero.aciertos = 0;

    try {
      ui.corriendo(true);
      let catalogo = ui.catalogo() || construirCatalogo();
      if (!catalogo) { ui.estado('No encontré la tabla de actuaciones. ¿Estás en el listado de la causa?'); return; }
      // "Descargar todo" toma todas; "Elegir descarga" toma las tildadas.
      const seleccion = todo ? catalogo.map((_, i) => i) : ui.seleccion();
      if (!seleccion.length) { ui.estado('Elegí al menos una actuación en la lista.'); return; }
      const datos = datosExpediente();
      // Copias frescas de las elegidas: el catálogo guarda solo los datos de
      // la fila; el trabajo (captura, adjuntos) va en estas copias, así una
      // segunda corrida arranca limpia. El PDF sale SIEMPRE cronológico
      // (más vieja → más nueva), aunque la lista se vea al revés.
      let actuaciones = seleccion.map((i) => nuevaActuacion(catalogo[i]));
      actuaciones.sort((a, b) => (a.fecha ? a.fecha.getTime() : 0) - (b.fecha ? b.fecha.getTime() : 0));
      const carpeta = `${nombreSeguro(datos.expediente || 'expediente', 20)}_${nombreSeguro(datos.caratula, 45)}`;

      // 1) Actuaciones, en serie: la MEV es ASP con estado de sesión en el
      //    servidor y en paralelo se desordena. Además, en serie y con
      //    pausas es como no se despierta el portero.
      for (const [i, act] of actuaciones.entries()) {
        if (corrida.cancelado) break;
        ui.progreso(i / actuaciones.length,
          `Capturando ${i + 1}/${actuaciones.length} — ${act.fechaTexto.split(' ')[0]}` +
          (portero.esperas ? `  ·  ${portero.esperas} validación(es)` : ''));
        await procesarActuacion(act);
        corrida.procesadas = i + 1;
        if (CONFIG.descansoCada && (i + 1) % CONFIG.descansoCada === 0 && i + 1 < actuaciones.length) {
          await esperarConCuenta(CONFIG.descansoMs, 'Pausa breve para no despertar la validación —');
        }
      }
      if (corrida.cancelado) {
        actuaciones = actuaciones.slice(0, Math.max(1, corrida.procesadas));
        actuaciones[actuaciones.length - 1].incidencias.push(
          'La descarga se canceló acá. Lo que sigue en la MEV no está en este PDF.');
      }

      // 2) Adjuntos: se traen los PDF de cada actuación. Quedan guardados
      //    en la propia actuación, así el armado los inserta justo detrás
      //    del proveído o escrito al que pertenecen.
      const pend = [];
      actuaciones.forEach((a, i) => a.adjuntos.forEach((adj) => pend.push({ a, adj, orden: i + 1 })));
      let bajados = 0;
      for (const { a, adj, orden } of pend) {
        if ((corrida.cancelado && bajados) || corrida.sinEspacio) break;
        ui.progreso(bajados / Math.max(1, pend.length), `Bajando adjunto ${bajados + 1}/${pend.length}`);
        await bajarAdjunto(a, adj, orden);
        bajados++;
      }
      // Lo que no se llegó a bajar queda asentado en el anexo.
      const motivo = corrida.sinEspacio ? SIN_ESPACIO : 'la descarga se canceló antes de llegar a él';
      for (const { a, adj } of pend.slice(bajados)) {
        a.incidencias.push(`No se bajó el adjunto "${adj.etiqueta}": ${motivo}.`);
      }
      if (corrida.sinEspacio) {
        // Con el almacenamiento lleno, el armado no tendría dónde escribir el
        // PDF: se sueltan los últimos adjuntos bajados hasta dejar dos tramos
        // libres, y quedan asentados en el anexo.
        let liberar = CONFIG.tramoMaxMB * 2 * 1048576;
        for (let k = bajados - 1; k >= 0 && liberar > 0; k--) {
          const { a, adj } = pend[k];
          if (!adj.blob) continue;
          liberar -= adj.blob.size;
          adj.blob = null;
          a.incidencias.push(`No se incorporó el adjunto "${adj.etiqueta}": se descartó para dejar lugar al armado del PDF (${SIN_ESPACIO}).`);
        }
      }
      const ok = pend.filter(({ adj }) => adj.blob).length;

      // 3) PDF: actuación, sus adjuntos, siguiente actuación. Pasados los
      //    CONFIG.tramoMaxMB se arma por tramos y se une al final.
      corrida.cancelado = false;          // el armado no se cancela
      ui.estado('Armando el PDF…');
      const { blob, tramos } = await armarPdf(datos, actuaciones);
      await descargar(blob, `${carpeta}.pdf`);

      const inc = actuaciones.reduce((n, x) => n + x.incidencias.length, 0);
      ui.progreso(1,
        `Listo — ${carpeta}.pdf (${Math.round(blob.size / 1048576)} MB` +
        (tramos > 1 ? `, armado en ${tramos} tramos` : '') + '): ' +
        `${actuaciones.length} actuaciones y ${ok}/${pend.length} adjuntos` +
        (portero.esperas ? ` · ${portero.esperas} validación(es), ${portero.segundos}s de espera` : '') +
        (corrida.sinEspacio ? ' · FALTÓ ESPACIO EN EL DISCO: el PDF está incompleto' : '') +
        (inc ? ` · ${inc} incidencia(s) en el anexo.` : '.'));
    } catch (e) {
      console.error(e);
      ui.estado('Error: ' + e.message);
    } finally {
      corrida.cancelado = false;
      ui.ocultarAyuda();
      ui.corriendo(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Panel
  // ─────────────────────────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────────────
  // Enlace con la ventana de MEV Ultra (encargo)
  // ─────────────────────────────────────────────────────────────────────
  function avisarPadre(msg) {
    try { window.parent.postMessage(Object.assign({ mevultra: 'encargo', id: ENCARGO.id }, msg), location.origin); } catch (e) { log('no pude avisar a la ventana', e); }
  }
  const ordenesPadre = { seguir: null, guardado: null };
  window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (!d || d.mevultra !== 'ordenes' || d.id !== ENCARGO.id || ev.source !== window.parent || ev.origin !== location.origin) return;
    if (d.orden === 'cancelar') { ENCARGO.cancelado = true; corrida.cancelado = true; }
    else if (d.orden === 'seguir' && ordenesPadre.seguir) { const f = ordenesPadre.seguir; ordenesPadre.seguir = null; f(); }
    else if (d.orden === 'archivoGuardado' && ordenesPadre.guardado) { const f = ordenesPadre.guardado; ordenesPadre.guardado = null; f(d.via); }
  });
  // El PDF lo guarda la ventana: desde un marco oculto la descarga no siempre
  // se dispara. Se espera su confirmación para que la corrida termine después.
  function entregarAlPadre(blob, nombre) {
    if (ENCARGO.urls && ENCARGO.urls.length) {
      nombre = nombre.replace(/\.pdf$/i, (ENCARGO.urls.length === 1 ? '_una-actuacion' : '_' + ENCARGO.urls.length + '-actuaciones') + '.pdf');
    }
    return new Promise((resolve) => {
      const corte = setTimeout(() => { ordenesPadre.guardado = null; resolve('ventana'); }, 600000);
      ordenesPadre.guardado = (via) => { clearTimeout(corte); resolve(via || 'ventana'); };
      avisarPadre({ tipo: 'archivo', blob, nombre });
    });
  }
  // Actuaciones pedidas: se buscan por su dirección; si la MEV la escribió
  // distinto, por los parámetros que la identifican (sCodi y nPosi).
  function seleccionEncargo() {
    const cat = construirCatalogo() || [];
    if (!ENCARGO.urls) return cat.map((_, i) => i);
    const firma = (u) => { try { const p = new URL(u, location.href).searchParams; return (p.get('sCodi') || '') + '|' + (p.get('nPosi') || '') + '|' + (p.get('sFile') || ''); } catch (e) { return u; } };
    const pedidas = new Set(ENCARGO.urls);
    const firmas = new Set(ENCARGO.urls.map(firma));
    const out = [];
    cat.forEach((a, i) => { if (pedidas.has(a.url) || firmas.has(firma(a.url))) out.push(i); });
    return out;
  }
  function crearUiEncargo() {
    let activa = false;
    let ultimo = '';
    return {
      estado: (t) => { ultimo = String(t || ''); avisarPadre({ tipo: 'estado', texto: ultimo }); },
      progreso: (f, t) => { ultimo = String(t || ''); avisarPadre({ tipo: 'progreso', fraccion: f, texto: ultimo }); },
      corriendo: (b) => { if (b === undefined) return activa; activa = !!b; return activa; },
      seleccion: () => seleccionEncargo(),
      catalogo: () => null,
      pedirAyuda: ({ texto, onSeguir }) => { ordenesPadre.seguir = onSeguir; avisarPadre({ tipo: 'ayuda', texto }); },
      ocultarAyuda: () => { ordenesPadre.seguir = null; avisarPadre({ tipo: 'ayuda', texto: '' }); },
      ultimo: () => ultimo
    };
  }
  async function arrancarEncargo() {
    if (ENCARGO.perdido) { avisarPadre({ tipo: 'fin', texto: 'No encontré el encargo de esta descarga. Volvé a pedirla.' }); return; }
    ui.estado('Abriendo la causa…');
    for (let i = 0; i < 90 && !document.querySelector(SEL.linkActuacion); i++) {
      if (ENCARGO.cancelado) { avisarPadre({ tipo: 'fin', texto: 'Cancelada antes de empezar.' }); return; }
      if (/Ingrese(?:\s|&nbsp;)+los(?:\s|&nbsp;)+datos/i.test(document.body ? document.body.innerHTML : '')) { avisarPadre({ tipo: 'fin', texto: 'La sesión de la MEV venció. Ingresá de nuevo y volvé a bajar.' }); return; }
      if (esPantallaValidacion(document.documentElement.outerHTML)) ui.estado('La MEV está validando el acceso. Espero…');
      await sleep(1000);
    }
    if (!document.querySelector(SEL.linkActuacion)) {
      avisarPadre({ tipo: 'fin', texto: 'La causa no mostró sus pasos procesales (validación de la MEV o sesión vencida). Probá abrirla en la MEV y volver a bajar.' });
      return;
    }
    await bajarExpediente(!ENCARGO.urls);
    if (ENCARGO.sesionVencida) { avisarPadre({ tipo: 'fin', texto: 'La sesión de la MEV venció a mitad de la descarga: el PDF que se guardó está incompleto. Ingresá de nuevo y volvé a bajar.' }); return; }
    avisarPadre({ tipo: 'fin', texto: ui.ultimo() || 'Terminado.' });
  }

  const ui = ENCARGO ? crearUiEncargo() : (function () {
    const escapar = (s) => (s || '').replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const miniBtn = 'padding:4px 7px;cursor:pointer;background:#eef3f5;color:#12303a;border:1px solid #cbd8de;border-radius:4px;font-size:10px;font-weight:600';
    const tabBtn = 'flex:1;padding:6px 4px;cursor:pointer;background:transparent;border:0;border-bottom:2px solid transparent;font-size:12px;font-weight:600;color:#5a7581';
    const winBtn = 'width:22px;height:19px;line-height:1;padding:0;margin-left:1px;border:0;background:transparent;color:#5a7581;font-size:14px;cursor:pointer;border-radius:3px;font-weight:700';

    const aboutHTML =
      '<div style="font-size:12px;line-height:1.65;padding:4px 2px 2px">' +
      '<div style="font-weight:700;color:#0d4a2b;font-size:13px">' + escapar(APP.nombre) + '</div>' +
      '<div style="color:#5a7581;margin-bottom:9px">Versión ' + escapar(APP.version) + '</div>' +
      '<div>Creado por <b>' + escapar(APP.autor) + '</b> con Claude.</div>' +
      '<div><a href="mailto:' + escapar(APP.mail) + '" style="color:#0a6cab">' + escapar(APP.mail) + '</a></div>' +
      '<div style="margin:9px 0;padding:8px 10px;background:#f4f7f8;border-radius:6px;color:#3a4c54;font-size:11px">' +
      '<b>Copyleft &#8212; ' + escapar(APP.licencia) + '.</b><br>' +
      'Copyright (C) ' + escapar(APP.anio) + ' ' + escapar(APP.autor) + '. Software libre: se permite y se alienta su uso, copia, ' +
      'modificación y distribución de forma gratuita, siempre que las obras derivadas conserven esta misma licencia. ' +
      'Sin garantía. <a href="' + escapar(APP.licenciaUrl) + '" target="_blank" rel="noopener noreferrer" style="color:#0a6cab">Texto de la licencia &#8599;</a>' +
      '</div>' +
      '<a href="' + escapar(APP.github) + '" target="_blank" rel="noopener noreferrer" ' +
      'style="display:inline-block;padding:7px 11px;background:#24292f;color:#fff;border-radius:5px;text-decoration:none;font-size:11px;font-weight:600">Ver en GitHub &#8599;</a>' +
      '</div>';

    const caja = document.createElement('div');
    caja.style.cssText = [
      'position:fixed', 'right:14px', 'bottom:14px', 'z-index:2147483647',
      'background:#fff', 'border:1px solid #0d4a2b', 'border-radius:8px',
      'box-shadow:0 6px 20px rgba(0,0,0,.28)', 'padding:11px 13px',
      'font:12px/1.45 system-ui,Segoe UI,sans-serif', 'width:360px', 'color:#12303a'
    ].join(';');
    caja.innerHTML =
      // Barra de título con controles de ventana
      '<div data-e="hdr" style="display:flex;justify-content:space-between;align-items:center">' +
      '<span data-e="titulo" style="font-weight:700;color:#0d4a2b;cursor:pointer" title="Clic para minimizar/restaurar">Bajar expediente</span>' +
      '<span style="display:flex;gap:1px;flex:none">' +
      '<button data-e="min" title="Minimizar" style="' + winBtn + '">&#8211;</button>' +
      '<button data-e="max" title="Maximizar" style="' + winBtn + '">&#9633;</button>' +
      '<button data-e="cerrar" title="Cerrar" style="' + winBtn + '">&#10005;</button>' +
      '</span>' +
      '</div>' +
      '<div data-e="cuerpo" style="margin-top:8px">' +
      // Estado / progreso / ayuda anti-bot (compartidos por los dos modos)
      '<div style="display:flex;justify-content:flex-end;margin:-2px 0 5px">' +
      '<span data-e="recargar" title="Recargar la página (útil si la MEV está validando el acceso)" style="font-size:10px;font-weight:500;color:#0a6cab;cursor:pointer;text-decoration:underline">recargar página</span>' +
      '</div>' +
      '<div data-e="estado" style="min-height:34px;color:#33505c">Elegí un modo abajo.</div>' +
      '<div style="background:#e3ebef;border-radius:3px;height:5px;margin:9px 0">' +
      '<div data-e="barra" style="background:#0d4a2b;height:5px;width:0;border-radius:3px;transition:width .25s"></div></div>' +
      '<div data-e="ayuda" style="display:none;background:#fff6e5;border:1px solid #e0b25c;border-radius:6px;padding:8px;margin-bottom:8px">' +
      '<div data-e="ayudaTxt" style="font-size:11px;color:#6b4a10;margin-bottom:7px"></div>' +
      '<div style="display:flex;gap:6px">' +
      '<button data-e="abrir" style="flex:1;padding:5px;cursor:pointer;background:#e0b25c;color:#3b2a06;border:0;border-radius:4px;font-size:11px;font-weight:600">Abrir en otra pestaña</button>' +
      '<button data-e="seguir" style="flex:1;padding:5px;cursor:pointer;background:#0d4a2b;color:#fff;border:0;border-radius:4px;font-size:11px;font-weight:600">Ya validé — seguir</button>' +
      '</div></div>' +
      // Solapas
      '<div style="display:flex;gap:3px;margin-bottom:9px;border-bottom:1px solid #dbe4e8">' +
      '<button data-e="navTodo" style="' + tabBtn + '">Descargar todo</button>' +
      '<button data-e="navElegir" style="' + tabBtn + '">Elegir descarga</button>' +
      '<button data-e="navAbout" style="' + tabBtn + '">About</button>' +
      '</div>' +
      // Solapa "Descargar todo"
      '<div data-e="tabTodo">' +
      '<div style="font-size:11px;color:#3a4c54;margin-bottom:9px;line-height:1.5">Baja el expediente <b>completo</b> tal como la MEV lo presenta: todas las actuaciones y sus adjuntos, en un único PDF cronológico. Sin elegir.</div>' +
      '<button data-e="irTodo" style="width:100%;padding:9px;cursor:pointer;background:#0d4a2b;color:#fff;border:0;border-radius:5px;font-weight:600">Descargar expediente completo (1 PDF)</button>' +
      '</div>' +
      // Solapa "Elegir descarga"
      '<div data-e="tabElegir" style="display:none">' +
      '<div style="display:flex;justify-content:flex-end;margin:-2px 0 5px">' +
      '<span data-e="releer" title="Releer la lista de actuaciones sin recargar" style="font-size:10px;font-weight:500;color:#0a6cab;cursor:pointer;text-decoration:underline">releer lista</span>' +
      '</div>' +
      '<input data-e="buscar" type="text" placeholder="Filtrar por fecha o texto…" ' +
      'style="width:100%;box-sizing:border-box;padding:5px;border:1px solid #b9c9d0;border-radius:4px;font-size:11px;margin-bottom:6px">' +
      '<div style="display:flex;gap:5px;align-items:center;margin-bottom:6px">' +
      '<button data-e="todas" style="' + miniBtn + '">Todas</button>' +
      '<button data-e="ninguna" style="' + miniBtn + '">Ninguna</button>' +
      '<button data-e="invertir" style="' + miniBtn + '">Invertir</button>' +
      '<span data-e="contador" style="margin-left:auto;font-size:11px;color:#5a7581">0 de 0</span>' +
      '</div>' +
      '<div style="display:flex;gap:5px;align-items:center;margin-bottom:5px;font-size:11px">' +
      '<span style="color:#5a7581">Fechas</span>' +
      '<input data-e="fdesde" type="date" style="flex:1;min-width:0;padding:3px;border:1px solid #b9c9d0;border-radius:4px;font-size:11px">' +
      '<span>a</span>' +
      '<input data-e="fhasta" type="date" style="flex:1;min-width:0;padding:3px;border:1px solid #b9c9d0;border-radius:4px;font-size:11px">' +
      '</div>' +
      '<div style="display:flex;gap:5px;margin-bottom:8px">' +
      '<button data-e="marcarf" title="Tildar las actuaciones que están entre esas dos fechas" style="' + miniBtn + '">Marcar entre fechas</button>' +
      '<button data-e="filtrarf" title="Mostrar solo las actuaciones entre esas dos fechas" style="' + miniBtn + '">Filtrar</button>' +
      '</div>' +
      '<div data-e="lista" style="max-height:250px;overflow:auto;border:1px solid #dbe4e8;border-radius:5px;margin-bottom:8px;background:#fbfcfd"></div>' +
      '<button data-e="ir" style="width:100%;padding:8px;cursor:pointer;background:#0d4a2b;color:#fff;border:0;border-radius:5px;font-weight:600">Bajar seleccionadas</button>' +
      '</div>' +
      // Solapa About
      '<div data-e="tabAbout" style="display:none">' + aboutHTML + '</div>' +
      '</div>';   // cierra cuerpo

    const q = (n) => caja.querySelector('[data-e="' + n + '"]');

    // ── Controles de ventana: minimizar / maximizar / cerrar ──
    const WKEY = '__mev_win';
    let estadoWin = 'normal';
    const pill = document.createElement('button');
    pill.textContent = '⬇ Bajar expediente';
    pill.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:2147483647;display:none;' +
      'padding:8px 12px;background:#0d4a2b;color:#fff;border:0;border-radius:8px;cursor:pointer;' +
      'font:600 12px system-ui,Segoe UI,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.25)';
    function setEstadoWin(s) {
      estadoWin = s;
      if (s !== 'closed') { try { localStorage.setItem(WKEY, s); } catch (e) {} }
      if (s === 'closed') { caja.style.display = 'none'; pill.style.display = ''; return; }
      caja.style.display = ''; pill.style.display = 'none';
      q('cuerpo').style.display = s === 'min' ? 'none' : '';
      caja.style.width = s === 'max' ? '460px' : '360px';
      const lst = caja.querySelector('[data-e="lista"]');
      if (lst) lst.style.maxHeight = s === 'max' ? '62vh' : '250px';
      q('max').textContent = s === 'max' ? '❐' : '□';
    }

    // ── Arrastre libre desde la barra de título (recuerda la posición) ──
    let justDragged = false;
    function habilitarArrastre(POSKEY) {
      const handle = q('hdr');
      handle.style.cursor = 'move';
      let sx, sy, ox, oy, moviendo = false, arrastro = false;
      const aplicarPos = (left, top) => {
        const w = caja.offsetWidth;
        left = Math.max(4, Math.min(left, window.innerWidth - Math.min(w, 90) - 4));
        top = Math.max(4, Math.min(top, window.innerHeight - 28));
        caja.style.left = left + 'px'; caja.style.top = top + 'px';
        caja.style.right = 'auto'; caja.style.bottom = 'auto';
      };
      handle.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;   // los botones de ventana no arrastran
        e.preventDefault();
        justDragged = false;
        const r = caja.getBoundingClientRect();
        ox = r.left; oy = r.top; sx = e.clientX; sy = e.clientY; moviendo = true; arrastro = false;
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
      function onMove(e) {
        if (!moviendo) return;
        const dx = e.clientX - sx, dy = e.clientY - sy;
        if (!arrastro && Math.abs(dx) + Math.abs(dy) < 4) return;   // umbral: distingue click de arrastre
        arrastro = true; caja.style.userSelect = 'none';
        aplicarPos(ox + dx, oy + dy);
      }
      function onUp() {
        moviendo = false; caja.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (arrastro) {
          justDragged = true;
          try { localStorage.setItem(POSKEY, JSON.stringify({ left: parseInt(caja.style.left, 10), top: parseInt(caja.style.top, 10) })); } catch (e) {}
        }
      }
      try { const p = JSON.parse(localStorage.getItem(POSKEY)); if (p && typeof p.left === 'number') aplicarPos(p.left, p.top); } catch (e) {}
    }

    // Cambio de solapa: marca la activa y muestra su contenido.
    function irASolapa(cual) {
      q('tabTodo').style.display = cual === 'todo' ? '' : 'none';
      q('tabElegir').style.display = cual === 'elegir' ? '' : 'none';
      q('tabAbout').style.display = cual === 'about' ? '' : 'none';
      const act = (btn, on) => {
        btn.style.color = on ? '#0d4a2b' : '#5a7581';
        btn.style.borderBottomColor = on ? '#0d4a2b' : 'transparent';
      };
      act(q('navTodo'), cual === 'todo');
      act(q('navElegir'), cual === 'elegir');
      act(q('navAbout'), cual === 'about');
    }
    let activa = false;
    let catalogoRef = null;

    const lista = () => q('lista');
    const filas = () => [...lista().querySelectorAll('label')];
    const visibles = () => filas().filter((l) => l.style.display !== 'none');

    // Shift+click: tilda/destilda el rango entre el último click y este,
    // sobre las filas visibles, con el estado de la casilla recién clickeada.
    let anclaSel = null;
    let rangoFecha = { d: null, h: null };
    function manejarShift(e, fila) {
      const vis = visibles();
      const idx = vis.indexOf(fila);
      if (e.shiftKey && anclaSel !== null && anclaSel >= 0 && anclaSel < vis.length && idx >= 0) {
        const val = fila.querySelector('input').checked;
        const a = Math.min(anclaSel, idx), b = Math.max(anclaSel, idx);
        for (let k = a; k <= b; k++) vis[k].querySelector('input').checked = val;
        try { window.getSelection().removeAllRanges(); } catch (e2) { /* nada */ }
      }
      anclaSel = idx;
      actualizarContador();
    }

    function actualizarContador() {
      const total = catalogoRef ? catalogoRef.length : 0;
      const sel = lista().querySelectorAll('input:checked').length;
      q('contador').textContent = sel + ' de ' + total;
      if (!activa) q('ir').textContent = 'Bajar seleccionadas (' + sel + ')';
    }

    // Visibilidad = filtro de texto Y rango de fechas, combinados.
    function aplicarFiltros() {
      const t = q('buscar').value.trim().toLowerCase();
      filas().forEach((l) => {
        const okTxt = !t || l.dataset.txt.includes(t);
        let okFecha = true;
        if (rangoFecha.d || rangoFecha.h) {
          const f = catalogoRef[+l.querySelector('input').dataset.idx].fecha;
          okFecha = !!(f && (!rangoFecha.d || f >= rangoFecha.d) && (!rangoFecha.h || f <= rangoFecha.h));
        }
        l.style.display = (okTxt && okFecha) ? 'flex' : 'none';
      });
    }

    function renderLista() {
      catalogoRef = construirCatalogo();
      const cont = lista();
      cont.innerHTML = '';
      if (!catalogoRef) {
        cont.innerHTML = '<div style="padding:9px;font-size:11px;color:#8a2b2b">No hay tabla de actuaciones en esta página. ' +
          'Si la MEV está validando el acceso, esperá a que cargue la causa y tocá “releer lista”.</div>';
        actualizarContador();
        return;
      }
      const frag = document.createDocumentFragment();
      catalogoRef.forEach((m, i) => {
        const fila = document.createElement('label');
        fila.style.cssText = 'display:flex;gap:7px;align-items:flex-start;padding:4px 6px;border-bottom:1px solid #eef2f4;cursor:pointer';
        fila.dataset.txt = ((m.fechaTexto || '') + ' ' + (m.descripcion || '')).toLowerCase();
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = true; cb.dataset.idx = i;
        cb.style.marginTop = '2px';
        cb.addEventListener('change', actualizarContador);
        cb.addEventListener('click', (e) => manejarShift(e, fila));
        const txt = document.createElement('span');
        txt.style.cssText = 'font-size:11px;line-height:1.35';
        const fecha = (m.fechaTexto || '').split(' ')[0] || 's/f';
        txt.innerHTML = '<b>' + String(i + 1).padStart(3, '0') + '.</b> ' + fecha + ' — ' +
          escapar(m.descripcion || '(sin descripción)') +
          (m.firmado ? ' <span title="firmado" style="color:#0a6">✔</span>' : '');
        fila.appendChild(cb); fila.appendChild(txt);
        frag.appendChild(fila);
      });
      cont.appendChild(frag);
      // Los date-picker se acotan al rango real del expediente (independiente
      // del orden en que se muestre la lista).
      const ms = catalogoRef.map((m) => m.fecha).filter(Boolean).map((f) => f.getTime());
      if (ms.length) {
        const yyyymmdd = (f) => `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
        q('fdesde').min = q('fhasta').min = yyyymmdd(new Date(Math.min(...ms)));
        q('fdesde').max = q('fhasta').max = yyyymmdd(new Date(Math.max(...ms)));
      }
      // Al re-armar la lista, el rango de fechas se resetea; se respeta el texto.
      rangoFecha = { d: null, h: null };
      aplicarFiltros();
      actualizarContador();
    }

    // Marca (tilda) las actuaciones dentro del rango de fechas y destilda el
    // resto. Alcanza a todo el catálogo, no solo a lo visible.
    // Lee el rango de los date-picker. Las fechas ISO (yyyy-mm-dd) se comparan
    // como texto = cronológico: si vino al revés (desde después de hasta), se
    // corrige solo.
    function leerRango() {
      let vd = q('fdesde').value, vh = q('fhasta').value;
      if (vd && vh && vd > vh) { const t = vd; vd = vh; vh = t; }
      return { d: vd ? new Date(vd + 'T00:00:00') : null, h: vh ? new Date(vh + 'T23:59:59') : null };
    }

    // "Marcar entre fechas": tilda las actuaciones del rango y destilda el
    // resto (la selección pasa a ser exactamente ese rango). No oculta nada.
    function marcarPorFecha() {
      if (!catalogoRef) return;
      const { d, h } = leerRango();
      if (!d && !h) { api.estado('Poné al menos una fecha para marcar entre fechas.'); return; }
      let n = 0;
      filas().forEach((l) => {
        const cb = l.querySelector('input');
        const f = catalogoRef[+cb.dataset.idx].fecha;
        cb.checked = !!(f && (!d || f >= d) && (!h || f <= h));
        if (cb.checked) n++;
      });
      actualizarContador();
      api.estado(`${n} actuación(es) marcadas entre esas fechas.`);
    }

    // "Filtrar": muestra SOLO las actuaciones del rango (oculta el resto). No
    // toca la selección. Sin fechas, quita el filtro.
    function filtrarPorFecha() {
      if (!catalogoRef) return;
      const { d, h } = leerRango();
      rangoFecha.d = d; rangoFecha.h = h;
      aplicarFiltros();
      if (!d && !h) api.estado('Filtro de fechas quitado: se ven todas.');
      else api.estado(`Mostrando ${visibles().length} actuación(es) entre esas fechas.`);
      actualizarContador();
    }

    const api = {
      estado: (t) => { q('estado').textContent = t; log(t); },
      progreso: (frac, t) => {
        q('barra').style.width = Math.round(frac * 100) + '%';
        if (t) { q('estado').textContent = t; log(t); }
      },
      corriendo: (b) => {
        if (b === undefined) return activa;
        activa = b;
        const ir = q('ir'), irTodo = q('irTodo');
        if (b) {
          // Cualquiera de los dos botones cancela mientras corre.
          ir.textContent = 'Cancelar'; ir.style.background = '#8a2b2b';
          irTodo.textContent = 'Cancelar'; irTodo.style.background = '#8a2b2b';
        } else {
          ir.style.background = '#0d4a2b';
          irTodo.textContent = 'Descargar expediente completo (1 PDF)'; irTodo.style.background = '#0d4a2b';
          actualizarContador();
        }
        ['todas', 'ninguna', 'invertir', 'buscar', 'releer', 'fdesde', 'fhasta', 'marcarf', 'filtrarf', 'navTodo', 'navElegir'].forEach((n) => {
          const el = q(n); if (el) { el.style.pointerEvents = b ? 'none' : ''; el.style.opacity = b ? 0.5 : 1; }
        });
        return activa;
      },
      // Índices del catálogo tildados, en orden.
      seleccion: () => [...lista().querySelectorAll('input:checked')].map((c) => +c.dataset.idx),
      catalogo: () => catalogoRef,
      pedirAyuda: ({ texto, onAbrir, onSeguir }) => {
        q('ayudaTxt').textContent = texto;
        q('abrir').onclick = onAbrir;
        q('seguir').onclick = onSeguir;
        q('ayuda').style.display = 'block';
      },
      ocultarAyuda: () => { q('ayuda').style.display = 'none'; }
    };

    (function montar() {
      if (!document.body) return setTimeout(montar, 250);
      document.body.appendChild(caja);
      document.body.appendChild(pill);

      // Controles de ventana
      q('min').addEventListener('click', () => setEstadoWin('min'));
      q('max').addEventListener('click', () => setEstadoWin(estadoWin === 'max' ? 'normal' : 'max'));
      q('cerrar').addEventListener('click', () => setEstadoWin('closed'));
      q('titulo').addEventListener('click', () => {
        if (justDragged) { justDragged = false; return; }   // si venís de arrastrar, no minimiza
        setEstadoWin(estadoWin === 'min' ? 'normal' : 'min');
      });
      [q('min'), q('max'), q('cerrar')].forEach((b) => {
        b.addEventListener('mouseenter', () => { b.style.background = b === q('cerrar') ? '#f2c4c4' : '#e3ebef'; });
        b.addEventListener('mouseleave', () => { b.style.background = 'transparent'; });
      });
      habilitarArrastre('__mev_pos');
      // Pedido del autor: abre SIEMPRE minimizado. Se expande con el botón de
      // la barra o clic en el título; al recargar vuelve a minimizado.
      setEstadoWin('min');

      q('navTodo').addEventListener('click', () => irASolapa('todo'));
      q('navElegir').addEventListener('click', () => irASolapa('elegir'));
      q('navAbout').addEventListener('click', () => irASolapa('about'));
      irASolapa('todo');

      q('irTodo').addEventListener('click', () => bajarExpediente(true));
      q('ir').addEventListener('click', () => bajarExpediente(false));
      q('recargar').addEventListener('click', () => {
        if (activa && !confirm('Hay una descarga en curso. ¿Recargar igual? Se pierde el avance.')) return;
        sessionStorage.removeItem('mev_val_espera');   // recarga a mano = arranca limpio
        location.reload();
      });
      q('releer').addEventListener('click', () => { if (!activa) { renderLista(); api.estado('Lista actualizada.'); } });
      q('buscar').addEventListener('input', aplicarFiltros);
      // Todas / Ninguna / Invertir operan sobre lo visible: con un filtro
      // puesto, alcanzan solo a las filas que el filtro dejó a la vista.
      q('todas').addEventListener('click', () => { visibles().forEach((l) => l.querySelector('input').checked = true); actualizarContador(); });
      q('ninguna').addEventListener('click', () => { visibles().forEach((l) => l.querySelector('input').checked = false); actualizarContador(); });
      q('invertir').addEventListener('click', () => {
        visibles().forEach((l) => { const c = l.querySelector('input'); c.checked = !c.checked; });
        actualizarContador();
      });
      q('marcarf').addEventListener('click', marcarPorFecha);
      q('filtrarf').addEventListener('click', filtrarPorFecha);

      const n = document.querySelectorAll(SEL.linkActuacion).length;
      if (n) {
        // Página buena: se arma la lista y no se toca nada más.
        sessionStorage.removeItem('mev_val_espera');
        renderLista();
        api.estado(`${catalogoRef ? catalogoRef.length : n} actuaciones. "Descargar todo", o "Elegir descarga" para tildar / por fechas.`);
      } else if (esPantallaValidacion(document.documentElement.outerHTML)) {
        // El listado todavía es el cartel de validación. NO se recarga en
        // seco: recargar reinicia el desafío y no termina nunca. Se le da
        // tiempo a que se resuelva y redirija solo; recién si no pasó se
        // recarga UNA vez, y con margen.
        const vueltas = +(sessionStorage.getItem('mev_val_espera') || 0);
        if (vueltas < 2) {
          sessionStorage.setItem('mev_val_espera', vueltas + 1);
          let seg = 18;
          api.estado('La MEV está validando el acceso. Dejá esta pestaña quieta; se resuelve sola.');
          const reloj = setInterval(() => {
            if (document.querySelectorAll(SEL.linkActuacion).length) {
              clearInterval(reloj); sessionStorage.removeItem('mev_val_espera'); renderLista();
              api.estado('Validación superada. Elegí las actuaciones y bajá.');
              return;
            }
            seg--;
            api.estado(`Validando acceso… si no cede sola, recargo en ${seg}s (dejá la pestaña quieta).`);
            if (seg <= 0) { clearInterval(reloj); location.reload(); }
          }, 1000);
        } else {
          api.estado('La validación no cede sola. Recargá la página a mano una vez y esperá unos segundos sin tocar nada.');
        }
      } else {
        api.estado('No estoy en el listado de una causa. Abrí el expediente y tocá “releer lista”.');
      }
    })();

    return api;
  })();

  log(`v${APP.version} cargado —`, document.querySelectorAll(SEL.linkActuacion).length, 'actuaciones');
  if (ENCARGO) arrancarEncargo();
})();


/*
 * ===========================================================================
 *  MÓDULO 2 — LA VENTANA DE MEV ULTRA
 * ===========================================================================
 *
 * Corre en la pestaña principal (nunca dentro de un marco) en cualquier
 * página de la MEV con sesión iniciada. Reúne en una sola ventana:
 *
 *   · Mis causas: todas las causas de todos los Sets de Búsqueda, de todos
 *     los departamentos judiciales, fueros y organismos, en una sola tabla.
 *   · Este expediente: datos de la causa y sus pasos procesales, con la
 *     selección de actuaciones para bajar.
 *   · Descargas: la cola de expedientes que se están bajando con el motor
 *     de MEV+ (módulo 1), uno por vez, en segundo plano.
 *   · Sets: qué contiene cada Set y dónde se encontró cada causa.
 *   · Buscar persona: un nombre en la carátula de las causas de todos los
 *     juzgados civiles y comerciales y de paz de la provincia (ver
 *     "buscar persona", más abajo).
 *   · Datos: etiquetas, anotaciones y respaldo cifrado.
 *
 * CÓMO LLEGA A LAS CAUSAS (relevado en la sesión real el 22/09/2026)
 *
 *   La MEV no devuelve un Set entero de una vez. El resultado de un Set
 *   depende de dos cosas que quedan guardadas en la sesión del servidor:
 *
 *   1. La jurisdicción elegida en POSLoguin.asp (departamento judicial y
 *      fuero, o Suprema Corte, Casación Penal o Justicia de Paz). Solo se
 *      ven las causas del Set que están en esa jurisdicción; si no hay, la
 *      MEV responde "El Set seleccionado contiene Expedientes de otra
 *      Jurisdicción o, no tiene Expedientes cargadas".
 *   2. El organismo. resultados.asp muestra solo las causas del primer
 *      organismo y trae un desplegable "Organismos del Set" con los demás.
 *      Cada organismo se consulta con un POST a resultados.asp con
 *      JuzgadoElegido y Consultar.
 *
 *   Por eso el Set "San Isidro PG" (77 según Sets.asp) mostraba 9 causas: eran
 *   las del Juzgado Civil y Comercial 1. Recorriendo sus quince organismos
 *   aparecen 76, más una en Quilmes y dos en San Martín.
 *
 *   La lectura cambia la jurisdicción de la sesión de la MEV mientras
 *   trabaja. Al terminar deja puesta la jurisdicción que había al empezar.
 *   Mientras lee conviene no navegar la MEV en otras pestañas.
 *
 *   procesales.asp y proveido.asp se abren por nidCausa y pidJuzgado y no
 *   dependen de la jurisdicción elegida (verificado con una causa de Quilmes
 *   estando en Tandil).
 *
 * QUÉ NO HACE
 *
 *   Solo lee. No crea, modifica ni borra Sets, no solicita autorizaciones y
 *   no presenta nada. Lo que guarda (índice, etiquetas, anotaciones) queda en
 *   este equipo, separado por usuario de la MEV.
 */
(function () {
  'use strict';

  // Los marcos son del módulo 1. Con los permisos de Tampermonkey, "window"
  // es un envoltorio y no se puede comparar con window.top: se mira si la
  // página está dentro de un marco.
  const EN_MARCO = (() => { try { return window.frameElement !== null; } catch (e) { return true; } })();
  if (EN_MARCO) return;
  if (window.__MEV_ULTRA_VENTANA__) return;
  window.__MEV_ULTRA_VENTANA__ = true;

  const W = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;
  const NBSP = String.fromCharCode(160);

  const APP = {
    nombre: 'MEV Ultra',
    version: 'beta 0.5.1',
    autor: 'Ignacio Kinbaum',
    anio: '2026',
    mail: 'estudiojuridicokinbaum@gmail.com',
    licencia: 'GPL-3.0-or-later',
    licenciaUrl: 'https://www.gnu.org/licenses/gpl-3.0.html',
    github: 'https://github.com/Elzas85/MEVULTRA'
  };

  // ---------------------------------------------------------------- utilidades
  // Reloj que no se frena con la pestaña en segundo plano. Chrome demora los
  // temporizadores de una pestaña que no está a la vista (verificado el
  // 24/09/2026: una espera de 0,1 s tardaba 1 s dentro del marco de la
  // descarga, y pasados unos minutos llega a una por minuto), y la descarga
  // se arrastraba hasta darse por cortada. Los temporizadores de un Worker
  // no se demoran. Si el Worker no se puede crear, se usa el reloj común.
  const sleep = (function () {
    let reloj = null;
    let siguienteId = 0;
    const pendientes = new Map();
    const liberarTodos = () => { pendientes.forEach((r) => r()); pendientes.clear(); };
    try {
      const fuente = 'onmessage=function(e){setTimeout(function(){postMessage(e.data.id)},e.data.ms)}';
      reloj = new Worker(URL.createObjectURL(new Blob([fuente], { type: 'text/javascript' })));
      reloj.onmessage = (e) => { const r = pendientes.get(e.data); if (r) { pendientes.delete(e.data); r(); } };
      reloj.onerror = () => { reloj = null; liberarTodos(); };
    } catch (e) { reloj = null; }
    return (ms) => new Promise((r) => {
      if (!reloj) { setTimeout(r, ms); return; }
      const id = ++siguienteId;
      pendientes.set(id, r);
      reloj.postMessage({ id, ms: Math.max(0, +ms || 0) });
    });
  })();
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const limpio = (s) => String(s || '').split(NBSP).join(' ').replace(/[ \t\r\n]+/g, ' ').trim();
  const DIACRITICOS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');
  const sinAcentos = (s) => String(s || '').normalize('NFD').replace(DIACRITICOS, '');
  const norm = (s) => sinAcentos(limpio(s)).toLowerCase();
  const ahora = () => Date.now();
  const log = (...a) => console.log('%c[MEV Ultra]', 'color:#0d4a2b;font-weight:bold', ...a);

  function fechaDe(txt) {
    const m = String(txt || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (!m) return null;
    const f = new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    return isNaN(f) ? null : f;
  }
  const dosDig = (n) => String(n).padStart(2, '0');
  const fechaCorta = (t) => { if (!t) return ''; const f = new Date(t); return dosDig(f.getDate()) + '/' + dosDig(f.getMonth() + 1) + '/' + f.getFullYear(); };
  const fechaHora = (t) => { if (!t) return ''; const f = new Date(t); return fechaCorta(t) + ' ' + dosDig(f.getHours()) + ':' + dosDig(f.getMinutes()); };
  const isoDia = (t) => { const f = new Date(t); return f.getFullYear() + '-' + dosDig(f.getMonth() + 1) + '-' + dosDig(f.getDate()); };
  const sello = () => { const f = new Date(); return isoDia(f) + '_' + dosDig(f.getHours()) + dosDig(f.getMinutes()); };

  // ---------------------------------------------------------------- cuenta
  // La cuenta es el usuario de la MEV que figura en el encabezado. Todo lo
  // guardado va separado por cuenta: con otro usuario no se ve nada ajeno.
  function leerCuenta(doc) {
    const t = (doc || document).body ? (doc || document).body.innerText : '';
    const u = t.match(/UsuarioMEV:\s*([^\s]+)/i);
    const n = t.match(/Nombre:\s*([^\n]+)/i);
    return u ? { usuario: u[1].trim(), nombre: n ? limpio(n[1]) : '' } : null;
  }

  // ---------------------------------------------------------------- almacén
  const gmGet = (k, def) => {
    try { const v = GM_getValue(k); if (v === undefined || v === null) return def; return typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { return def; }
  };
  const gmSet = (k, v) => { try { GM_setValue(k, JSON.stringify(v)); } catch (e) { log('no pude guardar', k, e); } };
  let CUENTA = null;
  const kc = (k) => 'mu.' + CUENTA.usuario + '.' + k;
  const leerC = (k, def) => gmGet(kc(k), def);
  const guardarC = (k, v) => gmSet(kc(k), v);

  // Preferencias de la ventana: son del equipo, no de la cuenta.
  const PREF = Object.assign({
    zoom: 100, porPagina: 25, columnas: null, anchos: {}, ocultas: null, ajustar: true,
    rect: null, orden: { col: 'ultFecha', dir: -1 }, colsExp: null, anchosExp: {}, ocultasExp: null
  }, gmGet('mu.pref', {}));
  const guardarPref = () => gmSet('mu.pref', PREF);

  // Índice: causas leídas de la MEV. Marcas: etiquetas y anotaciones (trabajo
  // propio, por eso tienen respaldo). Se guardan por separado.
  let IDX = null;     // { causas:{}, sets:{}, orgs:{}, lectura:{} }
  let MARCAS = null;  // { etiquetas:[{id,nombre,color}], filas:{ key:{etq:[],anot:'',t} } }
  const idxVacio = () => ({ causas: {}, sets: {}, orgs: {}, lectura: null, version: 1 });
  const marcasVacias = () => ({ etiquetas: [], filas: {}, version: 1 });
  function cargarDatos() {
    IDX = Object.assign(idxVacio(), leerC('indice', {}));
    MARCAS = Object.assign(marcasVacias(), leerC('marcas', {}));
  }
  const guardarIndice = () => guardarC('indice', IDX);
  let respaldoPendiente = null;
  function guardarMarcas() {
    MARCAS.t = ahora();
    guardarC('marcas', MARCAS);
    clearTimeout(respaldoPendiente);
    respaldoPendiente = setTimeout(() => { respaldoACarpeta().catch((e) => log('respaldo a carpeta', e)); }, 4000);
  }

  // ---------------------------------------------------------------- jurisdicciones
  // Los valores son los del formulario de POSLoguin.asp (relevado 22/09/2026).
  const DEPTOS = [
    ['80', 'Avellaneda-Lanus'], ['10', 'Azul'], ['11', 'Bahía Blanca'], ['12', 'Dolores'], ['13', 'Junín'],
    ['14', 'La Matanza'], ['6', 'La Plata'], ['16', 'Lomas de Zamora'], ['17', 'Mar del Plata'], ['18', 'Mercedes'],
    ['52', 'Moreno - Gral. Rodriguez'], ['19', 'Moron'], ['20', 'Necochea'], ['21', 'Olavarría'], ['22', 'Pergamino'],
    ['23', 'Quilmes'], ['24', 'San Isidro'], ['25', 'San Martín'], ['26', 'San Nicolas'], ['27', 'Tandil'],
    ['28', 'Trenque Lauquen'], ['49', 'Tres Arroyos'], ['29', 'Zarate/Campana']
  ];
  const JURIS = [];
  DEPTOS.forEach(([v, n]) => JURIS.push({ id: 'CC' + v, dto: v, depto: n, fuero: '', nombre: n, cuerpo: 'TipoDto=CC&DtoJudElegido=' + v }));
  DEPTOS.forEach(([v, n]) => JURIS.push({ id: 'FF' + v, dto: v, depto: n, fuero: 'Familia', nombre: n + ' - Familia', cuerpo: 'TipoDto=CC&DtoJudElegido=' + v + '&TipoF=FF' }));
  DEPTOS.forEach(([v, n]) => JURIS.push({ id: 'PP' + v, dto: v, depto: n, fuero: 'Penal', nombre: n + ' - Penal', cuerpo: 'TipoDto=CC&DtoJudElegido=' + v + '&TipoP=PP' }));
  JURIS.push({ id: 'SCJ', dto: '', depto: 'Suprema Corte', fuero: '', nombre: 'Suprema Corte', cuerpo: 'TipoDto=SCJ&DtoJudElegido=6' });
  JURIS.push({ id: 'LPC', dto: '', depto: 'Tribunal de Casación Penal', fuero: '', nombre: 'Tribunal de Casación Penal', cuerpo: 'TipoDto=LPC&DtoJudElegido=6' });
  JURIS.push({ id: 'PZ', dto: '', depto: 'Justicia de Paz', fuero: '', nombre: 'Justicia de Paz', cuerpo: 'TipoDto=PZ&DtoJudElegido=6' });
  const jurisPorId = (id) => JURIS.find((j) => j.id === id) || null;

  // Nombre de la jurisdicción tal como lo escribe el encabezado de la MEV
  // ("Tandil", "San Isidro - Familia", "SUPREMA CORTE", "Justicia de PAZ").
  function jurisPorNombre(nombre) {
    const n = norm(nombre).replace(/\s+/g, ' ');
    if (!n) return null;
    if (/suprema corte/.test(n)) return jurisPorId('SCJ');
    if (/casacion/.test(n)) return jurisPorId('LPC');
    if (/justicia de paz/.test(n)) return jurisPorId('PZ');
    const fuero = /- *familia$/.test(n) ? 'FF' : (/- *penal$/.test(n) ? 'PP' : 'CC');
    const compacto = (x) => x.replace(/[^a-z0-9]/g, '');
    const base = compacto(n.replace(/ *- *(familia|penal)$/, ''));
    const d = DEPTOS.find(([, dn]) => compacto(norm(dn)) === base);
    return d ? jurisPorId(fuero + d[0]) : null;
  }

  // La jurisdicción está en una celda del encabezado ("Tandil", "San Isidro -
  // Familia", "SUPREMA CORTE"). Se busca la celda cuyo texto sea el nombre de
  // una jurisdicción conocida: en un documento leído por fetch no hay saltos
  // de renglón, así que no alcanza con leer líneas.
  function jurisDelEncabezado(doc) {
    const d = doc || document;
    const celdas = [...d.querySelectorAll('td.fondoazul, td.fondoazul p, td, p, b')];
    for (const c of celdas) {
      const t = limpio(c.textContent);
      if (t && t.length < 60 && jurisPorNombre(t)) return t;
    }
    return '';
  }

  // Jurisdicciones probables de un Set por su nombre, para buscar primero ahí.
  function jurisProbables(nombreSet) {
    const n = norm(nombreSet);
    const out = [];
    const agregar = (id) => { if (jurisPorId(id) && !out.includes(id)) out.push(id); };
    const alias = [
      [/lanus|avellaneda/, '80'], [/\bmdq\b|mar del plata/, '17'], [/lomas/, '16'], [/zarate|campana/, '29'],
      [/matanza/, '14'], [/la plata/, '6'], [/moron/, '19'], [/san isidro/, '24'], [/san martin/, '25'],
      [/san nicolas/, '26'], [/quilmes/, '23'], [/mercedes/, '18'], [/necochea/, '20'], [/azul/, '10'],
      [/dolores/, '12'], [/junin/, '13'], [/bahia/, '11'], [/tandil/, '27'], [/olavarria/, '21'],
      [/pergamino/, '22'], [/trenque/, '28'], [/tres arroyos/, '49'], [/moreno|rodriguez/, '52']
    ];
    const fam = /familia/.test(n), pen = /penal/.test(n);
    alias.forEach(([re, v]) => { if (re.test(n)) { if (fam) agregar('FF' + v); if (pen) agregar('PP' + v); agregar('CC' + v); } });
    if (/\bpaz\b/.test(n)) agregar('PZ');
    if (/suprema/.test(n)) agregar('SCJ');
    if (/casacion/.test(n)) agregar('LPC');
    return out;
  }

  // ---------------------------------------------------------------- red
  // Huellas de la pantalla de validación anti-bot (las mismas que usa el
  // motor de MEV+). La pantalla viaja con HTTP 200: hay que mirarla antes de
  // usar el HTML.
  const PORTERO = new RegExp([
    'validando\\s+acceso', 'siendo\\s+navegado\\s+por\\s+un\\s+ser\\s+humano', 'verificando\\s+si\\s+est[aá]',
    'vuelva\\s+a\\s+cargar\\s+la\\s+p[aá]gina', 'checking\\s+your\\s+browser', 'just\\s+a\\s+moment',
    'cf[-_]browser[-_]verification', 'challenge-platform', '_Incapsula_'
  ].join('|'), 'i');
  const esPortero = (html) => !html || !html.trim() ||
    (PORTERO.test(html) && !/UsuarioMEV/i.test(html)) ||
    (html.length < 3000 && /http-equiv\s*=\s*["']?\s*refresh/i.test(html));
  // Página de ingreso: "Ingrese los datos del Usuario" con los campos usuario y clave.
  const esLogin = (html) => /Ingrese(?:\s|&nbsp;)+los(?:\s|&nbsp;)+datos/i.test(html || '') || (/name\s*=\s*["']?clave\b/i.test(html || '') && /name\s*=\s*["']?usuario\b/i.test(html || ''));

  class Cortado extends Error {}

  // Ritmo: la validación se dispara por velocidad. Pausa con variación y
  // freno progresivo cuando la MEV protesta.
  const RITMO = { base: 700, actual: 700, max: 6000, limpias: 0 };
  async function pausa() {
    const j = RITMO.actual * (0.75 + Math.random() * 0.5);
    await sleep(j);
  }
  function respuestaLimpia() {
    RITMO.limpias++;
    if (RITMO.limpias % 20 === 0 && RITMO.actual > RITMO.base) RITMO.actual = Math.max(RITMO.base, Math.round(RITMO.actual / 1.5));
  }

  // Estado compartido de la validación: si hay una en curso, todos esperan.
  const VALIDACION = { promesa: null, ayuda: null };

  // Navega de verdad en un marco oculto para que corra el desafío.
  function pasarEnMarco(url, limiteMs) {
    return new Promise((resolve) => {
      const m = document.createElement('iframe');
      m.style.cssText = 'position:fixed;left:-99999px;top:0;width:900px;height:700px;border:0';
      m.setAttribute('data-mu', 'validacion');
      document.body.appendChild(m);
      const t0 = ahora();
      const reloj = setInterval(() => {
        let html = '';
        try { html = m.contentDocument && m.contentDocument.readyState === 'complete' ? m.contentDocument.documentElement.outerHTML : ''; } catch (e) { html = ''; }
        const ok = html && html.length > 400 && !esPortero(html);
        if (ok || ahora() - t0 > limiteMs) { clearInterval(reloj); m.remove(); resolve(!!ok); }
      }, 500);
      m.src = url;
    });
  }

  function validar(url, aviso) {
    if (VALIDACION.promesa) return VALIDACION.promesa;
    VALIDACION.promesa = (async () => {
      RITMO.actual = Math.min(RITMO.max, Math.round(RITMO.actual * 1.8));
      RITMO.limpias = 0;
      const esperas = [5, 10, 20, 40, 60];
      for (let i = 0; i < esperas.length; i++) {
        for (let s = esperas[i]; s > 0; s--) {
          if (aviso) aviso('La MEV pidió validar el acceso. Reintento ' + (i + 1) + ' de ' + esperas.length + ' en ' + s + ' s.');
          await sleep(1000);
          if (LECTURA.cancelar) throw new Cortado('cancelado');
        }
        if (await pasarEnMarco(url, 45000)) return true;
      }
      // No cedió sola: se pide intervención humana sin perder lo leído.
      return esperarValidacionManual(url);
    })().finally(() => { VALIDACION.promesa = null; });
    return VALIDACION.promesa;
  }

  // Buscar persona no resuelve la verificación por su cuenta: la deja a la
  // persona desde el primer momento y espera. Se corta al pausar la búsqueda.
  function validarHumano(url) {
    if (VALIDACION.promesa) return VALIDACION.promesa;
    VALIDACION.promesa = esperarValidacionManual(url, () => BUSQ.activa && BUSQ.pausar)
      .finally(() => { VALIDACION.promesa = null; });
    return VALIDACION.promesa;
  }

  // No cedió sola: se pide intervención humana sin perder lo leído. Se sondea
  // cada 10 s por si se resolvió en otra pestaña, y se puede cancelar.
  function esperarValidacionManual(url, cortar = () => LECTURA.activa && LECTURA.cancelar) {
    return new Promise((resolve, reject) => {
      let listo = false;
      const fin = (ok) => { if (listo) return; listo = true; clearInterval(reloj); VALIDACION.ayuda = null; ui.ayudaValidacion(null); ok ? resolve(true) : reject(new Cortado('cancelado')); };
      const reloj = setInterval(async () => {
        if (cortar()) { fin(false); return; }
        try { const r = await fetch(url, { credentials: 'include', cache: 'no-store' }); if (!esPortero(await decodificar(r))) fin(true); } catch (e) { /* sigue esperando */ }
      }, 10000);
      VALIDACION.ayuda = () => fin(true);
      ui.ayudaValidacion({ url, seguir: VALIDACION.ayuda });
    });
  }

  const decodificar = async (r) => new TextDecoder('windows-1252').decode(await r.arrayBuffer());

  // Pedido a la MEV con reintentos, detección de validación y de sesión caída.
  async function pedir(url, opciones, aviso) {
    const o = Object.assign({ credentials: 'include', cache: 'no-store' }, opciones || {});
    if (o.body && !o.headers) o.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    for (let intento = 1; intento <= 5; intento++) {
      if (LECTURA.cancelar && opciones && opciones.cancelable) throw new Cortado('cancelado');
      if (VALIDACION.promesa) await VALIDACION.promesa;
      let html = '';
      try {
        const r = await fetch(url, o);
        if (r.status >= 500) throw new Error('HTTP ' + r.status);
        if (r.redirected && /loguin\.asp/i.test(r.url)) throw new Error('SESION');
        html = await decodificar(r);
      } catch (e) {
        if (e.message === 'SESION') throw e;
        if (intento === 5) throw new Error('la MEV no responde (' + e.message + ')');
        await sleep(Math.min(1500 * Math.pow(2, intento - 1), 20000));
        continue;
      }
      if (esLogin(html)) throw new Error('SESION');
      if (esPortero(html)) { await (o.soloHumana ? validarHumano('/Sets.asp') : validar(/^\/?Sets\.asp/i.test(url) ? url : '/Sets.asp', aviso)); continue; }
      respuestaLimpia();
      return html;
    }
    throw new Error('la MEV no dejó leer ' + url);
  }
  const parsear = (html) => new DOMParser().parseFromString(html, 'text/html');

  // ---------------------------------------------------------------- lectura de la MEV
  // Sets.asp: nombre, número y total de cada Set de Búsqueda.
  function leerSetsDe(doc) {
    const sets = [];
    const vistos = new Set();
    doc.querySelectorAll('a[href*="esultados.asp"]').forEach((a) => {
      const m = (a.getAttribute('href') || '').match(/nidset=(\d+)/i);
      if (!m || vistos.has(m[1])) return;
      vistos.add(m[1]);
      let tr = a.closest('tr');
      let total = null;
      for (let k = 0; k < 4 && tr && total === null; k++) {
        const t = tr.innerText.match(/Total Expedientes:\s*(\d+)/i);
        if (t) total = +t[1];
        tr = tr.nextElementSibling;
      }
      let tipo = 0;
      const mod = doc.querySelector('a[href*="odificarSet.asp"][href*="nidset=' + m[1] + '"]');
      if (mod) { const tt = (mod.getAttribute('href') || '').match(/tipodeset=(\d+)/i); if (tt) tipo = +tt[1]; }
      sets.push({ nidset: m[1], nombre: limpio(a.textContent), total: total === null ? 0 : total, tipo });
    });
    return sets;
  }

  // resultados.asp: cada causa es una tabla con dos filas. La primera trae la
  // carátula y el enlace a procesales.asp; la segunda, en este orden: estado,
  // Nº de receptoría, Nº de expediente, fecha de inicio y "fecha - último
  // trámite".
  function leerResultados(doc) {
    const out = [];
    const vistos = new Set();
    doc.querySelectorAll('a[href*="rocesales.asp"]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      const nid = (href.match(/nidCausa=(\d+)/i) || [])[1];
      const pid = ((href.match(/pidJuzgado=([^&]+)/i) || [])[1] || '').trim();
      if (!nid || !pid) return;
      const key = nid + '|' + pid;
      if (vistos.has(key)) return;
      vistos.add(key);
      const tabla = a.closest('table');
      const filaDatos = a.closest('tr') ? a.closest('tr').nextElementSibling : null;
      const celdas = filaDatos ? [...filaDatos.cells].map((c) => limpio(c.innerText)) : [];
      const ult = celdas[4] || '';
      const mu = ult.match(/^(\d{1,2}\/\d{1,2}\/\d{4})\s*-?\s*(.*)$/);
      out.push({
        key, nidCausa: nid, pid,
        caratula: limpio(a.textContent).replace(/\s*-\s*$/, ''),
        estado: celdas[0] || '',
        receptoria: celdas[1] || '',
        expediente: celdas[2] || '',
        inicio: celdas[3] || '',
        ultFechaTxt: mu ? mu[1] : '',
        ultDesc: mu ? limpio(mu[2]) : ult,
        _tabla: !!tabla
      });
    });
    return out;
  }
  const totalDeclarado = (doc) => { const m = (doc.body ? doc.body.innerText : '').match(/Total expedientes:\s*(\d+)/i); return m ? +m[1] : null; };
  const sinCausasEnJuris = (doc) => /contiene Expedientes de otra Jurisdicci|no tiene Expedientes cargad/i.test(doc.body ? doc.body.innerText : '');

  // ¿El Set tiene más de una página de resultados? La MEV no pagina en lo
  // relevado; si alguna vez lo hace, se avisa en vez de mostrar menos.
  function organismosDelSet(doc) {
    const sel = doc.querySelector('select#JuzgadoElegido, select[name="JuzgadoElegido"]');
    if (!sel || !sel.form || !/resultados\.asp/i.test(sel.form.getAttribute('action') || '')) return [];
    return [...sel.options].map((o) => ({ pid: o.value.trim(), nombre: limpio(o.text) })).filter((o) => o.pid);
  }

  const LECTURA = { activa: false, cancelar: false, avance: '', tipo: '' };
  const MSG_JURIS_NO_DISPONIBLE = /no esta disponible para esta jurisdicci/i;
  const textoDe = (doc) => (doc.body ? doc.body.textContent : '');

  // Cambia la jurisdicción de la sesión. Devuelve false si la MEV no la
  // atiende o si quedó en otra (por ejemplo, un fuero no habilitado).
  async function cambiarJuris(j, aviso, avisos, extra) {
    const html = await pedir('/POSLoguin.asp', Object.assign({ method: 'POST', body: j.cuerpo + '&Aceptar=Aceptar', cancelable: true }, extra || {}), aviso);
    const doc = parsear(html);
    if (MSG_JURIS_NO_DISPONIBLE.test(textoDe(doc))) { avisos.push('La MEV informó que ' + j.nombre + ' no está disponible en este momento.'); return false; }
    const quedo = jurisPorNombre(jurisDelEncabezado(doc));
    if (quedo && quedo.id !== j.id) { avisos.push('Se pidió ' + j.nombre + ' y la MEV quedó en ' + quedo.nombre + ': no se leyó esa jurisdicción.'); return false; }
    return true;
  }

  // Candado entre pestañas: una lectura o una descarga por vez en todo el
  // navegador, porque las dos dependen del estado de la sesión de la MEV.
  const ID_PESTANA = Math.random().toString(36).slice(2);
  function candadoAjeno() {
    const c = gmGet('mu.candado', null);
    return c && c.id !== ID_PESTANA && ahora() - c.t < 30000 ? c : null;
  }
  function tomarCandado(tipo) {
    if (candadoAjeno()) return false;
    gmSet('mu.candado', { id: ID_PESTANA, t: ahora(), tipo });
    return true;
  }
  const soltarCandado = () => { const c = gmGet('mu.candado', null); if (c && c.id === ID_PESTANA) gmSet('mu.candado', null); };
  const renovarCandado = (tipo) => gmSet('mu.candado', { id: ID_PESTANA, t: ahora(), tipo });

  // ------------------------------------------------ lectura: piezas
  function crearCorrida(modo) {
    return { modo, t0: ahora(), hallados: {}, lugares: {}, consultados: new Set(), avisos: [], ocultas: {}, pedidos: 0, sets: [], setsNuevos: {}, conocidos: [] };
  }
  const encontradosDe = (cr, nid) => Object.values(cr.hallados).filter((c) => c.sets.includes(nid)).length;
  const setCompleto = (cr, s) => s.total > 0 && encontradosDe(cr, s.nidset) >= s.total;

  // Sets: se conserva lo aprendido (dónde estaban) y se actualiza el total.
  // No se toca el índice hasta que la lectura termina bien.
  function prepararSets(cr, sets) {
    cr.sets = sets;
    sets.forEach((s) => { cr.setsNuevos[s.nidset] = Object.assign({ lugares: {} }, IDX.sets[s.nidset] || {}, s); });
  }

  // Plan: jurisdicciones en orden y, para cada una, qué Sets mirar.
  function agregarAlPlan(plan, jid, nid) {
    let p = plan.find((x) => x.jid === jid);
    if (!p) { p = { jid, sets: [] }; plan.push(p); }
    if (!p.sets.includes(nid)) p.sets.push(nid);
  }
  function armarPlan(cr) {
    const plan = [];
    cr.sets.forEach((s) => {
      const lugares = Object.keys(cr.setsNuevos[s.nidset].lugares || {});
      if (cr.modo === 'rapida' && lugares.length) { lugares.forEach((jid) => agregarAlPlan(plan, jid, s.nidset)); cr.conocidos.push(s.nidset); }
    });
    cr.sets.filter((s) => s.total > 0 && !cr.conocidos.includes(s.nidset))
      .forEach((s) => jurisProbables(s.nombre).forEach((jid) => agregarAlPlan(plan, jid, s.nidset)));
    return plan;
  }

  function registrarCausas(cr, lista, jid, nid, org) {
    lista.forEach((c) => {
      const prev = cr.hallados[c.key];
      if (prev) { if (!prev.sets.includes(nid)) prev.sets.push(nid); return; }
      const orgNombre = (IDX.orgs[c.pid] && IDX.orgs[c.pid].nombre) || (org && org.nombre) || '';
      cr.hallados[c.key] = Object.assign(c, { sets: [nid], juris: jid, organismo: orgNombre });
      if (!IDX.orgs[c.pid]) IDX.orgs[c.pid] = { nombre: orgNombre, juris: jid };
    });
    cr.lugares[nid] = cr.lugares[nid] || {};
    const pids = cr.lugares[nid][jid] = cr.lugares[nid][jid] || [];
    lista.forEach((c) => { if (!pids.includes(c.pid)) pids.push(c.pid); });
  }

  // La MEV a veces declara más causas de las que pone en pantalla (verificado
  // el 23/09/2026: "Total expedientes: 5" con cuatro causas a la vista). Esas
  // no se pueden leer; se cuentan para no darlas por perdidas.
  function controlarTotal(cr, doc, lista, rotulo, nid) {
    const decl = totalDeclarado(doc);
    const enPantalla = doc.querySelectorAll('div.AnchoFijoCaratula').length || lista.length;
    if (decl === null || decl <= lista.length) return;
    const ocultas = decl - enPantalla;
    if (ocultas > 0) { cr.ocultas[nid] = (cr.ocultas[nid] || 0) + ocultas; cr.avisos.push(rotulo + ': la MEV informa ' + decl + ' causas pero muestra ' + enPantalla + '. ' + (ocultas === 1 ? 'La que falta no la muestra la propia MEV.' : 'Las ' + ocultas + ' que faltan no las muestra la propia MEV.')); }
    if (enPantalla > lista.length) cr.avisos.push(rotulo + ': la MEV muestra ' + enPantalla + ' causas y se pudieron leer ' + lista.length + '.');
  }

  async function leerOrganismo(cr, j, s, o, aviso) {
    if (LECTURA.cancelar) throw new Cortado('cancelado');
    aviso(j.nombre + ' · ' + s.nombre + ' · ' + o.nombre + ' · ' + Object.keys(cr.hallados).length + ' causas leídas');
    await pausa();
    cr.pedidos++;
    const html = await pedir('/resultados.asp?sFechaDesde=&sFechaHasta=', { method: 'POST', body: 'JuzgadoElegido=' + encodeURIComponent(o.pid) + '&Consultar=Consultar', cancelable: true }, aviso);
    const doc = parsear(html);
    const lista = leerResultados(doc).filter((c) => c.pid === o.pid);
    controlarTotal(cr, doc, lista, s.nombre + ' · ' + o.nombre, s.nidset);
    registrarCausas(cr, lista, j.id, s.nidset, o);
  }

  async function leerSetEnJuris(cr, j, s, aviso) {
    if (LECTURA.cancelar) throw new Cortado('cancelado');
    aviso(j.nombre + ' · ' + s.nombre + ' · ' + Object.keys(cr.hallados).length + ' causas leídas');
    await pausa();
    cr.pedidos++;
    const html = await pedir('/resultados.asp?nidset=' + encodeURIComponent(s.nidset) + '&sFechaDesde=&sFechaHasta=&pOrden=xCa&pOrdenAD=Asc', { cancelable: true }, aviso);
    const doc = parsear(html);
    cr.consultados.add(j.id + '|' + s.nidset);
    if (sinCausasEnJuris(doc)) return;
    const orgs = organismosDelSet(doc);
    orgs.forEach((o) => { IDX.orgs[o.pid] = { nombre: o.nombre, juris: j.id }; });
    const primera = leerResultados(doc);
    controlarTotal(cr, doc, primera, s.nombre + ' en ' + j.nombre, s.nidset);
    registrarCausas(cr, primera, j.id, s.nidset, null);
    const cubiertos = new Set(primera.map((c) => c.pid));
    for (const o of orgs) if (!cubiertos.has(o.pid)) await leerOrganismo(cr, j, s, o, aviso);
  }

  async function consultarJuris(cr, jid, nids, aviso) {
    const j = jurisPorId(jid);
    if (!j) return;
    const faltan = nids.map((n) => cr.setsNuevos[n]).filter((s) => s && s.total > 0 && !cr.consultados.has(jid + '|' + s.nidset));
    if (!faltan.length) return;
    aviso('Cambiando a ' + j.nombre + '…');
    await pausa();
    cr.pedidos++;
    if (!await cambiarJuris(j, aviso, cr.avisos)) return;
    for (const s of faltan) await leerSetEnJuris(cr, j, s, aviso);
  }

  // Barrido: los Sets que siguen incompletos se buscan en todas las
  // jurisdicciones, cortando cada uno al completar su total.
  async function barrer(cr, aviso) {
    const hayQueBarrer = cr.modo === 'completa' || cr.sets.some((s) => s.total > 0 && !cr.conocidos.includes(s.nidset));
    if (!hayQueBarrer) return;
    for (const j of JURIS) {
      const pendientes = cr.sets.filter((s) => s.total > 0 && !setCompleto(cr, s) && (cr.modo === 'completa' || !cr.conocidos.includes(s.nidset))).map((s) => s.nidset);
      if (!pendientes.length) return;
      await consultarJuris(cr, j.id, pendientes, aviso);
    }
  }

  // Novedad de una causa respecto de la lectura anterior.
  function novedadDe(prev, reg) {
    if (!prev) return 'incorporada a un Set';
    if (prev.ultFechaTxt !== reg.ultFechaTxt || prev.ultDesc !== reg.ultDesc) return 'movimiento: ' + (reg.ultFechaTxt + ' ' + reg.ultDesc).trim();
    if (prev.estado !== reg.estado) return 'estado: ' + prev.estado + ' → ' + reg.estado;
    return '';
  }
  function registroDe(c, prev) {
    const f = fechaDe(c.ultFechaTxt);
    return {
      key: c.key, nidCausa: c.nidCausa, pid: c.pid, juris: c.juris,
      organismo: c.organismo || (IDX.orgs[c.pid] && IDX.orgs[c.pid].nombre) || '',
      caratula: c.caratula, estado: c.estado, receptoria: c.receptoria, expediente: c.expediente,
      inicio: c.inicio, ultFecha: f ? f.getTime() : null, ultFechaTxt: c.ultFechaTxt, ultDesc: c.ultDesc,
      sets: c.sets.slice(), alta: prev ? prev.alta : ahora(), ausente: null,
      nuevo: prev ? !!prev.nuevo : false, cambio: prev ? prev.cambio || '' : ''
    };
  }
  // Lo que estaba y no apareció: si su lugar se consultó, ya no figura; si
  // no se consultó (lectura rápida parcial, jurisdicción caída), se conserva.
  function conservarAusentes(cr, antes, nuevas) {
    Object.values(antes).forEach((p) => {
      if (nuevas[p.key]) return;
      const seMiro = (p.sets || []).some((nid) => cr.consultados.has(p.juris + '|' + nid));
      const setVigente = (p.sets || []).some((nid) => cr.setsNuevos[nid]);
      nuevas[p.key] = (seMiro || !setVigente) ? Object.assign({}, p, { ausente: p.ausente || ahora() }) : p;
    });
  }
  function fundirIndice(cr) {
    const primeraVez = !IDX.lectura;
    const antes = IDX.causas;
    const nuevas = {};
    Object.values(cr.hallados).forEach((c) => {
      const prev = antes[c.key];
      const reg = registroDe(c, prev);
      const cambio = primeraVez ? '' : novedadDe(prev, reg);
      if (cambio) { reg.nuevo = true; reg.cambio = cambio; }
      nuevas[c.key] = reg;
    });
    conservarAusentes(cr, antes, nuevas);
    Object.keys(cr.lugares).forEach((nid) => { if (cr.setsNuevos[nid]) cr.setsNuevos[nid].lugares = cr.lugares[nid]; });
    Object.values(cr.setsNuevos).forEach((s) => { s.encontradas = Object.values(nuevas).filter((c) => !c.ausente && c.sets.includes(s.nidset)).length; s.ocultas = cr.ocultas[s.nidset] || 0; });
    IDX.sets = cr.setsNuevos;
    IDX.causas = nuevas;
    IDX.lectura = { fecha: ahora(), modo: cr.modo, segundos: Math.round((ahora() - cr.t0) / 1000), pedidos: cr.pedidos, avisos: cr.avisos, causas: Object.keys(cr.hallados).length };
    guardarIndice();
  }

  function mensajeDeError(e) {
    if (e instanceof Cortado) return 'Lectura cancelada. El índice anterior quedó como estaba.';
    if (e.message === 'SESION') return 'La sesión de la MEV venció. Ingresá de nuevo y volvé a leer.';
    return 'La lectura se interrumpió: ' + e.message;
  }

  // Deja la jurisdicción que había al empezar.
  async function restituirJuris(original, extra) {
    if (!original) return;
    try {
      const html = await pedir('/POSLoguin.asp', Object.assign({ method: 'POST', body: original.cuerpo + '&Aceptar=Aceptar' }, extra || {}));
      const quedo = jurisPorNombre(jurisDelEncabezado(parsear(html)));
      if (quedo && quedo.id !== original.id) ui.aviso('Al terminar no se pudo volver a ' + original.nombre + ': la MEV quedó en ' + quedo.nombre + '.', true);
    } catch (e) { log('no pude volver a', original.nombre, e); ui.aviso('Al terminar no se pudo volver a ' + original.nombre + '. Elegila en "Cambiar Jurisdicción".', true); }
  }

  /**
   * Lee las causas. "rapida" consulta solo donde ya se encontraron causas de
   * cada Set; "completa" recorre todas las jurisdicciones hasta completar el
   * total que declara cada Set. Un Set que nunca se leyó entra siempre en
   * modo completo.
   */
  async function leerCausas(modo) {
    if (LECTURA.activa) return;
    if (BUSQ.activa) { ui.aviso('Hay una búsqueda por nombre en curso. Pausala o esperá a que termine.', true); return; }
    if (DESCARGAS.activa()) { ui.aviso('Hay una descarga en curso. La lectura cambia la jurisdicción de la MEV: esperá a que termine.', true); return; }
    if (!tomarCandado('lectura')) { ui.aviso('Otra pestaña de la MEV está leyendo o bajando. Esperá a que termine.', true); return; }
    LECTURA.activa = true; LECTURA.cancelar = false; LECTURA.tipo = modo;
    const pulso = setInterval(() => renovarCandado('lectura'), 5000);
    const aviso = (t) => { LECTURA.avance = t; ui.progresoLectura(t); };
    const cr = crearCorrida(modo);
    let original = null;
    ui.lecturaEmpezo();
    try {
      aviso('Leyendo los Sets de Búsqueda…');
      const docSets = parsear(await pedir('/Sets.asp', { cancelable: true }, aviso));
      original = jurisPorNombre(jurisDelEncabezado(docSets)) || jurisPorId(leerC('ultimaJuris', ''));
      const sets = leerSetsDe(docSets);
      if (!sets.length) throw new Error('no encontré Sets de Búsqueda en la MEV');
      prepararSets(cr, sets);
      for (const p of armarPlan(cr)) await consultarJuris(cr, p.jid, p.sets, aviso);
      await barrer(cr, aviso);
      fundirIndice(cr);
      aviso('');
      ui.lecturaTermino(null);
    } catch (e) {
      log('lectura', e);
      ui.lecturaTermino(mensajeDeError(e));
    } finally {
      LECTURA.cancelar = false;
      await restituirJuris(original);
      clearInterval(pulso);
      soltarCandado();
      LECTURA.activa = false;
      ui.refrescarTodo();
      setTimeout(() => DESCARGAS.siguiente(), 300);
    }
  }

  // ---------------------------------------------------------------- buscar persona
  /*
   * BUSCAR PERSONA (0.5.0)
   *
   * Busca un nombre en la carátula de las causas de los juzgados civiles y
   * comerciales de los 23 departamentos judiciales y de los juzgados de paz.
   * Sirve para saber si hay una causa iniciada (una sucesión, por ejemplo)
   * sin recorrer la MEV jurisdicción por jurisdicción y juzgado por juzgado.
   *
   * Cómo trabaja:
   *   1. Cambia a cada jurisdicción, como la lectura de las causas.
   *   2. Abre la consulta por carátula de la MEV (encuentra las causas que
   *      contienen todas las palabras, en cualquier orden) y toma del mismo
   *      formulario la lista de organismos de esa jurisdicción.
   *   3. Consulta los juzgados civiles y comerciales en cada departamento y
   *      todos los juzgados en Justicia de Paz. Si el formulario ofrece
   *      "todos los organismos", hace una sola consulta y se queda con lo
   *      de esos juzgados.
   *
   * Va pausado a propósito: una consulta por vez y una pausa fija entre una y
   * otra (BUSCADOR.pausaMs). Si la MEV pide verificar que se trata de una
   * persona, la búsqueda se detiene hasta que el usuario lo resuelve: el
   * buscador no resuelve esa verificación por su cuenta.
   *
   * Se puede pausar y retomar: después de cada consulta se guarda qué
   * organismos ya se consultaron y qué se encontró.
   *
   * La consulta por carátula no se relevó en una sesión real. El buscador la
   * reconoce en la propia MEV: el formulario con un campo de carátula y el
   * desplegable de organismos. Nunca envía un formulario que no sea ese (por
   * ejemplo, el de crear o modificar Sets). Si no lo reconoce, o si la
   * primera respuesta no es un listado de causas, se detiene y arma un
   * diagnóstico para corregirlo.
   */
  const BUSCADOR = {
    pausaMs: 4000,          // entre una consulta y la siguiente
    maxGuardadas: 30,       // búsquedas que se conservan en el historial
    maxEnlaces: 6,          // páginas de la MEV que se revisan para ubicar la consulta
    minLetras: 3            // largo mínimo del texto a buscar
  };
  const BUSQ = { activa: false, pausar: false, actual: null, avance: '' };
  class ErrorDiagnostico extends Error {
    constructor(mensaje, diagnostico) { super(mensaje); this.diagnostico = diagnostico; }
  }

  const RE_CIVIL = /civil\s*y\s*comercial|civ\.?\s*y\s*com\.?/i;
  const RE_CAMARA = /c[aá]mara/i;
  const RE_PAZ = /\bpaz\b/i;
  const RE_TODOS = /^\s*[-(]*\s*todos\b/i;
  const RE_CARATULA = /car[aá]tula/i;
  // Formularios que la MEV usa para cambiar cosas de la cuenta: nunca se envían.
  const RE_ACCION_PROHIBIDA = /set|nuevo|modific|alta|baja|borr|elimin|agreg|incorpor|guard|perfil|clave|usuario/i;

  // ------------------------------------------------ historial
  const leerBusquedas = () => { const v = leerC('busquedas', []); return Array.isArray(v) ? v : []; };
  const busquedaPorId = (id) => leerBusquedas().find((x) => x.id === id) || null;
  function guardarBusqueda(b) {
    const lista = leerBusquedas().filter((x) => x.id !== b.id);
    lista.unshift(b);
    guardarC('busquedas', lista.slice(0, BUSCADOR.maxGuardadas));
  }
  function quitarBusqueda(id) { guardarC('busquedas', leerBusquedas().filter((x) => x.id !== id)); }

  /** Jurisdicciones a recorrer: los departamentos (fuero civil y comercial) y Justicia de Paz. */
  function planBusqueda(alcance) {
    if (alcance && alcance !== 'todo') return [alcance];
    return JURIS.filter((j) => /^CC/.test(j.id)).map((j) => j.id).concat('PZ');
  }

  const textoDeBusqueda = (s) => limpio(s).toUpperCase();

  function nuevaBusqueda(texto, alcance) {
    return {
      id: 'b' + ahora().toString(36), texto: textoDeBusqueda(texto), alcance: alcance || 'todo',
      t0: ahora(), t1: 0, segundos: 0, estado: 'espera', error: '', diagnostico: '',
      plan: planBusqueda(alcance), jurisHechas: [], hechos: [], resultados: {}, avisos: [],
      pedidos: 0, juzgados: 0, verificada: false, urlConsulta: ''
    };
  }

  const nombreAlcance = (a) => (a === 'todo' || !a ? 'Toda la provincia' : a === 'PZ' ? 'Justicia de Paz' : ((jurisPorId(a) || { nombre: a }).nombre + ' (civiles y comerciales)'));

  // ------------------------------------------------ reconocimiento del formulario
  // En este módulo "CSS" es la hoja de estilos de la ventana: se usa la del navegador.
  const escaparSelector = (s) => (window.CSS && window.CSS.escape ? window.CSS.escape(s) : String(s).replace(/["\\[\]]/g, '\\$&'));

  /** Texto que acompaña a un campo: su etiqueta, lo escrito antes o la celda anterior. */
  function rotuloDe(el) {
    if (el.id) { const l = el.ownerDocument.querySelector('label[for="' + escaparSelector(el.id) + '"]'); if (l) return limpio(l.textContent); }
    const l = el.closest('label');
    if (l) return limpio(l.textContent);
    let t = '', n = el.previousSibling;
    while (n && t.length < 60) { if (n.nodeName === 'INPUT' || n.nodeName === 'SELECT') break; t = (n.textContent || '') + t; n = n.previousSibling; }
    if (limpio(t)) return limpio(t);
    const td = el.closest('td');
    const prev = td && td.previousElementSibling;
    return prev ? limpio(prev.textContent).slice(0, 60) : '';
  }

  /** Texto que sigue a una opción de radio (así se rotulan en la MEV). */
  function textoJunto(el) {
    if (el.id) { const l = el.ownerDocument.querySelector('label[for="' + escaparSelector(el.id) + '"]'); if (l) return limpio(l.textContent); }
    let t = '', n = el.nextSibling;
    while (n && t.length < 40) { if (n.nodeName === 'INPUT' || n.nodeName === 'SELECT') break; t += n.textContent || ''; n = n.nextSibling; }
    return limpio(t);
  }

  /** Si el formulario elige el tipo de consulta (carátula, número, receptoría), la opción de carátula. */
  function criterioCaratula(els) {
    for (const r of els.filter((e) => (e.type || '').toLowerCase() === 'radio' && e.name)) {
      if (RE_CARATULA.test(r.value + ' ' + textoJunto(r))) return { name: r.name, value: r.value };
    }
    for (const s of els.filter((e) => e.tagName === 'SELECT' && e.name)) {
      const o = [...s.options].find((x) => RE_CARATULA.test(x.text + ' ' + x.value));
      if (o) return { name: s.name, value: o.value };
    }
    return null;
  }

  /** El campo de texto de la carátula. Sin rótulo claro, solo se acepta si hay un criterio "carátula" y un único campo. */
  function campoDeCaratula(els, hayCriterio) {
    const campos = els.filter((e) => e.tagName === 'INPUT' && /^(text|search)$/i.test(e.type || 'text') && e.name);
    const rotulado = campos.find((i) => RE_CARATULA.test(i.name + ' ' + (i.id || '') + ' ' + rotuloDe(i)));
    if (rotulado) return rotulado;
    return hayCriterio && campos.length === 1 ? campos[0] : null;
  }

  function desplegableDeOrganismos(els) {
    const sels = els.filter((e) => e.tagName === 'SELECT' && e.name && e.options.length > 1);
    return sels.find((s) => /juzg|organ/i.test(s.name + ' ' + (s.id || ''))) ||
      sels.slice().sort((a, b) => b.options.length - a.options.length)[0] || null;
  }

  function accionDe(form, urlPagina) {
    try { const u = new URL(form.getAttribute('action') || urlPagina, new URL(urlPagina, location.origin)); return u.origin === location.origin ? u.pathname + u.search : null; } catch (e) { return null; }
  }

  /**
   * Campos de cada formulario de la página. En la MEV el formulario se abre
   * dentro de una tabla y el lector de HTML lo deja vacío: sus campos quedan
   * a continuación, sueltos. Cada campo va con el formulario que lo contiene
   * o, si no tiene, con el último formulario abierto antes que él.
   */
  function camposPorFormulario(doc) {
    const grupos = new Map();
    let ultimo = null;
    doc.querySelectorAll('form, input, select, textarea, button').forEach((el) => {
      if (el.tagName === 'FORM') { ultimo = el; grupos.set(el, []); return; }
      const dueno = el.closest('form') || ultimo;
      if (dueno && grupos.has(dueno)) grupos.get(dueno).push(el);
    });
    return grupos;
  }

  /** La consulta por carátula de una página, o null. Nunca devuelve un formulario que cambie la cuenta. */
  function describirFormulario(doc, urlPagina) {
    const grupos = camposPorFormulario(doc);
    for (const form of doc.querySelectorAll('form')) {
      const accion = accionDe(form, urlPagina);
      if (!accion || RE_ACCION_PROHIBIDA.test(accion.split('?')[0])) continue;
      const els = grupos.get(form) || [];
      const criterio = criterioCaratula(els);
      const texto = campoDeCaratula(els, !!criterio);
      const org = desplegableDeOrganismos(els);
      if (!texto || !org) continue;
      const organismos = [...org.options].map((o) => ({ pid: (o.value || '').trim(), nombre: limpio(o.text) })).filter((o) => o.pid);
      if (!organismos.length) continue;
      return {
        form, campos: els, texto, org, criterio, accion,
        metodo: (form.getAttribute('method') || 'get').toUpperCase() === 'POST' ? 'POST' : 'GET',
        organismos, todos: organismos.find((o) => RE_TODOS.test(o.nombre)) || null
      };
    }
    return null;
  }

  /** Codifica como la recibe la MEV, en windows-1252 (eñes y acentos). */
  function codificar1252(s) {
    let out = '';
    for (const ch of String(s == null ? '' : s)) {
      const c = ch.codePointAt(0);
      if (/[A-Za-z0-9\-_.*]/.test(ch)) out += ch;
      else if (ch === ' ') out += '+';
      else if (c < 256) out += '%' + c.toString(16).toUpperCase().padStart(2, '0');
      else out += '%3F';
    }
    return out;
  }

  /** Valor que mandaría el navegador por un campo que el buscador no toca. */
  function valorPorDefecto(el) {
    const tipo = (el.type || '').toLowerCase();
    if (/^(submit|button|image|reset|file)$/.test(tipo)) return null;
    if (tipo === 'radio' || tipo === 'checkbox') return el.checked ? el.value : null;
    if (el.tagName === 'SELECT') { const o = el.options[el.selectedIndex]; return o ? o.value : null; }
    return el.value;
  }

  /** Cuerpo del formulario tal como lo mandaría el navegador, con la carátula, el organismo y el criterio puestos. */
  function cuerpoDeBusqueda(desc, texto, pid) {
    const pares = [];
    for (const el of desc.campos) {
      if (!el.name || el.disabled) continue;
      if (el === desc.texto) { pares.push([el.name, texto]); continue; }
      if (el === desc.org) { pares.push([el.name, pid]); continue; }
      if (desc.criterio && el.name === desc.criterio.name) {
        if ((el.type || '').toLowerCase() !== 'radio' || el.value === desc.criterio.value) pares.push([el.name, desc.criterio.value]);
        continue;
      }
      const v = valorPorDefecto(el);
      if (v !== null) pares.push([el.name, v]);
    }
    const boton = desc.campos.find((e) => (e.type || '').toLowerCase() === 'submit' && e.name);
    if (boton) pares.push([boton.name, boton.value]);
    const vistos = new Set();
    return pares.filter(([k, v]) => { const c = k + '=' + v; if (vistos.has(c)) return false; vistos.add(c); return true; })
      .map(([k, v]) => codificar1252(k) + '=' + codificar1252(v)).join('&');
  }

  /** ¿La respuesta es un listado de causas, con o sin resultados? */
  const respuestaReconocida = (doc) => !!doc.querySelector('a[href*="rocesales.asp"]') ||
    /Total expedientes|no se encontr|no existen|no hay (causas|expedientes|resultados)|sin resultados|0 expedientes/i.test(textoDe(doc));

  // ------------------------------------------------ diagnóstico
  function describirCampo(el) {
    const tipo = el.tagName === 'SELECT' ? 'select(' + el.options.length + ' opciones: ' + [...el.options].slice(0, 4).map((o) => limpio(o.text)).join(' | ') + ')' : (el.tagName.toLowerCase() + ':' + (el.type || ''));
    return '    ' + tipo + ' name=' + (el.name || '-') + ' id=' + (el.id || '-') + ' valor=' + limpio(el.value || '').slice(0, 30) + ' rótulo=' + (rotuloDe(el) || textoJunto(el)).slice(0, 50);
  }
  function diagnosticoDePagina(url, doc) {
    const lineas = ['Página ' + url + ' · título: ' + limpio(doc.title) + ' · formularios: ' + doc.querySelectorAll('form').length];
    const grupos = camposPorFormulario(doc);
    doc.querySelectorAll('form').forEach((f, i) => {
      lineas.push('  Formulario ' + (i + 1) + ' · acción: ' + (f.getAttribute('action') || '(la misma página)') + ' · método: ' + (f.getAttribute('method') || 'get'));
      (grupos.get(f) || []).slice(0, 25).forEach((el) => lineas.push(describirCampo(el)));
    });
    const enlaces = enlacesCandidatos(doc, url).slice(0, 10).map((c) => c.texto + ' → ' + c.url);
    if (enlaces.length) lineas.push('  Enlaces candidatos: ' + enlaces.join(' · '));
    return lineas.join('\n');
  }
  function armarDiagnostico(titulo, paginas, extra) {
    const partes = ['MEV Ultra ' + APP.version + ' · Buscar persona · ' + fechaHora(ahora()), titulo];
    paginas.forEach((p) => partes.push(diagnosticoDePagina(p.url, p.doc)));
    if (extra) partes.push(extra);
    return partes.join('\n\n').slice(0, 12000);
  }

  // ------------------------------------------------ ubicar la consulta
  /** Páginas de la MEV donde puede estar la consulta por carátula, de la más a la menos probable. */
  function enlacesCandidatos(doc, urlPagina) {
    const vistos = new Set();
    const out = [];
    doc.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      if (!/\.asp/i.test(href) || /^javascript:|loguin|salir|logout|proveido|procesales/i.test(href)) return;
      let u;
      try { u = new URL(href, new URL(urlPagina, location.origin)); } catch (e) { return; }
      const url = u.pathname + u.search;
      if (u.origin !== location.origin || vistos.has(url) || RE_ACCION_PROHIBIDA.test(u.pathname)) return;
      vistos.add(url);
      const t = norm(a.textContent + ' ' + href);
      const puntos = (/caratula/.test(t) ? 4 : 0) + (/busq/.test(t) ? 2 : 0) + (/consulta/.test(t) ? 1 : 0);
      if (puntos) out.push({ url, puntos, texto: limpio(a.textContent) });
    });
    return out.sort((a, b) => b.puntos - a.puntos);
  }

  async function pedirBusqueda(url, opciones, aviso) {
    await pausaBuscador();
    BUSQ.actual.pedidos++;
    return parsear(await pedir(url, Object.assign({ soloHumana: true }, opciones || {}), aviso));
  }

  /**
   * Ubica la consulta por carátula: primero la última que funcionó, después
   * la página de Sets y las páginas de la MEV que enlaza. Si no la reconoce,
   * se detiene con un diagnóstico.
   */
  async function ubicarConsulta(aviso) {
    const vistas = [];
    const probar = async (url) => {
      if (vistas.some((v) => v.url === url)) return null;
      const doc = await pedirBusqueda(url, {}, aviso);
      vistas.push({ url, doc });
      const desc = describirFormulario(doc, url);
      return desc ? { url, desc } : null;
    };
    aviso('Buscando la consulta por carátula de la MEV…');
    const conocida = leerC('urlConsultaCaratula', '');
    const r0 = conocida ? await probar(conocida) : null;
    if (r0) return r0;
    const r1 = await probar('/Sets.asp');
    if (r1) return r1;
    const sets = vistas.find((v) => v.url === '/Sets.asp');
    for (const c of enlacesCandidatos(sets.doc, '/Sets.asp').slice(0, BUSCADOR.maxEnlaces)) {
      const r = await probar(c.url);
      if (r) return r;
    }
    throw new ErrorDiagnostico('No se encontró la consulta por carátula de la MEV.',
      armarDiagnostico('No se reconoció la consulta por carátula en estas páginas:', vistas));
  }

  /** El formulario de la jurisdicción en curso (los organismos cambian con la jurisdicción). */
  async function formularioEnJuris(b, aviso) {
    if (b.urlConsulta) {
      const doc = await pedirBusqueda(b.urlConsulta, {}, aviso);
      const desc = describirFormulario(doc, b.urlConsulta);
      if (desc) return desc;
    }
    const r = await ubicarConsulta(aviso);
    b.urlConsulta = r.url;
    guardarC('urlConsultaCaratula', r.url);
    return r.desc;
  }

  // ------------------------------------------------ consultas
  function pausaBuscador() {
    return new Promise((resolve, reject) => {
      const fin = ahora() + BUSCADOR.pausaMs;
      const reloj = setInterval(() => {
        if (BUSQ.pausar) { clearInterval(reloj); reject(new Cortado('pausa')); return; }
        if (ahora() >= fin) { clearInterval(reloj); resolve(); }
      }, 200);
    });
  }

  const organismoBuscable = (nombre, jid) => (jid === 'PZ' ? RE_PAZ.test(nombre) : RE_CIVIL.test(nombre) && !RE_CAMARA.test(nombre));

  function registrarHallazgos(b, j, lista, desc) {
    const nombres = new Map(desc.organismos.map((o) => [o.pid, o.nombre]));
    lista.forEach((c) => {
      if (b.resultados[c.key]) return;
      const datos = Object.assign({}, c, { juris: j.id, organismo: nombres.get(c.pid) || '' });
      delete datos._tabla;
      b.resultados[c.key] = datos;
    });
  }

  /** La primera respuesta tiene que ser un listado de causas; si no, se detiene antes de recorrer la provincia. */
  function verificarPrimera(b, doc, desc, cuerpo) {
    if (b.verificada) return;
    if (!respuestaReconocida(doc)) {
      throw new ErrorDiagnostico('La MEV no devolvió un listado de causas.',
        armarDiagnostico('La consulta por carátula se envió pero la respuesta no es un listado de causas.', [{ url: b.urlConsulta, doc: desc.form.ownerDocument }],
          'Envío: ' + desc.metodo + ' ' + desc.accion + '\n' + cuerpo + '\n\nRespuesta (texto): ' + limpio(textoDe(doc)).slice(0, 1500)));
    }
    b.verificada = true;
  }

  async function consultarOrganismo(b, j, desc, org, permitidos, aviso) {
    aviso(j.nombre + ' · ' + org.nombre);
    const cuerpo = cuerpoDeBusqueda(desc, b.texto, org.pid);
    const post = desc.metodo === 'POST';
    const url = post ? desc.accion : desc.accion + (desc.accion.includes('?') ? '&' : '?') + cuerpo;
    const doc = await pedirBusqueda(url, post ? { method: 'POST', body: cuerpo } : {}, aviso);
    verificarPrimera(b, doc, desc, cuerpo);
    const todas = leerResultados(doc);
    registrarHallazgos(b, j, todas.filter((c) => permitidos.has(c.pid)), desc);
    const decl = totalDeclarado(doc);
    if (decl !== null && decl > todas.length) b.avisos.push(j.nombre + ' · ' + org.nombre + ': la MEV informa ' + decl + ' causas y muestra ' + todas.length + '.');
  }

  function juzgadosDe(desc, jid, j, b) {
    const orgs = desc.organismos.filter((o) => !RE_TODOS.test(o.nombre) && organismoBuscable(o.nombre, jid));
    if (!orgs.length) b.avisos.push(j.nombre + ': entre ' + desc.organismos.length + ' organismos no se reconoció ningún juzgado ' + (jid === 'PZ' ? 'de paz' : 'civil y comercial') + ' (por ejemplo: ' + desc.organismos.slice(0, 3).map((o) => o.nombre).join('; ') + ').');
    return orgs;
  }

  async function buscarEnJuris(b, jid, aviso) {
    const j = jurisPorId(jid);
    if (!j || b.jurisHechas.includes(jid)) return;
    aviso('Cambiando a ' + j.nombre + '…');
    await pausaBuscador();
    b.pedidos++;
    if (await cambiarJuris(j, aviso, b.avisos, { soloHumana: true })) {
      const desc = await formularioEnJuris(b, aviso);
      const orgs = juzgadosDe(desc, jid, j, b);
      const permitidos = new Set(orgs.map((o) => o.pid));
      const pendientes = desc.todos && orgs.length ? [desc.todos] : orgs;
      for (const o of pendientes) {
        const clave = jid + '|' + o.pid;
        if (b.hechos.includes(clave)) continue;
        await consultarOrganismo(b, j, desc, o, permitidos, aviso);
        b.hechos.push(clave);
        b.juzgados += o === desc.todos ? orgs.length : 1;
        guardarBusqueda(b);
        ui.buscadorCambio();
      }
    }
    b.jurisHechas.push(jid);
    guardarBusqueda(b);
  }

  function mensajeDeBusqueda(e) {
    if (e.message === 'SESION') return 'La sesión de la MEV venció. Ingresá de nuevo y retomá la búsqueda.';
    return 'La búsqueda se interrumpió: ' + e.message;
  }

  function cerrarBusqueda(b, e) {
    b.segundos += Math.round((ahora() - (b.tRun || ahora())) / 1000);
    if (!e) { b.estado = 'terminada'; b.t1 = ahora(); return; }
    if (e instanceof Cortado) { b.estado = 'pausada'; return; }
    b.estado = 'error';
    b.error = e instanceof ErrorDiagnostico ? e.message : mensajeDeBusqueda(e);
    b.diagnostico = e instanceof ErrorDiagnostico ? e.diagnostico : '';
  }

  /** Empieza o retoma una búsqueda. Una sola por vez y nunca junto con una lectura o una descarga. */
  async function correrBusqueda(b) {
    if (BUSQ.activa || !b) return;
    if (LECTURA.activa || DESCARGAS.activa()) { ui.aviso('Hay una lectura o una descarga en curso. La búsqueda cambia la jurisdicción de la MEV: esperá a que termine.', true); return; }
    if (!tomarCandado('busqueda')) { ui.aviso('Otra pestaña de la MEV está leyendo, bajando o buscando. Esperá a que termine.', true); return; }
    BUSQ.activa = true; BUSQ.pausar = false; BUSQ.actual = b;
    Object.assign(b, { estado: 'curso', error: '', diagnostico: '', tRun: ahora() });
    guardarBusqueda(b);
    const pulso = setInterval(() => renovarCandado('busqueda'), 5000);
    const aviso = (t) => { BUSQ.avance = t; ui.buscadorProgreso(t); };
    const original = jurisPorNombre(jurisDelEncabezado(document)) || jurisPorId(leerC('ultimaJuris', ''));
    let falla = null;
    ui.buscadorCambio();
    try {
      for (const jid of b.plan) await buscarEnJuris(b, jid, aviso);
    } catch (e) {
      log('búsqueda', e);
      falla = e;
    } finally {
      cerrarBusqueda(b, falla);
      BUSQ.avance = 'Volviendo a la jurisdicción de antes…';
      ui.buscadorProgreso(BUSQ.avance);
      await sleep(BUSCADOR.pausaMs);          // también este pedido va a su ritmo
      await restituirJuris(original, { soloHumana: true });
      clearInterval(pulso);
      soltarCandado();
      BUSQ.activa = false; BUSQ.pausar = false; BUSQ.avance = '';
      guardarBusqueda(b);
      ui.buscadorCambio();
      setTimeout(() => DESCARGAS.siguiente(), 300);
    }
  }

  function empezarBusqueda(texto, alcance) {
    const t = textoDeBusqueda(texto);
    if (t.replace(/\s/g, '').length < BUSCADOR.minLetras) { ui.aviso('Escribí al menos ' + BUSCADOR.minLetras + ' letras del nombre.', true); return null; }
    const b = nuevaBusqueda(t, alcance);
    guardarBusqueda(b);
    correrBusqueda(b);
    return b;
  }
  const retomarBusqueda = (id) => correrBusqueda(busquedaPorId(id));
  function pausarBusqueda() { if (BUSQ.activa) { BUSQ.pausar = true; ui.buscadorProgreso('Pausando al terminar la consulta en curso…'); } }

  // ---------------------------------------------------------------- expediente
  // procesales.asp: datos de la causa y pasos procesales.
  function leerExpediente(doc) {
    // Se lee el texto sin depender de los saltos de renglón: cada dato va
    // desde su rótulo hasta el rótulo siguiente.
    let texto = '';
    if (doc.body) {
      const clon = doc.body.cloneNode(true);
      clon.querySelectorAll('#mvu, #mvu-pill, #mvu-pop, script, style').forEach((n) => n.remove());
      texto = limpio(clon.textContent);
    }
    const ROTULOS = 'Car[áa]tula|Fecha inicio|N[°º] de Receptor[íi]a|N[°º] de Expediente|Estado|C[óo]digo de Barras|Pasos Procesales|Se recomienda|Fecha Fojas';
    const campo = (et) => { const m = texto.match(new RegExp('(?:' + et + ')\\s*:\\s*(.*?)\\s*(?=(?:' + ROTULOS + ')|$)', 'i')); return m ? limpio(m[1]).slice(0, 300) : ''; };
    let tabla = null, max = 0;
    doc.querySelectorAll('table').forEach((t) => {
      const n = [...t.rows].filter((r) => r.querySelector('a[href*="proveido.asp"]')).length;
      if (n > max) { max = n; tabla = t; }
    });
    const acts = [];
    if (tabla) {
      [...tabla.rows].forEach((fila, i) => {
        const a = fila.querySelector('a[href*="proveido.asp"]');
        if (!a) return;
        const celdas = [...fila.cells].map((c) => limpio(c.textContent));
        const fechaTxt = celdas.find((c) => fechaDe(c)) || '';
        const f = fechaDe(fechaTxt);
        let url = '';
        try { url = new URL(a.getAttribute('href'), 'https://mev.scba.gov.ar/').href; } catch (e) { url = ''; }
        acts.push({
          i, url, fechaTxt, fecha: f ? f.getTime() : null,
          fojas: celdas[1] || '',
          firmado: !!fila.querySelector('img[src*="firma" i], img[title*="firm" i], img[alt*="firm" i]'),
          descripcion: limpio(a.textContent) || celdas[3] || ''
        });
      });
    }
    return {
      caratula: campo('Car[áa]tula'), inicio: campo('Fecha inicio'), receptoria: campo('N[°º] de Receptor[íi]a'),
      expediente: campo('N[°º] de Expediente'), estado: campo('Estado'), acts
    };
  }

  const urlProcesales = (c) => '/procesales.asp?nidCausa=' + encodeURIComponent(c.nidCausa) + '&pidJuzgado=' + encodeURIComponent(c.pid);
  const urlAbsoluta = (u) => new URL(u, 'https://mev.scba.gov.ar/').href;

  // Partes, a partir de la carátula (es lo único que da el listado).
  function partesDe(c) {
    const car = limpio(c.caratula);
    const j = jurisPorId(c.juris);
    const m = car.match(/^(.*?)\s+C\/\s*(.*?)(?:\s+S\/\s*(.*))?$/i);
    if (m && m[1] && m[2]) return 'Actora: ' + m[1] + ' · Demandada: ' + m[2].replace(/\s+S\/.*$/i, '');
    const s = car.match(/^(.*?)\s+S\/\s*(.*)$/i);
    if (s) {
      if (/sucesi|testament/i.test(s[2])) return 'Causante: ' + s[1];
      if (j && j.fuero === 'Penal') return 'Imputado: ' + s[1];
      return s[1];
    }
    return '';
  }
  const deptoDe = (c) => { const j = jurisPorId(c.juris); return j ? j.nombre : ''; };
  const setsDe = (c) => (c.sets || []).map((n) => (IDX.sets[n] ? IDX.sets[n].nombre : n)).join(' · ');

  // ---------------------------------------------------------------- descargas
  // Cada descarga la hace el motor de MEV+ (módulo 1) dentro de un marco
  // oculto que abre procesales.asp de esa causa. El marco recibe el encargo
  // por el almacén de Tampermonkey (qué actuaciones bajar), informa su avance
  // por mensajes y al final entrega el PDF, que se guarda desde acá.
  // Una descarga por vez: la MEV guarda estado de sesión y en paralelo se
  // desordena. Tope de quince en espera, como en SuPJN+.
  const TOPE_COLA = 15;
  const DESCARGAS = (function () {
    const cola = [];          // { id, causa, urls|null, titulo, estado, texto, prog, t }
    let actual = null;        // { item, marco }
    const activa = () => !!actual;

    function agregar(causa, urls, titulo) {
      const pendientes = cola.filter((x) => x.estado === 'espera' || x.estado === 'bajando').length;
      if (pendientes >= TOPE_COLA) { ui.aviso('Ya hay ' + pendientes + ' descargas pendientes (el tope es ' + TOPE_COLA + '). Esperá a que avancen.', true); return false; }
      const clave = causa.key + '|' + (urls && urls.length ? urls.join(',') : 'todo');
      if (cola.some((x) => x.clave === clave && (x.estado === 'espera' || x.estado === 'bajando'))) { ui.aviso('Esa descarga ya está en la cola.', false); return false; }
      if (LECTURA.activa) { ui.aviso('Se están leyendo las causas. Las descargas empiezan cuando termine la lectura.', false); }
      if (BUSQ.activa) { ui.aviso('Hay una búsqueda por nombre en curso. Las descargas empiezan cuando termine o cuando la pauses.', false); }
      const item = {
        id: 'd' + ahora().toString(36) + Math.random().toString(36).slice(2, 6),
        causa: { key: causa.key, nidCausa: causa.nidCausa, pid: causa.pid, caratula: causa.caratula, expediente: causa.expediente },
        urls: urls && urls.length ? urls.slice() : null,
        titulo: titulo || (urls && urls.length ? urls.length + ' actuación(es)' : 'expediente completo'),
        clave, estado: 'espera', texto: 'En espera', prog: 0, t: ahora(), ult: ahora(), ayuda: false
      };
      cola.push(item);
      ui.refrescarDescargas();
      siguiente();
      return true;
    }

    // Espera entre pestañas: si otra está leyendo o bajando, se reintenta.
    let reintento = null;
    function siguiente() {
      clearTimeout(reintento);
      if (actual || LECTURA.activa || BUSQ.activa) return;
      const item = cola.find((x) => x.estado === 'espera');
      if (!item) { ui.refrescarDescargas(); return; }
      if (!tomarCandado('descarga')) { item.texto = 'Esperando: otra pestaña de la MEV está leyendo o bajando.'; ui.refrescarDescargas(); reintento = setTimeout(siguiente, 15000); return; }
      item.estado = 'bajando'; item.texto = 'Abriendo la causa…'; item.prog = 0;
      gmSet('mu.encargo.' + item.id, { urls: item.urls, t: ahora(), origen: ID_PESTANA });
      const marco = document.createElement('iframe');
      marco.setAttribute('data-mu', 'descarga');
      marco.style.cssText = 'position:fixed;left:-99999px;top:0;width:1100px;height:900px;border:0';
      marco.src = urlProcesales(item.causa) + '#mevultra-encargo=' + item.id;
      item.ult = ahora();
      actual = { item, marco, vigia: null, pulso: setInterval(() => renovarCandado('descarga'), 5000) };
      document.body.appendChild(marco);
      // Vigía por inactividad: si el marco pasa tres minutos sin dar señales
      // (sesión caída, validación que se perdió, error sin aviso) y no está
      // esperando que el usuario valide, la descarga se da por fallida.
      actual.vigia = setInterval(() => {
        if (actual && actual.item === item && !item.ayuda && ahora() - item.ult > 180000) terminar(item, 'error', 'La descarga dejó de responder. Probá abrir la causa en la MEV y volver a bajar.');
      }, 30000);
      ui.refrescarDescargas();
    }

    function terminar(item, estado, texto) {
      item.estado = estado; item.texto = texto; if (estado === 'listo') item.prog = 1;
      if (actual && actual.item === item) {
        clearInterval(actual.vigia);
        clearInterval(actual.pulso);
        soltarCandado();
        const m = actual.marco;
        actual = null;
        setTimeout(() => m.remove(), 1500);
      }
      try { GM_deleteValue('mu.encargo.' + item.id); } catch (e) { /* nada */ }
      ui.ayudaDescarga(null);
      ui.refrescarDescargas();
      setTimeout(siguiente, 1200);
    }

    function enviar(msg) {
      if (!actual) return;
      try { actual.marco.contentWindow.postMessage(Object.assign({ mevultra: 'ordenes', id: actual.item.id }, msg), location.origin); } catch (e) { /* nada */ }
    }

    function cancelar(id) {
      const item = cola.find((x) => x.id === id);
      if (!item) return;
      if (item.estado === 'espera') { item.estado = 'cancelado'; item.texto = 'Cancelada antes de empezar'; ui.refrescarDescargas(); return; }
      if (item.estado === 'bajando') { item.texto = 'Cancelando: se arma el PDF con lo que haya…'; enviar({ orden: 'cancelar' }); ui.refrescarDescargas(); }
    }
    function cancelarTodo() {
      cola.forEach((x) => { if (x.estado === 'espera') { x.estado = 'cancelado'; x.texto = 'Cancelada antes de empezar'; } });
      if (actual) cancelar(actual.item.id);
      ui.refrescarDescargas();
    }
    function limpiarTerminadas() {
      for (let i = cola.length - 1; i >= 0; i--) if (!['espera', 'bajando'].includes(cola[i].estado)) cola.splice(i, 1);
      ui.refrescarDescargas();
    }

    // Mensajes del marco. Solo se aceptan del marco de la descarga en curso.
    window.addEventListener('message', (ev) => {
      const d = ev.data;
      if (!d || d.mevultra !== 'encargo' || !actual || ev.origin !== location.origin) return;
      if (ev.source !== actual.marco.contentWindow || d.id !== actual.item.id) return;
      const item = actual.item;
      item.ult = ahora();
      if (d.tipo === 'estado') { item.texto = String(d.texto || ''); }
      else if (d.tipo === 'progreso') { item.prog = Math.max(0, Math.min(1, +d.fraccion || 0)); item.texto = String(d.texto || ''); }
      else if (d.tipo === 'ayuda') {
        item.ayuda = !!d.texto;
        ui.ayudaDescarga(d.texto ? { texto: String(d.texto), url: urlAbsoluta(urlProcesales(item.causa)), seguir: () => enviar({ orden: 'seguir' }) } : null);
      } else if (d.tipo === 'archivo') {
        guardarArchivo(d.blob, String(d.nombre || 'expediente.pdf'), 'application/pdf').then((via) => {
          enviar({ orden: 'archivoGuardado', via });
        });
        return;
      } else if (d.tipo === 'fin') {
        const txt = String(d.texto || '');
        const ok = /^Listo/.test(txt);
        terminar(item, ok ? 'listo' : (/cancel/i.test(txt) ? 'cancelado' : 'error'), txt || (ok ? 'Listo' : 'No se pudo completar'));
        return;
      }
      ui.refrescarDescargas();
    });

    return { agregar, cancelar, cancelarTodo, limpiarTerminadas, activa, cola: () => cola, siguiente, actual: () => actual };
  })();

  // Encargos que quedaron de una pestaña cerrada a mitad de una descarga.
  function limpiarEncargosViejos() {
    try {
      if (typeof GM_listValues !== 'function') return;
      GM_listValues().filter((k) => /^mu\.encargo\./.test(k)).forEach((k) => {
        const v = gmGet(k, null);
        if (!v || ahora() - (v.t || 0) > 86400000) GM_deleteValue(k);
      });
    } catch (e) { /* nada */ }
  }

  // Guarda un archivo en Descargas. GM_download falla en silencio con
  // Tampermonkey en modo nativo si el nombre trae carpetas; se cae a un
  // <a download> común. Los archivos grandes van directo por <a download>.
  function guardarArchivo(datos, nombre, tipo) {
    const blob = datos instanceof Blob ? datos : new Blob([datos], { type: tipo || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const porAncla = () => { const a = document.createElement('a'); a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove(); };
    const grande = blob.size >= 100 * 1048576;
    const margen = Math.max(180000, Math.ceil(blob.size / (100 * 1048576)) * 120000);
    return new Promise((resolve) => {
      if (grande || typeof GM_download !== 'function') { porAncla(); resolve('ancla'); return; }
      let listo = false;
      const fin = (v) => { if (!listo) { listo = true; resolve(v); } };
      try {
        GM_download({ url, name: nombre, saveAs: false, timeout: 300000,
          onload: () => fin('GM_download'),
          onerror: () => { porAncla(); fin('ancla'); },
          ontimeout: () => { porAncla(); fin('ancla'); } });
      } catch (e) { porAncla(); fin('ancla'); }
    }).finally(() => setTimeout(() => URL.revokeObjectURL(url), margen));
  }

  // ---------------------------------------------------------------- etiquetas y anotaciones
  // Paleta: los pasteles de EJE+ y SADE+ más el rojo semáforo, con el texto
  // en el color que se lee sobre cada fondo.
  const COLORES = [
    ['Rojo semáforo', '#c93b3b', '#ffffff'], ['Verde', '#cdebd6', '#1d4d2c'], ['Amarillo', '#fbeaa5', '#5c4a00'],
    ['Celeste', '#cfe6f7', '#16466b'], ['Rosa', '#f6d3e0', '#6b1f3d'], ['Lila', '#e2d8f3', '#3f2b6b'],
    ['Naranja', '#fbd9bd', '#6b3a10'], ['Gris', '#e3e6e8', '#33393e'], ['Turquesa', '#c9ece9', '#155750'], ['Arena', '#eee2cc', '#5a4722']
  ];
  const colorDe = (hex) => COLORES.find((c) => c[1] === hex) || COLORES[7];
  const marcaDe = (key) => MARCAS.filas[key] || null;
  const etiquetasDe = (key) => { const m = marcaDe(key); return m ? (m.etq || []).map((id) => MARCAS.etiquetas.find((e) => e.id === id)).filter(Boolean) : []; };
  const anotacionDe = (key) => { const m = marcaDe(key); return m ? (m.anot || '') : ''; };
  function fijarMarca(key, cambios) {
    const m = Object.assign({ etq: [], anot: '' }, MARCAS.filas[key] || {}, cambios, { t: ahora() });
    if (!m.etq.length && !m.anot) delete MARCAS.filas[key]; else MARCAS.filas[key] = m;
    guardarMarcas();
  }
  function alternarEtiqueta(key, id) {
    const m = marcaDe(key) || { etq: [], anot: '' };
    const etq = (m.etq || []).includes(id) ? m.etq.filter((x) => x !== id) : (m.etq || []).concat([id]);
    fijarMarca(key, { etq });
  }
  function crearEtiqueta(nombre, color) {
    const n = limpio(nombre);
    if (!n) return null;
    const ya = MARCAS.etiquetas.find((e) => norm(e.nombre) === norm(n));
    if (ya) return ya;
    const e = { id: 'e' + ahora().toString(36) + Math.random().toString(36).slice(2, 5), nombre: n, color: color || COLORES[(MARCAS.etiquetas.length + 1) % COLORES.length][1] };
    MARCAS.etiquetas.push(e);
    guardarMarcas();
    return e;
  }
  function borrarEtiqueta(id) {
    MARCAS.etiquetas = MARCAS.etiquetas.filter((e) => e.id !== id);
    Object.keys(MARCAS.filas).forEach((k) => {
      const m = MARCAS.filas[k];
      m.etq = (m.etq || []).filter((x) => x !== id);
      if (!m.etq.length && !m.anot) delete MARCAS.filas[k];
    });
    guardarMarcas();
  }

  // ---------------------------------------------------------------- respaldo cifrado
  // Mismo esquema que SuPJN+: archivo binario propio (.mevu), AES-GCM con
  // clave derivada por PBKDF2 de una contraseña que se pone una vez y queda
  // guardada en este equipo, por cuenta. No se pide en el uso diario.
  //
  //   bytes 0 a 6    marca "MEVULT" + 0x01
  //   byte  7        versión del formato
  //   bytes 8 a 23   sal (distinta en cada archivo)
  //   bytes 24 a 35  vector de inicialización
  //   resto          contenido cifrado
  const MARCA_ARCHIVO = [0x4d, 0x45, 0x56, 0x55, 0x4c, 0x54, 0x01];
  const VERSION_ARCHIVO = 1;
  const VUELTAS = 250000;
  const EXT = '.mevu';
  const cripto = () => (W.crypto || window.crypto);
  const bytesDe = (s) => new TextEncoder().encode(s);
  async function claveDesde(contra, sal) {
    const base = await cripto().subtle.importKey('raw', bytesDe(contra), 'PBKDF2', false, ['deriveKey']);
    return cripto().subtle.deriveKey({ name: 'PBKDF2', salt: sal, iterations: VUELTAS, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  const leerContra = () => { const v = leerC('contra', null); return v && typeof v.c === 'string' ? v.c : ''; };
  const guardarContra = (c) => guardarC('contra', { c: String(c || ''), t: ahora() });
  const esNuestro = (b) => { if (!b || b.length < MARCA_ARCHIVO.length + 29) return false; for (let i = 0; i < MARCA_ARCHIVO.length; i++) if (b[i] !== MARCA_ARCHIVO[i]) return false; return true; };
  async function cifrar(txt, contra) {
    if (!contra) throw new Error('falta la contraseña del respaldo');
    const sal = cripto().getRandomValues(new Uint8Array(16));
    const iv = cripto().getRandomValues(new Uint8Array(12));
    const k = await claveDesde(contra, sal);
    const c = new Uint8Array(await cripto().subtle.encrypt({ name: 'AES-GCM', iv }, k, bytesDe(txt)));
    const out = new Uint8Array(MARCA_ARCHIVO.length + 1 + 16 + 12 + c.length);
    out.set(MARCA_ARCHIVO, 0); out[MARCA_ARCHIVO.length] = VERSION_ARCHIVO;
    out.set(sal, MARCA_ARCHIVO.length + 1); out.set(iv, MARCA_ARCHIVO.length + 17); out.set(c, MARCA_ARCHIVO.length + 29);
    return out;
  }
  async function descifrar(bytes, contra) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (!esNuestro(b)) return new TextDecoder().decode(b);
    if (!contra) throw new Error('ese archivo tiene contraseña y todavía no pusiste la tuya');
    const p = MARCA_ARCHIVO.length + 1;
    const k = await claveDesde(contra, b.subarray(p, p + 16));
    try { return new TextDecoder().decode(await cripto().subtle.decrypt({ name: 'AES-GCM', iv: b.subarray(p + 16, p + 28) }, k, b.subarray(p + 28))); } catch (e) { throw new Error('la contraseña no abre ese archivo'); }
  }
  const datosRespaldo = () => JSON.stringify({ formato: 'mevultra/marcas', version: 1, fecha: new Date().toISOString(), cuenta: CUENTA.usuario, etiquetas: MARCAS.etiquetas, filas: MARCAS.filas }, null, 1);

  async function exportar() {
    const c = leerContra();
    if (!c) throw new Error('primero poné la contraseña del respaldo (una sola vez)');
    await guardarArchivo(await cifrar(datosRespaldo(), c), 'MEV-Ultra-datos-' + CUENTA.usuario + '-' + sello() + EXT, 'application/octet-stream');
    guardarC('respaldo', { fecha: ahora() });
  }

  // Importar suma: no pisa lo que ya hay. Etiquetas por nombre; en cada causa
  // se suman las etiquetas, y la anotación se toma solo si acá no había.
  function fusionar(obj) {
    if (!obj || obj.formato !== 'mevultra/marcas') throw new Error('ese archivo no es un respaldo de MEV Ultra');
    if (obj.cuenta && obj.cuenta !== CUENTA.usuario) throw new Error('ese respaldo es del usuario ' + obj.cuenta + ' y esta sesión es de ' + CUENTA.usuario);
    const mapa = {};
    let etqNuevas = 0, causas = 0, conflictos = 0;
    (obj.etiquetas || []).forEach((e) => {
      let local = MARCAS.etiquetas.find((x) => norm(x.nombre) === norm(e.nombre));
      if (!local) { local = { id: e.id && !MARCAS.etiquetas.some((x) => x.id === e.id) ? e.id : 'e' + Math.random().toString(36).slice(2, 9), nombre: e.nombre, color: e.color }; MARCAS.etiquetas.push(local); etqNuevas++; }
      mapa[e.id] = local.id;
    });
    Object.entries(obj.filas || {}).forEach(([k, m]) => {
      const l = MARCAS.filas[k] || { etq: [], anot: '' };
      const etq = [...new Set((l.etq || []).concat((m.etq || []).map((x) => mapa[x]).filter(Boolean)))];
      let anot = l.anot || '';
      if (!anot && m.anot) anot = m.anot; else if (m.anot && m.anot !== anot) conflictos++;
      if (etq.length || anot) { MARCAS.filas[k] = { etq, anot, t: ahora() }; causas++; }
    });
    guardarMarcas();
    return { etqNuevas, causas, conflictos };
  }
  async function importarArchivo(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const txt = await descifrar(bytes, leerContra());
    return fusionar(JSON.parse(txt));
  }

  // Carpeta de respaldo automático: se elige una vez (Chrome guarda el
  // permiso); cada cambio de etiquetas o anotaciones se escribe cifrado ahí.
  // Conviene que esté fuera de la carpeta del programa (OneDrive, Drive).
  let CARPETA = null;
  let carpetaEstado = { estado: 'nada', texto: '' };
  function abrirIDB() {
    return new Promise((res, rej) => {
      let p;
      try { p = W.indexedDB.open('mevultra', 1); } catch (e) { rej(e); return; }
      p.onupgradeneeded = () => { try { p.result.createObjectStore('carpeta'); } catch (e) { /* ya estaba */ } };
      p.onsuccess = () => res(p.result);
      p.onerror = () => rej(p.error || new Error('no se pudo abrir el almacén'));
    });
  }
  async function idb(modo, fn) {
    const db = await abrirIDB();
    return new Promise((res, rej) => {
      const tx = db.transaction('carpeta', modo);
      const r = fn(tx.objectStore('carpeta'));
      tx.oncomplete = () => { db.close(); res(r && r.result); };
      tx.onerror = () => rej(tx.error);
    });
  }
  const archivoCarpeta = () => 'MEV-Ultra-datos-' + CUENTA.usuario + EXT;
  async function cargarCarpeta() {
    try { CARPETA = await idb('readonly', (s) => s.get('h:' + CUENTA.usuario)); } catch (e) { CARPETA = null; }
    if (!CARPETA) { carpetaEstado = { estado: 'nada', texto: 'Sin carpeta elegida.' }; return; }
    let perm = 'prompt';
    try { perm = await CARPETA.queryPermission({ mode: 'readwrite' }); } catch (e) { perm = 'prompt'; }
    carpetaEstado = perm === 'granted' ? { estado: 'lista', texto: 'Respaldo automático en la carpeta "' + CARPETA.name + '".' }
      : { estado: 'pedir', texto: 'Chrome pide confirmar el permiso sobre la carpeta "' + CARPETA.name + '".' };
  }
  async function elegirCarpeta() {
    if (typeof W.showDirectoryPicker !== 'function') throw new Error('este navegador no deja elegir una carpeta: usá Exportar');
    if (!leerContra()) throw new Error('primero poné la contraseña del respaldo');
    const h = await W.showDirectoryPicker({ id: 'mevultra-respaldo', mode: 'readwrite', startIn: 'documents' });
    await idb('readwrite', (s) => s.put(h, 'h:' + CUENTA.usuario));
    CARPETA = h;
    carpetaEstado = { estado: 'lista', texto: 'Respaldo automático en la carpeta "' + h.name + '".' };
    await respaldoACarpeta();
  }
  async function confirmarPermisoCarpeta() {
    if (!CARPETA) return;
    const p = await CARPETA.requestPermission({ mode: 'readwrite' });
    await cargarCarpeta();
    if (p === 'granted') await respaldoACarpeta();
  }
  async function respaldoACarpeta() {
    if (!CARPETA || carpetaEstado.estado !== 'lista') return;
    const c = leerContra();
    if (!c) { carpetaEstado = { estado: 'contra', texto: 'Falta la contraseña del respaldo: sin ella no se escribe en la carpeta.' }; return; }
    try {
      const fh = await CARPETA.getFileHandle(archivoCarpeta(), { create: true });
      const w = await fh.createWritable();
      await w.write(await cifrar(datosRespaldo(), c));
      await w.close();
      guardarC('respaldoCarpeta', { fecha: ahora() });
      carpetaEstado = { estado: 'lista', texto: 'Respaldo automático en la carpeta "' + CARPETA.name + '". Última copia: ' + fechaHora(ahora()) + '.' };
    } catch (e) {
      carpetaEstado = { estado: 'error', texto: 'No se pudo escribir en la carpeta: ' + e.message };
    }
    if (ui && ui.refrescarEstadoCarpeta) ui.refrescarEstadoCarpeta();
  }

  // ---------------------------------------------------------------- estilos
  const V = '#0d4a2b', V2 = '#08331d', VC = '#e5efe9', VB = '#bcd4c4';
  const CSS = `
  #mvu,#mvu *,#mvu-pill,#mvu-pop,#mvu-pop *{box-sizing:border-box}
  #mvu{position:fixed;z-index:2147483000;background:#f4f6f5;color:#1f2328;font:13px/1.4 "Segoe UI",system-ui,Arial,sans-serif;display:flex;flex-direction:column;overflow:hidden}
  #mvu.max{inset:0;border:0}
  #mvu.ventana{border:1px solid #9fb8a8;border-radius:6px;box-shadow:0 18px 52px rgba(0,0,0,.34)}
  #mvu.oculta{display:none}
  #mvu button{font:inherit}
  #mvu .bar{display:flex;align-items:center;gap:8px;height:46px;padding:0 6px 0 12px;background:${V};color:#fff;flex:0 0 auto;user-select:none}
  #mvu.ventana .bar{cursor:move}
  #mvu .marca{font-weight:800;font-size:16px;letter-spacing:.4px;white-space:nowrap}
  #mvu .beta{font-size:10px;font-weight:700;background:#f4c430;color:#4a3b00;border-radius:3px;padding:1px 5px}
  #mvu .cuenta{font-size:11px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.25);border-radius:3px;padding:3px 7px;white-space:nowrap;max-width:230px;overflow:hidden;text-overflow:ellipsis}
  #mvu .bar input.buscar{flex:1 1 auto;min-width:120px;max-width:640px;height:30px;border:1px solid transparent;border-radius:3px;padding:0 10px;font:inherit;color:#1f2328;background:#fff}
  #mvu .bar input.buscar:focus{outline:2px solid #9fd1b2}
  #mvu .bar .bb{height:30px;padding:0 11px;border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.1);color:#fff;border-radius:3px;cursor:pointer;white-space:nowrap}
  #mvu .bar .bb:hover{background:rgba(255,255,255,.22)}
  #mvu .zoom{display:flex;align-items:center;border:1px solid rgba(255,255,255,.35);border-radius:3px;overflow:hidden;flex:0 0 auto}
  #mvu .zoom button{height:28px;border:0;background:transparent;color:#fff;cursor:pointer;padding:0 8px}
  #mvu .zoom button:hover{background:rgba(255,255,255,.2)}
  #mvu .zoom span{font-size:11px;min-width:38px;text-align:center}
  #mvu .ctrl{display:flex;margin-left:auto;flex:0 0 auto}
  #mvu .ctrl button{width:30px;height:26px;border:0;background:transparent;color:#fff;cursor:pointer;border-radius:3px;font-size:13px;line-height:1}
  #mvu .ctrl button:hover{background:rgba(255,255,255,.2)}
  #mvu .ctrl button.cerrar:hover{background:#c0392b}
  #mvu .tabs{display:flex;gap:2px;padding:0 10px;background:#fff;border-bottom:1px solid #d5ddd8;flex:0 0 auto;overflow-x:auto}
  #mvu .tabs button{border:0;background:transparent;padding:9px 13px 8px;cursor:pointer;color:#56615b;border-bottom:3px solid transparent;white-space:nowrap;font-weight:600}
  #mvu .tabs button:hover{color:${V}}
  #mvu .tabs button.on{color:${V};border-bottom-color:${V}}
  #mvu .tabs .n{display:inline-block;min-width:18px;padding:0 5px;margin-left:5px;border-radius:9px;background:${VC};color:${V};font-size:11px;text-align:center}
  #mvu .tabs .n.rojo{background:#c93b3b;color:#fff}
  #mvu .tabs .x{margin-left:6px;color:#8a938e;font-weight:400}
  #mvu .tabs .x:hover{color:#c0392b}
  #mvu .franja{display:flex;align-items:center;gap:10px;padding:6px 12px;font-size:12px;flex:0 0 auto}
  #mvu .franja.lect{background:#fff6d6;border-bottom:1px solid #ecd98c;color:#5c4a00}
  #mvu .franja.aviso{background:#e8f3ec;border-bottom:1px solid ${VB};color:#1d4d2c}
  #mvu .franja.aviso.malo{background:#fbe5e3;border-bottom-color:#e6b1ac;color:#7a1f16}
  #mvu .franja .grow{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #mvu .franja button{height:24px;padding:0 9px;border:1px solid currentColor;background:transparent;color:inherit;border-radius:3px;cursor:pointer;font-size:12px}
  #mvu .cuerpo{flex:1 1 auto;overflow:hidden;position:relative}
  #mvu section{position:absolute;inset:0;display:none;flex-direction:column;overflow:hidden}
  #mvu section.on{display:flex}
  #mvu section.scroll{overflow:auto;padding:14px 18px}
  #mvu .tool{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:8px 12px;background:#fff;border-bottom:1px solid #e0e6e2;flex:0 0 auto}
  #mvu .tool .sep{width:1px;height:22px;background:#dfe5e1;margin:0 3px}
  #mvu .b,#mvu select.s,#mvu input.i{height:28px;border:1px solid #c9d3cd;background:#fff;color:#2b3138;border-radius:3px;padding:0 9px;font:inherit;font-size:12px}
  #mvu select.s{appearance:none;-webkit-appearance:none;padding-right:22px;max-width:190px;background:#fff url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6'><path d='M0 0l5 6 5-6z' fill='%23586159'/></svg>") no-repeat right 7px center}
  #mvu input.i[type=date]{padding:0 5px}
  #mvu .b{cursor:pointer;white-space:nowrap}
  #mvu .b:hover{border-color:${V};color:${V}}
  #mvu .b.p{background:${V};border-color:${V};color:#fff}
  #mvu .b.p:hover{background:${V2};color:#fff}
  #mvu .b.on{background:${VC};border-color:${V};color:${V};font-weight:600}
  #mvu .b.rojo{background:#8a2b2b;border-color:#8a2b2b;color:#fff}
  #mvu .b[disabled]{opacity:.45;cursor:default}
  #mvu .info{padding:5px 12px;font-size:12px;color:#56615b;flex:0 0 auto;display:flex;gap:14px;flex-wrap:wrap}
  #mvu .envoltura{flex:1 1 auto;overflow:scroll;background:#fff;border-top:1px solid #e0e6e2}
  #mvu .envoltura::-webkit-scrollbar{width:12px;height:12px}
  #mvu .envoltura::-webkit-scrollbar-thumb{background:#b9c7be;border-radius:6px;border:3px solid #fff}
  #mvu .envoltura::-webkit-scrollbar-track{background:#f1f4f2}
  #mvu table.grid{border-collapse:separate;border-spacing:0;table-layout:fixed;font-size:12.5px}
  #mvu table.grid th{position:sticky;top:0;z-index:2;background:#eef3f0;color:#2f3a33;text-align:left;font-weight:700;padding:7px 8px;border-bottom:1px solid #cfdad3;border-right:1px solid #e1e8e3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;user-select:none;cursor:pointer}
  #mvu table.grid th.arr{opacity:.4}
  #mvu table.grid th.sobre{box-shadow:inset 3px 0 0 ${V}}
  #mvu table.grid th .rz{position:absolute;top:0;right:0;width:7px;height:100%;cursor:col-resize}
  #mvu table.grid th .fl{color:${V};margin-left:4px}
  #mvu table.grid td{padding:6px 8px;border-bottom:1px solid #edf1ee;vertical-align:top;overflow:hidden;text-overflow:ellipsis}
  #mvu table.grid tr:hover td{background:#f5faf7}
  #mvu table.grid tr.sel td{background:#e6f2ea}
  #mvu table.grid tr.aus td{color:#9aa39d}
  #mvu table.grid td.nw{white-space:nowrap}
  #mvu .car{color:#123d25;font-weight:600;cursor:pointer}
  #mvu .car:hover{text-decoration:underline}
  #mvu .punto{display:inline-block;width:9px;height:9px;border-radius:50%;background:#1f9d55;margin-top:4px}
  #mvu .chip{display:inline-block;padding:1px 7px;margin:0 3px 3px 0;border-radius:10px;font-size:11px;font-weight:600;white-space:nowrap}
  #mvu .celda-edit{cursor:pointer;min-height:18px}
  #mvu .celda-edit:hover{outline:1px dashed #9fb8a8}
  #mvu .mas{color:#8a938e;font-size:11px}
  #mvu .ib{border:1px solid #d3dcd6;background:#fff;border-radius:3px;cursor:pointer;height:24px;min-width:26px;padding:0 6px;color:#2b3138}
  #mvu .ib:hover{border-color:${V};color:${V}}
  #mvu .pag{display:flex;align-items:center;gap:4px;padding:6px 12px;background:#fff;border-top:1px solid #e0e6e2;flex:0 0 auto;font-size:12px;flex-wrap:wrap}
  #mvu .pag button{height:26px;min-width:28px;border:1px solid #d3dcd6;background:#fff;border-radius:3px;cursor:pointer}
  #mvu .pag button.on{background:${V};border-color:${V};color:#fff}
  #mvu .pag .grow{flex:1}
  #mvu .vacio{padding:40px 24px;max-width:760px;margin:0 auto;color:#3a453e;line-height:1.6}
  #mvu .vacio h2{color:${V};margin:0 0 10px;font-size:19px}
  #mvu .cab{background:#fff;border-bottom:1px solid #e0e6e2;padding:12px 14px;flex:0 0 auto}
  #mvu .cab h2{margin:0 0 6px;font-size:16px;color:#123d25}
  #mvu .datos{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12px;color:#3a453e;margin-bottom:8px}
  #mvu .datos b{color:#1f2328}
  #mvu .fila{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
  #mvu textarea.anot{width:100%;min-height:52px;max-height:160px;resize:vertical;border:1px solid #c9d3cd;border-radius:3px;padding:6px 8px;font:inherit;font-size:12.5px;margin-top:6px}
  #mvu .caja{background:#fff;border:1px solid #dde5e0;border-radius:6px;padding:12px 14px;margin-bottom:12px}
  #mvu .caja h3{margin:0 0 8px;font-size:14px;color:${V}}
  #mvu .prog{height:6px;background:#e1e9e4;border-radius:3px;overflow:hidden;margin-top:5px}
  #mvu .prog i{display:block;height:100%;background:${V};width:0;transition:width .3s}
  #mvu .ayuda-val{background:#fff6e5;border:1px solid #e0b25c;border-radius:6px;padding:10px 12px;margin:10px 12px 0;color:#6b4a10;font-size:12px}
  #mvu .txt p{margin:0 0 9px}
  #mvu .txt li{margin-bottom:5px}
  #mvu .rsz{position:absolute;z-index:5}
  #mvu.max .rsz{display:none}
  #mvu .rsz.n{top:0;left:6px;right:6px;height:5px;cursor:ns-resize}
  #mvu .rsz.s{bottom:0;left:6px;right:6px;height:5px;cursor:ns-resize}
  #mvu .rsz.e{right:0;top:6px;bottom:6px;width:5px;cursor:ew-resize}
  #mvu .rsz.w{left:0;top:6px;bottom:6px;width:5px;cursor:ew-resize}
  #mvu .rsz.ne{top:0;right:0;width:10px;height:10px;cursor:nesw-resize}
  #mvu .rsz.nw{top:0;left:0;width:10px;height:10px;cursor:nwse-resize}
  #mvu .rsz.se{bottom:0;right:0;width:12px;height:12px;cursor:nwse-resize}
  #mvu .rsz.sw{bottom:0;left:0;width:10px;height:10px;cursor:nesw-resize}
  #mvu-pill{position:fixed;z-index:2147483001;right:16px;bottom:16px;display:none;align-items:center;gap:8px;height:40px;padding:0 8px 0 14px;border-radius:20px;background:${V};color:#fff;font:700 13px "Segoe UI",system-ui,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.3);cursor:pointer;user-select:none}
  #mvu-pill.aviso{background:#c93b3b}
  #mvu-pill .pb{border:0;background:rgba(255,255,255,.18);color:#fff;border-radius:50%;width:26px;height:26px;cursor:pointer;font-size:12px}
  #mvu-pill .pb:hover{background:rgba(255,255,255,.32)}
  #mvu-pop{position:fixed;z-index:2147483002;display:none;background:#fff;border:1px solid #b9cbbf;border-radius:6px;box-shadow:0 12px 32px rgba(0,0,0,.25);padding:10px;font:12.5px/1.4 "Segoe UI",system-ui,sans-serif;color:#1f2328;min-width:220px;max-width:380px}
  #mvu-pop .it{display:block;width:100%;text-align:left;border:0;background:transparent;padding:6px 8px;border-radius:3px;cursor:pointer;font:inherit}
  #mvu-pop .it:hover{background:${VC};color:${V}}
  #mvu-pop label{display:flex;align-items:center;gap:7px;padding:3px 2px;cursor:pointer}
  #mvu-pop textarea{width:100%;min-height:110px;border:1px solid #c9d3cd;border-radius:3px;padding:6px;font:inherit}
  #mvu-pop input[type=text]{width:100%;height:28px;border:1px solid #c9d3cd;border-radius:3px;padding:0 7px;font:inherit}
  #mvu-pop .pie{display:flex;gap:6px;justify-content:flex-end;margin-top:8px}
  #mvu-pop .pie button{height:26px;padding:0 10px;border:1px solid #c9d3cd;background:#fff;border-radius:3px;cursor:pointer}
  #mvu-pop .pie button.p{background:${V};border-color:${V};color:#fff}
  #mvu-pop h4{margin:0 0 6px;font-size:12.5px;color:${V}}
  #mvu input[type=checkbox],#mvu-pop input[type=checkbox]{accent-color:${V};width:15px;height:15px;cursor:pointer;margin:0}
  `;

  // ---------------------------------------------------------------- grilla genérica
  // Tabla con columnas que se ordenan (clic en el título), se reubican
  // (arrastrando el título), se ensanchan (arrastrando el borde) y se ocultan.
  // La usan Mis causas y Este expediente.
  function Grilla(opc) {
    // opc: { cols, pref:{orden,anchos,ocultas,ajustar}, guardar(), filas(), celda(col, fila), clave(fila), orden:{col,dir}, alOrdenar(), claseFila(fila) }
    const tabla = document.createElement('table');
    tabla.className = 'grid';
    let arrastrada = null;
    const visibles = () => {
      const ord = (opc.pref.orden || []).filter((id) => opc.cols.some((c) => c.id === id));
      opc.cols.forEach((c) => { if (!ord.includes(c.id)) ord.push(c.id); });
      opc.pref.orden = ord;
      return ord.map((id) => opc.cols.find((c) => c.id === id)).filter((c) => !(opc.pref.ocultas || []).includes(c.id));
    };
    function pintar() {
      const cols = visibles();
      const anchos = cols.map((c) => opc.pref.anchos[c.id] || c.w);
      const suma = anchos.reduce((a, b) => a + b, 0);
      const ajustar = opc.pref.ajustar !== false;
      tabla.style.width = ajustar ? '100%' : suma + 'px';
      let h = '<colgroup>' + cols.map((c, i) => '<col style="width:' + (ajustar ? (anchos[i] / suma * 100).toFixed(3) + '%' : anchos[i] + 'px') + '">').join('') + '</colgroup>';
      h += '<thead><tr>' + cols.map((c) => {
        const o = opc.orden();
        const flecha = o && o.col === c.id ? '<span class="fl">' + (o.dir > 0 ? '▲' : '▼') + '</span>' : '';
        return '<th data-c="' + c.id + '" draggable="' + (c.fija ? 'false' : 'true') + '" title="' + esc(c.tip || c.t) + (c.orden ? ' · clic para ordenar' : '') + ' · arrastrar para mover">' +
          (c.thHtml ? c.thHtml() : esc(c.t)) + flecha + '<span class="rz" data-rz="' + c.id + '"></span></th>';
      }).join('') + '</tr></thead><tbody>';
      const filas = opc.filas();
      h += filas.map((f) => '<tr data-k="' + esc(opc.clave(f)) + '" class="' + (opc.claseFila ? opc.claseFila(f) : '') + '">' +
        cols.map((c) => '<td class="' + (c.nw ? 'nw' : '') + '" data-c="' + c.id + '">' + opc.celda(c, f) + '</td>').join('') + '</tr>').join('');
      if (!filas.length) h += '<tr><td colspan="' + cols.length + '" style="padding:18px;color:#6b756f">' + esc(opc.vacio ? opc.vacio() : 'Nada para mostrar.') + '</td></tr>';
      h += '</tbody>';
      tabla.innerHTML = h;
    }
    // Ordenar
    tabla.addEventListener('click', (e) => {
      if (e.target.closest('.rz')) return;
      const th = e.target.closest('th');
      if (!th || e.target.closest('input')) return;
      const c = opc.cols.find((x) => x.id === th.dataset.c);
      if (!c || !c.orden) return;
      const o = opc.orden();
      opc.fijarOrden(o && o.col === c.id ? { col: c.id, dir: -o.dir } : { col: c.id, dir: c.dirInicial || 1 });
    });
    // Mover
    tabla.addEventListener('dragstart', (e) => {
      const th = e.target.closest && e.target.closest('th');
      if (!th) return;
      arrastrada = th.dataset.c; th.classList.add('arr');
      try { e.dataTransfer.setData('text/plain', arrastrada); e.dataTransfer.effectAllowed = 'move'; } catch (x) { /* nada */ }
    });
    tabla.addEventListener('dragover', (e) => {
      const th = e.target.closest && e.target.closest('th');
      if (!th || !arrastrada) return;
      e.preventDefault();
      tabla.querySelectorAll('th.sobre').forEach((x) => x.classList.remove('sobre'));
      th.classList.add('sobre');
    });
    tabla.addEventListener('drop', (e) => {
      const th = e.target.closest && e.target.closest('th');
      if (!th || !arrastrada) return;
      e.preventDefault();
      const ord = opc.pref.orden.slice();
      const de = ord.indexOf(arrastrada), a = ord.indexOf(th.dataset.c);
      if (de >= 0 && a >= 0 && de !== a) { ord.splice(de, 1); ord.splice(a, 0, arrastrada); opc.pref.orden = ord; opc.guardar(); }
      arrastrada = null; pintar();
    });
    tabla.addEventListener('dragend', () => { arrastrada = null; tabla.querySelectorAll('th.sobre,th.arr').forEach((x) => x.classList.remove('sobre', 'arr')); });
    // Ensanchar
    tabla.addEventListener('mousedown', (e) => {
      const rz = e.target.closest('.rz');
      if (!rz) return;
      e.preventDefault(); e.stopPropagation();
      const id = rz.dataset.rz;
      const th = rz.parentElement;
      const x0 = e.clientX, w0 = th.getBoundingClientRect().width;
      const zoom = (PREF.zoom || 100) / 100;
      // Con "ajustar al ancho" las columnas van en proporciones: se pasa a
      // píxeles reales las de todas, para que el cambio sea el que se ve.
      if (opc.pref.ajustar !== false) tabla.querySelectorAll('th').forEach((t) => { opc.pref.anchos[t.dataset.c] = Math.round(t.getBoundingClientRect().width / zoom); });
      const mover = (ev) => { opc.pref.anchos[id] = Math.max(30, Math.round((w0 + (ev.clientX - x0)) / zoom)); pintar(); };
      const soltar = () => { document.removeEventListener('mousemove', mover); document.removeEventListener('mouseup', soltar); opc.guardar(); };
      document.addEventListener('mousemove', mover);
      document.addEventListener('mouseup', soltar);
    });
    return { tabla, pintar, visibles };
  }

  // ---------------------------------------------------------------- interfaz
  let ui = null;
  function crearUI() {
    const est = document.createElement('style');
    est.textContent = CSS;
    document.head.appendChild(est);

    const raiz = document.createElement('div');
    raiz.id = 'mvu';
    raiz.innerHTML =
      '<div class="bar" data-e="bar">' +
        '<span class="marca">MEV Ultra</span><span class="beta">beta</span>' +
        '<span class="cuenta" data-e="cuenta"></span>' +
        '<input class="buscar" data-e="buscar" type="search" placeholder="Buscar en todas las causas: carátula, número, organismo, trámite, etiqueta, anotación…">' +
        '<button class="bb" data-e="leer" title="Lee de nuevo las causas de todos los Sets">&#10227; Leer causas</button>' +
        '<span class="zoom"><button data-e="zm" title="Alejar">&#8722;</button><span data-e="zv">100%</span><button data-e="zp" title="Acercar">+</button></span>' +
        '<span class="ctrl"><button data-e="min" title="Minimizar">&#8211;</button><button data-e="max" title="Maximizar o restaurar">&#9633;</button><button data-e="cerrar" class="cerrar" title="Cerrar">&#10005;</button></span>' +
      '</div>' +
      '<div class="tabs" data-e="tabs">' +
        '<button data-t="causas">Mis causas<span class="n" data-e="nCausas">0</span></button>' +
        '<button data-t="exp" data-e="tabExp" style="display:none">Este expediente<span class="x" data-e="cerrarExp" title="Cerrar esta solapa">&#10005;</span></button>' +
        '<button data-t="buscar">Buscar persona</button>' +
        '<button data-t="desc">Descargas<span class="n" data-e="nDesc" style="display:none">0</span></button>' +
        '<button data-t="sets">Sets</button>' +
        '<button data-t="datos">Datos y respaldo</button>' +
        '<button data-t="ayuda">Ayuda</button>' +
        '<button data-t="acerca">Acerca de</button>' +
      '</div>' +
      '<div class="franja lect" data-e="lect" role="status" aria-live="polite" style="display:none"><span class="grow" data-e="lectTxt"></span><button data-e="lectCancelar">Cancelar la lectura</button></div>' +
      '<div class="franja aviso" data-e="aviso" role="status" aria-live="polite" style="display:none"><span class="grow" data-e="avisoTxt"></span><button data-e="avisoX">Entendido</button></div>' +
      '<div class="cuerpo" data-e="cuerpo">' +
        '<section data-p="causas"></section>' +
        '<section data-p="exp"></section>' +
        '<section data-p="buscar" class="scroll"></section>' +
        '<section data-p="desc" class="scroll"></section>' +
        '<section data-p="sets" class="scroll"></section>' +
        '<section data-p="datos" class="scroll"></section>' +
        '<section data-p="ayuda" class="scroll txt"></section>' +
        '<section data-p="acerca" class="scroll txt"></section>' +
      '</div>' +
      ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map((d) => '<div class="rsz ' + d + '" data-rsz="' + d + '"></div>').join('');
    document.body.appendChild(raiz);

    const pill = document.createElement('div');
    pill.id = 'mvu-pill';
    pill.innerHTML = '<span data-e="pillTxt">MEV Ultra</span><button class="pb" data-e="pillAbrir" title="Abrir MEV Ultra">&#9633;</button>';
    document.body.appendChild(pill);

    const pop = document.createElement('div');
    pop.id = 'mvu-pop';
    document.body.appendChild(pop);

    const q = (n, r) => (r || raiz).querySelector('[data-e="' + n + '"]');
    const P = (n) => raiz.querySelector('section[data-p="' + n + '"]');
    q('cuenta').textContent = CUENTA.usuario + (CUENTA.nombre ? ' · ' + CUENTA.nombre : '');
    q('cuenta').title = 'Usuario de la MEV con el que se leen y guardan los datos. Cada usuario tiene sus propias causas, etiquetas y anotaciones.';

    // ------------------------------------------------ ventana
    // Estado por pestaña: se abre sola ocupando la pantalla; si se la
    // minimiza o se la cierra, en esa pestaña queda así al navegar la MEV.
    let estadoVentana = 'max';
    try { estadoVentana = sessionStorage.getItem('mu.ventana') || 'max'; } catch (e) { /* nada */ }
    function aplicarRect() {
      const r = PREF.rect || { x: 60, y: 40, w: Math.min(1200, window.innerWidth - 120), h: Math.min(760, window.innerHeight - 80) };
      r.w = Math.max(520, Math.min(r.w, window.innerWidth)); r.h = Math.max(320, Math.min(r.h, window.innerHeight));
      r.x = Math.max(0, Math.min(r.x, window.innerWidth - 120)); r.y = Math.max(0, Math.min(r.y, window.innerHeight - 46));
      Object.assign(raiz.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
      PREF.rect = r;
    }
    function ventana(s) {
      estadoVentana = s;
      try { sessionStorage.setItem('mu.ventana', s); } catch (e) { /* nada */ }
      raiz.className = s === 'max' ? 'max' : (s === 'ventana' ? 'ventana' : 'oculta');
      if (s === 'ventana') aplicarRect(); else if (s === 'max') { raiz.style.left = raiz.style.top = raiz.style.width = raiz.style.height = ''; }
      pill.style.display = (s === 'min' || s === 'cerrada') ? 'flex' : 'none';
      if (s === 'max' || s === 'ventana') { pill.classList.remove('aviso'); PREF.ultimoTam = s; guardarPref(); }
      q('max').innerHTML = s === 'max' ? '&#10064;' : '&#9633;';
    }
    q('min').onclick = () => ventana('min');
    q('cerrar').onclick = () => ventana('cerrada');
    q('max').onclick = () => ventana(estadoVentana === 'max' ? 'ventana' : 'max');
    q('bar').addEventListener('dblclick', (e) => { if (!e.target.closest('button,input')) ventana(estadoVentana === 'max' ? 'ventana' : 'max'); });
    q('pillAbrir', pill).onclick = (e) => { e.stopPropagation(); ventana(PREF.ultimoTam === 'ventana' ? 'ventana' : 'max'); };
    // Arrastrar la ventana
    q('bar').addEventListener('mousedown', (e) => {
      if (estadoVentana !== 'ventana' || e.target.closest('button,input,.zoom')) return;
      e.preventDefault();
      const x0 = e.clientX, y0 = e.clientY, r0 = Object.assign({}, PREF.rect);
      const mover = (ev) => { PREF.rect.x = r0.x + ev.clientX - x0; PREF.rect.y = r0.y + ev.clientY - y0; aplicarRect(); };
      const soltar = () => { document.removeEventListener('mousemove', mover); document.removeEventListener('mouseup', soltar); guardarPref(); };
      document.addEventListener('mousemove', mover); document.addEventListener('mouseup', soltar);
    });
    // Redimensionar por los ocho bordes
    raiz.addEventListener('mousedown', (e) => {
      const h = e.target.closest('.rsz');
      if (!h || estadoVentana !== 'ventana') return;
      e.preventDefault();
      const d = h.dataset.rsz, x0 = e.clientX, y0 = e.clientY, r0 = Object.assign({}, PREF.rect);
      const mover = (ev) => {
        const dx = ev.clientX - x0, dy = ev.clientY - y0, r = PREF.rect;
        if (d.includes('e')) r.w = r0.w + dx;
        if (d.includes('s')) r.h = r0.h + dy;
        if (d.includes('w')) { r.w = r0.w - dx; r.x = r0.x + dx; }
        if (d.includes('n')) { r.h = r0.h - dy; r.y = r0.y + dy; }
        aplicarRect();
      };
      const soltar = () => { document.removeEventListener('mousemove', mover); document.removeEventListener('mouseup', soltar); guardarPref(); };
      document.addEventListener('mousemove', mover); document.addEventListener('mouseup', soltar);
    });
    // Indicador minimizado: se mueve arrastrándolo; un clic lo abre.
    (function () {
      if (PREF.pill) Object.assign(pill.style, { right: 'auto', bottom: 'auto', left: PREF.pill.x + 'px', top: PREF.pill.y + 'px' });
      let x0, y0, r0, movio = false;
      pill.addEventListener('mousedown', (e) => {
        if (e.target.closest('.pb')) return;
        e.preventDefault(); x0 = e.clientX; y0 = e.clientY; r0 = pill.getBoundingClientRect(); movio = false;
        const mover = (ev) => {
          const dx = ev.clientX - x0, dy = ev.clientY - y0;
          if (!movio && Math.abs(dx) + Math.abs(dy) < 4) return;
          movio = true;
          const x = Math.max(0, Math.min(window.innerWidth - r0.width, r0.left + dx));
          const y = Math.max(0, Math.min(window.innerHeight - r0.height, r0.top + dy));
          Object.assign(pill.style, { right: 'auto', bottom: 'auto', left: x + 'px', top: y + 'px' });
          PREF.pill = { x, y };
        };
        const soltar = () => {
          document.removeEventListener('mousemove', mover); document.removeEventListener('mouseup', soltar);
          if (movio) guardarPref(); else ventana(PREF.ultimoTam === 'ventana' ? 'ventana' : 'max');
        };
        document.addEventListener('mousemove', mover); document.addEventListener('mouseup', soltar);
      });
    })();
    // Zoom del contenido
    function aplicarZoom() { q('cuerpo').style.zoom = (PREF.zoom / 100); q('zv').textContent = PREF.zoom + '%'; }
    q('zm').onclick = () => { PREF.zoom = Math.max(60, PREF.zoom - 10); aplicarZoom(); guardarPref(); };
    q('zp').onclick = () => { PREF.zoom = Math.min(170, PREF.zoom + 10); aplicarZoom(); guardarPref(); };
    q('zv').ondblclick = () => { PREF.zoom = 100; aplicarZoom(); guardarPref(); };

    // ------------------------------------------------ solapas
    let solapa = 'causas';
    function ir(t) {
      solapa = t;
      raiz.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
      raiz.querySelectorAll('section').forEach((s) => s.classList.toggle('on', s.dataset.p === t));
      if (t === 'desc') pintarDescargas();
      if (t === 'buscar') pintarBuscar();
      if (t === 'sets') pintarSets();
      if (t === 'datos') pintarDatos();
      cerrarPop();
    }
    q('tabs').addEventListener('click', (e) => {
      if (e.target.closest('[data-e="cerrarExp"]')) { e.stopPropagation(); cerrarExpediente(); return; }
      const b = e.target.closest('button[data-t]');
      if (b) ir(b.dataset.t);
    });

    // ------------------------------------------------ avisos
    let avisoReloj = null;
    function aviso(txt, malo) {
      q('avisoTxt').textContent = txt;
      q('aviso').classList.toggle('malo', !!malo);
      q('aviso').style.display = txt ? 'flex' : 'none';
      clearTimeout(avisoReloj);
      if (txt && !malo) avisoReloj = setTimeout(() => { q('aviso').style.display = 'none'; }, 12000);
      if (txt && (estadoVentana === 'min' || estadoVentana === 'cerrada')) pill.classList.add('aviso');
    }
    q('avisoX').onclick = () => aviso('');
    // Teclado: Enter o Espacio sobre un control hecho con span o div lo acciona.
    raiz.addEventListener('keydown', (e) => {
      if ((e.key !== 'Enter' && e.key !== ' ') || !e.target.matches('[role="button"]')) return;
      e.preventDefault(); e.target.click();
    });

    // ------------------------------------------------ ventanita emergente
    function abrirPop(ancla, html, alAbrir) {
      pop.onclick = null;
      pop.innerHTML = html;
      pop.style.display = 'block';
      const r = ancla.isConnected ? ancla.getBoundingClientRect() : (abrirPop.ultimo || ancla.getBoundingClientRect());
      abrirPop.ultimo = r;
      const w = pop.offsetWidth, h = pop.offsetHeight;
      let x = Math.min(r.left, window.innerWidth - w - 8), y = r.bottom + 4;
      if (y + h > window.innerHeight - 8) y = Math.max(8, r.top - h - 4);
      pop.style.left = Math.max(8, x) + 'px'; pop.style.top = y + 'px';
      if (alAbrir) alAbrir(pop);
    }
    function cerrarPop() { pop.style.display = 'none'; pop.innerHTML = ''; pop.onclick = null; }
    document.addEventListener('mousedown', (e) => {
      if (pop.style.display === 'block' && !pop.contains(e.target) && !e.target.closest('[data-pop]')) cerrarPop();
    }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pop.style.display === 'block') cerrarPop(); });

    function popEtiquetas(ancla, key, alCambiar) {
      const dibujar = () => {
        const mias = (marcaDe(key) || {}).etq || [];
        abrirPop(ancla,
          '<h4>Etiquetas</h4>' +
          (MARCAS.etiquetas.length ? MARCAS.etiquetas.map((e) => {
            const c = colorDe(e.color);
            return '<label><input type="checkbox" data-id="' + esc(e.id) + '"' + (mias.includes(e.id) ? ' checked' : '') + '><span class="chip" style="background:' + c[1] + ';color:' + c[2] + '">' + esc(e.nombre) + '</span></label>';
          }).join('') : '<div style="color:#6b756f;margin-bottom:6px">Todavía no hay etiquetas.</div>') +
          '<div style="display:flex;gap:6px;margin-top:8px"><input type="text" data-e="nueva" placeholder="Nueva etiqueta…"><button class="it" data-e="crear" style="width:auto;border:1px solid #c9d3cd">Crear</button></div>' +
          '<div class="pie"><button data-e="listo" class="p">Listo</button></div>',
          (p) => {
            p.querySelectorAll('input[type=checkbox]').forEach((cb) => { cb.onchange = () => { alternarEtiqueta(key, cb.dataset.id); alCambiar(); }; });
            const crear = () => { const e = crearEtiqueta(q('nueva', p).value); if (e) { alternarEtiqueta(key, e.id); alCambiar(); dibujar(); } };
            q('crear', p).onclick = crear;
            q('nueva', p).onkeydown = (ev) => { if (ev.key === 'Enter') crear(); };
            q('listo', p).onclick = cerrarPop;
          });
      };
      dibujar();
    }
    function popAnotacion(ancla, key, alCambiar) {
      abrirPop(ancla,
        '<h4>Anotación</h4><div style="color:#6b756f;font-size:11px;margin-bottom:5px">Nota privada de trabajo. Queda en este equipo y no tiene relación con la MEV.</div>' +
        '<textarea data-e="txt">' + esc(anotacionDe(key)) + '</textarea>' +
        '<div class="pie"><button data-e="borrar">Borrar</button><button data-e="cancelar">Cancelar</button><button data-e="ok" class="p">Guardar</button></div>',
        (p) => {
          const t = q('txt', p); t.focus(); t.setSelectionRange(t.value.length, t.value.length);
          q('ok', p).onclick = () => { fijarMarca(key, { anot: t.value.trim() }); cerrarPop(); alCambiar(); };
          q('borrar', p).onclick = () => { fijarMarca(key, { anot: '' }); cerrarPop(); alCambiar(); };
          q('cancelar', p).onclick = cerrarPop;
          t.onkeydown = (ev) => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) q('ok', p).click(); };
        });
    }
    const chips = (key) => etiquetasDe(key).map((e) => { const c = colorDe(e.color); return '<span class="chip" style="background:' + c[1] + ';color:' + c[2] + '">' + esc(e.nombre) + '</span>'; }).join('');

    // ================================================ MIS CAUSAS
    const F = { texto: '', depto: '', org: '', set: '', estado: '', etq: '', desde: '', hasta: '', novedades: false, ausentes: false };
    const SEL = new Set();
    let pagina = 0;
    let anclaSel = null;
    const COLS = [
      { id: 'sel', t: '', w: 34, fija: true, tip: 'Seleccionar', thHtml: () => '<input type="checkbox" data-e="selTodo" title="Seleccionar todas las filtradas">' },
      { id: 'nuevo', t: '', w: 28, tip: 'Novedad desde la lectura anterior', orden: (c) => (c.nuevo ? 0 : 1), dirInicial: 1 },
      { id: 'caratula', t: 'Carátula', w: 360, orden: (c) => norm(c.caratula) },
      { id: 'partes', t: 'Partes', w: 250, orden: (c) => norm(partesDe(c)) },
      { id: 'organismo', t: 'Organismo', w: 210, orden: (c) => norm(c.organismo) },
      { id: 'depto', t: 'Departamento', w: 150, orden: (c) => norm(deptoDe(c)) },
      { id: 'expediente', t: 'Nº expediente', w: 110, nw: true, orden: (c) => numOrden(c.expediente) },
      { id: 'receptoria', t: 'Nº receptoría', w: 120, nw: true, orden: (c) => norm(c.receptoria) },
      { id: 'estado', t: 'Estado', w: 120, orden: (c) => norm(c.estado) },
      { id: 'inicio', t: 'Inicio', w: 90, nw: true, orden: (c) => { const f = fechaDe(c.inicio); return f ? f.getTime() : 0; }, dirInicial: -1 },
      { id: 'ultFecha', t: 'Últ. movimiento', w: 108, nw: true, orden: (c) => c.ultFecha || 0, dirInicial: -1 },
      { id: 'ultDesc', t: 'Último trámite', w: 250, orden: (c) => norm(c.ultDesc) },
      { id: 'sets', t: 'Sets', w: 160, orden: (c) => norm(setsDe(c)) },
      { id: 'etiquetas', t: 'Etiquetas', w: 170, orden: (c) => norm(etiquetasDe(c.key).map((e) => e.nombre).join(' ')) || '~' },
      { id: 'anotacion', t: 'Anotación', w: 220, orden: (c) => norm(anotacionDe(c.key)) || '~' },
      { id: 'acc', t: '', w: 76, fija: true, tip: 'Acciones' }
    ];
    const numOrden = (s) => { const m = String(s || '').match(/\d+/g); return m ? m.map((x) => x.padStart(9, '0')).join('-') : '~'; };
    if (!PREF.ocultas) PREF.ocultas = ['partes', 'receptoria', 'inicio', 'sets'];
    const prefCausas = { get orden() { return PREF.columnas || []; }, set orden(v) { PREF.columnas = v; }, anchos: PREF.anchos, get ocultas() { return PREF.ocultas; }, get ajustar() { return PREF.ajustar; } };

    function causasTodas() { return Object.values(IDX.causas); }
    function pasaFiltro(c) {
      if (!F.ausentes && c.ausente) return false;
      if (F.novedades && !c.nuevo) return false;
      if (F.depto && c.juris !== F.depto) return false;
      if (F.org && c.pid !== F.org) return false;
      if (F.set && !(c.sets || []).includes(F.set)) return false;
      if (F.estado && norm(c.estado) !== F.estado) return false;
      if (F.etq === '__sin') { if (etiquetasDe(c.key).length) return false; }
      else if (F.etq === '__anot') { if (!anotacionDe(c.key)) return false; }
      else if (F.etq && !((marcaDe(c.key) || {}).etq || []).includes(F.etq)) return false;
      if (F.desde) { const d = new Date(F.desde + 'T00:00:00').getTime(); if (!c.ultFecha || c.ultFecha < d) return false; }
      if (F.hasta) { const h = new Date(F.hasta + 'T23:59:59').getTime(); if (!c.ultFecha || c.ultFecha > h) return false; }
      if (F.texto) {
        const pal = norm(F.texto).split(' ').filter(Boolean);
        const bolsa = norm([c.caratula, c.expediente, c.receptoria, c.organismo, deptoDe(c), c.estado, c.ultDesc, c.ultFechaTxt, c.inicio, setsDe(c), etiquetasDe(c.key).map((e) => e.nombre).join(' '), anotacionDe(c.key)].join(' '));
        if (!pal.every((p) => bolsa.includes(p))) return false;
      }
      return true;
    }
    function filtradas() {
      const l = causasTodas().filter(pasaFiltro);
      const o = PREF.orden || { col: 'ultFecha', dir: -1 };
      const col = COLS.find((c) => c.id === o.col && c.orden) || COLS.find((c) => c.id === 'ultFecha');
      l.sort((a, b) => {
        const x = col.orden(a), y = col.orden(b);
        if (x < y) return -o.dir; if (x > y) return o.dir;
        return norm(a.caratula) < norm(b.caratula) ? -1 : 1;
      });
      return l;
    }
    let vistaActual = [];
    const grilla = Grilla({
      cols: COLS, pref: prefCausas, guardar: guardarPref,
      orden: () => PREF.orden,
      fijarOrden: (o) => { PREF.orden = o; guardarPref(); pintarCausas(); },
      clave: (c) => c.key,
      claseFila: (c) => (SEL.has(c.key) ? 'sel' : '') + (c.ausente ? ' aus' : ''),
      vacio: () => (causasTodas().length ? 'Ninguna causa coincide con los filtros.' : 'Todavía no se leyeron las causas.'),
      filas: () => vistaActual,
      celda: (col, c) => {
        switch (col.id) {
          case 'sel': return '<input type="checkbox" data-a="sel" aria-label="' + esc('Seleccionar ' + c.caratula) + '"' + (SEL.has(c.key) ? ' checked' : '') + '>';
          case 'nuevo': return c.ausente ? '<span title="No figura en la última lectura (desde ' + esc(fechaCorta(c.ausente)) + '). Puede haber salido del Set o cambiado de organismo." style="color:#9aa39d">&#8856;</span>'
            : (c.nuevo ? '<span class="punto" title="' + esc('Novedad: ' + (c.cambio || 'cambió desde la lectura anterior')) + '"></span>' : '');
          case 'caratula': return '<span class="car" data-a="abrir" tabindex="0" role="button" title="Ver esta causa en MEV Ultra">' + esc(c.caratula) + '</span>';
          case 'partes': return esc(partesDe(c));
          case 'organismo': return esc(c.organismo);
          case 'depto': return esc(deptoDe(c));
          case 'expediente': return esc(c.expediente);
          case 'receptoria': return esc(c.receptoria);
          case 'estado': return esc(c.estado);
          case 'inicio': return esc(c.inicio);
          case 'ultFecha': return esc(c.ultFechaTxt || '');
          case 'ultDesc': return '<span title="' + esc(c.ultDesc) + '">' + esc(c.ultDesc) + '</span>';
          case 'sets': return esc(setsDe(c));
          case 'etiquetas': return '<div class="celda-edit" data-a="etq" data-pop="1" tabindex="0" role="button" title="Poner o sacar etiquetas">' + (chips(c.key) || '<span class="mas">+ etiqueta</span>') + '</div>';
          case 'anotacion': { const a = anotacionDe(c.key); return '<div class="celda-edit" data-a="anot" data-pop="1" tabindex="0" role="button" title="' + esc(a || 'Escribir una anotación') + '">' + (a ? esc(a) : '<span class="mas">+ anotación</span>') + '</div>'; }
          case 'acc': return '<button class="ib" data-a="bajar" title="Bajar el expediente completo en un PDF">&#8681;</button> <button class="ib" data-a="menu" data-pop="1" title="Más acciones">&#8943;</button>';
          default: return '';
        }
      }
    });

    P('causas').innerHTML =
      '<div class="tool">' +
        '<select class="s" data-e="fDepto" title="Departamento judicial y fuero"></select>' +
        '<select class="s" data-e="fOrg" title="Organismo"></select>' +
        '<select class="s" data-e="fSet" title="Set de Búsqueda"></select>' +
        '<select class="s" data-e="fEstado" title="Estado"></select>' +
        '<select class="s" data-e="fEtq" title="Etiqueta"></select>' +
        '<span style="font-size:12px;color:#56615b">Últ. mov.</span><input class="i" type="date" data-e="fDesde" title="Desde"><input class="i" type="date" data-e="fHasta" title="Hasta">' +
        '<button class="b" data-e="fNov" title="Solo las causas que cambiaron desde la lectura anterior">Novedades</button>' +
        '<button class="b" data-e="fLimpiar" title="Quitar todos los filtros">Quitar filtros</button>' +
        '<span class="sep"></span>' +
        '<button class="b" data-e="visto" title="Quita la marca de novedad de todas las causas">Marcar todo como visto</button>' +
        '<button class="b" data-e="cols" data-pop="1">Columnas &#9662;</button>' +
        '<button class="b" data-e="csv" title="Exporta la lista filtrada a un archivo que abre Excel">Exportar</button>' +
        '<button class="b p" data-e="bajarSel" title="Bajar el expediente completo de cada causa seleccionada, de a una">Bajar seleccionadas (0)</button>' +
      '</div>' +
      '<div class="info" data-e="infoCausas"></div>' +
      '<div class="envoltura" data-e="envCausas"></div>' +
      '<div class="pag" data-e="pag"></div>';
    q('envCausas').appendChild(grilla.tabla);

    function opciones(sel, lista, todas, valor) {
      const v = valor || '';
      sel.innerHTML = '<option value="">' + esc(todas) + '</option>' + lista.map(([val, txt]) => '<option value="' + esc(val) + '">' + esc(txt) + '</option>').join('');
      sel.value = lista.some(([val]) => val === v) ? v : '';
    }
    function pintarFiltros() {
      const cs = causasTodas().filter((c) => !c.ausente || F.ausentes);
      const cuenta = (fn) => { const m = {}; cs.forEach((c) => { const k = fn(c); if (k) m[k] = (m[k] || 0) + 1; }); return m; };
      const dep = cuenta((c) => c.juris);
      opciones(q('fDepto'), Object.keys(dep).sort((a, b) => (jurisPorId(a) || {}).nombre > (jurisPorId(b) || {}).nombre ? 1 : -1).map((k) => [k, (jurisPorId(k) || { nombre: k }).nombre + ' (' + dep[k] + ')']), 'Todos los departamentos', F.depto);
      const org = cuenta((c) => (!F.depto || c.juris === F.depto) ? c.pid : '');
      opciones(q('fOrg'), Object.keys(org).map((k) => [k, ((IDX.orgs[k] && IDX.orgs[k].nombre) || k) + ' (' + org[k] + ')']).sort((a, b) => (a[1] > b[1] ? 1 : -1)), 'Todos los organismos', F.org);
      opciones(q('fSet'), Object.values(IDX.sets).map((s) => [s.nidset, s.nombre + ' (' + (s.encontradas || 0) + ')']), 'Todos los Sets', F.set);
      const est = cuenta((c) => norm(c.estado));
      opciones(q('fEstado'), Object.keys(est).sort().map((k) => [k, (causasTodas().find((c) => norm(c.estado) === k) || {}).estado + ' (' + est[k] + ')']), 'Todos los estados', F.estado);
      opciones(q('fEtq'), [['__sin', 'Sin etiqueta'], ['__anot', 'Con anotación']].concat(MARCAS.etiquetas.map((e) => [e.id, e.nombre])), 'Todas las etiquetas', F.etq);
      q('fNov').classList.toggle('on', F.novedades);
      const nov = causasTodas().filter((c) => c.nuevo && !c.ausente).length;
      q('fNov').textContent = 'Novedades' + (nov ? ' (' + nov + ')' : '');
    }
    function pintarCausas() {
      const todas = filtradas();
      const pp = PREF.porPagina || 25;
      const paginas = Math.max(1, Math.ceil(todas.length / pp));
      if (pagina >= paginas) pagina = paginas - 1;
      vistaActual = todas.slice(pagina * pp, pagina * pp + pp);
      grilla.pintar();
      const selTodo = q('selTodo');
      if (selTodo) { const n = todas.filter((c) => SEL.has(c.key)).length; selTodo.checked = todas.length > 0 && n === todas.length; selTodo.indeterminate = n > 0 && n < todas.length; }
      const vivas = causasTodas().filter((c) => !c.ausente).length;
      const aus = causasTodas().length - vivas;
      const l = IDX.lectura;
      q('infoCausas').innerHTML =
        '<span><b>' + todas.length + '</b> de ' + vivas + ' causas</span>' +
        (SEL.size ? '<span><b>' + SEL.size + '</b> seleccionadas · <a href="#" data-e="selNada" style="color:' + V + '">quitar selección</a></span>' : '') +
        (l ? '<span>Última lectura: ' + esc(fechaHora(l.fecha)) + ' (' + (l.modo === 'completa' ? 'completa' : 'rápida') + ', ' + l.segundos + ' s)</span>' : '') +
        (aus ? '<span><label style="cursor:pointer"><input type="checkbox" data-e="fAus"' + (F.ausentes ? ' checked' : '') + '> mostrar ' + aus + ' que ya no figuran</label></span>' : '') +
        (l && l.avisos && l.avisos.length ? '<span style="color:#8a5a00">' + l.avisos.length + ' aviso(s) de la lectura: ver solapa Sets</span>' : '');
      const sn = q('selNada'); if (sn) sn.onclick = (e) => { e.preventDefault(); SEL.clear(); pintarCausas(); };
      const fa = q('fAus'); if (fa) fa.onchange = () => { F.ausentes = fa.checked; pagina = 0; pintarFiltros(); pintarCausas(); };
      q('bajarSel').textContent = 'Bajar seleccionadas (' + SEL.size + ')';
      q('bajarSel').disabled = !SEL.size;
      q('nCausas').textContent = vivas;
      // Paginador: tamaño de 5 en 5 hasta 50, anterior, siguiente y números.
      let h = '<span>Por página</span><select class="s" data-e="pp" style="height:26px">' + [5, 10, 15, 20, 25, 30, 35, 40, 45, 50].map((n) => '<option' + (n === pp ? ' selected' : '') + '>' + n + '</option>').join('') + '</select><span class="grow"></span>';
      h += '<button data-pg="' + (pagina - 1) + '"' + (pagina === 0 ? ' disabled' : '') + '>&#8249; Anterior</button>';
      const ver = [];
      for (let i = 0; i < paginas; i++) if (i === 0 || i === paginas - 1 || Math.abs(i - pagina) <= 2) ver.push(i);
      let prev = -1;
      ver.forEach((i) => { if (i - prev > 1) h += '<span>…</span>'; h += '<button data-pg="' + i + '" class="' + (i === pagina ? 'on' : '') + '">' + (i + 1) + '</button>'; prev = i; });
      h += '<button data-pg="' + (pagina + 1) + '"' + (pagina >= paginas - 1 ? ' disabled' : '') + '>Siguiente &#8250;</button>';
      q('pag').innerHTML = h;
      q('pp').onchange = () => { PREF.porPagina = +q('pp').value; pagina = 0; guardarPref(); pintarCausas(); };
    }
    q('pag').addEventListener('click', (e) => { const b = e.target.closest('button[data-pg]'); if (b && !b.disabled) { pagina = +b.dataset.pg; pintarCausas(); q('envCausas').scrollTop = 0; } });

    const alFiltrar = () => { pagina = 0; pintarFiltros(); pintarCausas(); };
    [['fDepto', 'depto'], ['fOrg', 'org'], ['fSet', 'set'], ['fEstado', 'estado'], ['fEtq', 'etq'], ['fDesde', 'desde'], ['fHasta', 'hasta']].forEach(([e, k]) => { q(e).onchange = () => { F[k] = q(e).value; if (k === 'depto') F.org = ''; alFiltrar(); }; });
    q('fNov').onclick = () => { F.novedades = !F.novedades; alFiltrar(); };
    q('fLimpiar').onclick = () => { Object.assign(F, { texto: '', depto: '', org: '', set: '', estado: '', etq: '', desde: '', hasta: '', novedades: false }); q('buscar').value = ''; q('fDesde').value = ''; q('fHasta').value = ''; alFiltrar(); };
    let buscarReloj = null;
    q('buscar').addEventListener('input', () => { clearTimeout(buscarReloj); buscarReloj = setTimeout(() => { F.texto = q('buscar').value; if (solapa !== 'causas') ir('causas'); alFiltrar(); }, 180); });
    q('visto').onclick = () => { causasTodas().forEach((c) => { c.nuevo = false; c.cambio = ''; }); guardarIndice(); alFiltrar(); };
    q('csv').onclick = () => exportarCsv(filtradas());
    q('bajarSel').onclick = () => {
      const lista = causasTodas().filter((c) => SEL.has(c.key));
      if (!lista.length) return;
      const libres = TOPE_COLA - DESCARGAS.cola().filter((x) => x.estado === 'espera' || x.estado === 'bajando').length;
      if (lista.length > libres) { aviso('Seleccionaste ' + lista.length + ' causas y hay lugar para ' + libres + ' en la cola (tope ' + TOPE_COLA + '). Achicá la selección.', true); return; }
      lista.forEach((c) => DESCARGAS.agregar(c, null));
      aviso(lista.length + ' expediente(s) en la cola de Descargas. Se bajan de a uno, en segundo plano.');
    };
    q('cols').onclick = (e) => {
      abrirPop(e.currentTarget,
        '<h4>Columnas</h4>' + COLS.filter((c) => !c.fija && c.t).map((c) => '<label><input type="checkbox" data-c="' + c.id + '"' + (PREF.ocultas.includes(c.id) ? '' : ' checked') + '> ' + esc(c.t) + '</label>').join('') +
        '<hr style="border:0;border-top:1px solid #e3e8e5"><label><input type="checkbox" data-e="aj"' + (PREF.ajustar !== false ? ' checked' : '') + '> Ajustar la tabla al ancho de la ventana</label>' +
        '<div class="pie"><button data-e="rest">Restablecer</button><button data-e="ok" class="p">Listo</button></div>',
        (p) => {
          p.querySelectorAll('input[data-c]').forEach((cb) => { cb.onchange = () => { PREF.ocultas = cb.checked ? PREF.ocultas.filter((x) => x !== cb.dataset.c) : PREF.ocultas.concat([cb.dataset.c]); guardarPref(); pintarCausas(); }; });
          q('aj', p).onchange = () => { PREF.ajustar = q('aj', p).checked; guardarPref(); pintarCausas(); };
          q('rest', p).onclick = () => { PREF.columnas = null; PREF.ocultas = ['partes', 'receptoria', 'inicio', 'sets']; Object.keys(PREF.anchos).forEach((k) => delete PREF.anchos[k]); PREF.ajustar = true; guardarPref(); cerrarPop(); pintarCausas(); };
          q('ok', p).onclick = cerrarPop;
        });
    };

    // Clics dentro de la tabla de causas
    grilla.tabla.addEventListener('click', (e) => {
      if (e.target.matches('[data-e="selTodo"]')) {
        const todas = filtradas();
        if (e.target.checked) todas.forEach((c) => SEL.add(c.key)); else todas.forEach((c) => SEL.delete(c.key));
        pintarCausas(); return;
      }
      const tr = e.target.closest('tr[data-k]');
      if (!tr) return;
      const c = IDX.causas[tr.dataset.k];
      if (!c) return;
      const a = e.target.closest('[data-a]');
      const accion = a ? a.dataset.a : '';
      if (accion === 'sel') {
        const orden = vistaActual.map((x) => x.key);
        const i = orden.indexOf(c.key);
        const val = e.target.checked;
        if (e.shiftKey && anclaSel !== null && anclaSel >= 0) { const [x, y] = [Math.min(anclaSel, i), Math.max(anclaSel, i)]; for (let k = x; k <= y; k++) val ? SEL.add(orden[k]) : SEL.delete(orden[k]); }
        else if (val) SEL.add(c.key); else SEL.delete(c.key);
        anclaSel = i; pintarCausas(); return;
      }
      if (accion === 'abrir') { abrirCausa(c); return; }
      if (accion === 'etq') { popEtiquetas(a, c.key, () => { pintarFiltros(); pintarCausas(); }); return; }
      if (accion === 'anot') { popAnotacion(a, c.key, () => pintarCausas()); return; }
      if (accion === 'bajar') { if (DESCARGAS.agregar(c, null)) aviso('En la cola de Descargas: ' + c.caratula); return; }
      if (accion === 'menu') { menuCausa(a, c); }
    });
    function menuCausa(ancla, c) {
      abrirPop(ancla,
        '<h4>' + esc(c.caratula.slice(0, 70)) + '</h4>' +
        '<button class="it" data-m="ver">Ver en MEV Ultra</button>' +
        '<button class="it" data-m="aqui">Abrir en la MEV, en esta pestaña</button>' +
        '<button class="it" data-m="nueva">Abrir en la MEV, en una pestaña nueva</button>' +
        '<button class="it" data-m="bajar">Bajar el expediente completo</button>' +
        '<button class="it" data-m="elegir">Elegir qué actuaciones bajar</button>' +
        '<button class="it" data-m="nov">' + (c.nuevo ? 'Marcar como vista' : 'Marcar como novedad') + '</button>',
        (p) => { p.onclick = (e) => {
          const b = e.target.closest('[data-m]'); if (!b) return;
          cerrarPop();
          const m = b.dataset.m;
          if (m === 'ver' || m === 'elegir') abrirCausa(c);
          else if (m === 'aqui') { location.href = urlProcesales(c); }
          else if (m === 'nueva') { W.open(urlAbsoluta(urlProcesales(c)), '_blank', 'noopener'); }
          else if (m === 'bajar') { if (DESCARGAS.agregar(c, null)) aviso('En la cola de Descargas: ' + c.caratula); }
          else if (m === 'nov') { c.nuevo = !c.nuevo; if (!c.nuevo) c.cambio = ''; else c.cambio = 'marcada a mano'; guardarIndice(); pintarFiltros(); pintarCausas(); }
        }; });
    }
    function exportarCsv(lista) {
      const cols = [['Carátula', (c) => c.caratula], ['Partes', partesDe], ['Organismo', (c) => c.organismo], ['Departamento', deptoDe], ['Nº expediente', (c) => c.expediente],
        ['Nº receptoría', (c) => c.receptoria], ['Estado', (c) => c.estado], ['Inicio', (c) => c.inicio], ['Últ. movimiento', (c) => c.ultFechaTxt], ['Último trámite', (c) => c.ultDesc],
        ['Sets', setsDe], ['Etiquetas', (c) => etiquetasDe(c.key).map((e) => e.nombre).join(', ')], ['Anotación', (c) => anotacionDe(c.key)], ['Novedad', (c) => (c.nuevo ? (c.cambio || 'sí') : '')],
        ['Enlace', (c) => urlAbsoluta(urlProcesales(c))]];
      // Un valor que empieza con = + - @ se abriría en Excel como fórmula.
      const seguro = (v) => (/^[=+\-@]/.test(v) ? "'" + v : v);
      const celda = (v) => '"' + seguro(String(v == null ? '' : v)).replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"';
      const txt = String.fromCharCode(0xfeff) + cols.map((x) => celda(x[0])).join(';') + '\r\n' + lista.map((c) => cols.map((x) => celda(x[1](c))).join(';')).join('\r\n');
      guardarArchivo(new Blob([txt], { type: 'text/csv;charset=utf-8' }), 'MEV-Ultra-causas-' + sello() + '.csv', 'text/csv');
    }

    // ================================================ ESTE EXPEDIENTE
    let EXP = null;   // { causa, datos, acts, sel:Set, cargando, error, filtro, desde, hasta, soloRango, orden }
    const COLS_EXP = [
      { id: 'sel', t: '', w: 34, fija: true, thHtml: () => '<input type="checkbox" data-e="expSelTodo" title="Seleccionar las visibles">' },
      { id: 'fecha', t: 'Fecha', w: 140, nw: true, orden: (a) => a.fecha || 0, dirInicial: -1 },
      { id: 'fojas', t: 'Fs.', w: 60, nw: true, orden: (a) => { const n = parseInt(a.fojas, 10); return isNaN(n) ? -1 : n; }, dirInicial: -1 },
      { id: 'firmado', t: 'Firmado', w: 70, orden: (a) => (a.firmado ? 0 : 1) },
      { id: 'descripcion', t: 'Descripción', w: 520, orden: (a) => norm(a.descripcion) },
      { id: 'acc', t: '', w: 92, fija: true }
    ];
    const prefExp = { get orden() { return PREF.colsExp || []; }, set orden(v) { PREF.colsExp = v; }, anchos: PREF.anchosExp, get ocultas() { return PREF.ocultasExp || []; }, get ajustar() { return PREF.ajustar; } };
    function actsVisibles() {
      if (!EXP || !EXP.acts) return [];
      let l = EXP.acts.slice();
      if (EXP.filtro) { const pal = norm(EXP.filtro).split(' ').filter(Boolean); l = l.filter((a) => { const b = norm(a.fechaTxt + ' ' + a.fojas + ' ' + a.descripcion); return pal.every((p) => b.includes(p)); }); }
      if (EXP.soloRango) l = l.filter(enRango);
      if (EXP.orden) { const col = COLS_EXP.find((c) => c.id === EXP.orden.col); if (col && col.orden) l.sort((a, b) => { const x = col.orden(a), y = col.orden(b); return x < y ? -EXP.orden.dir : (x > y ? EXP.orden.dir : a.i - b.i); }); }
      return l;
    }
    function enRango(a) {
      const d = EXP.desde ? new Date(EXP.desde + 'T00:00:00').getTime() : null;
      const h = EXP.hasta ? new Date(EXP.hasta + 'T23:59:59').getTime() : null;
      if (!a.fecha) return !d && !h;
      return (!d || a.fecha >= d) && (!h || a.fecha <= h);
    }
    let vistaExp = [];
    let anclaExp = null;
    const grillaExp = Grilla({
      cols: COLS_EXP, pref: prefExp, guardar: guardarPref,
      orden: () => EXP && EXP.orden,
      fijarOrden: (o) => { EXP.orden = o; pintarActs(); },
      clave: (a) => a.url,
      claseFila: (a) => (EXP.sel.has(a.url) ? 'sel' : ''),
      vacio: () => (EXP && EXP.acts && EXP.acts.length ? 'Ninguna actuación coincide con el filtro.' : 'La MEV no muestra pasos procesales para esta causa.'),
      filas: () => vistaExp,
      celda: (col, a) => {
        switch (col.id) {
          case 'sel': return '<input type="checkbox" data-a="sel"' + (EXP.sel.has(a.url) ? ' checked' : '') + '>';
          case 'fecha': return esc(a.fechaTxt);
          case 'fojas': return esc(a.fojas);
          case 'firmado': return a.firmado ? '<span title="Firmado digitalmente" style="color:' + V + ';font-weight:700">&#10003;</span>' : '';
          case 'descripcion': return '<span class="car" data-a="ver" title="Ver en una pestaña nueva" style="font-weight:500">' + esc(a.descripcion) + '</span>';
          case 'acc': return '<button class="ib" data-a="ver" title="Ver en una pestaña nueva">Ver &#8599;</button> <button class="ib" data-a="bajar1" title="Bajar solo esta actuación, con sus adjuntos">&#8681;</button>';
          default: return '';
        }
      }
    });

    function cerrarExpediente() { guardarAnotPendiente(); EXP = null; q('tabExp').style.display = 'none'; if (solapa === 'exp') ir('causas'); }
    function causaDesdeUrl(u) {
      const p = new URL(u, location.href).searchParams;
      const nid = p.get('nidCausa') || p.get('nidcausa'), pid = (p.get('pidJuzgado') || p.get('pidjuzgado') || '').trim();
      if (!nid || !pid) return null;
      return IDX.causas[nid + '|' + pid] || { key: nid + '|' + pid, nidCausa: nid, pid, caratula: '', organismo: (IDX.orgs[pid] && IDX.orgs[pid].nombre) || '', juris: (IDX.orgs[pid] && IDX.orgs[pid].juris) || '', sets: [], externa: true };
    }
    async function abrirCausa(c, docActual) {
      EXP = { causa: c, datos: null, acts: null, sel: new Set(), cargando: true, error: '', filtro: '', desde: '', hasta: '', soloRango: false, orden: null };
      q('tabExp').style.display = '';
      ir('exp');
      if (c.nuevo) { c.nuevo = false; c.cambio = ''; guardarIndice(); pintarFiltros(); pintarCausas(); }
      pintarExp();
      try {
        const doc = docActual || parsear(await pedir(urlProcesales(c), {}, (t) => { if (EXP && EXP.causa === c) { EXP.cargandoTxt = t; const m = q('xCargando', P('exp')); if (m) m.textContent = t; } }));
        if (!EXP || EXP.causa !== c) return;
        const d = leerExpediente(doc);
        EXP.datos = d; EXP.acts = d.acts; EXP.cargando = false;
        if (!c.caratula && d.caratula) c.caratula = d.caratula;
      } catch (e) {
        if (!EXP || EXP.causa !== c) return;
        EXP.cargando = false;
        EXP.error = e.message === 'SESION' ? 'La sesión de la MEV venció. Ingresá de nuevo.' : 'No se pudo leer la causa: ' + e.message;
      }
      pintarExp();
    }
    // Anotación de "Este expediente": lo tipeado se guarda a los 600 ms, y
    // también antes de redibujar la solapa, para no perder nada.
    let anotPend = null;
    function guardarAnotPendiente() {
      if (!anotPend) return;
      const p = anotPend; anotPend = null;
      clearTimeout(p.reloj);
      fijarMarca(p.key, { anot: p.el.value.trim() });
      pintarCausas();
    }
    function pintarExp() {
      guardarAnotPendiente();
      const s = P('exp');
      if (!EXP) { s.innerHTML = ''; return; }
      const c = EXP.causa, d = EXP.datos || {};
      q('tabExp').firstChild.textContent = 'Este expediente';
      const dato = (t, v) => (v ? '<span>' + esc(t) + ': <b>' + esc(v) + '</b></span>' : '');
      s.innerHTML =
        '<div class="cab">' +
          '<h2>' + esc(d.caratula || c.caratula || 'Causa ' + c.nidCausa) + '</h2>' +
          '<div class="datos">' + dato('Organismo', c.organismo) + dato('Departamento', deptoDe(c)) + dato('Nº de expediente', d.expediente || c.expediente) +
            dato('Nº de receptoría', d.receptoria || c.receptoria) + dato('Inicio', d.inicio || c.inicio) + dato('Estado', d.estado || c.estado) + dato('Partes', partesDe(Object.assign({}, c, { caratula: d.caratula || c.caratula }))) +
            dato('Sets', setsDe(c)) + (c.externa ? '<span style="color:#8a5a00">Esta causa no está en tus Sets.</span>' : '') + '</div>' +
          '<div class="fila">' +
            '<button class="b" data-e="xAqui">Abrir en la MEV</button><button class="b" data-e="xNueva">Pestaña nueva &#8599;</button><button class="b" data-e="xReleer">&#10227; Releer</button>' +
            '<span class="sep" style="width:1px;height:22px;background:#dfe5e1"></span>' +
            '<button class="b p" data-e="xTodo">Bajar expediente completo</button><button class="b p" data-e="xSel">Bajar seleccionadas (0)</button>' +
            '<span class="sep" style="width:1px;height:22px;background:#dfe5e1"></span>' +
            '<span data-e="xEtq" class="celda-edit" data-pop="1" title="Poner o sacar etiquetas">' + (chips(c.key) || '<span class="mas">+ etiqueta</span>') + '</span>' +
          '</div>' +
          '<textarea class="anot" data-e="xAnot" placeholder="Anotación privada sobre esta causa (queda en este equipo)…">' + esc(anotacionDe(c.key)) + '</textarea>' +
        '</div>' +
        (EXP.cargando ? '<div class="vacio">Leyendo la causa en la MEV…<br><small data-e="xCargando">' + esc(EXP.cargandoTxt || '') + '</small></div>'
          : EXP.error ? '<div class="vacio" style="color:#7a1f16">' + esc(EXP.error) + '</div>'
          : '<div class="tool">' +
              '<input class="i" type="search" data-e="xFiltro" placeholder="Filtrar por fecha o texto…" style="width:220px" value="' + esc(EXP.filtro) + '">' +
              '<span style="font-size:12px;color:#56615b">Fechas</span><input class="i" type="date" data-e="xDesde" value="' + esc(EXP.desde) + '"><span>a</span><input class="i" type="date" data-e="xHasta" value="' + esc(EXP.hasta) + '">' +
              '<button class="b" data-e="xMarcarF" title="Tildar las actuaciones entre esas fechas">Marcar entre fechas</button>' +
              '<button class="b' + (EXP.soloRango ? ' on' : '') + '" data-e="xFiltrarF" title="Mostrar solo las actuaciones entre esas fechas">Filtrar por fechas</button>' +
              '<span class="sep"></span>' +
              '<button class="b" data-e="xTodas">Todas</button><button class="b" data-e="xNinguna">Ninguna</button><button class="b" data-e="xInvertir">Invertir</button>' +
              '<button class="b" data-e="xOrdenMev" title="El orden en que las muestra la MEV">Orden de la MEV</button>' +
              '<span data-e="xCont" style="margin-left:auto;font-size:12px;color:#56615b"></span>' +
            '</div><div class="envoltura" data-e="xEnv"></div>');
      q('xAqui', s).onclick = () => { location.href = urlProcesales(c); };
      q('xNueva', s).onclick = () => W.open(urlAbsoluta(urlProcesales(c)), '_blank', 'noopener');
      q('xReleer', s).onclick = () => abrirCausa(c);
      q('xTodo', s).onclick = () => { if (DESCARGAS.agregar(c, null, 'expediente completo')) aviso('En la cola de Descargas: ' + (c.caratula || 'la causa')); };
      q('xSel', s).onclick = () => {
        if (!EXP.sel.size) { aviso('Tildá al menos una actuación.', true); return; }
        const urls = EXP.acts.filter((a) => EXP.sel.has(a.url)).map((a) => a.url);
        if (DESCARGAS.agregar(c, urls, urls.length + ' actuación(es)')) aviso(urls.length + ' actuación(es) en la cola de Descargas.');
      };
      q('xEtq', s).onclick = (e) => popEtiquetas(e.currentTarget, c.key, () => { pintarExpCab(); pintarFiltros(); pintarCausas(); });
      const areaAnot = q('xAnot', s);
      areaAnot.oninput = () => {
        if (anotPend) clearTimeout(anotPend.reloj);
        anotPend = { key: c.key, el: areaAnot, reloj: setTimeout(guardarAnotPendiente, 600) };
      };
      areaAnot.onblur = guardarAnotPendiente;
      if (!EXP.cargando && !EXP.error) {
        q('xEnv', s).appendChild(grillaExp.tabla);
        q('xFiltro', s).oninput = () => { EXP.filtro = q('xFiltro', s).value; pintarActs(); };
        q('xDesde', s).onchange = () => { EXP.desde = q('xDesde', s).value; if (EXP.soloRango) pintarActs(); };
        q('xHasta', s).onchange = () => { EXP.hasta = q('xHasta', s).value; if (EXP.soloRango) pintarActs(); };
        q('xMarcarF', s).onclick = () => { if (!EXP.desde && !EXP.hasta) { aviso('Poné al menos una de las dos fechas.', true); return; } EXP.acts.filter(enRango).forEach((a) => EXP.sel.add(a.url)); pintarActs(); };
        q('xFiltrarF', s).onclick = () => { EXP.soloRango = !EXP.soloRango; q('xFiltrarF', s).classList.toggle('on', EXP.soloRango); pintarActs(); };
        q('xTodas', s).onclick = () => { actsVisibles().forEach((a) => EXP.sel.add(a.url)); pintarActs(); };
        q('xNinguna', s).onclick = () => { actsVisibles().forEach((a) => EXP.sel.delete(a.url)); pintarActs(); };
        q('xInvertir', s).onclick = () => { actsVisibles().forEach((a) => (EXP.sel.has(a.url) ? EXP.sel.delete(a.url) : EXP.sel.add(a.url))); pintarActs(); };
        q('xOrdenMev', s).onclick = () => { EXP.orden = null; pintarActs(); };
        pintarActs();
      }
    }
    function pintarExpCab() { const s = P('exp'); const x = q('xEtq', s); if (x && EXP) x.innerHTML = chips(EXP.causa.key) || '<span class="mas">+ etiqueta</span>'; }
    function pintarActs() {
      const s = P('exp');
      vistaExp = actsVisibles();
      grillaExp.pintar();
      const st = q('expSelTodo'); if (st) { const n = vistaExp.filter((a) => EXP.sel.has(a.url)).length; st.checked = vistaExp.length > 0 && n === vistaExp.length; st.indeterminate = n > 0 && n < vistaExp.length; }
      const cont = q('xCont', s); if (cont) cont.textContent = EXP.sel.size + ' seleccionadas de ' + EXP.acts.length + (vistaExp.length !== EXP.acts.length ? ' · ' + vistaExp.length + ' a la vista' : '');
      const b = q('xSel', s); if (b) { b.textContent = 'Bajar seleccionadas (' + EXP.sel.size + ')'; b.disabled = !EXP.sel.size; }
    }
    grillaExp.tabla.addEventListener('click', (e) => {
      if (e.target.matches('[data-e="expSelTodo"]')) { vistaExp.forEach((a) => (e.target.checked ? EXP.sel.add(a.url) : EXP.sel.delete(a.url))); pintarActs(); return; }
      const tr = e.target.closest('tr[data-k]'); if (!tr) return;
      const act = EXP.acts.find((a) => a.url === tr.dataset.k); if (!act) return;
      const a = e.target.closest('[data-a]'); const accion = a ? a.dataset.a : '';
      if (accion === 'sel') {
        const orden = vistaExp.map((x) => x.url), i = orden.indexOf(act.url), val = e.target.checked;
        if (e.shiftKey && anclaExp !== null && anclaExp >= 0) { const [x, y] = [Math.min(anclaExp, i), Math.max(anclaExp, i)]; for (let k = x; k <= y; k++) val ? EXP.sel.add(orden[k]) : EXP.sel.delete(orden[k]); }
        else if (val) EXP.sel.add(act.url); else EXP.sel.delete(act.url);
        anclaExp = i; pintarActs(); return;
      }
      if (accion === 'ver') { W.open(act.url, '_blank', 'noopener'); return; }
      if (accion === 'bajar1') { if (DESCARGAS.agregar(EXP.causa, [act.url], act.fechaTxt.split(' ')[0] + ' ' + act.descripcion.slice(0, 50))) aviso('Actuación en la cola de Descargas.'); }
    });

    // ================================================ DESCARGAS
    let ayudaDesc = null;
    function pintarDescargas() {
      const s = P('desc');
      const cola = DESCARGAS.cola();
      const pend = cola.filter((x) => x.estado === 'espera' || x.estado === 'bajando').length;
      q('nDesc').style.display = pend ? '' : 'none';
      q('nDesc').textContent = pend;
      if (solapa !== 'desc') return;
      const rot = { espera: 'En espera', bajando: 'Bajando', listo: 'Listo', error: 'No se completó', cancelado: 'Cancelada' };
      const col = { espera: '#6b756f', bajando: V, listo: '#1f7a45', error: '#a3261b', cancelado: '#8a5a00' };
      s.innerHTML =
        '<div class="caja"><h3>Descargas</h3>' +
        '<div style="font-size:12px;color:#3a453e;margin-bottom:8px">Cada expediente se baja con el motor de MEV+: la presentación original de cada actuación, los adjuntos sin tocar y un único PDF cronológico, con texto buscable. Van de a uno, en segundo plano, y se puede seguir trabajando. Tope: ' + TOPE_COLA + ' en espera. No cierres ni recargues esta pestaña mientras bajan.</div>' +
        '<div class="fila"><button class="b" data-e="dCancelar"' + (pend ? '' : ' disabled') + '>Cancelar todas</button><button class="b" data-e="dLimpiar">Quitar las terminadas</button></div></div>' +
        (ayudaDesc ? '<div class="ayuda-val" style="margin:0 0 12px">' + esc(ayudaDesc.texto) + '<div class="fila" style="margin-top:8px"><button class="b" data-e="dAbrir">Abrir la causa en otra pestaña</button><button class="b p" data-e="dSeguir">Ya validé: seguir</button></div></div>' : '') +
        (cola.length ? cola.slice().reverse().map((x) =>
          '<div class="caja" style="padding:10px 12px">' +
            '<div style="display:flex;gap:10px;align-items:baseline"><b style="flex:1">' + esc(x.causa.caratula || ('Causa ' + x.causa.nidCausa)) + '</b>' +
            '<span style="font-size:12px;color:' + col[x.estado] + ';font-weight:700">' + rot[x.estado] + '</span>' +
            ((x.estado === 'espera' || x.estado === 'bajando') ? ' <button class="ib" data-d="' + x.id + '">Cancelar</button>' : '') + '</div>' +
            '<div style="font-size:12px;color:#56615b">' + esc(x.titulo) + (x.causa.expediente ? ' · Expte. ' + esc(x.causa.expediente) : '') + '</div>' +
            '<div style="font-size:12px;margin-top:4px">' + esc(x.texto) + '</div>' +
            (x.estado === 'bajando' || x.estado === 'listo' ? '<div class="prog"><i style="width:' + Math.round(x.prog * 100) + '%"></i></div>' : '') +
          '</div>').join('') : '<div class="vacio" style="padding:20px 0">No hay descargas. Se bajan desde Mis causas (&#8681; o "Bajar seleccionadas") o desde Este expediente.</div>');
      const b1 = q('dCancelar', s); if (b1) b1.onclick = () => DESCARGAS.cancelarTodo();
      q('dLimpiar', s).onclick = () => DESCARGAS.limpiarTerminadas();
      s.querySelectorAll('[data-d]').forEach((b) => { b.onclick = () => DESCARGAS.cancelar(b.dataset.d); });
      if (ayudaDesc) { q('dAbrir', s).onclick = () => W.open(ayudaDesc.url, '_blank', 'noopener'); q('dSeguir', s).onclick = () => { const f = ayudaDesc.seguir; ayudaDesc = null; f(); pintarDescargas(); }; }
    }

    // ================================================ BUSCAR PERSONA
    let busqVista = null;          // búsqueda que se muestra (la que corre tiene prioridad)
    const ROT_BUSQ = { espera: 'Sin empezar', curso: 'Buscando', pausada: 'Pausada', terminada: 'Terminada', error: 'Detenida' };

    function opcionesAlcance() {
      const deptos = JURIS.filter((j) => /^CC/.test(j.id))
        .map((j) => '<option value="' + esc(j.id) + '">' + esc(j.nombre) + ' (civiles y comerciales)</option>').join('');
      return '<option value="todo">Toda la provincia: civiles y comerciales y juzgados de paz</option>' +
        '<option value="PZ">Solo juzgados de paz</option>' + deptos;
    }

    function pintarBuscar() {
      const s = P('buscar');
      if (!q('bTexto', s)) {
        s.innerHTML =
          '<div class="caja"><h3>Buscar una persona en la MEV</h3>' +
          '<div style="font-size:12px;color:#3a453e;margin-bottom:8px;line-height:1.5">Busca el nombre en la carátula de las causas de los juzgados civiles y comerciales de los 23 departamentos judiciales y de los juzgados de paz, y encuentra las que tienen todas las palabras, en cualquier orden. ' +
          'Va pausado, una consulta cada ' + (BUSCADOR.pausaMs / 1000) + ' segundos, así que recorrer toda la provincia lleva un rato: se puede pausar y retomar. Mientras busca cambia la jurisdicción de tu sesión de la MEV; al terminar deja la que tenías.</div>' +
          '<div class="fila"><input class="i" data-e="bTexto" type="search" style="flex:1 1 260px" placeholder="Apellido y nombre, por ejemplo: MANICO TEODORA">' +
          '<select class="s" data-e="bAlcance" style="max-width:360px">' + opcionesAlcance() + '</select>' +
          '<button class="b p" data-e="bBuscar">Buscar</button></div></div>' +
          '<div data-e="bCuerpo"></div>';
        q('bBuscar', s).onclick = () => {
          const b = empezarBusqueda(q('bTexto', s).value, q('bAlcance', s).value);
          if (b) { busqVista = b.id; pintarBuscarCuerpo(); }
        };
        q('bTexto', s).addEventListener('keydown', (e) => { if (e.key === 'Enter') q('bBuscar', s).click(); });
      }
      pintarBuscarCuerpo();
    }

    function busquedaEnPantalla(lista) {
      if (BUSQ.activa && BUSQ.actual) return BUSQ.actual;
      return lista.find((x) => x.id === busqVista) || null;
    }

    function pintarBuscarCuerpo() {
      const s = P('buscar');
      const c = q('bCuerpo', s);
      if (!c || solapa !== 'buscar') return;
      q('bBuscar', s).disabled = BUSQ.activa;
      const lista = leerBusquedas();
      const b = busquedaEnPantalla(lista);
      c.innerHTML = (b ? cajaBusqueda(b) : '') + cajaHistorial(lista, b);
      if (b) conectarBusqueda(c, b);
      c.querySelectorAll('[data-bv]').forEach((e) => { e.onclick = () => { busqVista = e.dataset.bv; pintarBuscarCuerpo(); }; });
    }

    /** Minutos que faltan, estimados con lo que tardaron las jurisdicciones ya recorridas. */
    function faltaEstimada(b) {
      const hechas = b.jurisHechas.length;
      if (!hechas || hechas >= b.plan.length) return '';
      const seg = b.segundos + (b.tRun ? (ahora() - b.tRun) / 1000 : 0);
      const min = Math.ceil(seg / hechas * (b.plan.length - hechas) / 60);
      return ' · faltan unos ' + min + ' min';
    }

    function lineaEstado(b, enCurso) {
      const n = Object.keys(b.resultados || {}).length;
      return '<b>' + esc(enCurso ? 'Buscando' : (ROT_BUSQ[b.estado] || b.estado)) + '</b>' +
        '<span>' + b.jurisHechas.length + ' de ' + b.plan.length + ' jurisdicciones · ' + b.juzgados + ' juzgados consultados · ' +
        n + (n === 1 ? ' causa encontrada' : ' causas encontradas') + (enCurso ? esc(faltaEstimada(b)) : '') + '</span>';
    }

    function botonesBusqueda(b, enCurso) {
      if (enCurso) return '<button class="b" data-e="bPausar"' + (BUSQ.pausar ? ' disabled' : '') + '>Pausar</button>';
      return (b.estado !== 'terminada' ? '<button class="b p" data-e="bRetomar"' + (BUSQ.activa ? ' disabled' : '') + '>Retomar</button>' : '') +
        '<button class="b" data-e="bQuitar">Quitar del historial</button>';
    }

    function cajaDiagnostico(b) {
      if (!b.diagnostico) return '';
      return '<div class="ayuda-val" style="margin:10px 0 0">No se pudo reconocer la consulta por carátula de la MEV. Con este diagnóstico se corrige el reconocimiento.' +
        '<textarea data-e="bDiag" readonly style="width:100%;height:140px;margin-top:6px;font:11px monospace"></textarea>' +
        '<div class="fila" style="margin-top:6px"><button class="b" data-e="bCopiar">Copiar el diagnóstico</button></div></div>';
    }

    function cajaAvisos(b) {
      if (!b.avisos || !b.avisos.length) return '';
      return '<div class="ayuda-val" style="margin:10px 0 0"><b>Avisos</b><ul style="margin:6px 0 0 18px;padding:0">' +
        b.avisos.slice(0, 40).map((a) => '<li>' + esc(a) + '</li>').join('') + '</ul></div>';
    }

    function cajaBusqueda(b) {
      const enCurso = BUSQ.activa && BUSQ.actual && BUSQ.actual.id === b.id;
      const avance = b.plan.length ? Math.round(100 * b.jurisHechas.length / b.plan.length) : 0;
      return '<div class="caja"><h3>' + esc(b.texto) + ' <span style="font-weight:400;color:#56615b;font-size:12px">· ' + esc(nombreAlcance(b.alcance)) + ' · ' + esc(fechaHora(b.t0)) + '</span></h3>' +
        '<div class="fila" style="font-size:12px;color:#3a453e">' + lineaEstado(b, enCurso) + '<span style="flex:1"></span>' + botonesBusqueda(b, enCurso) + '</div>' +
        '<div class="prog"><i style="width:' + avance + '%"></i></div>' +
        '<div data-e="bAvance" style="font-size:12px;color:#56615b;margin-top:6px">' + esc(enCurso ? BUSQ.avance : (b.error || '')) + '</div>' +
        cajaDiagnostico(b) + cajaAvisos(b) + tablaResultados(Object.values(b.resultados || {})) + '</div>';
    }

    const deptoDeResultado = (c) => (jurisPorId(c.juris) || { nombre: '' }).nombre;

    function filaResultado(c) {
      return '<tr><td style="white-space:normal"><span class="car" data-br="' + esc(c.key) + '" title="Ver esta causa en MEV Ultra">' + esc(c.caratula) + '</span>' +
        (c.estado ? '<div class="mas">' + esc(c.estado) + '</div>' : '') + '</td>' +
        '<td style="white-space:normal">' + esc(c.organismo) + '</td><td>' + esc(deptoDeResultado(c)) + '</td>' +
        '<td class="nw">' + esc(c.expediente) + '</td><td class="nw">' + esc(c.inicio) + '</td>' +
        '<td style="white-space:normal">' + esc(((c.ultFechaTxt || '') + ' ' + (c.ultDesc || '')).trim()) + '</td>' +
        '<td class="nw"><button class="ib" data-bb="' + esc(c.key) + '" title="Bajar el expediente completo">&#8681;</button></td></tr>';
    }

    function tablaResultados(res) {
      if (!res.length) return '<div class="mas" style="margin-top:10px">Todavía no hay causas encontradas.</div>';
      const orden = res.slice().sort((a, b) => deptoDeResultado(a).localeCompare(deptoDeResultado(b)) || (a.organismo || '').localeCompare(b.organismo || ''));
      return '<table class="grid" style="width:100%;margin-top:10px"><thead><tr><th>Carátula</th><th style="width:210px">Organismo</th>' +
        '<th style="width:130px">Departamento</th><th style="width:110px">Nº expediente</th><th style="width:90px">Inicio</th>' +
        '<th style="width:160px">Último movimiento</th><th style="width:44px"></th></tr></thead><tbody>' +
        orden.map(filaResultado).join('') + '</tbody></table>';
    }

    function cajaHistorial(lista, enPantalla) {
      const otras = lista.filter((x) => !enPantalla || x.id !== enPantalla.id);
      if (!otras.length) return '';
      return '<div class="caja"><h3>Búsquedas anteriores</h3>' +
        otras.map((x) => '<div class="fila" style="font-size:12px;padding:4px 0;border-bottom:1px solid #edf1ee">' +
          '<span class="car" data-bv="' + esc(x.id) + '">' + esc(x.texto) + '</span>' +
          '<span style="color:#56615b">' + esc(nombreAlcance(x.alcance)) + ' · ' + esc(fechaHora(x.t0)) + ' · ' + esc(ROT_BUSQ[x.estado] || x.estado) +
          ' · ' + Object.keys(x.resultados || {}).length + ' encontrada(s)</span></div>').join('') + '</div>';
    }

    const causaDeResultado = (r) => IDX.causas[r.key] || Object.assign({ sets: [], externa: true }, r);

    function copiarDiagnostico(b, area) {
      area.select();
      const listo = () => aviso('Diagnóstico copiado.');
      try { navigator.clipboard.writeText(b.diagnostico).then(listo, () => { document.execCommand('copy'); listo(); }); } catch (e) { document.execCommand('copy'); listo(); }
    }

    function conectarBusqueda(c, b) {
      const bp = q('bPausar', c);
      if (bp) bp.onclick = () => { pausarBusqueda(); bp.disabled = true; };
      const br = q('bRetomar', c);
      if (br) br.onclick = () => retomarBusqueda(b.id);
      const bq = q('bQuitar', c);
      if (bq) bq.onclick = () => { if (W.confirm('¿Quitar del historial la búsqueda "' + b.texto + '"?')) { quitarBusqueda(b.id); busqVista = null; pintarBuscarCuerpo(); } };
      const d = q('bDiag', c);
      if (d) { d.value = b.diagnostico; q('bCopiar', c).onclick = () => copiarDiagnostico(b, d); }
      c.querySelectorAll('[data-br]').forEach((e) => { e.onclick = () => { const r = b.resultados[e.dataset.br]; if (r) abrirCausa(causaDeResultado(r)); }; });
      c.querySelectorAll('[data-bb]').forEach((e) => {
        e.onclick = () => { const r = b.resultados[e.dataset.bb]; if (r && DESCARGAS.agregar(causaDeResultado(r), null)) aviso('En la cola de Descargas: ' + r.caratula); };
      });
    }

    // ================================================ SETS
    function pintarSets() {
      const s = P('sets');
      const l = IDX.lectura;
      const sets = Object.values(IDX.sets);
      const tipo = (t) => (t ? 'Lista de autorizaciones' : 'Set propio');
      s.innerHTML =
        '<div class="caja"><h3>Lectura de las causas</h3>' +
        '<div style="font-size:12px;color:#3a453e;margin-bottom:8px">La MEV muestra cada Set por partes: solo las causas de la jurisdicción elegida y, dentro de ella, de a un organismo. MEV Ultra recorre esas combinaciones y arma una sola lista. La <b>lectura rápida</b> vuelve solo a donde ya encontró causas de cada Set; la <b>completa</b> recorre todas las jurisdicciones (departamentos, fueros de Familia y Penal, Suprema Corte, Casación y Justicia de Paz) hasta completar el total que declara cada Set. Mientras lee, no navegues la MEV en otras pestañas: la lectura cambia la jurisdicción de tu sesión y al terminar deja la que tenías.</div>' +
        '<div class="fila"><button class="b p" data-e="sRapida"' + (LECTURA.activa ? ' disabled' : '') + '>Lectura rápida</button><button class="b" data-e="sCompleta"' + (LECTURA.activa ? ' disabled' : '') + '>Lectura completa</button>' +
        (l ? '<span style="font-size:12px;color:#56615b">Última: ' + esc(fechaHora(l.fecha)) + ' · ' + (l.modo === 'completa' ? 'completa' : 'rápida') + ' · ' + l.causas + ' causas · ' + l.pedidos + ' consultas · ' + l.segundos + ' s</span>' : '') + '</div>' +
        (l && l.avisos && l.avisos.length ? '<div class="ayuda-val" style="margin:10px 0 0"><b>Avisos de la última lectura</b><ul style="margin:6px 0 0 18px;padding:0">' + l.avisos.map((a) => '<li>' + esc(a) + '</li>').join('') + '</ul></div>' : '') +
        '</div>' +
        '<div class="caja"><h3>Tus Sets de Búsqueda</h3>' +
        (sets.length ? '<table class="grid" style="width:100%"><thead><tr><th>Set</th><th style="width:170px">Tipo</th><th style="width:90px">Total MEV</th><th style="width:100px">Encontradas</th><th>Dónde están</th></tr></thead><tbody>' +
          sets.map((x) => {
            const enc = x.encontradas || 0;
            const ocu = x.ocultas || 0;
            const est = !IDX.lectura ? '' : (enc < x.total && enc + ocu >= x.total ? '<span style="color:#1f7a45" title="Las que faltan no las muestra la propia MEV">&#10003; (la MEV no muestra ' + ocu + ')</span>' : x.total === enc ? '<span style="color:#1f7a45">&#10003;</span>' : (enc < x.total ? '<span style="color:#a3261b" title="Faltan causas: probá la lectura completa">faltan ' + (x.total - enc) + '</span>' : '<span style="color:#8a5a00" title="La MEV cuenta menos de las que muestra">' + (enc - x.total) + ' más</span>'));
            const donde = Object.entries(x.lugares || {}).map(([jid, pids]) => {
              const n = Object.values(IDX.causas).filter((c) => !c.ausente && c.juris === jid && c.sets.includes(x.nidset)).length;
              return esc((jurisPorId(jid) || { nombre: jid }).nombre) + ' (' + n + (pids.length > 1 ? ', ' + pids.length + ' organismos' : '') + ')';
            }).join(' · ');
            return '<tr><td><span class="car" data-set="' + esc(x.nidset) + '" title="Ver sus causas">' + esc(x.nombre) + '</span></td><td>' + tipo(x.tipo) + '</td><td>' + x.total + '</td><td>' + enc + ' ' + est + '</td><td style="white-space:normal">' + (donde || '<span class="mas">' + (x.total ? 'sin leer' : 'vacío') + '</span>') + '</td></tr>';
          }).join('') + '</tbody></table>' : '<div class="mas">Todavía no se leyeron. Usá "Lectura completa".</div>') +
        '</div>';
      q('sRapida', s).onclick = () => leerCausas('rapida');
      q('sCompleta', s).onclick = () => leerCausas('completa');
      s.querySelectorAll('[data-set]').forEach((e) => { e.onclick = () => { F.set = e.dataset.set; ir('causas'); alFiltrar(); }; });
    }

    // ================================================ DATOS Y RESPALDO
    function pintarDatos() {
      const s = P('datos');
      if (solapa !== 'datos') return;
      const resp = leerC('respaldo', null);
      const dias = resp ? Math.floor((ahora() - resp.fecha) / 86400000) : null;
      const cuenta = (id) => Object.values(MARCAS.filas).filter((m) => (m.etq || []).includes(id)).length;
      const anots = Object.values(MARCAS.filas).filter((m) => m.anot).length;
      s.innerHTML =
        '<div class="caja"><h3>Etiquetas</h3>' +
        (MARCAS.etiquetas.length ? MARCAS.etiquetas.map((e) =>
          '<div class="fila" style="margin-bottom:6px"><select class="s" data-col="' + esc(e.id) + '">' + COLORES.map((c) => '<option value="' + c[1] + '"' + (c[1] === e.color ? ' selected' : '') + '>' + esc(c[0]) + '</option>').join('') + '</select>' +
          '<input class="i" data-nom="' + esc(e.id) + '" value="' + esc(e.nombre) + '" style="width:220px">' +
          '<span class="chip" style="background:' + colorDe(e.color)[1] + ';color:' + colorDe(e.color)[2] + '">' + esc(e.nombre) + '</span>' +
          '<span class="mas">' + cuenta(e.id) + ' causa(s)</span><button class="ib" data-borrar="' + esc(e.id) + '">Borrar</button></div>').join('') : '<div class="mas" style="margin-bottom:6px">No hay etiquetas todavía.</div>') +
        '<div class="fila" style="margin-top:8px"><input class="i" data-e="dNueva" placeholder="Nueva etiqueta…" style="width:220px"><button class="b" data-e="dCrear">Crear</button></div>' +
        '<div class="mas" style="margin-top:8px">' + anots + ' causa(s) con anotación.</div></div>' +
        '<div class="caja"><h3>Respaldo</h3>' +
        '<div style="font-size:12px;color:#3a453e;margin-bottom:8px">Las etiquetas y las anotaciones son trabajo tuyo y quedan solo en este navegador. El respaldo sale en un archivo propio (' + EXT + '), cifrado con una contraseña que ponés una sola vez en este equipo: acá no se vuelve a pedir, y en otra PC hace falta para abrirlo. Protege el archivo que sale de esta PC; dentro de este navegador queda guardada junto con los datos. Importar suma lo del archivo sin pisar lo que ya hay.</div>' +
        '<div class="fila" style="margin-bottom:8px"><span>Contraseña: <b>' + (leerContra() ? 'puesta en este equipo' : 'sin poner') + '</b></span><input class="i" type="password" data-e="dContra" placeholder="' + (leerContra() ? 'Cambiar la contraseña' : 'Contraseña del respaldo') + '" style="width:220px" autocomplete="new-password"><button class="b" data-e="dContraOk">Guardar contraseña</button></div>' +
        '<div class="fila"><button class="b p" data-e="dExportar"' + (leerContra() ? '' : ' disabled') + '>Exportar respaldo</button><button class="b" data-e="dImportar">Importar respaldo</button><input type="file" data-e="dArchivo" accept="' + EXT + ',.json,application/octet-stream,application/json" style="display:none">' +
        '<span style="font-size:12px;color:' + (dias === null || dias > 15 ? '#a3261b' : '#56615b') + '">' + (resp ? 'Última exportación: ' + esc(fechaHora(resp.fecha)) + (dias > 15 ? ' (hace ' + dias + ' días)' : '') : 'Nunca se exportó.') + '</span></div></div>' +
        '<div class="caja"><h3>Respaldo automático en una carpeta</h3>' +
        '<div style="font-size:12px;color:#3a453e;margin-bottom:8px">Elegís una carpeta una vez (conviene OneDrive o el Drive, fuera de la carpeta del programa) y cada cambio de etiquetas o anotaciones se escribe ahí, cifrado con la misma contraseña, en el archivo ' + esc(archivoCarpeta()) + '.</div>' +
        '<div class="fila"><span style="font-size:12px" data-e="dCarpetaEstado">' + esc(carpetaEstado.texto) + '</span>' +
        '<button class="b" data-e="dCarpeta">' + (CARPETA ? 'Cambiar la carpeta' : 'Elegir la carpeta') + '</button>' +
        (carpetaEstado.estado === 'pedir' ? '<button class="b p" data-e="dPermiso">Confirmar el permiso</button>' : '') + '</div></div>' +
        '<div class="caja"><h3>Índice de causas</h3><div style="font-size:12px;color:#3a453e;margin-bottom:8px">El índice es lo que se leyó de la MEV. Borrarlo no toca las etiquetas ni las anotaciones: vuelven a aparecer cuando se lee de nuevo.</div>' +
        '<button class="b" data-e="dBorrarIdx">Borrar el índice</button></div>';
      s.querySelectorAll('[data-col]').forEach((sel) => { sel.onchange = () => { const e = MARCAS.etiquetas.find((x) => x.id === sel.dataset.col); if (e) { e.color = sel.value; guardarMarcas(); pintarDatos(); pintarCausas(); } }; });
      s.querySelectorAll('[data-nom]').forEach((inp) => { inp.onchange = () => { const e = MARCAS.etiquetas.find((x) => x.id === inp.dataset.nom); const n = limpio(inp.value); if (e && n) { e.nombre = n; guardarMarcas(); pintarDatos(); pintarFiltros(); pintarCausas(); } }; });
      s.querySelectorAll('[data-borrar]').forEach((b) => { b.onclick = () => { const e = MARCAS.etiquetas.find((x) => x.id === b.dataset.borrar); if (e && W.confirm('¿Borrar la etiqueta "' + e.nombre + '"? Se quita de ' + cuenta(e.id) + ' causa(s).')) { borrarEtiqueta(e.id); pintarDatos(); pintarFiltros(); pintarCausas(); } }; });
      const crear = () => { if (crearEtiqueta(q('dNueva', s).value)) { pintarDatos(); pintarFiltros(); } };
      q('dCrear', s).onclick = crear; q('dNueva', s).onkeydown = (e) => { if (e.key === 'Enter') crear(); };
      q('dContraOk', s).onclick = () => {
        const v = q('dContra', s).value;
        if (!v || v.length < 6) { aviso('La contraseña tiene que tener al menos 6 caracteres.', true); return; }
        guardarContra(v); aviso('Contraseña guardada en este equipo. Anotala en un lugar seguro: sin ella no se abren los respaldos en otra PC.');
        respaldoACarpeta().catch(() => {}); pintarDatos();
      };
      q('dExportar', s).onclick = async () => { try { await exportar(); aviso('Respaldo exportado a Descargas.'); pintarDatos(); } catch (e) { aviso('No se pudo exportar: ' + e.message, true); } };
      q('dImportar', s).onclick = () => q('dArchivo', s).click();
      q('dArchivo', s).onchange = async () => {
        const f = q('dArchivo', s).files[0]; if (!f) return;
        try { const r = await importarArchivo(f); aviso('Importado: ' + r.causas + ' causa(s) con marcas, ' + r.etqNuevas + ' etiqueta(s) nuevas' + (r.conflictos ? ', ' + r.conflictos + ' anotación(es) distintas que se dejaron como estaban acá' : '') + '.'); }
        catch (e) { aviso('No se pudo importar: ' + e.message, true); }
        pintarDatos(); pintarFiltros(); pintarCausas();
      };
      q('dCarpeta', s).onclick = async () => { try { await elegirCarpeta(); aviso('Carpeta de respaldo elegida.'); } catch (e) { if (e.name !== 'AbortError') aviso('No se pudo usar la carpeta: ' + e.message, true); } pintarDatos(); };
      const dp = q('dPermiso', s); if (dp) dp.onclick = async () => { try { await confirmarPermisoCarpeta(); } catch (e) { aviso('Chrome no dio el permiso: ' + e.message, true); } pintarDatos(); };
      q('dBorrarIdx', s).onclick = () => { if (W.confirm('¿Borrar el índice de causas? Las etiquetas y anotaciones se conservan.')) { IDX = idxVacio(); guardarIndice(); SEL.clear(); pintarFiltros(); pintarCausas(); pintarDatos(); } };
    }

    // ================================================ AYUDA Y ACERCA DE
    P('ayuda').innerHTML =
      '<div style="max-width:860px"><h2 style="color:' + V + ';margin:0 0 10px">Cómo se usa</h2>' +
      '<p><b>Mis causas</b> reúne en una sola tabla las causas de todos tus Sets de Búsqueda, de todos los departamentos judiciales, fueros y organismos. La primera vez tocá <b>Leer causas</b> (o, en la solapa Sets, <b>Lectura completa</b>). Después alcanza con la lectura rápida.</p>' +
      '<p><b>Por qué hace falta leer:</b> la MEV muestra cada Set por partes, solo lo de la jurisdicción elegida y de a un organismo. MEV Ultra recorre esas combinaciones por vos. Mientras lee cambia la jurisdicción de tu sesión de la MEV; al terminar deja la que tenías. Por eso conviene no navegar la MEV en otras pestañas mientras lee.</p>' +
      '<ul><li><b>Buscar:</b> la caja de arriba busca en todos los campos, incluidas etiquetas y anotaciones. Se pueden escribir varias palabras.</li>' +
      '<li><b>Filtros:</b> departamento, organismo, Set, estado, etiqueta y rango de fechas del último movimiento.</li>' +
      '<li><b>Novedades:</b> después de cada lectura, las causas con un movimiento, un cambio de estado o recién agregadas a un Set quedan con un punto verde. Se marcan como vistas al abrirlas o con "Marcar todo como visto". La primera lectura es la línea de partida: ahí no hay novedades.</li>' +
      '<li><b>Columnas:</b> se ordenan con un clic en el título, se mueven arrastrando el título, se ensanchan arrastrando el borde y se ocultan desde "Columnas".</li>' +
      '<li><b>Etiquetas y anotaciones:</b> un clic sobre la celda. Son notas privadas de trabajo: quedan en este equipo y no tocan la MEV.</li>' +
      '<li><b>Selección:</b> las casillas, con Mayúscula para tildar un rango. "Bajar seleccionadas" pone en la cola el expediente completo de cada una.</li></ul>' +
      '<p><b>Este expediente</b> muestra los datos de la causa y sus pasos procesales. Se puede bajar todo o elegir actuaciones: a mano, por rango de fechas o filtrando por texto (Todas, Ninguna e Invertir actúan sobre lo que queda a la vista). "Ver" abre la actuación en una pestaña nueva y &#8681; baja solo esa.</p>' +
      '<p><b>Buscar persona</b> busca un nombre en la carátula de las causas de los juzgados civiles y comerciales de los 23 departamentos judiciales y de los juzgados de paz: sirve para saber si hay una causa iniciada, una sucesión por ejemplo, sin recorrer la MEV juzgado por juzgado. Encuentra las carátulas que tienen todas las palabras, en cualquier orden. Va pausado, una consulta por vez, así que recorrer toda la provincia lleva un rato; se puede pausar y retomar, y las búsquedas quedan en el historial. Si la MEV pide verificar que sos una persona, la búsqueda espera a que lo resuelvas. Mientras busca no corren lecturas ni descargas.</p>' +
      '<p><b>Descargas:</b> es MEV+ adentro de MEV Ultra. Cada actuación se captura con la presentación original de la MEV, los adjuntos se incorporan sin tocar detrás del proveído o escrito al que pertenecen y sale un único PDF cronológico, con texto buscable. Si la MEV pide validar que sos una persona, espera y reintenta sola; si no cede, avisa y sigue desde donde quedó. Los expedientes de más de 500 MB se arman por tramos.</p>' +
      '<p><b>Si algo falla,</b> cerrá la ventana con la cruz y seguí con la MEV de siempre: MEV Ultra no cambia nada de la MEV. Queda el indicador abajo a la derecha para volver a abrirla.</p>' +
      '<p><b>Fueros de Familia y Penal:</b> esas causas siempre requieren autorización del juzgado; una vez autorizadas aparecen en las "Listas de Causas con Autorización", que MEV Ultra lee igual que los demás Sets.</p></div>';
    P('acerca').innerHTML =
      '<div style="max-width:720px">' +
      '<div style="font-weight:800;color:' + V + ';font-size:20px">' + esc(APP.nombre) + '</div>' +
      '<div style="color:#56615b;margin-bottom:12px">Versión ' + esc(APP.version) + ' · incluye MEV+ 2.0.1</div>' +
      '<p>Una sola ventana sobre la Mesa de Entradas Virtual de la SCBA: todas las causas de todos los Sets, el expediente por dentro, etiquetas, anotaciones y la descarga completa de MEV+.</p>' +
      '<p>Creado por <b>' + esc(APP.autor) + '</b> con Claude.<br><a href="mailto:' + esc(APP.mail) + '" style="color:' + V + '">' + esc(APP.mail) + '</a></p>' +
      '<div class="caja" style="font-size:12px"><b>Copyleft: ' + esc(APP.licencia) + '.</b><br>Copyright (C) ' + esc(APP.anio) + ' ' + esc(APP.autor) + '. Software libre: se permite y se alienta su uso, copia, modificación y distribución de forma gratuita, siempre que las obras derivadas conserven esta misma licencia. Sin garantía. <a href="' + esc(APP.licenciaUrl) + '" target="_blank" rel="noopener noreferrer" style="color:' + V + '">Texto de la licencia &#8599;</a></div>' +
      '<p><a href="' + esc(APP.github) + '" target="_blank" rel="noopener noreferrer" class="b p" style="display:inline-flex;align-items:center;text-decoration:none">Ver en GitHub &#8599;</a></p>' +
      '<p style="font-size:12px;color:#56615b">Solo lee: no crea ni modifica Sets, no solicita autorizaciones y no presenta nada. Los datos propios quedan en este equipo, separados por usuario de la MEV. MEV Ultra y MEV+ no deben estar instalados a la vez: MEV Ultra ya trae MEV+.</p></div>';

    // ================================================ primera vez
    function pintarVacio() {
      if (Object.keys(IDX.causas).length) return false;
      const env = q('envCausas');
      env.innerHTML = '<div class="vacio"><h2>Todavía no se leyeron tus causas</h2>' +
        '<p>MEV Ultra recorre tus Sets de Búsqueda en todas las jurisdicciones y organismos y arma una sola lista. La primera lectura es completa y puede tardar unos minutos; las siguientes pueden ser rápidas.</p>' +
        '<p>Mientras lee, no navegues la MEV en otras pestañas: la lectura cambia la jurisdicción de tu sesión y al terminar deja la que tenías.</p>' +
        '<p><button class="b p" data-e="primera" style="height:34px;font-size:13px">Leer mis causas (lectura completa)</button></p></div>';
      q('primera').onclick = () => leerCausas('completa');
      return true;
    }
    function pintarTodoCausas() {
      pintarFiltros();
      if (pintarVacio()) return;
      if (!q('envCausas').contains(grilla.tabla)) { q('envCausas').innerHTML = ''; q('envCausas').appendChild(grilla.tabla); }
      pintarCausas();
    }

    q('leer').onclick = () => leerCausas(Object.values(IDX.sets).some((s) => Object.keys(s.lugares || {}).length) ? 'rapida' : 'completa');
    q('lectCancelar').onclick = () => { LECTURA.cancelar = true; q('lectTxt').textContent = 'Cancelando…'; };

    ventana(estadoVentana);
    aplicarZoom();
    ir('causas');
    pintarTodoCausas();
    window.addEventListener('resize', () => { if (estadoVentana === 'ventana') aplicarRect(); });
    window.addEventListener('beforeunload', (e) => {
      if (LECTURA.activa || BUSQ.activa || DESCARGAS.activa() || DESCARGAS.cola().some((x) => x.estado === 'espera')) { e.preventDefault(); e.returnValue = ''; }
    });
    // Otra pestaña cambió las marcas o el índice: se recargan.
    if (typeof GM_addValueChangeListener === 'function') {
      GM_addValueChangeListener(kc('marcas'), (k, a, b, remoto) => { if (remoto) { MARCAS = Object.assign(marcasVacias(), gmGet(kc('marcas'), {})); pintarFiltros(); pintarCausas(); pintarExpCab(); } });
      GM_addValueChangeListener(kc('indice'), (k, a, b, remoto) => { if (remoto && !LECTURA.activa) { IDX = Object.assign(idxVacio(), gmGet(kc('indice'), {})); pintarTodoCausas(); } });
    }

    return {
      aviso,
      abrirCausa,
      causaDesdeUrl,
      ventana,
      refrescarTodo: () => { pintarTodoCausas(); if (solapa === 'sets') pintarSets(); q('leer').disabled = false; },
      refrescarDescargas: pintarDescargas,
      refrescarDatos: pintarDatos,
      refrescarEstadoCarpeta: () => { const e = q('dCarpetaEstado'); if (e) e.textContent = carpetaEstado.texto; },
      progresoLectura: (t) => { q('lectTxt').textContent = t ? 'Leyendo las causas: ' + t : ''; q('lect').style.display = t ? 'flex' : 'none'; },
      lecturaEmpezo: () => { q('leer').disabled = true; q('lect').style.display = 'flex'; q('lectTxt').textContent = 'Leyendo las causas…'; if (solapa === 'sets') pintarSets(); },
      lecturaTermino: (error) => {
        q('lect').style.display = 'none';
        if (error) { aviso(error, true); return; }
        const l = IDX.lectura;
        const nov = Object.values(IDX.causas).filter((c) => c.nuevo && !c.ausente).length;
        aviso('Lectura terminada: ' + l.causas + ' causas en ' + l.segundos + ' s' + (nov ? ', ' + nov + ' con novedades' : '') + (l.avisos.length ? '. Hay avisos en la solapa Sets.' : '.'));
      },
      ayudaValidacion: (x) => {
        q('lectCancelar').style.display = LECTURA.activa ? '' : 'none';
        if (!x) { if (LECTURA.activa) q('lectTxt').textContent = 'Sigo leyendo…'; else q('lect').style.display = 'none'; return; }
        q('lect').style.display = 'flex';
        q('lectTxt').innerHTML = BUSQ.activa
          ? 'La MEV pide verificar que sos una persona. Abrí la MEV en otra pestaña, resolvé la verificación y tocá <a href="#" data-e="lectSeguir" style="color:inherit;font-weight:700">Ya validé: seguir</a>. Lo buscado no se pierde.'
          : 'La MEV insiste con la validación. Abrí la MEV en otra pestaña, pasá el control y tocá <a href="#" data-e="lectSeguir" style="color:inherit;font-weight:700">Ya validé: seguir</a>. Lo leído no se pierde.';
        q('lectSeguir').onclick = (e) => { e.preventDefault(); x.seguir(); };
        if (estadoVentana === 'min' || estadoVentana === 'cerrada') pill.classList.add('aviso');
      },
      ayudaDescarga: (x) => { ayudaDesc = x; pintarDescargas(); if (x && (estadoVentana === 'min' || estadoVentana === 'cerrada')) pill.classList.add('aviso'); },
      buscadorCambio: () => { if (solapa === 'buscar') pintarBuscarCuerpo(); },
      buscadorProgreso: (t) => { const e = q('bAvance', P('buscar')); if (e && BUSQ.activa) e.textContent = t; }
    };
  }

  // ---------------------------------------------------------------- arranque
  async function iniciar() {
    if (!document.body) { setTimeout(iniciar, 200); return; }
    CUENTA = leerCuenta(document);
    if (!CUENTA) return;                         // sin sesión (pantalla de ingreso): no se muestra nada
    cargarDatos();
    try { await cargarCarpeta(); } catch (e) { /* sin carpeta */ }
    limpiarEncargosViejos();
    // Se recuerda la última jurisdicción reconocida, para volver a ella al
    // terminar una lectura que empezó sin jurisdicción elegida (recién
    // ingresado a la MEV).
    { const j = jurisPorNombre(jurisDelEncabezado(document)); if (j) guardarC('ultimaJuris', j.id); }
    // En una actuación abierta en pestaña nueva ("Ver") se muestra la
    // actuación: la ventana arranca minimizada.
    if (/\/proveido\.asp/i.test(location.pathname)) { try { if (!sessionStorage.getItem('mu.ventana')) sessionStorage.setItem('mu.ventana', 'min'); } catch (e) { /* nada */ } }
    ui = crearUI();
    // En el listado de una causa se abre directamente "Este expediente",
    // leyendo la propia página (sin volver a pedirla).
    if (/\/procesales\.asp/i.test(location.pathname)) {
      const c = ui.causaDesdeUrl(location.href);
      if (c && document.querySelector('a[href*="proveido.asp"]')) ui.abrirCausa(c, document);
      else if (c) ui.abrirCausa(c);
    }
    log(APP.version, 'lista ·', Object.keys(IDX.causas).length, 'causas en el índice de', CUENTA.usuario);
  }
  iniciar();
})();


/*
 * ===========================================================================
 *  LICENCIA COMPLETA — GNU GENERAL PUBLIC LICENSE v3.0
 *  Incluida en el propio archivo para que el userscript sea autocontenido.
 *  No afecta la ejecucion (es un comentario). Texto oficial e integro de la FSF.
 * ===========================================================================
 *
 *                     GNU GENERAL PUBLIC LICENSE
 *                        Version 3, 29 June 2007
 *
 *  Copyright (C) 2007 Free Software Foundation, Inc. <https://fsf.org/>
 *  Everyone is permitted to copy and distribute verbatim copies
 *  of this license document, but changing it is not allowed.
 *
 *                             Preamble
 *
 *   The GNU General Public License is a free, copyleft license for
 * software and other kinds of works.
 *
 *   The licenses for most software and other practical works are designed
 * to take away your freedom to share and change the works.  By contrast,
 * the GNU General Public License is intended to guarantee your freedom to
 * share and change all versions of a program--to make sure it remains free
 * software for all its users.  We, the Free Software Foundation, use the
 * GNU General Public License for most of our software; it applies also to
 * any other work released this way by its authors.  You can apply it to
 * your programs, too.
 *
 *   When we speak of free software, we are referring to freedom, not
 * price.  Our General Public Licenses are designed to make sure that you
 * have the freedom to distribute copies of free software (and charge for
 * them if you wish), that you receive source code or can get it if you
 * want it, that you can change the software or use pieces of it in new
 * free programs, and that you know you can do these things.
 *
 *   To protect your rights, we need to prevent others from denying you
 * these rights or asking you to surrender the rights.  Therefore, you have
 * certain responsibilities if you distribute copies of the software, or if
 * you modify it: responsibilities to respect the freedom of others.
 *
 *   For example, if you distribute copies of such a program, whether
 * gratis or for a fee, you must pass on to the recipients the same
 * freedoms that you received.  You must make sure that they, too, receive
 * or can get the source code.  And you must show them these terms so they
 * know their rights.
 *
 *   Developers that use the GNU GPL protect your rights with two steps:
 * (1) assert copyright on the software, and (2) offer you this License
 * giving you legal permission to copy, distribute and/or modify it.
 *
 *   For the developers' and authors' protection, the GPL clearly explains
 * that there is no warranty for this free software.  For both users' and
 * authors' sake, the GPL requires that modified versions be marked as
 * changed, so that their problems will not be attributed erroneously to
 * authors of previous versions.
 *
 *   Some devices are designed to deny users access to install or run
 * modified versions of the software inside them, although the manufacturer
 * can do so.  This is fundamentally incompatible with the aim of
 * protecting users' freedom to change the software.  The systematic
 * pattern of such abuse occurs in the area of products for individuals to
 * use, which is precisely where it is most unacceptable.  Therefore, we
 * have designed this version of the GPL to prohibit the practice for those
 * products.  If such problems arise substantially in other domains, we
 * stand ready to extend this provision to those domains in future versions
 * of the GPL, as needed to protect the freedom of users.
 *
 *   Finally, every program is threatened constantly by software patents.
 * States should not allow patents to restrict development and use of
 * software on general-purpose computers, but in those that do, we wish to
 * avoid the special danger that patents applied to a free program could
 * make it effectively proprietary.  To prevent this, the GPL assures that
 * patents cannot be used to render the program non-free.
 *
 *   The precise terms and conditions for copying, distribution and
 * modification follow.
 *
 *                        TERMS AND CONDITIONS
 *
 *   0. Definitions.
 *
 *   "This License" refers to version 3 of the GNU General Public License.
 *
 *   "Copyright" also means copyright-like laws that apply to other kinds of
 * works, such as semiconductor masks.
 *
 *   "The Program" refers to any copyrightable work licensed under this
 * License.  Each licensee is addressed as "you".  "Licensees" and
 * "recipients" may be individuals or organizations.
 *
 *   To "modify" a work means to copy from or adapt all or part of the work
 * in a fashion requiring copyright permission, other than the making of an
 * exact copy.  The resulting work is called a "modified version" of the
 * earlier work or a work "based on" the earlier work.
 *
 *   A "covered work" means either the unmodified Program or a work based
 * on the Program.
 *
 *   To "propagate" a work means to do anything with it that, without
 * permission, would make you directly or secondarily liable for
 * infringement under applicable copyright law, except executing it on a
 * computer or modifying a private copy.  Propagation includes copying,
 * distribution (with or without modification), making available to the
 * public, and in some countries other activities as well.
 *
 *   To "convey" a work means any kind of propagation that enables other
 * parties to make or receive copies.  Mere interaction with a user through
 * a computer network, with no transfer of a copy, is not conveying.
 *
 *   An interactive user interface displays "Appropriate Legal Notices"
 * to the extent that it includes a convenient and prominently visible
 * feature that (1) displays an appropriate copyright notice, and (2)
 * tells the user that there is no warranty for the work (except to the
 * extent that warranties are provided), that licensees may convey the
 * work under this License, and how to view a copy of this License.  If
 * the interface presents a list of user commands or options, such as a
 * menu, a prominent item in the list meets this criterion.
 *
 *   1. Source Code.
 *
 *   The "source code" for a work means the preferred form of the work
 * for making modifications to it.  "Object code" means any non-source
 * form of a work.
 *
 *   A "Standard Interface" means an interface that either is an official
 * standard defined by a recognized standards body, or, in the case of
 * interfaces specified for a particular programming language, one that
 * is widely used among developers working in that language.
 *
 *   The "System Libraries" of an executable work include anything, other
 * than the work as a whole, that (a) is included in the normal form of
 * packaging a Major Component, but which is not part of that Major
 * Component, and (b) serves only to enable use of the work with that
 * Major Component, or to implement a Standard Interface for which an
 * implementation is available to the public in source code form.  A
 * "Major Component", in this context, means a major essential component
 * (kernel, window system, and so on) of the specific operating system
 * (if any) on which the executable work runs, or a compiler used to
 * produce the work, or an object code interpreter used to run it.
 *
 *   The "Corresponding Source" for a work in object code form means all
 * the source code needed to generate, install, and (for an executable
 * work) run the object code and to modify the work, including scripts to
 * control those activities.  However, it does not include the work's
 * System Libraries, or general-purpose tools or generally available free
 * programs which are used unmodified in performing those activities but
 * which are not part of the work.  For example, Corresponding Source
 * includes interface definition files associated with source files for
 * the work, and the source code for shared libraries and dynamically
 * linked subprograms that the work is specifically designed to require,
 * such as by intimate data communication or control flow between those
 * subprograms and other parts of the work.
 *
 *   The Corresponding Source need not include anything that users
 * can regenerate automatically from other parts of the Corresponding
 * Source.
 *
 *   The Corresponding Source for a work in source code form is that
 * same work.
 *
 *   2. Basic Permissions.
 *
 *   All rights granted under this License are granted for the term of
 * copyright on the Program, and are irrevocable provided the stated
 * conditions are met.  This License explicitly affirms your unlimited
 * permission to run the unmodified Program.  The output from running a
 * covered work is covered by this License only if the output, given its
 * content, constitutes a covered work.  This License acknowledges your
 * rights of fair use or other equivalent, as provided by copyright law.
 *
 *   You may make, run and propagate covered works that you do not
 * convey, without conditions so long as your license otherwise remains
 * in force.  You may convey covered works to others for the sole purpose
 * of having them make modifications exclusively for you, or provide you
 * with facilities for running those works, provided that you comply with
 * the terms of this License in conveying all material for which you do
 * not control copyright.  Those thus making or running the covered works
 * for you must do so exclusively on your behalf, under your direction
 * and control, on terms that prohibit them from making any copies of
 * your copyrighted material outside their relationship with you.
 *
 *   Conveying under any other circumstances is permitted solely under
 * the conditions stated below.  Sublicensing is not allowed; section 10
 * makes it unnecessary.
 *
 *   3. Protecting Users' Legal Rights From Anti-Circumvention Law.
 *
 *   No covered work shall be deemed part of an effective technological
 * measure under any applicable law fulfilling obligations under article
 * 11 of the WIPO copyright treaty adopted on 20 December 1996, or
 * similar laws prohibiting or restricting circumvention of such
 * measures.
 *
 *   When you convey a covered work, you waive any legal power to forbid
 * circumvention of technological measures to the extent such circumvention
 * is effected by exercising rights under this License with respect to
 * the covered work, and you disclaim any intention to limit operation or
 * modification of the work as a means of enforcing, against the work's
 * users, your or third parties' legal rights to forbid circumvention of
 * technological measures.
 *
 *   4. Conveying Verbatim Copies.
 *
 *   You may convey verbatim copies of the Program's source code as you
 * receive it, in any medium, provided that you conspicuously and
 * appropriately publish on each copy an appropriate copyright notice;
 * keep intact all notices stating that this License and any
 * non-permissive terms added in accord with section 7 apply to the code;
 * keep intact all notices of the absence of any warranty; and give all
 * recipients a copy of this License along with the Program.
 *
 *   You may charge any price or no price for each copy that you convey,
 * and you may offer support or warranty protection for a fee.
 *
 *   5. Conveying Modified Source Versions.
 *
 *   You may convey a work based on the Program, or the modifications to
 * produce it from the Program, in the form of source code under the
 * terms of section 4, provided that you also meet all of these conditions:
 *
 *     a) The work must carry prominent notices stating that you modified
 *     it, and giving a relevant date.
 *
 *     b) The work must carry prominent notices stating that it is
 *     released under this License and any conditions added under section
 *     7.  This requirement modifies the requirement in section 4 to
 *     "keep intact all notices".
 *
 *     c) You must license the entire work, as a whole, under this
 *     License to anyone who comes into possession of a copy.  This
 *     License will therefore apply, along with any applicable section 7
 *     additional terms, to the whole of the work, and all its parts,
 *     regardless of how they are packaged.  This License gives no
 *     permission to license the work in any other way, but it does not
 *     invalidate such permission if you have separately received it.
 *
 *     d) If the work has interactive user interfaces, each must display
 *     Appropriate Legal Notices; however, if the Program has interactive
 *     interfaces that do not display Appropriate Legal Notices, your
 *     work need not make them do so.
 *
 *   A compilation of a covered work with other separate and independent
 * works, which are not by their nature extensions of the covered work,
 * and which are not combined with it such as to form a larger program,
 * in or on a volume of a storage or distribution medium, is called an
 * "aggregate" if the compilation and its resulting copyright are not
 * used to limit the access or legal rights of the compilation's users
 * beyond what the individual works permit.  Inclusion of a covered work
 * in an aggregate does not cause this License to apply to the other
 * parts of the aggregate.
 *
 *   6. Conveying Non-Source Forms.
 *
 *   You may convey a covered work in object code form under the terms
 * of sections 4 and 5, provided that you also convey the
 * machine-readable Corresponding Source under the terms of this License,
 * in one of these ways:
 *
 *     a) Convey the object code in, or embodied in, a physical product
 *     (including a physical distribution medium), accompanied by the
 *     Corresponding Source fixed on a durable physical medium
 *     customarily used for software interchange.
 *
 *     b) Convey the object code in, or embodied in, a physical product
 *     (including a physical distribution medium), accompanied by a
 *     written offer, valid for at least three years and valid for as
 *     long as you offer spare parts or customer support for that product
 *     model, to give anyone who possesses the object code either (1) a
 *     copy of the Corresponding Source for all the software in the
 *     product that is covered by this License, on a durable physical
 *     medium customarily used for software interchange, for a price no
 *     more than your reasonable cost of physically performing this
 *     conveying of source, or (2) access to copy the
 *     Corresponding Source from a network server at no charge.
 *
 *     c) Convey individual copies of the object code with a copy of the
 *     written offer to provide the Corresponding Source.  This
 *     alternative is allowed only occasionally and noncommercially, and
 *     only if you received the object code with such an offer, in accord
 *     with subsection 6b.
 *
 *     d) Convey the object code by offering access from a designated
 *     place (gratis or for a charge), and offer equivalent access to the
 *     Corresponding Source in the same way through the same place at no
 *     further charge.  You need not require recipients to copy the
 *     Corresponding Source along with the object code.  If the place to
 *     copy the object code is a network server, the Corresponding Source
 *     may be on a different server (operated by you or a third party)
 *     that supports equivalent copying facilities, provided you maintain
 *     clear directions next to the object code saying where to find the
 *     Corresponding Source.  Regardless of what server hosts the
 *     Corresponding Source, you remain obligated to ensure that it is
 *     available for as long as needed to satisfy these requirements.
 *
 *     e) Convey the object code using peer-to-peer transmission, provided
 *     you inform other peers where the object code and Corresponding
 *     Source of the work are being offered to the general public at no
 *     charge under subsection 6d.
 *
 *   A separable portion of the object code, whose source code is excluded
 * from the Corresponding Source as a System Library, need not be
 * included in conveying the object code work.
 *
 *   A "User Product" is either (1) a "consumer product", which means any
 * tangible personal property which is normally used for personal, family,
 * or household purposes, or (2) anything designed or sold for incorporation
 * into a dwelling.  In determining whether a product is a consumer product,
 * doubtful cases shall be resolved in favor of coverage.  For a particular
 * product received by a particular user, "normally used" refers to a
 * typical or common use of that class of product, regardless of the status
 * of the particular user or of the way in which the particular user
 * actually uses, or expects or is expected to use, the product.  A product
 * is a consumer product regardless of whether the product has substantial
 * commercial, industrial or non-consumer uses, unless such uses represent
 * the only significant mode of use of the product.
 *
 *   "Installation Information" for a User Product means any methods,
 * procedures, authorization keys, or other information required to install
 * and execute modified versions of a covered work in that User Product from
 * a modified version of its Corresponding Source.  The information must
 * suffice to ensure that the continued functioning of the modified object
 * code is in no case prevented or interfered with solely because
 * modification has been made.
 *
 *   If you convey an object code work under this section in, or with, or
 * specifically for use in, a User Product, and the conveying occurs as
 * part of a transaction in which the right of possession and use of the
 * User Product is transferred to the recipient in perpetuity or for a
 * fixed term (regardless of how the transaction is characterized), the
 * Corresponding Source conveyed under this section must be accompanied
 * by the Installation Information.  But this requirement does not apply
 * if neither you nor any third party retains the ability to install
 * modified object code on the User Product (for example, the work has
 * been installed in ROM).
 *
 *   The requirement to provide Installation Information does not include a
 * requirement to continue to provide support service, warranty, or updates
 * for a work that has been modified or installed by the recipient, or for
 * the User Product in which it has been modified or installed.  Access to a
 * network may be denied when the modification itself materially and
 * adversely affects the operation of the network or violates the rules and
 * protocols for communication across the network.
 *
 *   Corresponding Source conveyed, and Installation Information provided,
 * in accord with this section must be in a format that is publicly
 * documented (and with an implementation available to the public in
 * source code form), and must require no special password or key for
 * unpacking, reading or copying.
 *
 *   7. Additional Terms.
 *
 *   "Additional permissions" are terms that supplement the terms of this
 * License by making exceptions from one or more of its conditions.
 * Additional permissions that are applicable to the entire Program shall
 * be treated as though they were included in this License, to the extent
 * that they are valid under applicable law.  If additional permissions
 * apply only to part of the Program, that part may be used separately
 * under those permissions, but the entire Program remains governed by
 * this License without regard to the additional permissions.
 *
 *   When you convey a copy of a covered work, you may at your option
 * remove any additional permissions from that copy, or from any part of
 * it.  (Additional permissions may be written to require their own
 * removal in certain cases when you modify the work.)  You may place
 * additional permissions on material, added by you to a covered work,
 * for which you have or can give appropriate copyright permission.
 *
 *   Notwithstanding any other provision of this License, for material you
 * add to a covered work, you may (if authorized by the copyright holders of
 * that material) supplement the terms of this License with terms:
 *
 *     a) Disclaiming warranty or limiting liability differently from the
 *     terms of sections 15 and 16 of this License; or
 *
 *     b) Requiring preservation of specified reasonable legal notices or
 *     author attributions in that material or in the Appropriate Legal
 *     Notices displayed by works containing it; or
 *
 *     c) Prohibiting misrepresentation of the origin of that material, or
 *     requiring that modified versions of such material be marked in
 *     reasonable ways as different from the original version; or
 *
 *     d) Limiting the use for publicity purposes of names of licensors or
 *     authors of the material; or
 *
 *     e) Declining to grant rights under trademark law for use of some
 *     trade names, trademarks, or service marks; or
 *
 *     f) Requiring indemnification of licensors and authors of that
 *     material by anyone who conveys the material (or modified versions of
 *     it) with contractual assumptions of liability to the recipient, for
 *     any liability that these contractual assumptions directly impose on
 *     those licensors and authors.
 *
 *   All other non-permissive additional terms are considered "further
 * restrictions" within the meaning of section 10.  If the Program as you
 * received it, or any part of it, contains a notice stating that it is
 * governed by this License along with a term that is a further
 * restriction, you may remove that term.  If a license document contains
 * a further restriction but permits relicensing or conveying under this
 * License, you may add to a covered work material governed by the terms
 * of that license document, provided that the further restriction does
 * not survive such relicensing or conveying.
 *
 *   If you add terms to a covered work in accord with this section, you
 * must place, in the relevant source files, a statement of the
 * additional terms that apply to those files, or a notice indicating
 * where to find the applicable terms.
 *
 *   Additional terms, permissive or non-permissive, may be stated in the
 * form of a separately written license, or stated as exceptions;
 * the above requirements apply either way.
 *
 *   8. Termination.
 *
 *   You may not propagate or modify a covered work except as expressly
 * provided under this License.  Any attempt otherwise to propagate or
 * modify it is void, and will automatically terminate your rights under
 * this License (including any patent licenses granted under the third
 * paragraph of section 11).
 *
 *   However, if you cease all violation of this License, then your
 * license from a particular copyright holder is reinstated (a)
 * provisionally, unless and until the copyright holder explicitly and
 * finally terminates your license, and (b) permanently, if the copyright
 * holder fails to notify you of the violation by some reasonable means
 * prior to 60 days after the cessation.
 *
 *   Moreover, your license from a particular copyright holder is
 * reinstated permanently if the copyright holder notifies you of the
 * violation by some reasonable means, this is the first time you have
 * received notice of violation of this License (for any work) from that
 * copyright holder, and you cure the violation prior to 30 days after
 * your receipt of the notice.
 *
 *   Termination of your rights under this section does not terminate the
 * licenses of parties who have received copies or rights from you under
 * this License.  If your rights have been terminated and not permanently
 * reinstated, you do not qualify to receive new licenses for the same
 * material under section 10.
 *
 *   9. Acceptance Not Required for Having Copies.
 *
 *   You are not required to accept this License in order to receive or
 * run a copy of the Program.  Ancillary propagation of a covered work
 * occurring solely as a consequence of using peer-to-peer transmission
 * to receive a copy likewise does not require acceptance.  However,
 * nothing other than this License grants you permission to propagate or
 * modify any covered work.  These actions infringe copyright if you do
 * not accept this License.  Therefore, by modifying or propagating a
 * covered work, you indicate your acceptance of this License to do so.
 *
 *   10. Automatic Licensing of Downstream Recipients.
 *
 *   Each time you convey a covered work, the recipient automatically
 * receives a license from the original licensors, to run, modify and
 * propagate that work, subject to this License.  You are not responsible
 * for enforcing compliance by third parties with this License.
 *
 *   An "entity transaction" is a transaction transferring control of an
 * organization, or substantially all assets of one, or subdividing an
 * organization, or merging organizations.  If propagation of a covered
 * work results from an entity transaction, each party to that
 * transaction who receives a copy of the work also receives whatever
 * licenses to the work the party's predecessor in interest had or could
 * give under the previous paragraph, plus a right to possession of the
 * Corresponding Source of the work from the predecessor in interest, if
 * the predecessor has it or can get it with reasonable efforts.
 *
 *   You may not impose any further restrictions on the exercise of the
 * rights granted or affirmed under this License.  For example, you may
 * not impose a license fee, royalty, or other charge for exercise of
 * rights granted under this License, and you may not initiate litigation
 * (including a cross-claim or counterclaim in a lawsuit) alleging that
 * any patent claim is infringed by making, using, selling, offering for
 * sale, or importing the Program or any portion of it.
 *
 *   11. Patents.
 *
 *   A "contributor" is a copyright holder who authorizes use under this
 * License of the Program or a work on which the Program is based.  The
 * work thus licensed is called the contributor's "contributor version".
 *
 *   A contributor's "essential patent claims" are all patent claims
 * owned or controlled by the contributor, whether already acquired or
 * hereafter acquired, that would be infringed by some manner, permitted
 * by this License, of making, using, or selling its contributor version,
 * but do not include claims that would be infringed only as a
 * consequence of further modification of the contributor version.  For
 * purposes of this definition, "control" includes the right to grant
 * patent sublicenses in a manner consistent with the requirements of
 * this License.
 *
 *   Each contributor grants you a non-exclusive, worldwide, royalty-free
 * patent license under the contributor's essential patent claims, to
 * make, use, sell, offer for sale, import and otherwise run, modify and
 * propagate the contents of its contributor version.
 *
 *   In the following three paragraphs, a "patent license" is any express
 * agreement or commitment, however denominated, not to enforce a patent
 * (such as an express permission to practice a patent or covenant not to
 * sue for patent infringement).  To "grant" such a patent license to a
 * party means to make such an agreement or commitment not to enforce a
 * patent against the party.
 *
 *   If you convey a covered work, knowingly relying on a patent license,
 * and the Corresponding Source of the work is not available for anyone
 * to copy, free of charge and under the terms of this License, through a
 * publicly available network server or other readily accessible means,
 * then you must either (1) cause the Corresponding Source to be so
 * available, or (2) arrange to deprive yourself of the benefit of the
 * patent license for this particular work, or (3) arrange, in a manner
 * consistent with the requirements of this License, to extend the patent
 * license to downstream recipients.  "Knowingly relying" means you have
 * actual knowledge that, but for the patent license, your conveying the
 * covered work in a country, or your recipient's use of the covered work
 * in a country, would infringe one or more identifiable patents in that
 * country that you have reason to believe are valid.
 *
 *   If, pursuant to or in connection with a single transaction or
 * arrangement, you convey, or propagate by procuring conveyance of, a
 * covered work, and grant a patent license to some of the parties
 * receiving the covered work authorizing them to use, propagate, modify
 * or convey a specific copy of the covered work, then the patent license
 * you grant is automatically extended to all recipients of the covered
 * work and works based on it.
 *
 *   A patent license is "discriminatory" if it does not include within
 * the scope of its coverage, prohibits the exercise of, or is
 * conditioned on the non-exercise of one or more of the rights that are
 * specifically granted under this License.  You may not convey a covered
 * work if you are a party to an arrangement with a third party that is
 * in the business of distributing software, under which you make payment
 * to the third party based on the extent of your activity of conveying
 * the work, and under which the third party grants, to any of the
 * parties who would receive the covered work from you, a discriminatory
 * patent license (a) in connection with copies of the covered work
 * conveyed by you (or copies made from those copies), or (b) primarily
 * for and in connection with specific products or compilations that
 * contain the covered work, unless you entered into that arrangement,
 * or that patent license was granted, prior to 28 March 2007.
 *
 *   Nothing in this License shall be construed as excluding or limiting
 * any implied license or other defenses to infringement that may
 * otherwise be available to you under applicable patent law.
 *
 *   12. No Surrender of Others' Freedom.
 *
 *   If conditions are imposed on you (whether by court order, agreement or
 * otherwise) that contradict the conditions of this License, they do not
 * excuse you from the conditions of this License.  If you cannot convey a
 * covered work so as to satisfy simultaneously your obligations under this
 * License and any other pertinent obligations, then as a consequence you may
 * not convey it at all.  For example, if you agree to terms that obligate you
 * to collect a royalty for further conveying from those to whom you convey
 * the Program, the only way you could satisfy both those terms and this
 * License would be to refrain entirely from conveying the Program.
 *
 *   13. Use with the GNU Affero General Public License.
 *
 *   Notwithstanding any other provision of this License, you have
 * permission to link or combine any covered work with a work licensed
 * under version 3 of the GNU Affero General Public License into a single
 * combined work, and to convey the resulting work.  The terms of this
 * License will continue to apply to the part which is the covered work,
 * but the special requirements of the GNU Affero General Public License,
 * section 13, concerning interaction through a network will apply to the
 * combination as such.
 *
 *   14. Revised Versions of this License.
 *
 *   The Free Software Foundation may publish revised and/or new versions of
 * the GNU General Public License from time to time.  Such new versions will
 * be similar in spirit to the present version, but may differ in detail to
 * address new problems or concerns.
 *
 *   Each version is given a distinguishing version number.  If the
 * Program specifies that a certain numbered version of the GNU General
 * Public License "or any later version" applies to it, you have the
 * option of following the terms and conditions either of that numbered
 * version or of any later version published by the Free Software
 * Foundation.  If the Program does not specify a version number of the
 * GNU General Public License, you may choose any version ever published
 * by the Free Software Foundation.
 *
 *   If the Program specifies that a proxy can decide which future
 * versions of the GNU General Public License can be used, that proxy's
 * public statement of acceptance of a version permanently authorizes you
 * to choose that version for the Program.
 *
 *   Later license versions may give you additional or different
 * permissions.  However, no additional obligations are imposed on any
 * author or copyright holder as a result of your choosing to follow a
 * later version.
 *
 *   15. Disclaimer of Warranty.
 *
 *   THERE IS NO WARRANTY FOR THE PROGRAM, TO THE EXTENT PERMITTED BY
 * APPLICABLE LAW.  EXCEPT WHEN OTHERWISE STATED IN WRITING THE COPYRIGHT
 * HOLDERS AND/OR OTHER PARTIES PROVIDE THE PROGRAM "AS IS" WITHOUT WARRANTY
 * OF ANY KIND, EITHER EXPRESSED OR IMPLIED, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE.  THE ENTIRE RISK AS TO THE QUALITY AND PERFORMANCE OF THE PROGRAM
 * IS WITH YOU.  SHOULD THE PROGRAM PROVE DEFECTIVE, YOU ASSUME THE COST OF
 * ALL NECESSARY SERVICING, REPAIR OR CORRECTION.
 *
 *   16. Limitation of Liability.
 *
 *   IN NO EVENT UNLESS REQUIRED BY APPLICABLE LAW OR AGREED TO IN WRITING
 * WILL ANY COPYRIGHT HOLDER, OR ANY OTHER PARTY WHO MODIFIES AND/OR CONVEYS
 * THE PROGRAM AS PERMITTED ABOVE, BE LIABLE TO YOU FOR DAMAGES, INCLUDING ANY
 * GENERAL, SPECIAL, INCIDENTAL OR CONSEQUENTIAL DAMAGES ARISING OUT OF THE
 * USE OR INABILITY TO USE THE PROGRAM (INCLUDING BUT NOT LIMITED TO LOSS OF
 * DATA OR DATA BEING RENDERED INACCURATE OR LOSSES SUSTAINED BY YOU OR THIRD
 * PARTIES OR A FAILURE OF THE PROGRAM TO OPERATE WITH ANY OTHER PROGRAMS),
 * EVEN IF SUCH HOLDER OR OTHER PARTY HAS BEEN ADVISED OF THE POSSIBILITY OF
 * SUCH DAMAGES.
 *
 *   17. Interpretation of Sections 15 and 16.
 *
 *   If the disclaimer of warranty and limitation of liability provided
 * above cannot be given local legal effect according to their terms,
 * reviewing courts shall apply local law that most closely approximates
 * an absolute waiver of all civil liability in connection with the
 * Program, unless a warranty or assumption of liability accompanies a
 * copy of the Program in return for a fee.
 *
 *                      END OF TERMS AND CONDITIONS
 *
 *             How to Apply These Terms to Your New Programs
 *
 *   If you develop a new program, and you want it to be of the greatest
 * possible use to the public, the best way to achieve this is to make it
 * free software which everyone can redistribute and change under these terms.
 *
 *   To do so, attach the following notices to the program.  It is safest
 * to attach them to the start of each source file to most effectively
 * state the exclusion of warranty; and each file should have at least
 * the "copyright" line and a pointer to where the full notice is found.
 *
 *     <one line to give the program's name and a brief idea of what it does.>
 *     Copyright (C) <year>  <name of author>
 *
 *     This program is free software: you can redistribute it and/or modify
 *     it under the terms of the GNU General Public License as published by
 *     the Free Software Foundation, either version 3 of the License, or
 *     (at your option) any later version.
 *
 *     This program is distributed in the hope that it will be useful,
 *     but WITHOUT ANY WARRANTY; without even the implied warranty of
 *     MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *     GNU General Public License for more details.
 *
 *     You should have received a copy of the GNU General Public License
 *     along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * Also add information on how to contact you by electronic and paper mail.
 *
 *   If the program does terminal interaction, make it output a short
 * notice like this when it starts in an interactive mode:
 *
 *     <program>  Copyright (C) <year>  <name of author>
 *     This program comes with ABSOLUTELY NO WARRANTY; for details type `show w'.
 *     This is free software, and you are welcome to redistribute it
 *     under certain conditions; type `show c' for details.
 *
 * The hypothetical commands `show w' and `show c' should show the appropriate
 * parts of the General Public License.  Of course, your program's commands
 * might be different; for a GUI interface, you would use an "about box".
 *
 *   You should also get your employer (if you work as a programmer) or school,
 * if any, to sign a "copyright disclaimer" for the program, if necessary.
 * For more information on this, and how to apply and follow the GNU GPL, see
 * <https://www.gnu.org/licenses/>.
 *
 *   The GNU General Public License does not permit incorporating your program
 * into proprietary programs.  If your program is a subroutine library, you
 * may consider it more useful to permit linking proprietary applications with
 * the library.  If this is what you want to do, use the GNU Lesser General
 * Public License instead of this License.  But first, please read
 * <https://www.gnu.org/licenses/why-not-lgpl.html>.
 */
