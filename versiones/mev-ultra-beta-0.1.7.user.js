// ==UserScript==
// @name         MEV Ultra - Indice unificado + descarga de expedientes de la MEV
// @namespace    https://mev.scba.gov.ar/
// @version      0.1.7
// @description  La version completa. Incluye TODO MEV+ (baja el expediente en un PDF unico respetando la presentacion original y conviviendo con la validacion anti-bot) y le suma el INDICE: recorre tus Sets pasando por cada jurisdiccion y arma en tu maquina una tabla unica con todas tus causas de todos los departamentos y fueros, buscable, ordenable y exportable a CSV. Si solo queres bajar expedientes, instala MEV+ en lugar de esta. No instales las dos a la vez.
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
// @connect      docs.scba.gov.ar
// @connect      mev.scba.gov.ar
// @require      https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js
// @require      https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js
// ==/UserScript==
/*
 * MEV Ultra - Indice unificado + descarga de expedientes de la MEV
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
 * ESTRUCTURA RELEVADA (agosto 2026)
 *   procesales.asp   table con Fecha | Fojas | Firmado | Descripción,
 *                    cada fila enlaza a proveido.asp (orden descendente)
 *   proveido.asp     #imprime = bloque imprimible completo
 *                    #contenidoTxt = texto del escrito o la resolución
 *   adjuntos         docs.scba.gov.ar/Documentos — OTRO HOST, por eso hace
 *                    falta GM_xmlhttpRequest y no alcanza un fetch
 */
/* global PDFLib, html2canvas */
(function () {
  'use strict';

  // MEV Ultra incluye todo MEV+. Este es ese modulo, y sigue trabajando solo
  // en la pantalla del expediente. El modulo de indice va al final del archivo.
  // Si alguien tiene instaladas MEV+ y MEV Ultra al mismo tiempo, en esta
  // pantalla se van a dibujar dos paneles: hay que dejar una sola.
  if (!/\/procesales\.asp/i.test(location.pathname)) return;
  if (window.__MEV_DESCARGA_ACTIVA__) return;
  window.__MEV_DESCARGA_ACTIVA__ = true;

  // Datos de la pestaña About. Editá acá el GitHub cuando tengas el repo.
  const APP = {
    nombre: 'MEV Ultra',
    version: 'beta 0.1.7',
    autor: 'Ignacio Kinbaum',
    anio: '2026',
    mail: 'estudiojuridicokinbaum@gmail.com',
    licencia: 'GPL-3.0-or-later',
    licenciaUrl: 'https://www.gnu.org/licenses/gpl-3.0.html',
    github: 'https://github.com/Elzas85/MEVULTRA'
  };

  const CONFIG = {
    escala: 2, // resolución de la captura (2 ≈ 190 dpi)
    calidadJpeg: 0.78, // 0.78 mantiene legible el cuerpo del texto
    anchoRender: 1000, // px de viewport para renderizar el proveído
    capaTextoBuscable: true,

    // Caídas del servidor (5xx, red)
    reintentos: 5,
    backoffBaseMs: 1500,
    backoffMaxMs: 30000,

    // Ritmo. La validación anti-bot se dispara por velocidad, así que el
    // paso se ajusta solo: se frena cuando la MEV protesta y recién
    // acelera tras una racha limpia.
    pausaBaseMs: 450,
    pausaMaxMs: 6000,
    jitter: 0.4, // ±40% para no marcar un pulso de máquina
    descansoCada: 25, // actuaciones
    descansoMs: 6000,

    // Portero anti-bot
    esperaValidacionBaseMs: 5000,
    esperaValidacionMaxMs: 60000,
    reintentosValidacion: 6, // ≈ 3 min antes de pedir ayuda humana
    limiteMarcoMs: 45000, // tope para que el marco atraviese el desafío
    sondeoManualMs: 10000, // cada cuánto se chequea durante la espera manual
    precalentadoOpacoMs: 8000 // marco a otro host (docs) para dejar la cookie
  };

  const SEL = {
    linkActuacion: 'a[href*="proveido.asp"]',
    imprimible: '#imprime',
    contenido: '#contenidoTxt',
    adjunto: 'a[href*="docs.scba.gov.ar/Documentos"], a[href*="/Documentos?"]'
  };

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

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const limpiar = (s) => (s || '').replace(/[ \t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const log = (...a) => console.log('%c[MEV]', 'color:#0a6;font-weight:bold', ...a);
  const backoff = (i) => Math.min(CONFIG.backoffBaseMs * Math.pow(2, i - 1), CONFIG.backoffMaxMs);

  function aWinAnsi(s) {
    return (s || '')
      .replace(/[‘’´`]/g, "'").replace(/[“”]/g, '"')
      .replace(/[–—]/g, '-').replace(/…/g, '...')
      // eslint-disable-next-line no-control-regex -- \x0A es intencional: conserva el salto de linea
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
  const corrida = { cancelado: false, procesadas: 0 };

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
    bloqueo: null, // promesa viva mientras se atraviesa la validación
    esperas: 0, // cuántas veces frenó la corrida
    segundos: 0, // cuánto se perdió esperando, en total
    pausa: CONFIG.pausaBaseMs,
    aciertos: 0
  };

  /**
   * ¿Esto es el cartel de validación o el expediente? El orden importa:
   * si el HTML trae las marcas del proveído y ninguna huella del portero,
   * es contenido bueno; recién después se buscan las huellas.
   */
  function esPantallaValidacion(html) {
    if (!html || !html.trim()) return true; // respuesta vacía: portero
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
          await sleep(220); // que terminen de pintar sellos e imágenes
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
        if (!pasó) pasó = await sondear(url); // por si el marco viene bloqueado por cabeceras
      } else {
        // Otro host (docs.scba.gov.ar): no se puede leer el marco, pero
        // cargarlo igual deja la cookie de ese dominio.
        const marco = crearMarco();
        marco.src = url;
        await sleep(CONFIG.precalentadoOpacoMs);
        marco.remove();
        pasó = true; // se verifica al reintentar la descarga
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
      if (portero.bloqueo) await portero.bloqueo; // nadie pasa mientras hay validación
      if (i > 0) await esperarConCuenta(backoff(i), `MEV caída — reintento ${i}/${CONFIG.reintentos} en`);
      try {
        const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
        if ([429, 500, 502, 503, 504].includes(res.status)) { ultimo = new Error('HTTP ' + res.status); continue; }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const buf = await res.arrayBuffer();
        await pausaAdaptativa();
        return new TextDecoder('windows-1252').decode(buf);
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
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return false; // PNG
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) return false; // JPEG
    const ct = ((headers.match(/content-type:\s*([^\r\n;]+)/i) || [])[1] || '').toLowerCase();
    if (ct && !/html|text|xml/.test(ct)) return false; // binario raro, pero binario
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

  async function fotografiar(doc) {
    const objetivo = doc.querySelector(SEL.imprimible) || doc.body;
    return html2canvas(objetivo, {
      scale: CONFIG.escala,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      windowWidth: CONFIG.anchoRender,
      width: objetivo.scrollWidth,
      height: objetivo.scrollHeight
    });
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
        lienzo: null,
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
      // ficha igual y un adjunto perdido es una foja perdida.
      const enImprime = [...(doc.querySelector(SEL.imprimible) || doc).querySelectorAll(SEL.adjunto)];
      const encontrados = enImprime.length ? enImprime : [...doc.querySelectorAll(SEL.adjunto)];
      const vistas = new Set();
      act.adjuntos = encontrados
        .filter((a) => a.href && !vistas.has(a.href) && vistas.add(a.href))
        .map((a) => ({ url: a.href, etiqueta: limpiar(a.innerText) || 'adjunto' }));

      if (capturar) {
        try {
          act.lienzo = docVivo ? await fotografiar(docVivo) : await capturarProveido(html);
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

  async function bajarAdjunto(act, adj, orden) {
    try {
      const { bytes, headers } = await pedirBinarioConReintento(adj.url);
      const ct = ((headers.match(/content-type:\s*([^\r\n;]+)/i) || [])[1] || '').toLowerCase();
      const cd = (headers.match(/filename\*?=(?:UTF-8'')?"?([^"\r\n;]+)/i) || [])[1] || '';
      const magic = String.fromCharCode.apply(null, bytes.slice(0, 4));
      adj.bytes = bytes;
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
  const M = 40;

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
   * Vuelca la captura al PDF. Si el proveído es más alto que una A4 se
   * corta en tramos del alto de página, sin reescalar: el texto conserva
   * el mismo cuerpo en todas las páginas.
   */
  async function volcarLienzo(pdf, lienzo, textoBuscable, fuente) {
    const anchoUtil = A4[0] - M * 2;
    const escala = anchoUtil / lienzo.width;
    const altoUtil = A4[1] - M * 2;
    const altoTramoPx = Math.floor(altoUtil / escala);
    const tramos = Math.max(1, Math.ceil(lienzo.height / altoTramoPx));
    const paginas = [];
    for (let t = 0; t < tramos; t++) {
      const alto = Math.min(altoTramoPx, lienzo.height - t * altoTramoPx);
      const corte = document.createElement('canvas');
      corte.width = lienzo.width;
      corte.height = alto;
      corte.getContext('2d').drawImage(lienzo, 0, t * altoTramoPx, lienzo.width, alto, 0, 0, lienzo.width, alto);
      const dataUrl = corte.toDataURL('image/jpeg', CONFIG.calidadJpeg);
      const img = await pdf.embedJpg(dataUrl);
      const pagina = pdf.addPage(A4);
      pagina.drawImage(img, {
        x: M, y: A4[1] - M - alto * escala,
        width: anchoUtil, height: alto * escala
      });
      paginas.push(pagina);
    }
    // Capa invisible: mantiene el Ctrl+F sobre una página que es imagen.
    if (CONFIG.capaTextoBuscable && textoBuscable && paginas.length) {
      try {
        const lineas = envolver(textoBuscable, fuente, 7, A4[0] - M * 2);
        let p = 0, y = A4[1] - M;
        for (const l of lineas) {
          if (y < M) { p++; y = A4[1] - M; if (p >= paginas.length) break; }
          if (l) paginas[p].drawText(l, { x: M, y, size: 7, font: fuente, opacity: 0 });
          y -= 9;
        }
      } catch (e) { log('capa de texto omitida', e); }
    }
    return paginas.length;
  }

  async function armarPdf(datos, actuaciones) {
    const cuerpo = await PDFDocument.create();
    const f = {
      normal: await cuerpo.embedFont(StandardFonts.Helvetica),
      bold: await cuerpo.embedFont(StandardFonts.HelveticaBold)
    };
    const indice = [];

    for (const [n, act] of actuaciones.entries()) {
      const desde = cuerpo.getPageCount() + 1;
      if (act.lienzo) {
        await volcarLienzo(cuerpo, act.lienzo, act.texto, f.normal);
        act.lienzo = null; // liberar memoria: 370 lienzos no entran juntos
      } else {
        // Sin captura, al menos no se pierde el contenido.
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

      for (const adj of act.adjuntos) {
        if (!adj.bytes) continue;
        try {
          if (adj.tipo === 'pdf') {
            // Se copian las páginas del original: nada se recompone.
            const src = await PDFDocument.load(adj.bytes, { ignoreEncryption: true });
            const pgs = await cuerpo.copyPages(src, src.getPageIndices());
            pgs.forEach((p) => cuerpo.addPage(p));
          } else if (adj.tipo === 'imagen') {
            const img = /png/.test(adj.contentType)
              ? await cuerpo.embedPng(adj.bytes) : await cuerpo.embedJpg(adj.bytes);
            const pag = cuerpo.addPage(A4);
            const esc = Math.min((A4[0] - M * 2) / img.width, (A4[1] - M * 2) / img.height, 1);
            pag.drawImage(img, {
              x: (A4[0] - img.width * esc) / 2, y: (A4[1] - img.height * esc) / 2,
              width: img.width * esc, height: img.height * esc
            });
          } else {
            act.incidencias.push(`Adjunto en formato no fusionable (${adj.contentType || 'desconocido'}): ${adj.nombre}. Quedó bajado suelto.`);
          }
          adj.bytes = null;
        } catch (e) {
          act.incidencias.push(`No se pudo incorporar "${adj.nombre || adj.etiqueta}": ${e.message}`);
        }
      }

      indice.push({
        n: n + 1, fecha: act.fechaTexto.split(' ')[0],
        desc: act.descripcion, adj: act.adjuntos.length, pagina: desde
      });
      ui.progreso((n + 1) / actuaciones.length, `Armando PDF ${n + 1}/${actuaciones.length}`);
    }

    const incidencias = actuaciones.flatMap((a, i) =>
      a.incidencias.map((t) => `Actuación ${i + 1} — ${a.fechaTexto} — ${a.descripcion}\n    ${t}`));
    if (portero.esperas) {
      incidencias.unshift(`Validación anti-bot — la MEV interpuso ${portero.esperas} vez/veces la pantalla de verificación humana ` +
        `(${portero.segundos}s de espera en total). Las actuaciones afectadas se reintentaron; si alguna quedó sin captura figura más abajo.`);
    }
    if (incidencias.length) {
      const pag = cuerpo.addPage(A4);
      let y = A4[1] - M;
      pag.drawText('ANEXO — INCIDENCIAS DE LA DESCARGA', { x: M, y, size: 11, font: f.bold, color: rgb(0.6, 0.1, 0.1) });
      y -= 22;
      const cuerpoTxt = 'Lo que sigue no pudo incorporarse. Verificalo a mano en la MEV antes de dar el expediente por completo.\n\n' + incidencias.join('\n\n');
      for (const l of envolver(cuerpoTxt, f.normal, 9, A4[0] - M * 2)) {
        if (y < M) break;
        if (l) pag.drawText(l, { x: M, y, size: 9, font: f.normal });
        y -= 12;
      }
    }

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

    const final = await PDFDocument.create();
    for (const src of [frente, cuerpo]) {
      const cargado = await PDFDocument.load(await src.save());
      const pgs = await final.copyPages(cargado, cargado.getPageIndices());
      pgs.forEach((p) => final.addPage(p));
    }
    final.setTitle(aWinAnsi(datos.caratula || 'Expediente MEV'));
    final.setSubject(aWinAnsi(`Expediente ${datos.expediente} — ${datos.organismo}`));
    final.setCreator('MEV+ userscript');
    return new Blob([await final.save()], { type: 'application/pdf' });
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
    // La MEV lista de la más nueva a la más vieja: se invierte para que la
    // numeración y el PDF queden en orden cronológico.
    filas.sort((a, b) => (a.fecha ? a.fecha.getTime() : 0) - (b.fecha ? b.fecha.getTime() : 0));
    return filas;
  }

  /** Copia fresca de una entrada del catálogo para trabajar sin ensuciarla. */
  const nuevaActuacion = (m) => ({
    url: m.url, fecha: m.fecha, fechaTexto: m.fechaTexto,
    fojas: m.fojas, firmado: m.firmado, descripcion: m.descripcion,
    lienzo: null, texto: '', adjuntos: [], incidencias: []
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
    const url = URL.createObjectURL(blob);
    const porAncla = () => {
      const a = document.createElement('a');
      a.href = url; a.download = nombre;
      document.body.appendChild(a); a.click(); a.remove();
    };
    return new Promise((resolve) => {
      if (typeof GM_download !== 'function') { porAncla(); return resolve('ancla'); }
      let resuelto = false;
      const listo = (via) => { if (!resuelto) { resuelto = true; resolve(via); } };
      try {
        GM_download({
          url, name: nombre, saveAs: false,
          onload: () => listo('GM_download'),
          onerror: (e) => {
            log('GM_download falló, cayendo a <a download>', e);
            porAncla(); listo('ancla');
          },
          ontimeout: () => { porAncla(); listo('ancla'); }
        });
      } catch (e) {
        log('GM_download tiró excepción, cayendo a <a download>', e);
        porAncla(); listo('ancla');
      }
      setTimeout(() => { if (!resuelto) { porAncla(); listo('ancla-timeout'); } }, 15000);
    }).finally(() => setTimeout(() => URL.revokeObjectURL(url), 180000));
  }

  async function bajarExpediente() {
    if (ui.corriendo()) { corrida.cancelado = true; ui.estado('Cancelando — armo el PDF con lo que haya…'); return; }
    corrida.cancelado = false;
    corrida.procesadas = 0;
    portero.esperas = 0;
    portero.segundos = 0;
    portero.pausa = CONFIG.pausaBaseMs;
    portero.aciertos = 0;

    try {
      ui.corriendo(true);
      const catalogo = ui.catalogo() || construirCatalogo();
      if (!catalogo) { ui.estado('No encontré la tabla de actuaciones. ¿Estás en el listado de la causa?'); return; }
      const seleccion = ui.seleccion();
      if (!seleccion.length) { ui.estado('Elegí al menos una actuación de la lista.'); return; }
      const datos = datosExpediente();
      // Copias frescas de las elegidas: el catálogo guarda solo los datos de
      // la fila; el trabajo (captura, adjuntos) va en estas copias, así una
      // segunda corrida arranca limpia. Se respeta el orden cronológico.
      let actuaciones = seleccion.slice().sort((a, b) => a - b).map((i) => nuevaActuacion(catalogo[i]));
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
        if (corrida.cancelado && bajados) break;
        ui.progreso(bajados / Math.max(1, pend.length), `Bajando adjunto ${bajados + 1}/${pend.length}`);
        await bajarAdjunto(a, adj, orden);
        bajados++;
      }
      const ok = pend.filter(({ adj }) => adj.bytes).length;

      // 3) PDF: actuación, sus adjuntos, siguiente actuación.
      corrida.cancelado = false; // el armado no se cancela
      ui.estado('Armando el PDF…');
      const blob = await armarPdf(datos, actuaciones);
      await descargar(blob, `${carpeta}.pdf`);

      const inc = actuaciones.reduce((n, x) => n + x.incidencias.length, 0);
      ui.progreso(1,
        `Listo — ${carpeta}.pdf (${Math.round(blob.size / 1048576)} MB): ` +
        `${actuaciones.length} actuaciones y ${ok}/${pend.length} adjuntos` +
        (portero.esperas ? ` · ${portero.esperas} validación(es), ${portero.segundos}s de espera` : '') +
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
  const ui = (function () {
    const escapar = (s) => (s || '').replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const miniBtn = 'padding:4px 7px;cursor:pointer;background:#eef3f5;color:#12303a;border:1px solid #cbd8de;border-radius:4px;font-size:10px;font-weight:600';
    const tabBtn = 'flex:1;padding:6px 4px;cursor:pointer;background:transparent;border:0;border-bottom:2px solid transparent;font-size:12px;font-weight:600;color:#5a7581';
    const winBtn = 'width:22px;height:19px;line-height:1;padding:0;margin-left:1px;border:0;background:transparent;color:#5a7581;font-size:14px;cursor:pointer;border-radius:3px;font-weight:700';

    const aboutHTML =
      '<div style="font-size:12px;line-height:1.65;padding:4px 2px 2px">' +
      '<div style="font-weight:700;color:#0a4d68;font-size:13px">' + escapar(APP.nombre) + '</div>' +
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
      'background:#fff', 'border:1px solid #0a4d68', 'border-radius:8px',
      'box-shadow:0 6px 20px rgba(0,0,0,.28)', 'padding:11px 13px',
      'font:12px/1.45 system-ui,Segoe UI,sans-serif', 'width:360px', 'color:#12303a'
    ].join(';');
    caja.innerHTML =
      // Barra de título con controles de ventana
      '<div data-e="hdr" style="display:flex;justify-content:space-between;align-items:center">' +
      '<span data-e="titulo" style="font-weight:700;color:#0a4d68;cursor:pointer" title="Clic para minimizar/restaurar">Bajar expediente</span>' +
      '<span style="display:flex;gap:1px;flex:none">' +
      '<button data-e="min" title="Minimizar" style="' + winBtn + '">&#8211;</button>' +
      '<button data-e="max" title="Maximizar" style="' + winBtn + '">&#9633;</button>' +
      '<button data-e="cerrar" title="Cerrar" style="' + winBtn + '">&#10005;</button>' +
      '</span>' +
      '</div>' +
      '<div data-e="cuerpo" style="margin-top:8px">' +
      // Solapas
      '<div style="display:flex;gap:4px;margin-bottom:9px;border-bottom:1px solid #dbe4e8">' +
      '<button data-e="navDescargar" style="' + tabBtn + '">Descargar</button>' +
      '<button data-e="navAbout" style="' + tabBtn + '">About</button>' +
      '</div>' +
      // Solapa Descargar
      '<div data-e="tabDescargar">' +
      '<div style="display:flex;justify-content:flex-end;gap:11px;margin:-2px 0 5px">' +
      '<span data-e="recargar" title="Recargar la página (útil si la MEV está validando el acceso)" style="font-size:10px;font-weight:500;color:#0a6cab;cursor:pointer;text-decoration:underline">recargar página</span>' +
      '<span data-e="releer" title="Releer la lista de actuaciones sin recargar" style="font-size:10px;font-weight:500;color:#0a6cab;cursor:pointer;text-decoration:underline">releer lista</span>' +
      '</div>' +
      '<div data-e="estado" style="min-height:34px;color:#33505c">Listo para arrancar.</div>' +
      '<div style="background:#e3ebef;border-radius:3px;height:5px;margin:9px 0">' +
      '<div data-e="barra" style="background:#0a4d68;height:5px;width:0;border-radius:3px;transition:width .25s"></div></div>' +
      '<div data-e="ayuda" style="display:none;background:#fff6e5;border:1px solid #e0b25c;border-radius:6px;padding:8px;margin-bottom:8px">' +
      '<div data-e="ayudaTxt" style="font-size:11px;color:#6b4a10;margin-bottom:7px"></div>' +
      '<div style="display:flex;gap:6px">' +
      '<button data-e="abrir" style="flex:1;padding:5px;cursor:pointer;background:#e0b25c;color:#3b2a06;border:0;border-radius:4px;font-size:11px;font-weight:600">Abrir en otra pestaña</button>' +
      '<button data-e="seguir" style="flex:1;padding:5px;cursor:pointer;background:#0a4d68;color:#fff;border:0;border-radius:4px;font-size:11px;font-weight:600">Ya validé — seguir</button>' +
      '</div></div>' +
      '<input data-e="buscar" type="text" placeholder="Filtrar por fecha o texto…" ' +
      'style="width:100%;box-sizing:border-box;padding:5px;border:1px solid #b9c9d0;border-radius:4px;font-size:11px;margin-bottom:6px">' +
      '<div style="display:flex;gap:5px;align-items:center;margin-bottom:6px">' +
      '<button data-e="todas" style="' + miniBtn + '">Todas</button>' +
      '<button data-e="ninguna" style="' + miniBtn + '">Ninguna</button>' +
      '<button data-e="invertir" style="' + miniBtn + '">Invertir</button>' +
      '<span data-e="contador" style="margin-left:auto;font-size:11px;color:#5a7581">0 de 0</span>' +
      '</div>' +
      '<div style="display:flex;gap:5px;align-items:center;margin-bottom:8px;font-size:11px">' +
      '<span style="color:#5a7581">Fechas</span>' +
      '<input data-e="fdesde" type="date" style="flex:1;min-width:0;padding:3px;border:1px solid #b9c9d0;border-radius:4px;font-size:11px">' +
      '<span>a</span>' +
      '<input data-e="fhasta" type="date" style="flex:1;min-width:0;padding:3px;border:1px solid #b9c9d0;border-radius:4px;font-size:11px">' +
      '<button data-e="aplicarf" title="Marcar solo las actuaciones dentro del rango" style="' + miniBtn + '">Marcar</button>' +
      '</div>' +
      '<div data-e="lista" style="max-height:250px;overflow:auto;border:1px solid #dbe4e8;border-radius:5px;margin-bottom:8px;background:#fbfcfd"></div>' +
      '<button data-e="ir" style="width:100%;padding:8px;cursor:pointer;background:#0a4d68;color:#fff;border:0;border-radius:5px;font-weight:600">Bajar seleccionadas</button>' +
      '</div>' +
      // Solapa About
      '<div data-e="tabAbout" style="display:none">' + aboutHTML + '</div>' +
      '</div>'; // cierra cuerpo

    const q = (n) => caja.querySelector('[data-e="' + n + '"]');

    // ── Controles de ventana: minimizar / maximizar / cerrar ──
    const WKEY = '__mev_win';
    let estadoWin = 'normal';
    const pill = document.createElement('button');
    pill.textContent = '⬇ Bajar expediente';
    pill.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:2147483647;display:none;' +
      'padding:8px 12px;background:#0a4d68;color:#fff;border:0;border-radius:8px;cursor:pointer;' +
      'font:600 12px system-ui,Segoe UI,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.25)';
    function setEstadoWin(s) {
      estadoWin = s;
      if (s !== 'closed') { try { localStorage.setItem(WKEY, s); } catch (e) { /* sin persistencia */ } }
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
        if (e.target.closest('button')) return; // los botones de ventana no arrastran
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
        if (!arrastro && Math.abs(dx) + Math.abs(dy) < 4) return; // umbral: distingue click de arrastre
        arrastro = true; caja.style.userSelect = 'none';
        aplicarPos(ox + dx, oy + dy);
      }
      function onUp() {
        moviendo = false; caja.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (arrastro) {
          justDragged = true;
          try { localStorage.setItem(POSKEY, JSON.stringify({ left: parseInt(caja.style.left, 10), top: parseInt(caja.style.top, 10) })); } catch (e) { /* sin persistencia */ }
        }
      }
      try { const p = JSON.parse(localStorage.getItem(POSKEY)); if (p && typeof p.left === 'number') aplicarPos(p.left, p.top); } catch (e) { /* sin posicion guardada */ }
    }

    // Cambio de solapa: marca la activa y muestra su contenido.
    function irASolapa(cual) {
      const esAbout = cual === 'about';
      q('tabDescargar').style.display = esAbout ? 'none' : '';
      q('tabAbout').style.display = esAbout ? '' : 'none';
      const act = (btn, on) => {
        btn.style.color = on ? '#0a4d68' : '#5a7581';
        btn.style.borderBottomColor = on ? '#0a4d68' : 'transparent';
      };
      act(q('navDescargar'), !esAbout);
      act(q('navAbout'), esAbout);
    }
    let activa = false;
    let catalogoRef = null;

    const lista = () => q('lista');
    const filas = () => [...lista().querySelectorAll('label')];
    const visibles = () => filas().filter((l) => l.style.display !== 'none');

    function actualizarContador() {
      const total = catalogoRef ? catalogoRef.length : 0;
      const sel = lista().querySelectorAll('input:checked').length;
      q('contador').textContent = sel + ' de ' + total;
      if (!activa) q('ir').textContent = 'Bajar seleccionadas (' + sel + ')';
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
      // Los date-picker se acotan al rango real del expediente.
      const fechas = catalogoRef.map((m) => m.fecha).filter(Boolean);
      if (fechas.length) {
        const yyyymmdd = (f) => `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
        const min = yyyymmdd(fechas[0]), max = yyyymmdd(fechas[fechas.length - 1]);
        q('fdesde').min = q('fhasta').min = min;
        q('fdesde').max = q('fhasta').max = max;
      }
      // Se respeta el filtro vigente al re-renderizar.
      const t = q('buscar').value.trim().toLowerCase();
      if (t) filas().forEach((l) => { l.style.display = l.dataset.txt.includes(t) ? 'flex' : 'none'; });
      actualizarContador();
    }

    // Marca (tilda) las actuaciones dentro del rango de fechas y destilda el
    // resto. Alcanza a todo el catálogo, no solo a lo visible.
    function marcarPorFecha() {
      if (!catalogoRef) return;
      const d = q('fdesde').value ? new Date(q('fdesde').value + 'T00:00:00') : null;
      const h = q('fhasta').value ? new Date(q('fhasta').value + 'T23:59:59') : null;
      if (!d && !h) { api.estado('Poné al menos una fecha en el rango.'); return; }
      let n = 0;
      filas().forEach((l) => {
        const cb = l.querySelector('input');
        const f = catalogoRef[+cb.dataset.idx].fecha;
        cb.checked = !!(f && (!d || f >= d) && (!h || f <= h));
        if (cb.checked) n++;
      });
      actualizarContador();
      api.estado(`${n} actuación(es) en el rango de fechas.`);
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
        const btn = q('ir');
        if (b) { btn.textContent = 'Cancelar'; btn.style.background = '#8a2b2b'; }
        else { btn.style.background = '#0a4d68'; actualizarContador(); }
        ['todas', 'ninguna', 'invertir', 'buscar', 'releer', 'fdesde', 'fhasta', 'aplicarf'].forEach((n) => {
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
        if (justDragged) { justDragged = false; return; } // si venís de arrastrar, no minimiza
        setEstadoWin(estadoWin === 'min' ? 'normal' : 'min');
      });
      [q('min'), q('max'), q('cerrar')].forEach((b) => {
        b.addEventListener('mouseenter', () => { b.style.background = b === q('cerrar') ? '#f2c4c4' : '#e3ebef'; });
        b.addEventListener('mouseleave', () => { b.style.background = 'transparent'; });
      });
      habilitarArrastre('__mev_pos');
      try { const g = localStorage.getItem(WKEY); if (g === 'min' || g === 'max') setEstadoWin(g); } catch (e) { /* sin estado guardado */ }

      q('navDescargar').addEventListener('click', () => irASolapa('descargar'));
      q('navAbout').addEventListener('click', () => irASolapa('about'));
      irASolapa('descargar');

      q('ir').addEventListener('click', bajarExpediente);
      q('recargar').addEventListener('click', () => {
        if (activa && !confirm('Hay una descarga en curso. ¿Recargar igual? Se pierde el avance.')) return;
        sessionStorage.removeItem('mev_val_espera'); // recarga a mano = arranca limpio
        location.reload();
      });
      q('releer').addEventListener('click', () => { if (!activa) { renderLista(); api.estado('Lista actualizada.'); } });
      q('buscar').addEventListener('input', () => {
        const t = q('buscar').value.trim().toLowerCase();
        filas().forEach((l) => { l.style.display = (!t || l.dataset.txt.includes(t)) ? 'flex' : 'none'; });
      });
      // Todas / Ninguna / Invertir operan sobre lo visible: con un filtro
      // puesto, alcanzan solo a las filas que el filtro dejó a la vista.
      q('todas').addEventListener('click', () => { visibles().forEach((l) => { l.querySelector('input').checked = true; }); actualizarContador(); });
      q('ninguna').addEventListener('click', () => { visibles().forEach((l) => { l.querySelector('input').checked = false; }); actualizarContador(); });
      q('invertir').addEventListener('click', () => {
        visibles().forEach((l) => { const c = l.querySelector('input'); c.checked = !c.checked; });
        actualizarContador();
      });
      q('aplicarf').addEventListener('click', marcarPorFecha);

      const n = document.querySelectorAll(SEL.linkActuacion).length;
      if (n) {
        // Página buena: se arma la lista y no se toca nada más.
        sessionStorage.removeItem('mev_val_espera');
        renderLista();
        api.estado(`${catalogoRef ? catalogoRef.length : n} actuaciones. Destildá las que no quieras y bajá.`);
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

/* ===========================================================================
 * MEV Ultra - Modulo INDICE
 * Corre en POSLoguin.asp, Busqueda.asp y Resultados.asp.
 * El modulo de descarga de expedientes (el de MEV+) corre en Procesales.asp
 * y no se toca: son dos modulos independientes en el mismo archivo.
 * ---------------------------------------------------------------------------
 * Por que existe: la MEV filtra cada Set por la jurisdiccion en la que estas
 * parado. Un set con causas de varios departamentos muestra solo las del
 * departamento actual, y si no hay ninguna contesta "El Set seleccionado
 * contiene Expedientes de otra Jurisdiccion". Para ver todo hay que entrar y
 * salir de cada jurisdiccion. Este modulo hace ese recorrido una vez, guarda
 * el resultado en tu maquina, y despues te muestra todo junto.
 * =========================================================================== */
(function () {
  'use strict';

  const RUTA = location.pathname.toLowerCase();
  const EN_JURIS = RUTA.indexOf('/posloguin.asp') === 0;
  const EN_BUSQUEDA = RUTA.indexOf('/busqueda.asp') === 0;
  const EN_RESULTADOS = RUTA.indexOf('/resultados.asp') === 0;
  if (!EN_JURIS && !EN_BUSQUEDA && !EN_RESULTADOS) return;

  const VERDE = '#0a4d68';
  const APP = {
    nombre: 'MEV Ultra',
    version: 'beta 0.1.7',
    autor: 'Ignacio Kinbaum',
    anio: '2026',
    mail: 'estudiojuridicokinbaum@gmail.com',
    licencia: 'GPL-3.0-or-later',
    licenciaUrl: 'https://www.gnu.org/licenses/gpl-3.0.html',
    github: 'https://github.com/Elzas85/MEVULTRA'
  };
  const K = {
    sets: 'mevultra_sets',
    mapa: 'mevultra_mapa',
    indice: 'mevultra_indice',
    pos: 'mevultra_pos',
    min: 'mevultra_min',
    ritmo: 'mevultra_ritmo',
    tam: 'mevultra_tam'
  };

  // Jurisdicciones, relevadas de la pantalla de ingreso. TipoDto + DtoJudElegido
  // son los dos campos que definen donde estas parado.
  const DEPTOS = [
    ['80', 'Avellaneda-Lanus'], ['10', 'Azul'], ['11', 'Bahia Blanca'], ['12', 'Dolores'],
    ['13', 'Junin'], ['14', 'La Matanza'], ['6', 'La Plata'], ['16', 'Lomas de Zamora'],
    ['17', 'Mar del Plata'], ['18', 'Mercedes'], ['52', 'Moreno - Gral. Rodriguez'],
    ['19', 'Moron'], ['20', 'Necochea'], ['21', 'Olavarria'], ['22', 'Pergamino'],
    ['23', 'Quilmes'], ['24', 'San Isidro'], ['25', 'San Martin'], ['26', 'San Nicolas'],
    ['27', 'Tandil'], ['28', 'Trenque Lauquen'], ['49', 'Tres Arroyos'], ['29', 'Zarate/Campana']
  ];
  const JURIS = [{ id: 'SCJ', tipo: 'SCJ', dto: '', nombre: 'Suprema Corte' },
    { id: 'LPC', tipo: 'LPC', dto: '', nombre: 'Tribunal de Casacion Penal' },
    { id: 'PZ', tipo: 'PZ', dto: '', nombre: 'Justicia de Paz' }]
    .concat(DEPTOS.map((d) => ({ id: 'CC' + d[0], tipo: 'CC', dto: d[0], nombre: d[1] })));

  const FUEROS = [
    { id: '', nombre: 'Civil / Laboral / CA' },
    { id: 'F', nombre: 'Familia' },
    { id: 'P', nombre: 'Penal' }
  ];

  // El portero anti-bot viaja con HTTP 200, asi que hay que reconocerlo por el
  // HTML. Mismas huellas que usa MEV+.
  const PORTERO = new RegExp([
    'validando\\s+acceso', 'siendo\\s+navegado\\s+por\\s+un\\s+ser\\s+humano',
    'verificando\\s+si\\s+est[aá]', 'vuelva\\s+a\\s+cargar\\s+la\\s+p[aá]gina',
    'checking\\s+your\\s+browser', 'just\\s+a\\s+moment', 'challenge-platform', '_Incapsula_'
  ].join('|'), 'i');

  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

  // La MEV es ASP clasico y sirve las paginas en ISO-8859-1. Si se leen como
  // UTF-8, "SUCESION" pierde la O con tilde y "ACOMPAÑADA" pierde la eñe.
  async function textoDe(respuesta) {
    const buf = await respuesta.arrayBuffer();
    const ct = respuesta.headers.get('content-type') || '';
    const m = /charset=([\w-]+)/i.exec(ct);
    const juegos = [m ? m[1] : null, 'iso-8859-1', 'utf-8'];
    for (const j of juegos) {
      if (!j) continue;
      try { return new TextDecoder(j).decode(buf); } catch (e) { /* juego de caracteres desconocido */ }
    }
    return new TextDecoder().decode(buf);
  }
  const leerJSON = (k, def) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } };
  const guardarJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin persistencia */ } };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sinAcentos = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

  // ------------------------------------------------------------------ sets

  // La lista de sets solo esta en Busqueda.asp. Se guarda para poder usarla
  // desde las otras pantallas.
  function capturarSets() {
    if (!EN_BUSQUEDA) return;
    const f = document.forms.form1;
    const sel = f && f.elements && f.elements.Set;
    if (!sel) return;
    const previos = {};
    leerJSON(K.sets, []).forEach((x) => { previos[x.id] = x; });
    const sets = [...sel.options]
      .filter((o) => o.value)
      // El total sale de Sets.asp, asi que si ya lo tenia no se pisa.
      .map((o) => ({ id: o.value, nombre: o.text.trim(), total: previos[o.value] ? previos[o.value].total : null }));
    if (sets.length) guardarJSON(K.sets, sets);
  }

  // Sets.asp lista los sets con su total real de expedientes. Sirve para saber
  // cuantas causas deberia juntar cada uno y darse cuenta cuando falta alguna.
  async function recargarSets() {
    const r = await fetch('/Sets.asp', { credentials: 'include' });
    const html = await textoDe(r);
    if (PORTERO.test(html)) throw new Error('PORTERO');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const previos = {};
    leerJSON(K.sets, []).forEach((x) => { previos[x.id] = x; });
    const encontrados = [];
    [...doc.querySelectorAll('a[href*="esultados.asp"]')].forEach((a) => {
      let id = '';
      try { id = new URL(a.getAttribute('href'), location.origin).searchParams.get('nidset') || ''; } catch (e) { /* enlace raro */ }
      if (!id) return;
      const nombre = (a.textContent || '').replace(/\s+/g, ' ').trim();
      const fila = a.closest('tr');
      const txt = fila ? (fila.innerText || fila.textContent || '') : '';
      const m = /Total\s+Expedientes:\s*(\d+)/i.exec(txt.replace(/\s+/g, ' '));
      encontrados.push({ id: id, nombre: nombre, total: m ? parseInt(m[1], 10) : (previos[id] ? previos[id].total : null) });
    });
    if (encontrados.length) guardarJSON(K.sets, encontrados);
    return encontrados.length;
  }

  // Si no tengo la lista de sets, la voy a buscar solo. Antes te mandaba a
  // entrar a Busqueda a mano, que es exactamente lo que no hay que hacerle
  // hacer a nadie.
  async function asegurarSets() {
    if (leerJSON(K.sets, []).length) return true;
    estado('No tenia la lista de sets, la busco...');
    try {
      const n = await recargarSets();
      if (n) { estado('Sets leidos: ' + n + '.'); return true; }
    } catch (e) {
      estado(e && e.message === 'PORTERO'
        ? 'Salto la validacion de la MEV. Resolvela y reintenta.'
        : 'No pude leer los sets: ' + (e && e.message ? e.message : e), true);
      return false;
    }
    estado('No pude leer tus sets. Proba el boton Recargar.', true);
    return false;
  }

  function limpiar() {
    [K.indice, K.mapa, K.sets].forEach((k) => { try { localStorage.removeItem(k); } catch (e) { /* sin persistencia */ } });
  }

  // Los nombres de los sets suelen traer el departamento adentro. Es solo una
  // sugerencia: el mapeo final lo confirma el usuario y queda guardado.
  function adivinarJuris(nombreSet) {
    const n = sinAcentos(nombreSet);
    if (/JUZGADO.*PAZ|JDO.*PAZ/.test(n)) return 'PZ';
    if (/CASACION/.test(n)) return 'LPC';
    if (/SUPREMA|SCJ/.test(n)) return 'SCJ';
    if (/\bMDQ\b/.test(n)) return 'CC17';
    if (/\bLANUS\b|AVELLANEDA/.test(n)) return 'CC80';
    const plano = (x) => sinAcentos(x).replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    const objetivo = plano(nombreSet);
    // Primero el nombre completo del departamento: asi "Causas La Plata" cae en
    // La Plata y no en Mar del Plata por la palabra suelta.
    for (const j of JURIS) {
      if (j.tipo !== 'CC') continue;
      if (objetivo.indexOf(plano(j.nombre)) >= 0) return j.id;
    }
    // Si no, la palabra mas larga del nombre del departamento.
    let mejor = '', largo = 0;
    for (const j of JURIS) {
      if (j.tipo !== 'CC') continue;
      plano(j.nombre).split(' ').forEach((tok) => {
        if (tok.length > 3 && tok.length > largo && (' ' + objetivo + ' ').indexOf(' ' + tok + ' ') >= 0) {
          mejor = j.id; largo = tok.length;
        }
      });
    }
    return mejor;
  }

  function mapa() {
    const guardado = leerJSON(K.mapa, {});
    const sets = leerJSON(K.sets, []);
    sets.forEach((s) => {
      if (guardado[s.id] === undefined) guardado[s.id] = { juris: adivinarJuris(s.nombre), fuero: '', usar: true };
    });
    return guardado;
  }

  // ------------------------------------------------------- red y parseo

  async function cambiarJurisdiccion(idJuris, fuero) {
    const j = JURIS.filter((x) => x.id === idJuris)[0];
    if (!j) throw new Error('jurisdiccion desconocida: ' + idJuris);
    const cuerpo = ['TipoDto=' + encodeURIComponent(j.tipo),
      'DtoJudElegido=' + encodeURIComponent(j.dto || '6')];
    if (fuero === 'F') cuerpo.push('TipoF=FF');
    if (fuero === 'P') cuerpo.push('TipoP=PP');
    cuerpo.push('Aceptar=Aceptar');
    const r = await fetch('/POSLoguin.asp', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: cuerpo.join('&')
    });
    const html = await textoDe(r);
    if (PORTERO.test(html)) throw new Error('PORTERO');
    if (/loguin\.asp/i.test(html) && /Ingrese los datos/i.test(html)) throw new Error('SESION');
    return true;
  }

  function parsearResultados(html, ctx) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const texto = doc.body ? doc.body.innerText || doc.body.textContent || '' : '';
    if (/otra\s+Jurisdicci/i.test(texto)) return { vacio: true, causas: [] };
    const out = [];
    [...doc.querySelectorAll('table.pegada')].forEach((t) => {
      if (t.rows.length !== 2) return;
      const a = t.rows[0].querySelector('a[href*="rocesales.asp"]');
      if (!a) return;
      let nid = '', pid = '';
      try {
        const u = new URL(a.getAttribute('href'), location.origin);
        nid = u.searchParams.get('nidCausa') || '';
        pid = u.searchParams.get('pidJuzgado') || '';
      } catch (e) { /* enlace raro, se guarda igual sin ids */ }
      const c = [...t.rows[1].cells].map((x) => (x.innerText || '').replace(/\s+/g, ' ').trim());
      const org = (c[1] || '').split('-').map((s) => s.trim());
      out.push({
        caratula: (t.rows[0].innerText || '').replace(/\s+/g, ' ').trim().replace(/\s*-\s*$/, ''),
        estado: c[0] || '',
        organismo: org[0] || '',
        numero: org[1] || '',
        anio: org[2] || '',
        receptoria: c[2] || '',
        inicio: c[3] || '',
        ultima: c[4] || '',
        nidCausa: nid,
        pidJuzgado: pid,
        set: ctx.set,
        juris: ctx.juris,
        fuero: ctx.fuero
      });
    });
    return { vacio: out.length === 0, causas: out };
  }

  async function leerSet(nidset, ctx) {
    const url = '/resultados.asp?nidset=' + encodeURIComponent(nidset) +
      '&sfechadesde=&sfechahasta=&pOrden=xCa&pOrdenAD=Asc';
    const r = await fetch(url, { credentials: 'include' });
    const html = await textoDe(r);
    if (PORTERO.test(html)) throw new Error('PORTERO');
    return parsearResultados(html, ctx);
  }

  // ------------------------------------------------------------- recorrido

  let corriendo = false;
  let abortar = false;

  async function correr() {
    if (corriendo) return;
    if (!(await asegurarSets())) return;
    const sets = leerJSON(K.sets, []);
    const m = mapa();
    const tareas = sets
      .filter((s) => m[s.id] && m[s.id].usar && m[s.id].juris)
      .map((s) => ({ set: s, juris: m[s.id].juris, fuero: m[s.id].fuero || '' }));
    if (!tareas.length) { estado('Ningun set tiene jurisdiccion asignada. Abri "Sets" y asignalas.', true); return; }

    corriendo = true; abortar = false;
    botones(true);
    const pausa = Math.max(1500, parseInt(leerJSON(K.ritmo, 4000), 10) || 4000);
    const acumulado = [];
    let jurisActual = null;

    try {
      for (let i = 0; i < tareas.length; i++) {
        if (abortar) { estado('Cortado por vos. Lo recorrido no se guarda.', true); return; }
        const t = tareas[i];
        const clave = t.juris + '|' + t.fuero;
        estado('(' + (i + 1) + '/' + tareas.length + ') ' + t.set.nombre + ': ubicandome...');
        if (clave !== jurisActual) {
          await cambiarJurisdiccion(t.juris, t.fuero);
          jurisActual = clave;
          await dormir(pausa);
        }
        estado('(' + (i + 1) + '/' + tareas.length + ') ' + t.set.nombre + ': leyendo...');
        const res = await leerSet(t.set.id, { set: t.set.nombre, juris: t.juris, fuero: t.fuero });
        res.causas.forEach((c) => acumulado.push(c));
        estado('(' + (i + 1) + '/' + tareas.length + ') ' + t.set.nombre + ': ' +
          (res.causas.length || 0) + ' causa(s). Total ' + acumulado.length + '.');
        if (i < tareas.length - 1) await dormir(pausa);
      }
      // Una misma causa puede estar en dos sets: se deduplica por nidCausa.
      const vistas = {};
      const unicas = [];
      acumulado.forEach((c) => {
        const k = c.nidCausa || (c.caratula + c.numero + c.anio);
        if (vistas[k]) return;
        vistas[k] = true;
        unicas.push(c);
      });
      guardarJSON(K.indice, { fecha: new Date().toISOString(), causas: unicas });
      estado('Indice actualizado: ' + unicas.length + ' causas de ' + tareas.length + ' set(s).');
      pintarTabla();
    } catch (e) {
      if (e && e.message === 'PORTERO') {
        estado('La MEV puso la pantalla de validacion. Resolvela en una pestaña y volve a empezar. Bajale el ritmo si se repite.', true);
      } else if (e && e.message === 'SESION') {
        estado('Se cayo la sesion de la MEV. Volve a entrar y reintenta.', true);
      } else {
        estado('Se corto: ' + (e && e.message ? e.message : e), true);
      }
    } finally {
      corriendo = false;
      botones(false);
    }
  }

  // ------------------------------------------------------------------ vista

  let elEstado = null, elTabla = null, elPanel = null;

  function estado(txt, malo) {
    if (!elEstado) return;
    elEstado.textContent = txt;
    elEstado.style.color = malo ? '#b3261e' : '#123';
  }

  function botones(activo) {
    const b = elPanel && elPanel.querySelector('[data-b="correr"]');
    const c = elPanel && elPanel.querySelector('[data-b="cortar"]');
    if (b) { b.disabled = activo; b.style.opacity = activo ? 0.6 : 1; }
    if (c) c.style.display = activo ? '' : 'none';
  }

  const orden = { campo: 'caratula', asc: true };
  let filtro = '';

  function pintarTabla() {
    if (!elTabla) return;
    const ind = leerJSON(K.indice, null);
    if (!ind || !ind.causas || !ind.causas.length) {
      elTabla.innerHTML = '<div style="padding:14px;font-size:12px;color:#556">Todavia no hay indice. Apreta "Actualizar indice".</div>';
      return;
    }
    const f = sinAcentos(filtro);
    let filas = ind.causas.filter((c) => !f || sinAcentos(
      c.caratula + ' ' + c.organismo + ' ' + c.numero + ' ' + c.anio + ' ' + c.receptoria + ' ' + c.set + ' ' + c.ultima
    ).indexOf(f) >= 0);
    const campo = orden.campo;
    filas = filas.slice().sort((a, b) => {
      const x = String(a[campo] || ''), y = String(b[campo] || '');
      return orden.asc ? x.localeCompare(y, 'es') : y.localeCompare(x, 'es');
    });
    const cols = [
      ['caratula', 'Caratula'], ['organismo', 'Org.'], ['numero', 'Nro'], ['anio', 'Año'],
      ['receptoria', 'Recept.'], ['estado', 'Estado'], ['inicio', 'Inicio'],
      ['ultima', 'Ultima actuacion'], ['set', 'Set']
    ];
    let h = '<div style="font-size:11px;color:#556;margin-bottom:6px">' +
      filas.length + ' de ' + ind.causas.length + ' causas. Indice del ' +
      new Date(ind.fecha).toLocaleString('es-AR') + '</div>';
    h += '<table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr>';
    cols.forEach((c) => {
      h += '<th data-col="' + c[0] + '" style="position:sticky;top:0;background:' + VERDE +
        ';color:#fff;padding:5px 6px;text-align:left;cursor:pointer;white-space:nowrap">' +
        esc(c[1]) + (orden.campo === c[0] ? (orden.asc ? ' ▲' : ' ▼') : '') + '</th>';
    });
    h += '</tr></thead><tbody>';
    filas.forEach((c) => {
      const href = c.nidCausa
        ? '/procesales.asp?nidCausa=' + encodeURIComponent(c.nidCausa) + '&pidJuzgado=' + encodeURIComponent(c.pidJuzgado)
        : '';
      h += '<tr style="border-bottom:1px solid #e6ecef">';
      h += '<td style="padding:4px 6px">' + (href
        ? '<a href="' + href + '" target="_blank" rel="noopener" style="color:' + VERDE + ';text-decoration:none">' + esc(c.caratula) + '</a>'
        : esc(c.caratula)) + '</td>';
      ['organismo', 'numero', 'anio', 'receptoria', 'estado', 'inicio', 'ultima', 'set'].forEach((k) => {
        h += '<td style="padding:4px 6px;white-space:nowrap;max-width:280px;overflow:hidden;text-overflow:ellipsis">' + esc(c[k]) + '</td>';
      });
      h += '</tr>';
    });
    h += '</tbody></table>';
    elTabla.innerHTML = h;
    [...elTabla.querySelectorAll('th[data-col]')].forEach((th) => {
      th.addEventListener('click', () => {
        const c = th.getAttribute('data-col');
        if (orden.campo === c) orden.asc = !orden.asc; else { orden.campo = c; orden.asc = true; }
        pintarTabla();
      });
    });
  }

  function csv() {
    const ind = leerJSON(K.indice, null);
    if (!ind || !ind.causas.length) return;
    const cols = ['caratula', 'organismo', 'numero', 'anio', 'receptoria', 'estado', 'inicio', 'ultima', 'set', 'juris', 'fuero'];
    const cel = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const lineas = [cols.join(';')].concat(ind.causas.map((c) => cols.map((k) => cel(c[k])).join(';')));
    const blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'MEV_indice_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }

  // ------------------------------------------------------ pantalla de sets

  async function pantallaSets() {
    if (!(await asegurarSets())) return;
    const sets = leerJSON(K.sets, []);
    const m = mapa();
    let h = '<div style="font-size:11px;color:#556;margin-bottom:8px">A cada set decile en que jurisdiccion vive. Lo que sugiero sale del nombre del set, revisalo.</div>';
    h += '<div style="margin-bottom:7px">' +
      '<button data-s="todos" style="background:' + VERDE + ';color:#fff;border:0;border-radius:5px;padding:4px 9px;font-size:11px;cursor:pointer;margin-right:5px">Todos</button>' +
      '<button data-s="ninguno" style="background:#5a7581;color:#fff;border:0;border-radius:5px;padding:4px 9px;font-size:11px;cursor:pointer">Ninguno</button>' +
      '<span data-s="cuenta" style="font-size:11px;color:#5a7581;margin-left:8px"></span>' +
      '</div>';
    h += '<table style="width:100%;border-collapse:collapse;font-size:11px">';
    sets.forEach((s) => {
      const e = m[s.id];
      h += '<tr style="border-bottom:1px solid #eef2f4">' +
        '<td style="padding:4px"><input type="checkbox" data-usar="' + s.id + '"' + (e.usar ? ' checked' : '') + '></td>' +
        '<td style="padding:4px">' + esc(s.nombre) +
        (typeof s.total === 'number' ? '<span style="color:#5a7581"> (' + s.total + ' en el set)</span>' : '') + '</td>' +
        '<td style="padding:4px"><select data-juris="' + s.id + '" style="font-size:11px;max-width:170px"><option value="">(sin asignar)</option>' +
        JURIS.map((j) => '<option value="' + j.id + '"' + (e.juris === j.id ? ' selected' : '') + '>' + esc(j.nombre) + '</option>').join('') +
        '</select></td>' +
        '<td style="padding:4px"><select data-fuero="' + s.id + '" style="font-size:11px">' +
        FUEROS.map((f) => '<option value="' + f.id + '"' + (e.fuero === f.id ? ' selected' : '') + '>' + esc(f.nombre) + '</option>').join('') +
        '</select></td></tr>';
    });
    h += '</table>';
    elTabla.innerHTML = h;
    const guardar = () => {
      const nuevo = {};
      sets.forEach((s) => {
        nuevo[s.id] = {
          usar: elTabla.querySelector('[data-usar="' + s.id + '"]').checked,
          juris: elTabla.querySelector('[data-juris="' + s.id + '"]').value,
          fuero: elTabla.querySelector('[data-fuero="' + s.id + '"]').value
        };
      });
      guardarJSON(K.mapa, nuevo);
      estado('Mapeo guardado.');
    };
    const contar = () => {
      const c = elTabla.querySelectorAll('[data-usar]:checked').length;
      const t = elTabla.querySelectorAll('[data-usar]').length;
      const e = elTabla.querySelector('[data-s="cuenta"]');
      if (e) e.textContent = c + ' de ' + t + ' set(s) para recorrer';
    };
    const marcarTodos = (v) => {
      [...elTabla.querySelectorAll('[data-usar]')].forEach((c) => { c.checked = v; });
      guardar(); contar();
    };
    elTabla.querySelector('[data-s="todos"]').addEventListener('click', () => marcarTodos(true));
    elTabla.querySelector('[data-s="ninguno"]').addEventListener('click', () => marcarTodos(false));
    [...elTabla.querySelectorAll('select,input')].forEach((el) => el.addEventListener('change', () => { guardar(); contar(); }));
    contar();
  }

  function pantallaAyuda() {
    elTabla.innerHTML =
      '<div style="padding:12px;font-size:12px;line-height:1.55;color:#223;max-width:760px">' +
      '<div style="font-weight:700;font-size:13px;margin-bottom:6px">Que resuelve</div>' +
      'La MEV filtra cada Set por la jurisdiccion en la que estas parado. Un set con causas de varios ' +
      'departamentos te muestra solo las del departamento actual, y si no hay ninguna te dice que el set ' +
      '"contiene Expedientes de otra Jurisdiccion". Para ver todo lo tuyo hay que entrar y salir de cada ' +
      'jurisdiccion, una por una.' +
      '<div style="margin-top:8px">MEV Ultra hace ese recorrido por vos una sola vez, se guarda el resultado ' +
      'en tu maquina, y despues te muestra todas tus causas juntas en una tabla, sin importar de que ' +
      'departamento o fuero sean.</div>' +
      '<div style="font-weight:700;font-size:13px;margin:12px 0 6px">Como se usa, en orden</div>' +
      '<div><b>1.</b> Apreta <b>Sets</b>. Si no tengo tu lista de sets todavia, la voy a buscar solo.</div>' +
      '<div><b>2.</b> A cada set decile en que jurisdiccion vive y de que fuero es. ' +
      'La jurisdiccion viene sugerida a partir del nombre del set, asi que revisala. Con <b>Todos</b> y ' +
      '<b>Ninguno</b> elegis cuales entran en el recorrido.</div>' +
      '<div><b>3.</b> Apreta <b>Actualizar indice</b>. Va set por set: se para en la jurisdiccion, lee, y sigue. ' +
      'Podes cortarlo cuando quieras.</div>' +
      '<div><b>4.</b> Cuando termina, <b>Ver indice</b> te muestra la tabla. Buscador arriba, columnas que ' +
      'ordenan al hacerles clic, clic en la caratula para abrir la causa en la MEV, y <b>CSV</b> para ' +
      'llevartela a una planilla.</div>' +
      '<div style="font-weight:700;font-size:13px;margin:12px 0 6px">Dos advertencias</div>' +
      '<div>La MEV tiene una validacion anti-bot que se dispara por velocidad. La pausa entre pedidos ' +
      'arranca en 4 segundos: si te salta la validacion, subila. Empeza probando con tres o cuatro sets ' +
      'antes de largar todos.</div>' +
      '<div style="margin-top:6px">El indice es una foto del momento en que lo actualizaste, guardada en ' +
      'esta computadora. Si una causa se movio despues, tu tabla no lo sabe hasta que actualices. La MEV ' +
      'sigue siendo la fuente.</div>' +
      '</div>';
  }

  function pantallaAbout() {
    elTabla.innerHTML =
      '<div style="padding:12px;font-size:12px;line-height:1.7;color:#223">' +
      '<div style="font-weight:700;font-size:14px">' + esc(APP.nombre) + '</div>' +
      '<div>Version ' + esc(APP.version) + '</div>' +
      '<div>' + esc(APP.autor) + ', ' + esc(APP.anio) + '</div>' +
      '<div><a href="mailto:' + esc(APP.mail) + '" style="color:' + VERDE + '">' + esc(APP.mail) + '</a></div>' +
      '<div>Licencia <a href="' + esc(APP.licenciaUrl) + '" target="_blank" rel="noopener" style="color:' + VERDE + '">' + esc(APP.licencia) + '</a></div>' +
      '<div><a href="' + esc(APP.github) + '" target="_blank" rel="noopener" style="color:' + VERDE + '">' + esc(APP.github) + '</a></div>' +
      '<div style="margin-top:9px;font-size:11px;color:#556;max-width:640px">Software libre. Se distribuye sin ' +
      'ninguna garantia. Los datos del indice quedan en esta computadora y no se envian a ningun lado. ' +
      'Esta version incluye ademas todo MEV+, que trabaja en la pantalla del expediente.</div>' +
      '</div>';
  }

  // ------------------------------------------------------------------ panel

  function construir() {
    if (document.getElementById('mevultra')) return;
    const st = document.createElement('style');
    st.textContent = [
      '#mevultra{position:fixed;right:16px;bottom:16px;z-index:2147483000;font-family:Segoe UI,Arial,sans-serif}',
      '#mevultra .caja{background:#fff;border:2px solid ' + VERDE + ';border-radius:8px;box-shadow:0 6px 22px rgba(0,0,0,.3);width:430px}',
      '#mevultra .caja.ancha{width:min(1100px,94vw)}',
      '#mevultra .caja .cuerpo{max-height:none}',
      '#mevultra .caja:not(.ancha) .zona{max-height:34vh}',
      '#mevultra .caja:not(.ancha) button{margin-bottom:4px}',
      '#mevultra .barra{background:' + VERDE + ';color:#fff;padding:6px 10px;display:flex;justify-content:space-between;align-items:center;cursor:move;user-select:none;border-radius:4px 4px 0 0}',
      '#mevultra .cuerpo{padding:9px}',
      '#mevultra button{background:' + VERDE + ';color:#fff;border:0;border-radius:5px;padding:6px 10px;cursor:pointer;font-size:12px;margin-right:5px}',
      '#mevultra button.sec{background:#5a7581}',
      '#mevultra input[type=text]{padding:5px;border:1px solid #b9c9d0;border-radius:4px;font-size:12px}',
      '#mevultra .caja .zona{max-height:56vh;overflow:auto;border:1px solid #dbe4e8;border-radius:5px;margin-top:8px;background:#fbfdfc}',
      '#mevultra .est{font-size:11.5px;margin-top:7px;min-height:17px}',
      '#mevultra .pastilla{background:' + VERDE + ';color:#fff;padding:7px 13px;border-radius:16px;cursor:move;font-weight:600;box-shadow:0 3px 10px rgba(0,0,0,.3);user-select:none}',
      '#mevultra .ctrl span{width:20px;height:18px;line-height:18px;text-align:center;border-radius:3px;cursor:pointer;display:inline-block}',
      '#mevultra .ctrl span:hover{background:rgba(255,255,255,.25)}'
    ].join('\n');
    document.head.appendChild(st);

    const cont = document.createElement('div');
    cont.id = 'mevultra';
    cont.innerHTML =
      '<div class="caja">' +
      '<div class="barra"><b>MEV Ultra</b><span class="ctrl">' +
      '<span data-b="ancho" title="Ensanchar o angostar el panel">&#9723;</span>' +
      '<span data-b="min" title="Minimizar">&#9472;</span>' +
      '<span data-b="cerrar" title="Cerrar hasta recargar">&#10005;</span></span></div>' +
      '<div class="cuerpo">' +
      '<button data-b="correr">Actualizar indice</button>' +
      '<button data-b="cortar" class="sec" style="display:none">Cortar</button>' +
      '<button data-b="sets" class="sec">Sets</button>' +
      '<button data-b="ver" class="sec">Ver indice</button>' +
      '<button data-b="csv" class="sec">CSV</button>' +
      '<button data-b="recargar" class="sec" title="Vuelve a leer tus sets desde la MEV, con el total de cada uno">Recargar</button>' +
      '<button data-b="limpiar" class="sec" title="Borra el indice, el mapeo y la lista de sets guardados en esta computadora">Limpiar</button>' +
      '<button data-b="ayuda" class="sec">Ayuda</button>' +
      '<button data-b="about" class="sec">About</button>' +
      '<input type="text" data-b="buscar" placeholder="Buscar en el indice..." style="width:230px;margin-left:6px">' +
      '<span style="font-size:11px;color:#5a7581;margin-left:6px">pausa</span> ' +
      '<input type="text" data-b="ritmo" value="4000" style="width:52px" title="Milisegundos entre pedidos. Mas alto = menos riesgo de que aparezca la validacion.">' +
      '<div class="zona" data-b="zona"></div>' +
      '<div class="est" data-b="estado"></div>' +
      '</div></div>' +
      '<div class="pastilla" style="display:none">MEV Ultra</div>';
    document.body.appendChild(cont);

    elPanel = cont;
    elTabla = cont.querySelector('[data-b="zona"]');
    elEstado = cont.querySelector('[data-b="estado"]');
    const caja = cont.querySelector('.caja');
    const pastilla = cont.querySelector('.pastilla');
    const barra = cont.querySelector('.barra');
    const inRitmo = cont.querySelector('[data-b="ritmo"]');
    inRitmo.value = leerJSON(K.ritmo, 4000);

    const minimizar = (v) => {
      caja.style.display = v ? 'none' : 'block';
      pastilla.style.display = v ? 'block' : 'none';
      guardarJSON(K.min, v);
    };

    const aplicarPos = (l, t) => {
      const a = cont.offsetWidth || 160;
      cont.style.left = Math.max(4, Math.min(l, window.innerWidth - Math.min(a, 110) - 4)) + 'px';
      cont.style.top = Math.max(4, Math.min(t, window.innerHeight - 28)) + 'px';
      cont.style.right = 'auto'; cont.style.bottom = 'auto';
    };
    let arrastrado = false;
    const arrastre = (mango) => {
      let sx, sy, ox, oy, mov = false, arr = false;
      mango.addEventListener('mousedown', (e) => {
        if (e.target.closest('[data-b]')) return;
        e.preventDefault();
        arrastrado = false;
        const r = cont.getBoundingClientRect();
        ox = r.left; oy = r.top; sx = e.clientX; sy = e.clientY; mov = true; arr = false;
        document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu);
      });
      function mm(e) {
        if (!mov) return;
        const dx = e.clientX - sx, dy = e.clientY - sy;
        if (!arr && Math.abs(dx) + Math.abs(dy) < 4) return;
        arr = true; cont.style.userSelect = 'none';
        aplicarPos(ox + dx, oy + dy);
      }
      function mu() {
        mov = false; cont.style.userSelect = '';
        document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu);
        if (arr) { arrastrado = true; guardarJSON(K.pos, { left: parseInt(cont.style.left, 10), top: parseInt(cont.style.top, 10) }); }
      }
    };
    arrastre(barra); arrastre(pastilla);

    const ancho = (v) => {
      caja.classList.toggle('ancha', !!v);
      guardarJSON(K.tam, !!v);
    };
    cont.querySelector('[data-b="ancho"]').addEventListener('click', () => ancho(!caja.classList.contains('ancha')));
    if (leerJSON(K.tam, false)) ancho(true);
    cont.querySelector('[data-b="min"]').addEventListener('click', () => minimizar(true));
    cont.querySelector('[data-b="cerrar"]').addEventListener('click', () => { cont.style.display = 'none'; });
    pastilla.addEventListener('click', () => { if (arrastrado) { arrastrado = false; return; } minimizar(false); });
    cont.querySelector('[data-b="correr"]').addEventListener('click', correr);
    cont.querySelector('[data-b="cortar"]').addEventListener('click', () => { abortar = true; });
    cont.querySelector('[data-b="sets"]').addEventListener('click', () => { ancho(true); pantallaSets(); });
    cont.querySelector('[data-b="ver"]').addEventListener('click', () => { ancho(true); pintarTabla(); });
    cont.querySelector('[data-b="csv"]').addEventListener('click', csv);
    cont.querySelector('[data-b="recargar"]').addEventListener('click', async () => {
      const b = cont.querySelector('[data-b="recargar"]');
      b.disabled = true;
      estado('Leyendo tus sets desde la MEV...');
      try {
        const n = await recargarSets();
        estado(n ? ('Sets actualizados: ' + n + '.') : 'No pude leer la lista de sets. Entra a "Organizar Mis Sets" y volve a intentar.', !n);
        pantallaSets();
      } catch (e) {
        estado(e && e.message === 'PORTERO'
          ? 'Salto la validacion de la MEV. Resolvela y reintenta.'
          : 'No pude leer los sets: ' + (e && e.message ? e.message : e), true);
      } finally { b.disabled = false; }
    });

    // Dos toques en vez de un cartel del navegador, que frena todo.
    let confirmarLimpieza = null;
    cont.querySelector('[data-b="limpiar"]').addEventListener('click', () => {
      const b = cont.querySelector('[data-b="limpiar"]');
      if (!confirmarLimpieza) {
        b.textContent = 'CONFIRMAR';
        estado('Esto borra el indice, el mapeo y la lista de sets guardados. Toca de nuevo para confirmar.');
        confirmarLimpieza = setTimeout(() => {
          confirmarLimpieza = null;
          b.textContent = 'Limpiar';
          estado('Limpieza cancelada.');
        }, 5000);
        return;
      }
      clearTimeout(confirmarLimpieza);
      confirmarLimpieza = null;
      b.textContent = 'Limpiar';
      limpiar();
      estado('Listo, quedo todo vacio. Vuelvo a leer tus sets...');
      pantallaAyuda();
      asegurarSets();
    });

    cont.querySelector('[data-b="ayuda"]').addEventListener('click', pantallaAyuda);
    cont.querySelector('[data-b="about"]').addEventListener('click', pantallaAbout);
    cont.querySelector('[data-b="buscar"]').addEventListener('input', (e) => { filtro = e.target.value; pintarTabla(); });
    inRitmo.addEventListener('change', () => guardarJSON(K.ritmo, parseInt(inRitmo.value, 10) || 4000));

    const p = leerJSON(K.pos, null);
    if (p && typeof p.left === 'number') aplicarPos(p.left, p.top);
    window.addEventListener('resize', () => { if (cont.style.left) aplicarPos(parseInt(cont.style.left, 10), parseInt(cont.style.top, 10)); });
    // Arranca como pastilla para no taparte la MEV. Un clic y se abre.
    if (leerJSON(K.min, true)) minimizar(true);

    const ind = leerJSON(K.indice, null);
    estado(ind ? ('Indice del ' + new Date(ind.fecha).toLocaleString('es-AR') + ': ' + ind.causas.length + ' causas.')
      : 'Primera vez: leete la ayuda de abajo, son cuatro pasos.');
    if (ind && ind.causas && ind.causas.length) pintarTabla(); else pantallaAyuda();
  }

  function iniciar() {
    capturarSets();
    construir();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
