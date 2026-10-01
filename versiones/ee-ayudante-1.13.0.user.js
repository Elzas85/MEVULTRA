// ==UserScript==
// @name         EE ayudante
// @namespace    local
// @version      1.13.0
// @description  Vista externa del Expediente Electrónico y de GEDO. Replica sus listados en una ventana propia, con texto completo, orden, búsqueda, etiquetas y anotaciones.
// @match        https://eue-pr.apps.buenosaires.gob.ar/expedientes-web/*
// @match        https://eut-pr.apps.buenosaires.gob.ar/gedo-web/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

/*
 * ======================================================================
 * EE ayudante
 *
 * Vista de lectura para el módulo Expediente Electrónico (SADE/GDE) y
 * para GEDO.
 *
 * ----------------------------------------------------------------------
 * CÓMO FUNCIONA
 *
 * La herramienta lee el listado que el sistema ya envió al navegador y lo
 * presenta nuevamente en una ventana propia, con su nombre y sus colores,
 * superpuesta a la pantalla original. No constituye una modificación del
 * sistema: es una segunda ventana, del mismo modo que si el listado se
 * copiara a una planilla para leerlo con comodidad.
 *
 * La ventana se cierra o se pliega en cualquier momento y debajo queda el
 * Expediente Electrónico intacto, sin agregado ni alteración alguna.
 *
 * ----------------------------------------------------------------------
 * QUÉ AGREGA SOBRE EL LISTADO ORIGINAL
 *
 *   ASUNTO       Una referencia por actuación, compuesta con el tipo de
 *                trámite, traducido de su código, y los datos
 *                identificatorios que se extraen del motivo de
 *                caratulación, según lo que cada trámite haya traído:
 *                referencia o carátula, persona, documento, inmueble,
 *                expediente judicial y juzgado.
 *   TEXTO ENTERO El sistema trunca varias columnas a veinte caracteres.
 *                Aquí se muestran completas.
 *   FICHA        Todos los campos de la actuación y el motivo textual,
 *                sin abrirla y sin consultar al sistema.
 *   ORDEN        Por cualquier columna, ascendente y descendente.
 *   BÚSQUEDA     Sobre todos los campos a la vez, incluido el asunto.
 *   PAGINACIÓN   Configurable de cinco en cinco.
 *   ETIQUETAS    Marcas propias sobre cada actuación, con anotación
 *                privada. No se escriben en el expediente: quedan en el
 *                navegador y se exportan e importan como archivo.
 *   EXCEL        El listado a la vista, en una planilla.
 *   COPIAR       El número de expediente, desde cada fila.
 *
 * ----------------------------------------------------------------------
 * LOS DOS BOTONES DE CADA FILA
 *
 *   VER    Abre la ficha de la actuación dentro de esta misma ventana. No
 *          consulta al servidor, no abre el expediente y no deja
 *          constancia: es otra presentación de lo que el listado ya
 *          contiene.
 *   ABRIR  Da la orden al listado original, tal como si se eligiera
 *          "Tramitar" en su desplegable de Acciones. Antes de accionar se
 *          verifica que la opción diga exactamente "Tramitar": si dijera
 *          otra cosa, la operación se cancela. Esa comprobación importa
 *          porque en la solapa Consultas el mismo desplegable ofrece
 *          "Adquirir", que toma el expediente.
 *
 * La herramienta no adquiere expedientes, no realiza pases y no modifica
 * ningún dato.
 *
 * ----------------------------------------------------------------------
 * LAS DOS PANTALLAS
 *
 * En el Buzón de Tareas la ventana replica el listado de actuaciones. Al
 * abrir un expediente, sea en la pantalla completa o en una ventana propia
 * por encima del buzón, replica su lista de documentos con las columnas
 * Orden, Tipo de documento, Etiqueta, Referencia, Resumen y Asociación, más
 * el botón Bajar del sistema.
 *
 * Arriba va el resumen del expediente, con sus etiquetas y su anotación,
 * que son las mismas que se ven desde el buzón porque van indexadas por el
 * número de expediente. Y cada documento tiene además las suyas propias:
 * un click sobre su celda de Etiqueta despliega el detalle, donde se ponen
 * etiquetas, se escribe la anotación y se piden al sistema los datos
 * adicionales del documento. Anterior y Siguiente mueven el paginador del
 * propio sistema.
 *
 * ----------------------------------------------------------------------
 * GEDO
 *
 * En GEDO la ventana replica el listado que esté a la vista, sea el de Mis
 * Tareas, el Porta Firma o el de Consultas, con las columnas que ese
 * listado traiga y el texto sin truncar. No compone ningún asunto: la
 * columna Referencia de GEDO ya es descriptiva. Lo único que agrega son
 * ETIQUETA y ANOTACIÓN.
 *
 * Cuando la fila nombra un expediente, la marca se guarda sobre ese
 * expediente, de modo que lo anotado en el Expediente Electrónico aparece
 * en GEDO y al revés. Si no lo nombra, se guarda sobre el número del
 * documento; y si tampoco hay, sobre el contenido de la fila, con el
 * aviso de que esa marca se pierde si el listado cambia.
 *
 * Los dos módulos están en subdominios distintos y no comparten el
 * almacenamiento del navegador, así que las etiquetas y las anotaciones
 * viven en el almacén de Tampermonkey, que sí es común. Lo que hubiera
 * guardado antes se traslada solo la primera vez.
 *
 * Los botones de cada fila son los del propio sistema, accionados
 * verificando su rótulo. Quedan afuera los que se apropian de algo o lo
 * destruyen, como "Adquirir tarea": para ésos está el botón del sistema.
 *
 * ----------------------------------------------------------------------
 * REQUISITO
 *
 * La columna "Motivo Caratulación" debe estar habilitada en el listado
 * original, desde "Configurar columnas visibles" al pie de la tabla. Sin
 * ella no puede componerse el asunto. Es configuración propia del
 * sistema, ajena a esta herramienta.
 * ======================================================================
 */

(function () {
    'use strict';

    const VERSION = '1.13.0';
    const CLAVE = 'ee.ayudante.v1';
    const ENCARGO = 'ee.ayudante.abrir';   // encargo que se deja para la pestaña nueva

    const TIPOS = {
        'PG000101A': 'Denuncia herencia vacante',
        'PG000203A': 'Liquidación de condena',
        'GENE3401A': 'Oficio judicial',
        'GENE2101B': 'Solicitud de ciudadano',
        'GENE2108A': 'Registro Poder Judicial'
    };

    const CFG_DEF = {
        // La ventana siempre arranca abierta. Cerrarla vale para esa
        // pantalla, no para siempre: si el estado cerrado se guardara, al
        // recargar sólo quedaría el botón de la esquina, que es fácil de
        // pasar por alto y hace pensar que la herramienta no arrancó.
        abierta: true,
        porPagina: 15,
        orden: { col: 'fecha', desc: true },
        maximizada: true,
        zoom: 1,                // ampliación del contenido, no de la ventana
        pos: null,              // posición cuando no está maximizada
        tam: null,              // tamaño cuando no está maximizada
        enPestanaNueva: true,   // Abrir usa una pestaña aparte
        filtro: '',             // se conserva la búsqueda entre recargas
        filtroEtiqueta: ''      // '' todas, '@sin', '@nota', o el id de una etiqueta
    };

    let CFG = (() => {
        let g = {};
        try { g = JSON.parse(localStorage.getItem(CLAVE) || '{}') || {}; } catch {}
        delete g.abierta;                       // no se hereda el estado cerrado
        return Object.assign({}, CFG_DEF, g);
    })();
    const guardar = () => { try { localStorage.setItem(CLAVE, JSON.stringify(CFG)); } catch {} };

    // ===================== ETIQUETAS Y ANOTACIONES =====================
    //
    // Son datos propios del usuario, no del sistema: no salen del
    // Expediente Electrónico ni entran en él. Quedan guardados en este
    // navegador, indexados por número de expediente, y se llevan de una
    // computadora a otra con exportar e importar.
    //
    // Se llaman ANOTACIONES y no notas, para no confundirlas con la nota
    // electrónica, que es un acto procesal.

    const CLAVE_MARCAS = 'ee.ayudante.marcas.v1';

    // Los colores son los pasteles de Obelisco, el sistema de diseño del
    // Gobierno de la Ciudad.
    const COLORES = [
        { id: 'citrus', nom: 'Amarillo', hex: '#ffe299' },
        { id: 'rojo', nom: 'Rojo', hex: '#ff9999' },
        { id: 'semaforo', nom: 'Rojo semáforo', hex: '#c93b3b', txt: '#ffffff' },
        { id: 'coral', nom: 'Coral', hex: '#ffaf99' },
        { id: 'strawberry', nom: 'Rosa', hex: '#ff99e5' },
        { id: 'berries', nom: 'Violeta', hex: '#e299ff' },
        { id: 'lavender', nom: 'Lavanda', hex: '#99b5ff' },
        { id: 'sky', nom: 'Celeste', hex: '#99e8ff' },
        { id: 'aqua', nom: 'Agua', hex: '#99ffe2' },
        { id: 'pistachio', nom: 'Pistacho', hex: '#99ffaf' },
        { id: 'lime', nom: 'Lima', hex: '#e8ff99' }
    ];
    const colorDe = (c) => COLORES.find(x => x.id === c) || COLORES[0];
    // Los pasteles llevan el texto en pizarra; los tonos plenos, en blanco.
    const estiloChip = (c) => {
        const x = colorDe(c);
        return 'background:' + x.hex + ';color:' + (x.txt || '#38485c') +
               (x.txt ? ';border-color:' + x.hex : '');
    };

    // El Expediente Electrónico y GEDO están en subdominios distintos y no
    // comparten localStorage. Por eso las etiquetas y las anotaciones van al
    // almacén de Tampermonkey, que sí se comparte entre los @match de un
    // mismo script. Si no estuviera disponible se sigue con localStorage,
    // y entonces cada módulo tiene las suyas.
    const GM_OK = (typeof GM_getValue === 'function' && typeof GM_setValue === 'function');

    const normalizarMarcas = (m) => (!m || typeof m !== 'object')
        ? { etiquetas: [], filas: {} }
        : {
            etiquetas: Array.isArray(m.etiquetas) ? m.etiquetas : [],
            filas: (m.filas && typeof m.filas === 'object') ? m.filas : {}
        };

    let MARCAS = (() => {
        let local = null;
        try { local = JSON.parse(localStorage.getItem(CLAVE_MARCAS) || 'null'); } catch {}
        if (!GM_OK) return normalizarMarcas(local);

        let compartido = null;
        try { compartido = JSON.parse(GM_getValue(CLAVE_MARCAS, 'null')); } catch {}
        // Primera vez con almacén compartido: se lleva lo que ya había.
        if (!compartido && local) {
            try { GM_setValue(CLAVE_MARCAS, JSON.stringify(local)); } catch {}
            return normalizarMarcas(local);
        }
        return normalizarMarcas(compartido);
    })();

    const guardarMarcas = () => {
        const txt = JSON.stringify(MARCAS);
        if (GM_OK) {
            try { GM_setValue(CLAVE_MARCAS, txt); return; }
            catch { avisar('No se pudieron guardar las etiquetas.'); return; }
        }
        try { localStorage.setItem(CLAVE_MARCAS, txt); }
        catch { avisar('No se pudieron guardar las etiquetas: el navegador no admite más datos.'); }
    };

    const marcaDe = (clave) => MARCAS.filas[clave] || { et: [], nota: '' };
    const etiquetaDe = (id) => MARCAS.etiquetas.find(e => e.id === id);
    const etiquetasDe = (clave) => marcaDe(clave).et.map(etiquetaDe).filter(Boolean);

    function fijarMarca(clave, cambio) {
        const m = Object.assign({ et: [], nota: '' }, MARCAS.filas[clave] || {}, cambio);
        if (!m.et.length && !m.nota.trim()) delete MARCAS.filas[clave];
        else MARCAS.filas[clave] = { et: m.et, nota: m.nota };
        guardarMarcas();
    }

    function alternarEtiqueta(clave, id) {
        const et = marcaDe(clave).et.slice();
        const i = et.indexOf(id);
        if (i >= 0) et.splice(i, 1); else et.push(id);
        fijarMarca(clave, { et });
    }

    function crearEtiqueta(nombre, color) {
        nombre = String(nombre || '').replace(/\s+/g, ' ').trim().slice(0, 28);
        if (!nombre) return null;
        const ya = MARCAS.etiquetas.find(e => norm(e.nom) === norm(nombre));
        if (ya) return ya.id;
        const id = 'et' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
        MARCAS.etiquetas.push({ id, nom: nombre, color: color || COLORES[0].id });
        guardarMarcas();
        return id;
    }

    function borrarEtiqueta(id) {
        MARCAS.etiquetas = MARCAS.etiquetas.filter(e => e.id !== id);
        for (const k of Object.keys(MARCAS.filas)) {
            const f = MARCAS.filas[k];
            f.et = (f.et || []).filter(y => y !== id);
            if (!f.et.length && !String(f.nota || '').trim()) delete MARCAS.filas[k];
        }
        guardarMarcas();
    }

    const usoDe = (id) => Object.values(MARCAS.filas).filter(f => (f.et || []).includes(id)).length;

    // ===================== UTILIDADES =====================

    const norm = (s) => (s || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ').trim().toLowerCase();
    const vis = (el) => el && el.offsetParent !== null;
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g,
        c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const mayuscInicial = (s) => {
        const t = String(s || '').toLowerCase().trim();
        return t ? t[0].toUpperCase() + t.slice(1) : '';
    };

    // ===================== PARSEO DEL MOTIVO =====================
    //
    // El listado no expone la carátula. El único campo con contenido
    // identificatorio es "Motivo Caratulación", donde la repartición que
    // caratuló escribió, sin formato fijo, lo que tenía a mano: la
    // una carátula, un nombre, un documento, un inmueble, un expediente
    // judicial, un juzgado. De ahí se extraen
    // esos datos, cada uno con su propio criterio y sólo cuando aparecen
    // de modo inequívoco. Nada se infiere ni se completa por aproximación.

    const VACIOS = [
        /^hv\.?$/i, /^presunta\s+hv\.?$/i,
        /^denuncia\s+(supuesta\s+)?herencia\s+vacante\.?$/i,
        /^oficio\s+judicial\.?$/i, /^pase\.?$/i, /^car[aá]tula\.?$/i,
        /^s\/?d\.?$/i, /^[-.\s·]*$/
    ];
    const esVacio = (m) => !m || VACIOS.some(re => re.test(m.trim()));

    const limpiar = (s) => String(s || '')
        .replace(/[“”„]/g, '"').replace(/"/g, '')
        .replace(/\(\s*\)/g, ' ').replace(/\[\s*\]/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/(?:\s*·\s*){2,}/g, ' · ')
        .replace(/[\s,;]+(?:con|y|de|del|titular)\s*$/i, '')
        .replace(/^[\s\-–·,.:;]+|[\s\-–·,.:;]+$/g, '')
        .trim();

    function parsearMotivo(motivo) {
        const out = {
            caratula: '', expediente: '', juzgado: '',
            persona: '', documento: '', inmueble: '', resto: ''
        };
        if (!motivo) return out;
        let t = String(motivo).replace(/[“”„]/g, '"').replace(/\s+/g, ' ').trim();

        // --- juzgado ---
        const corch = t.match(/\[([^\]]+)\]/);
        if (corch) { out.juzgado = limpiar(corch[1].replace(/\s*Sec\s*-?\s*$/i, '')); t = t.replace(corch[0], ' '); }
        if (!out.juzgado) {
            const par = t.match(/\(([^)]*(?:juzgado|juz|jcc)[^)]*)\)/i);
            if (par) { out.juzgado = limpiar(par[1]); t = t.replace(par[0], ' '); }
        }
        if (!out.juzgado) {
            const mj = t.match(/[·\-,]\s*((?:juzgado|juz|jcc)\b[^·]*)$/i);
            if (mj) { out.juzgado = limpiar(mj[1]); t = t.replace(mj[0], ' '); }
        }

        // --- documento ---
        // Sólo con la palabra que lo nombra delante: un número suelto no
        // se toma nunca por un documento.
        const mDoc = t.match(/\b(?:D\.?N\.?I\.?|L\.?[CE]\.?|documento|C\.?U\.?I\.?[TL]\.?)\s*(?:n?[°ºo]\s*)?[:\-]?\s*([\d][\d.\-]{6,13})/i);
        if (mDoc) { out.documento = mDoc[1].replace(/[.\-]+$/, ''); t = t.replace(mDoc[0], ' '); }

        // --- expediente judicial ---
        let mExp = t.match(/\((\d{2,6}\s*[-/]\s*\d{2,4})\)/);
        if (!mExp) mExp = t.match(/\bexpte?\.?\s*(?:judicial)?\s*n?[°ºo]?\s*([\d.]{2,8}\s*[-/]\s*\d{2,4})/i);
        if (!mExp) mExp = t.match(/\b(\d{4,6}\s*[-/]\s*(?:19|20)\d{2})\b/);
        if (mExp) { out.expediente = mExp[1].replace(/\s+/g, ''); t = t.replace(mExp[0], ' '); }

        // --- inmueble ---
        // Se toma únicamente cuando el propio texto lo anuncia, con la
        // palabra que lo introduce delante. Sin ese anclaje, una calle con
        // altura es indistinguible de cualquier otro número.
        const mInm = t.match(/\b(?:(?:inmueble|domicilio|sit[oa]|ubicad[oa])s?\s+(?:en\s+|de\s+|del\s+)?)+[:\-]?\s*([^·;]{5,70}?\s\d{1,5}(?:\s*\/\s*\d{1,4})?(?:\s*,?\s*(?:piso|p\.?)\s*[\w°º]{1,4})?(?:\s*,?\s*(?:depto|dto|dpto)\.?\s*[\w°º]{1,4})?)/i);
        if (mInm) { out.inmueble = limpiar(mInm[1]); t = t.replace(mInm[0], ' '); }

        t = limpiar(t);

        // --- carátula judicial ---
        // La marca inequívoca es el "c/" o el "s/" entre las partes.
        if (/\s(c|s)\/\s?/i.test(t)) { out.caratula = t; return out; }

        // --- persona ---
        // Muchos motivos tienen la forma "RÓTULO - dato". El rótulo varía
        // según el trámite y puede aparecer más de una vez; se descarta
        // cuanto rótulo haya quedado por delante del dato.
        const ROTULO = /^(?:causante|denunciante|solicitante|titular|interesad[oa]|referencia|asunto|sra?\.?|sr\.?)\s*[:\-]\s*/i;
        const mPers = t.match(/\b(?:vacante|denuncia|causante|solicitud|solicitante|oficio|registro|vista|referencia|asunto|sra?)\.?\s*[-:]\s+(.{3,90})$/i);
        if (mPers && !/\//.test(mPers[1]) && /^[^\d]{2,}/.test(mPers[1])) {
            out.persona = limpiar(mPers[1].replace(ROTULO, '')); return out;
        }

        if (!esVacio(t)) out.resto = t;
        return out;
    }

    function componer(codigo, descripcion, motivo) {
        const tipo = TIPOS[codigo] || mayuscInicial(descripcion);
        const p = parsearMotivo(motivo);
        const particular = p.caratula || p.persona || p.resto;
        const extras = [
            p.documento && 'DNI ' + p.documento,
            p.inmueble,
            p.expediente && 'expte. ' + p.expediente,
            p.juzgado
        ].filter(Boolean);
        return {
            tipo,
            particular: particular || '',
            documento: p.documento,
            inmueble: p.inmueble,
            expediente: p.expediente,
            juzgado: p.juzgado,
            extras,
            identificado: !!(particular || p.documento || p.inmueble || p.expediente),
            plano: [tipo, particular].filter(Boolean).concat(extras).join(' · ')
        };
    }

    // ===================== LECTURA DEL SISTEMA =====================

    function grilla() {
        for (const lb of document.querySelectorAll('.z-listbox')) {
            if (!vis(lb)) continue;
            const heads = [...lb.querySelectorAll('.z-listhead .z-listheader')];
            if (!heads.length) continue;
            const tit = heads.map(h => norm(h.innerText));
            if (tit.includes('numero expediente')) return { lb, heads, tit };
        }
        return null;
    }

    // El sistema guarda en el atributo title de cada celda el texto
    // completo cuando lo muestra truncado. Pero en algunas columnas ese
    // atributo no es el dato sino una instrucción de la interfaz, como
    // "Haga click aquí para ver los datos del usuario". Por eso el title
    // se usa únicamente cuando es la versión extendida de lo visible: o
    // bien el texto visible termina en puntos suspensivos, o bien el title
    // empieza igual que él. En cualquier otro caso se toma lo que se ve,
    // que es siempre el dato.
    const INSTRUCCION = /^(haga\s+click|hacer\s+click|clic|click|presione|copiar|seleccione|ver\s+)/i;

    const textoCelda = (c) => {
        if (!c) return '';
        const t = (c.getAttribute('title') || '').trim();
        const v = (c.innerText || '').trim();
        if (!t || t === v || INSTRUCCION.test(t)) return v.replace(/\s+/g, ' ');
        const cortado = v.endsWith('...') || v.endsWith('…');
        const prefijo = v.length > 3 && t.toLowerCase().startsWith(v.slice(0, -3).toLowerCase().trim());
        return ((cortado && (prefijo || t.length > v.length)) ? t : v).replace(/\s+/g, ' ');
    };

    let DATOS = [], FALTA = [], MODO = 'buzon', EXPTE = '', COLS_GEDO = [];

    // La pantalla del expediente abierto trae su propia grilla, con otras
    // columnas. Es el mismo componente de ZK, así que se lee igual: por el
    // título de la cabecera y nunca por identificador.
    function grillaDocs() {
        for (const lb of document.querySelectorAll('.z-listbox')) {
            if (!vis(lb)) continue;
            const heads = [...lb.querySelectorAll('.z-listhead .z-listheader')];
            if (!heads.length) continue;
            const tit = heads.map(h => norm(h.innerText));
            if (tit.includes('numero documento') && tit.includes('tipo de documento')) {
                return { lb, tit };
            }
        }
        return null;
    }

    // El número del expediente abierto. Se prefiere el rótulo que contiene
    // sólo el número; si no aparece, el primero que se encuentre.
    const RE_EX = /EX-\d{4}-\d{5,}-?\s*-GCABA-[A-Z]+/;

    // El número del expediente abierto.
    //
    // Tres precauciones. El sistema suele mostrarlo en un cuadro de texto,
    // y un input no tiene texto sino valor, así que se miran las dos cosas.
    // Si el expediente se abrió en una ventana propia se busca primero
    // dentro de esa ventana, porque el buzón que quedó detrás está lleno de
    // números de otros expedientes. Y siempre se excluyen las dos grillas:
    // la de documentos, cuya columna Referencia trae números ajenos
    // ("S/ EX-2025-45258294-GCABA-DG..."), y la del buzón.
    let EXPTE_MANO = '';          // número indicado a mano, si no se pudo leer

    function numeroExpediente() {
        if (EXPTE_MANO) return EXPTE_MANO;

        const G = grillaDocs();
        const gDoc = G ? G.lb : null;
        const gBuz = (() => { const b = grilla(); return b ? b.lb : null; })();
        const fuera = (el) => !(gDoc && gDoc.contains(el)) && !(gBuz && gBuz.contains(el));

        const mirar = (t) => {
            const x = String(t || '').replace(/\s+/g, ' ').trim();
            if (!x || x.length > 200) return null;
            const m = x.match(RE_EX);
            return m ? { exacto: x === m[0], num: m[0] } : null;
        };

        const buscar = (marco) => {
            let suelto = '';
            // 1) campos y atributos
            for (const el of marco.querySelectorAll('input,textarea,[title]')) {
                if (!fuera(el) || !vis(el)) continue;
                for (const t of [el.value, el.getAttribute('title')]) {
                    const r = mirar(t);
                    if (!r) continue;
                    if (r.exacto) return r.num;
                    if (!suelto) suelto = r.num;
                }
            }
            // 2) texto
            const paso = document.createTreeWalker(marco, NodeFilter.SHOW_TEXT);
            let n;
            while ((n = paso.nextNode())) {
                if (!fuera(n)) continue;
                const r = mirar(n.nodeValue);
                if (!r || !vis(n.parentElement)) continue;
                if (r.exacto) return r.num;
                if (!suelto) suelto = r.num;
            }
            return suelto;
        };

        const ventana = gDoc && gDoc.closest('.z-window');
        if (ventana) {
            const dentro = buscar(ventana);
            if (dentro) return dentro;
        }
        return buscar(document.body);
    }

    // Los tres botones que el sistema ofrece en cada documento. Se
    // reconocen por su rótulo y se accionan verificándolo de nuevo, igual
    // que con Tramitar.
    const ACC_DOC = [
        { id: 'ver', re: /^visualizar/i, rot: 'Ver', tit: 'Abre el documento en el visor del sistema' },
        { id: 'bajar', re: /^descargar/i, rot: 'Bajar', tit: 'Descarga el documento, tal como el botón del sistema' },
        { id: 'datos', re: /^m[aá]s datos/i, rot: 'Datos', tit: 'Muestra los datos del documento' }
    ];

    const mandosDe = (celda) => !celda ? [] :
        [...celda.querySelectorAll('[title]')]
            .map(el => ({ el, t: (el.getAttribute('title') || '').trim() }))
            .map(x => ({ el: x.el, acc: ACC_DOC.find(a => a.re.test(x.t)) }))
            .filter(x => x.acc);

    // Columnas de la grilla de documentos que la ventana ya muestra por su
    // cuenta. Cualquier otra que el sistema agregue, como las tres que
    // despliega "Más Datos", cae en el detalle de cada documento.
    const COL_PROPIAS = ['orden', 'tipo de documento', 'numero documento', 'referencia',
        'fecha de asociacion', 'fecha de creacion', 'accion', 'acciones', ''];

    function leerDocs() {
        const G = grillaDocs();
        FALTA = [];
        if (!G) { DATOS = []; return false; }
        const i = (n) => G.tit.indexOf(n);
        const iOrd = i('orden'), iTip = i('tipo de documento'), iNum = i('numero documento');
        const iRef = i('referencia'), iAso = i('fecha de asociacion'), iCre = i('fecha de creacion');
        const iAcc = i('accion') >= 0 ? i('accion') : i('acciones');

        // Rótulos de las columnas que el sistema haya agregado de más.
        const heads = [...G.lb.querySelectorAll('.z-listhead .z-listheader')];
        const otras = G.tit.map((t, k) => ({ k, t, rot: (heads[k].innerText || '').trim() }))
            .filter(x => !COL_PROPIAS.includes(x.t));

        const out = [];
        for (const fila of G.lb.querySelectorAll('.z-listbox-body .z-listitem')) {
            const cs = [...fila.querySelectorAll('.z-listcell')];
            const numero = textoCelda(cs[iNum]);
            if (!numero) continue;
            const extra = [];
            for (const o of otras) {
                const v = textoCelda(cs[o.k]);
                if (v) extra.push([o.rot, v]);
            }
            out.push({
                orden: textoCelda(cs[iOrd]),
                tipo: textoCelda(cs[iTip]),
                numero,
                clave: numero.replace(/\s+/g, ''),
                referencia: textoCelda(cs[iRef]),
                asociacion: textoCelda(cs[iAso]),
                creacion: textoCelda(cs[iCre]),
                extra,
                mandos: mandosDe(cs[iAcc]).map(m => m.acc.id)
            });
        }
        DATOS = componerDocs(out);
        EXPTE = numeroExpediente();
        return true;
    }

    // ---- resumen de cada documento ----
    // Se compone con lo que el propio documento trae: la referencia entera,
    // los expedientes que cita y el tiempo que pasó desde el documento
    // anterior. Nada inferido: si la referencia sólo dice "Pase", se dice
    // que sólo dice eso.
    const RE_ACT = /(?:EX|IF|PV|RS|NO|ME|DI|RE|PL)-\d{4}-\d{5,}-?\s*-?GCABA-[A-Z]+/g;

    function fechaDe(t) {
        const m = String(t || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (!m) return null;
        const d = new Date(+m[3], +m[2] - 1, +m[1]);
        return isNaN(d.getTime()) ? null : d;
    }

    function componerDocs(filas) {
        const orden = filas.slice().sort((a, b) =>
            (parseInt(a.orden, 10) || 0) - (parseInt(b.orden, 10) || 0));
        const previa = {};
        let ultima = null;
        for (const d of orden) {
            previa[d.clave] = ultima;
            ultima = fechaDe(d.creacion) || ultima;
        }
        for (const d of filas) {
            const ref = (d.referencia || '').trim();
            const soloPase = /^pase\.?$/i.test(ref);
            // Sólo se anuncian las actuaciones citadas cuando la referencia
            // dice algo más que ellas; si la referencia ES la lista, repetirla
            // no agrega nada.
            const halladas = [...new Set((ref.match(RE_ACT) || []).map(x => x.replace(/\s+/g, ' ')))]
                .filter(x => x.replace(/\s+/g, '') !== (EXPTE || '').replace(/\s+/g, ''));
            const resto = halladas.reduce((t, x) => t.split(x).join(' '), ref)
                .replace(/[^a-záéíóúñ]/gi, '');
            const citas = resto.length >= 4 ? halladas : [];
            const antes = previa[d.clave], hoy = fechaDe(d.creacion);
            let dias = null;
            if (antes && hoy) dias = Math.round((hoy - antes) / 86400000);
            // El resumen no repite la referencia, que tiene columna propia:
            // dice lo que la referencia no dice.
            d.r = {
                sinRef: soloPase || !ref,
                citas,
                dias,
                plano: [soloPase || !ref ? 'pase, sin referencia propia' : '',
                    citas.length ? 'cita ' + citas.join(', ') : '',
                    dias !== null && dias > 0 ? dias + (dias === 1 ? ' día' : ' días') +
                        ' después del anterior' : ''].filter(Boolean).join(' · ')
            };
        }
        return filas;
    }

    // Acciona uno de los botones del sistema sobre un documento. Se vuelve
    // a ubicar la fila en la grilla original y se comprueba el rótulo antes
    // de accionar: no se acciona nada que no diga lo que se espera.
    function mandoDoc(claveDoc, idAcc) {
        const G = grillaDocs();
        if (!G) return { ok: false, msg: 'No se encuentra la lista de documentos.' };
        const iNum = G.tit.indexOf('numero documento');
        const iAcc = G.tit.indexOf('accion') >= 0 ? G.tit.indexOf('accion') : G.tit.indexOf('acciones');
        if (iNum < 0 || iAcc < 0) return { ok: false, msg: 'La lista no tiene las columnas esperadas.' };

        const fila = [...G.lb.querySelectorAll('.z-listbox-body .z-listitem')].find(f => {
            const cs = [...f.querySelectorAll('.z-listcell')];
            return textoCelda(cs[iNum]).replace(/\s+/g, '') === claveDoc;
        });
        if (!fila) return { ok: false, msg: 'El documento ya no figura en esta página.' };

        const celda = [...fila.querySelectorAll('.z-listcell')][iAcc];
        const m = mandosDe(celda).find(x => x.acc.id === idAcc);
        if (!m) return { ok: false, msg: 'El sistema no ofrece esa acción para este documento.' };
        if (!m.acc.re.test((m.el.getAttribute('title') || '').trim())) {
            return { ok: false, msg: 'El botón no dice lo esperado. Operación cancelada.' };
        }
        m.el.click();
        return { ok: true };
    }

    // Paginador propio del sistema, para poder moverlo desde esta ventana.
    function paginador() {
        const G = grillaDocs();
        if (!G) return null;
        const raiz = G.lb.closest('.z-window, .z-tabpanel, .z-div, body') || document.body;
        const caja = [...raiz.querySelectorAll('.z-paging')].find(vis);
        if (!caja) return null;
        const halla = (re) => [...caja.querySelectorAll('a,button,i,span,img')]
            .find(el => re.test(el.className || '') || re.test(el.getAttribute('title') || ''));
        // El número de página vive en un campo, cuyo valor no forma parte
        // del texto del bloque; el total, en cambio, va suelto tras la barra.
        const campo = caja.querySelector('input');
        const texto = caja.innerText || '';
        const par = texto.match(/(\d+)\s*\/\s*(\d+)/);
        const solo = texto.match(/\/\s*(\d+)/);
        return {
            primero: halla(/first|primer/i), anterior: halla(/prev|anterior/i),
            siguiente: halla(/next|siguiente/i), ultimo: halla(/last|ultim/i),
            pagina: campo ? (+campo.value || 1) : (par ? +par[1] : 1),
            total: par ? +par[2] : (solo ? +solo[1] : null)
        };
    }

    // ===================== GEDO =====================
    //
    // GEDO tiene varias solapas y cada una su propia grilla: Mis Tareas,
    // Porta Firma, Consultas. En vez de conocerlas una por una, se replica
    // la que esté a la vista, sea cual sea, con las columnas que traiga.
    // Lo único que se agrega es etiqueta y anotación, porque su columna
    // Referencia ya viene descriptiva y sin truncar: no hay asunto que
    // componer.

    const EN_GEDO = /\/gedo-web\//.test(location.pathname);

    function grillaGedo() {
        if (!EN_GEDO) return null;
        let mejor = null;
        for (const lb of document.querySelectorAll('.z-listbox')) {
            if (!vis(lb)) continue;
            const heads = [...lb.querySelectorAll('.z-listhead .z-listheader')];
            if (heads.length < 3) continue;
            const filas = lb.querySelectorAll('.z-listbox-body .z-listitem').length;
            const tit = heads.map(h => norm(h.innerText));
            if (!tit.some(t => t.includes('referencia'))) continue;
            // Con más de una a la vista gana la que tenga filas.
            if (!mejor || filas > mejor.filas) {
                mejor = { lb, heads, tit, filas,
                          rot: heads.map(h => (h.innerText || '').trim()) };
            }
        }
        return mejor;
    }

    // Sobre qué se cuelgan la etiqueta y la anotación. Si la fila nombra un
    // expediente, se usa ése: así lo anotado en el Expediente Electrónico
    // aparece acá y al revés. Si no, el número del documento. Y si tampoco,
    // el propio texto de la fila.
    // Acciones que la ventana NO replica. Son las que se apropian de algo o
    // lo destruyen: para ésas está el botón del propio sistema, que exige ir
    // a buscarlo. Vale el mismo criterio que con "Adquirir" en el Expediente
    // Electrónico.
    const ACC_VEDADAS = /adquirir|elimin|borrar|anular|dar de baja|desasign/i;

    const RE_EXP = /EX-\d{4}-\d{5,}-?\s*-?GCABA-[A-Z]+/;
    const RE_DOC = /(?:IF|PV|RS|NO|ME|DI|RE|PL|CO)-\d{4}-\d{5,}-?\s*-?GCABA-[A-Z]+/;

    function claveFila(valores) {
        const todo = valores.join(' ');
        const ex = todo.match(RE_EXP);
        if (ex) return { clave: ex[0].replace(/\s+/g, ''), de: 'expediente' };
        const doc = todo.match(RE_DOC);
        if (doc) return { clave: doc[0].replace(/\s+/g, ''), de: 'documento' };
        const t = norm(todo).slice(0, 120);
        return { clave: t ? 'fila:' + t : '', de: 'fila' };
    }

    function leerGedo() {
        const G = grillaGedo();
        FALTA = [];
        if (!G) { DATOS = []; return false; }

        // Columnas del sistema, salvo la de acciones.
        const cols = G.tit.map((t, k) => ({ k, t, rot: G.rot[k] }))
            .filter(x => x.t && !/^(accion|acciones)$/.test(x.t));
        const iAcc = G.tit.findIndex(t => /^(accion|acciones)$/.test(t));

        const out = [];
        for (const fila of G.lb.querySelectorAll('.z-listbox-body .z-listitem')) {
            const cs = [...fila.querySelectorAll('.z-listcell')];
            const valores = cols.map(c => textoCelda(cs[c.k]));
            if (!valores.some(v => v)) continue;
            const k = claveFila(valores);
            if (!k.clave) continue;
            const todos = iAcc >= 0 && cs[iAcc]
                ? [...cs[iAcc].querySelectorAll('[title]')]
                    .map(el => (el.getAttribute('title') || '').replace(/\s+/g, ' ').trim())
                    .filter(t => t && t.length <= 80)
                : [];
            const mandos = todos.filter(t => !ACC_VEDADAS.test(t));
            const vedados = todos.filter(t => ACC_VEDADAS.test(t));
            out.push({ valores, clave: k.clave, deQue: k.de, mandos, vedados,
                       ancla: valores.join(' § ') });
        }
        DATOS = out;
        COLS_GEDO = cols.map((c, i) => ({ k: 'c' + i, t: c.rot || c.t, i }));
        return true;
    }

    // Acciona un botón de la fila de GEDO. Se vuelve a ubicar la fila por su
    // contenido y se comprueba el rótulo del botón antes de accionar.
    function mandoGedo(ancla, titulo) {
        const G = grillaGedo();
        if (!G) return { ok: false, msg: 'No se encuentra el listado original.' };
        const cols = G.tit.map((t, k) => ({ k, t }))
            .filter(x => x.t && !/^(accion|acciones)$/.test(x.t));
        const iAcc = G.tit.findIndex(t => /^(accion|acciones)$/.test(t));
        if (iAcc < 0) return { ok: false, msg: 'El listado no tiene columna de acciones.' };

        const fila = [...G.lb.querySelectorAll('.z-listbox-body .z-listitem')].find(f => {
            const cs = [...f.querySelectorAll('.z-listcell')];
            return cols.map(c => textoCelda(cs[c.k])).join(' § ') === ancla;
        });
        if (!fila) return { ok: false, msg: 'La fila ya no figura en el listado.' };

        const celda = [...fila.querySelectorAll('.z-listcell')][iAcc];
        if (ACC_VEDADAS.test(titulo)) {
            return { ok: false, msg: 'Esa acción no se acciona desde esta ventana.' };
        }
        const el = [...celda.querySelectorAll('[title]')].find(x =>
            (x.getAttribute('title') || '').replace(/\s+/g, ' ').trim() === titulo);
        if (!el) return { ok: false, msg: 'El sistema ya no ofrece esa acción en esa fila.' };
        if ((el.getAttribute('title') || '').replace(/\s+/g, ' ').trim() !== titulo) {
            return { ok: false, msg: 'El botón no dice lo esperado. Operación cancelada.' };
        }
        el.click();
        return { ok: true };
    }

    function leer() {
        if (EN_GEDO) {
            MODO = 'gedo';
            return leerGedo();
        }

        // El expediente puede abrirse en una ventana propia por encima del
        // buzón, y entonces las dos grillas quedan a la vista al mismo
        // tiempo. Manda la de documentos: en el buzón no existe, así que no
        // hay confusión posible.
        if (grillaDocs()) {
            if (MODO !== 'expediente') { MODO = 'expediente'; docAbierto = null; }
            return leerDocs();
        }

        const G = grilla();
        docAbierto = null;
        EXPTE_MANO = '';
        if (!G) { MODO = 'buzon'; DATOS = []; FALTA = []; return false; }
        MODO = 'buzon';
        EXPTE = '';
        FALTA = [];

        const i = (n) => G.tit.indexOf(n);
        const iEst = i('tarea/estado'), iFec = i('fecha ult. modif.'), iExp = i('numero expediente');
        const iCod = i('codigo tramite'), iDes = i('descripcion del tramite');
        const iPase = i('motivo pase'), iMot = i('motivo caratulacion'), iUsu = i('usuario anterior');

        if (iCod < 0 && iDes < 0) FALTA.push('Código de Trámite');
        if (iMot < 0) FALTA.push('Motivo Caratulación');

        const out = [];
        for (const fila of G.lb.querySelectorAll('.z-listbox-body .z-listitem')) {
            const cs = [...fila.querySelectorAll('.z-listcell')];
            const cod = textoCelda(cs[iCod]), des = textoCelda(cs[iDes]);
            if (!cod && !des) continue;
            const mot = textoCelda(cs[iMot]);
            const numero = textoCelda(cs[iExp]);
            out.push({
                estado: textoCelda(cs[iEst]),
                fecha: textoCelda(cs[iFec]),
                numero,
                clave: numero.replace(/\s+/g, ''),
                codigo: cod,
                tramite: des,
                pase: textoCelda(cs[iPase]),
                motivo: mot,
                usuario: textoCelda(cs[iUsu]),
                a: componer(cod, des, esVacio(mot) ? '' : mot)
            });
        }
        DATOS = out;
        return true;
    }

    // ===================== TRAMITAR =====================
    // Da la orden al listado original. Se opera de a una actuación por
    // vez. Antes de accionar se comprueba que la opción diga exactamente
    // "Tramitar": si dijera otra cosa, se cancela.

    function tramitar(clave) {
        const G = grilla();
        if (!G) return { ok: false, msg: 'No se encuentra el listado original.' };

        const iExp = G.tit.indexOf('numero expediente');
        const iAcc = G.tit.indexOf('acciones');
        if (iExp < 0 || iAcc < 0) return { ok: false, msg: 'El listado no tiene las columnas esperadas.' };

        const fila = [...G.lb.querySelectorAll('.z-listbox-body .z-listitem')].find(f => {
            const cs = [...f.querySelectorAll('.z-listcell')];
            return textoCelda(cs[iExp]).replace(/\s+/g, '') === clave;
        });
        if (!fila) return { ok: false, msg: 'La actuación ya no figura en el listado. Actualice y vuelva a intentarlo.' };

        const celda = [...fila.querySelectorAll('.z-listcell')][iAcc];
        if (!celda) return { ok: false, msg: 'La fila no tiene columna de acciones.' };

        const item = [...celda.querySelectorAll('.z-comboitem')]
            .find(li => norm(li.innerText) === 'tramitar');
        if (!item) return { ok: false, msg: 'La fila no ofrece la opción Tramitar.' };

        // Doble control antes de accionar. No se acciona nada que no diga
        // exactamente "Tramitar".
        if (norm(item.innerText) !== 'tramitar') {
            return { ok: false, msg: 'La opción no dice Tramitar. Operación cancelada.' };
        }

        item.click();
        return { ok: true };
    }

    // ===================== COPIAR =====================
    // Se intenta primero el portapapeles del navegador. Si no estuviera
    // disponible se recurre al método anterior, con un campo temporal, que
    // funciona igual porque todo se dispara desde un click del usuario.

    function copiar(texto, boton) {
        const listo = () => {
            if (!boton) return;
            const antes = boton.innerHTML;
            boton.textContent = '✓'; boton.classList.add('ok');
            setTimeout(() => { boton.innerHTML = antes; boton.classList.remove('ok'); }, 1200);
        };
        const viejo = () => {
            try {
                const ta = document.createElement('textarea');
                ta.value = texto;
                ta.style.cssText = 'position:fixed;left:-9999px;top:0';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                ta.remove();
                listo();
            } catch {}
        };
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(texto).then(listo, viejo);
                return;
            }
        } catch {}
        viejo();
    }

    // ===================== ABRIR UNA ACTUACIÓN =====================
    // Tramitar recarga la página, de modo que si se accionara en esta
    // misma pestaña se perdería el listado junto con la búsqueda y el
    // orden. Para evitarlo se deja anotado un encargo y se abre una
    // pestaña nueva: allí la herramienta lo levanta y acciona Tramitar
    // sobre esa actuación. Esta pestaña queda intacta.

    function avisar(txt, seg) {
        const av = win && win.querySelector('.eea-aviso');
        if (!av) return;
        av.style.display = ''; av.textContent = txt;
        if (seg) setTimeout(() => { av.style.display = 'none'; }, seg * 1000);
    }

    function abrirActuacion(clave) {
        if (CFG.enPestanaNueva) {
            try {
                localStorage.setItem(ENCARGO, JSON.stringify({ clave, ts: Date.now() }));
            } catch { /* sin almacenamiento se sigue por el otro camino */ }

            const nueva = window.open(location.origin + '/expedientes-web/', '_blank');
            if (nueva) {
                avisar('Se abre ' + clave + ' en una pestaña nueva. Este listado permanece sin cambios.', 6);
                return;
            }
            // El navegador bloqueó la pestaña: se retira el encargo para
            // que no lo levante otra pestaña por error y se sigue aquí.
            try { localStorage.removeItem(ENCARGO); } catch {}
        }

        const r = tramitar(clave);
        if (r.ok) { win.classList.add('eea-min'); plegado(true); }
        else avisar(r.msg);
    }

    // Al arrancar, si hay un encargo reciente, esta pestaña es la que se
    // abrió para tramitar: lo cumple y no muestra el listado.
    function cumplirEncargo() {
        let e = null;
        try { e = JSON.parse(localStorage.getItem(ENCARGO) || 'null'); } catch {}
        if (!e || !e.clave) return false;
        try { localStorage.removeItem(ENCARGO); } catch {}
        if (Date.now() - (e.ts || 0) > 60000) return false;   // encargo vencido

        // El listado puede tardar en aparecer. Se espera hasta veinte
        // segundos antes de darlo por perdido.
        const t0 = Date.now();
        const intento = setInterval(() => {
            const r = tramitar(e.clave);
            if (!r.ok && Date.now() - t0 <= 20000) return;
            clearInterval(intento);
            if (!r.ok) { abrir(); avisar('No fue posible abrir ' + e.clave + '. ' + r.msg); return; }
            // Accionado Tramitar, se espera a que aparezca el expediente y
            // se vuelve a mostrar la herramienta, ya en su vista.
            const espera = setInterval(() => {
                if (!grillaDocs() && Date.now() - t0 < 40000) return;
                clearInterval(espera);
                abrir();
            }, 800);
        }, 900);
        return true;
    }

    // ===================== ARCHIVOS =====================
    //
    // Todo se arma en el navegador. No hay pedidos a ningún servidor ni
    // librerías traídas de afuera.

    function bajar(datos, nombre, tipo) {
        try {
            const url = URL.createObjectURL(new Blob([datos], { type: tipo }));
            const a = document.createElement('a');
            a.href = url; a.download = nombre;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 4000);
            return true;
        } catch { avisar('El navegador no permitió generar el archivo.'); return false; }
    }

    const selloFecha = () => new Date().toISOString().slice(0, 10);

    // --- etiquetas y anotaciones, para llevar a otra computadora ---

    function exportarMarcas() {
        const datos = JSON.stringify({
            formato: 'ee-ayudante/marcas',
            version: 1,
            fecha: new Date().toISOString(),
            etiquetas: MARCAS.etiquetas,
            filas: MARCAS.filas
        }, null, 1);
        bajar(datos, 'EE-ayudante-etiquetas-' + selloFecha() + '.json', 'application/json');
    }

    // La importación no borra lo que ya hay: agrega las etiquetas que
    // falten y, en las actuaciones que vengan repetidas, une las etiquetas
    // y conserva las dos anotaciones cuando difieren.
    function importarMarcas(texto) {
        let d;
        try { d = JSON.parse(texto); } catch { return 'El archivo no es un JSON válido.'; }
        if (!d || d.formato !== 'ee-ayudante/marcas' || !d.filas) {
            return 'El archivo no es una exportación de EE ayudante.';
        }
        const mapa = {};                       // id de origen -> id acá
        for (const e of (d.etiquetas || [])) {
            if (!e || !e.id || !e.nom) continue;
            const igual = MARCAS.etiquetas.find(x => norm(x.nom) === norm(e.nom));
            if (igual) { mapa[e.id] = igual.id; continue; }
            const id = crearEtiqueta(e.nom, e.color);
            if (id) mapa[e.id] = id;
        }
        let filas = 0;
        for (const k of Object.keys(d.filas)) {
            const orig = d.filas[k] || {};
            const acá = marcaDe(k);
            const et = acá.et.slice();
            for (const x of (orig.et || [])) {
                const id = mapa[x] || x;
                if (etiquetaDe(id) && !et.includes(id)) et.push(id);
            }
            let nota = acá.nota || '';
            const otra = String(orig.nota || '').trim();
            if (otra && otra !== nota.trim()) nota = nota ? nota + '\n\n' + otra : otra;
            if (et.length || nota.trim()) { MARCAS.filas[k] = { et, nota }; filas++; }
        }
        guardarMarcas();
        return { etiquetas: MARCAS.etiquetas.length, filas };
    }

    // --- libro de Excel ---
    //
    // Un .xlsx es un ZIP con unos pocos XML adentro. Se arma acá mismo:
    // las entradas se guardan sin comprimir, que el formato admite, de
    // modo que sólo hace falta calcular el CRC de cada una.

    const TABLA_CRC = (() => {
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
            t[n] = c >>> 0;
        }
        return t;
    })();
    const crc32 = (u8) => {
        let c = 0xffffffff;
        for (let i = 0; i < u8.length; i++) c = TABLA_CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
    };
    const utf8 = (s) => new TextEncoder().encode(s);

    function zip(entradas) {
        const u16 = (n) => [n & 255, (n >>> 8) & 255];
        const u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
        const bloques = [], dirs = [];
        let off = 0;
        for (const e of entradas) {
            const nom = utf8(e.nombre), dat = e.datos, crc = crc32(dat);
            const local = Uint8Array.from([80, 75, 3, 4].concat(
                u16(20), u16(0x0800), u16(0), u16(0), u16(0),
                u32(crc), u32(dat.length), u32(dat.length), u16(nom.length), u16(0)));
            bloques.push(local, nom, dat);
            dirs.push(Uint8Array.from([80, 75, 1, 2].concat(
                u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
                u32(crc), u32(dat.length), u32(dat.length), u16(nom.length),
                u16(0), u16(0), u16(0), u16(0), u32(0), u32(off), [].slice.call(nom))));
            off += local.length + nom.length + dat.length;
        }
        const largoDir = dirs.reduce((n, d) => n + d.length, 0);
        const fin = Uint8Array.from([80, 75, 5, 6].concat(
            u16(0), u16(0), u16(dirs.length), u16(dirs.length), u32(largoDir), u32(off), u16(0)));
        const todo = bloques.concat(dirs, [fin]);
        const out = new Uint8Array(todo.reduce((n, x) => n + x.length, 0));
        let q = 0;
        for (const x of todo) { out.set(x, q); q += x.length; }
        return out;
    }

    const xml = (v) => String(v == null ? '' : v)
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const columnaLetra = (n) => {
        let s = '';
        n++;
        while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; }
        return s;
    };

    function libroExcel(cabeceras, filas, anchos, hoja1) {
        hoja1 = (hoja1 || 'Listado').replace(/[\\/*?:[\]]/g, ' ').slice(0, 31);
        const celda = (v, col, fil, estilo) =>
            '<c r="' + columnaLetra(col) + fil + '" t="inlineStr"' + (estilo ? ' s="' + estilo + '"' : '') +
            '><is><t xml:space="preserve">' + xml(v) + '</t></is></c>';
        const filaXML = (vals, fil, estilo) =>
            '<row r="' + fil + '">' + vals.map((v, i) => celda(v, i, fil, estilo)).join('') + '</row>';

        const hoja =
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
            '<sheetPr><outlinePr summaryBelow="1" summaryRight="1"/></sheetPr>' +
            '<cols>' + anchos.map((w, i) =>
                '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('') +
            '</cols><sheetData>' +
            filaXML(cabeceras, 1, 1) +
            filas.map((f, i) => filaXML(f, i + 2, 2)).join('') +
            '</sheetData>' +
            '<autoFilter ref="A1:' + columnaLetra(cabeceras.length - 1) + (filas.length + 1) + '"/>' +
            '</worksheet>';

        const estilos =
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
            '<fonts count="2">' +
            '<font><sz val="10"/><name val="Calibri"/><color rgb="FF38485C"/></font>' +
            '<font><b/><sz val="10"/><name val="Calibri"/><color rgb="FF38485C"/></font>' +
            '</fonts>' +
            '<fills count="3"><fill><patternFill patternType="none"/></fill>' +
            '<fill><patternFill patternType="gray125"/></fill>' +
            '<fill><patternFill patternType="solid"><fgColor rgb="FFFFDB2E"/>' +
            '<bgColor indexed="64"/></patternFill></fill></fills>' +
            '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
            '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
            '<cellXfs count="3">' +
            '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
            '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
            '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1">' +
            '<alignment vertical="top" wrapText="1"/></xf>' +
            '</cellXfs>' +
            '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
            '</styleSheet>';

        return zip([
            { nombre: '[Content_Types].xml', datos: utf8(
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
                '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
                '<Default Extension="xml" ContentType="application/xml"/>' +
                '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
                '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
                '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
                '</Types>') },
            { nombre: '_rels/.rels', datos: utf8(
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
                '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
                '</Relationships>') },
            { nombre: 'xl/workbook.xml', datos: utf8(
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
                'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
                '<sheets><sheet name="' + xml(hoja1) + '" sheetId="1" r:id="rId1"/></sheets>' +
                '</workbook>') },
            { nombre: 'xl/_rels/workbook.xml.rels', datos: utf8(
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
                '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
                '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
                '</Relationships>') },
            { nombre: 'xl/styles.xml', datos: utf8(estilos) },
            { nombre: 'xl/worksheets/sheet1.xml', datos: utf8(hoja) }
        ]);
    }

    const marcasDe = (clave) => [etiquetasDe(clave).map(e => e.nom).join(', '),
        marcaDe(clave).nota || ''];

    // Cada pantalla exporta sus propias columnas. Siempre se exporta lo que
    // está a la vista: si hay una búsqueda o un filtro de etiqueta puestos,
    // sale eso y no el listado entero.
    function tablaExportable() {
        if (MODO === 'gedo') {
            const f = norm(filtro);
            const texto = (d) => d.valores.join(' ') + ' ' + marcasDe(d.clave).join(' ');
            const L = porEtiqueta(!f ? DATOS.slice() : DATOS.filter(d => norm(texto(d)).includes(f)));
            return {
                cabeceras: COLS_GEDO.map(c => c.t).concat(['Etiquetas', 'Anotación']),
                filas: L.map(d => d.valores.concat(marcasDe(d.clave))),
                anchos: COLS_GEDO.map(() => 30).concat([22, 46]),
                nombre: 'GEDO-' + selloFecha() + '.xlsx',
                cuantos: L.length, que: 'filas', hoja: 'GEDO'
            };
        }

        if (MODO === 'expediente') {
            const f = norm(filtro);
            const L = !f ? DATOS.slice() : DATOS.filter(d =>
                norm([d.orden, d.tipo, d.numero, d.referencia, d.asociacion, d.creacion,
                    d.r ? d.r.plano : '', marcasDe(d.clave).join(' ')].join(' ')).includes(f));
            return {
                cabeceras: ['Orden', 'Tipo de documento', 'Número de documento', 'Referencia',
                    'Resumen', 'Fecha de asociación', 'Fecha de creación', 'Etiquetas', 'Anotación'],
                filas: L.map(d => [d.orden, d.tipo, d.numero, d.referencia,
                    d.r ? d.r.plano : '', d.asociacion, d.creacion].concat(marcasDe(d.clave))),
                anchos: [8, 24, 32, 46, 44, 20, 20, 22, 46],
                nombre: 'EE-' + (EXPTE ? EXPTE.replace(/[^\w-]+/g, '') + '-' : '') +
                    selloFecha() + '.xlsx',
                cuantos: L.length, que: 'documentos', hoja: 'Documentos'
            };
        }

        const L = filtradas();
        return {
            cabeceras: ['Estado', 'Última modificación', 'Expediente', 'Código de trámite',
                'Descripción del trámite', 'Asunto', 'Referencia', 'Documento', 'Inmueble',
                'Expediente judicial', 'Juzgado', 'Motivo del pase', 'Usuario anterior',
                'Motivo de caratulación', 'Etiquetas', 'Anotación'],
            filas: L.map(d => [d.estado, d.fecha, d.numero, d.codigo, d.tramite, d.a.plano,
                d.a.particular, d.a.documento, d.a.inmueble, d.a.expediente, d.a.juzgado,
                d.pase, d.usuario, d.motivo].concat(marcasDe(d.clave))),
            anchos: [13, 19, 30, 13, 34, 46, 34, 13, 28, 15, 30, 30, 18, 52, 22, 46],
            nombre: 'EE-buzon-' + selloFecha() + '.xlsx',
            cuantos: L.length, que: 'actuaciones', hoja: 'Buzon de Tareas'
        };
    }

    function exportarExcel() {
        const t = tablaExportable();
        if (!t.filas.length) { avisar('No hay nada para exportar en esta pantalla.'); return; }
        bajar(libroExcel(t.cabeceras, t.filas, t.anchos, t.hoja), t.nombre,
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        avisar('Se exportaron ' + t.cuantos + ' ' + t.que + ' a Excel.', 5);
    }

    // ===================== ESTILOS =====================
    //
    // La paleta es la institucional del Gobierno de la Ciudad, tomada de
    // Obelisco, su sistema de diseño: amarillo #ffdb2e sobre pizarra
    // #38485c, con sus tonos de apoyo. El Expediente Electrónico es azul,
    // de modo que la ventana se distingue de él a simple vista, que es
    // justamente lo que se busca: que quien mire la pantalla advierta de
    // inmediato que está viendo otra aplicación.
    //
    //   #ffdb2e  amarillo institucional     #ffd408  amarillo, al pasar
    //   #facf00  borde del amarillo         #edc400  borde acentuado
    //   #38485c  pizarra, texto principal   #425266  pizarra clara
    //   #665812  texto sobre crema          #69788a  texto secundario
    //   #fffbea  crema                      #fff6d1  crema acentuado
    //   #d1d8e0  borde neutro               #8a98a8  texto tenue

    const CSS = `
    #eea *,#eea-abrir{box-sizing:border-box}
    #eea-fondo{position:fixed;inset:0;background:rgba(56,72,92,.55);z-index:2147482000;
      backdrop-filter:blur(1.5px)}
    #eea{position:fixed;z-index:2147482100;background:#fffbea;border-radius:8px;
      box-shadow:0 18px 60px rgba(25,32,41,.5);display:flex;flex-direction:column;
      font:13px/1.45 "Segoe UI",Arial,sans-serif;color:#38485c;overflow:hidden;
      min-width:560px;min-height:320px}
    #eea.eea-max{border-radius:0;box-shadow:none}
    #eea.eea-min{height:auto!important;min-height:0;width:320px!important;border-radius:6px}
    #eea.eea-min .eea-zoom,
    #eea.eea-min .eea-cuerpo,#eea.eea-min .eea-ficha,#eea.eea-min .eea-about,
    #eea.eea-min .eea-pie,#eea.eea-min .eea-barra,#eea.eea-min .eea-aviso,
    #eea.eea-min .eea-rz{display:none}
    #eea.eea-max .eea-rz{display:none}

    /* --- barra de título --- */
    .eea-tit{display:flex;align-items:center;gap:10px;background:#ffdb2e;color:#38485c;
      padding:0 6px 0 12px;height:38px;cursor:move;user-select:none;flex:none}
    .eea-tit .eea-marca{font-weight:700;letter-spacing:.02em;white-space:nowrap}
    .eea-tit .eea-v{opacity:.6;font-size:11px}
    .eea-tit .eea-sub{opacity:.8;font-size:11px;margin-left:2px;
      border-left:1px solid rgba(56,72,92,.3);padding-left:10px;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .eea-tit .eea-zoom{margin-left:auto;display:flex;align-items:center;gap:1px;flex:none;
      border-right:1px solid rgba(56,72,92,.25);padding-right:8px;margin-right:4px}
    /* El grupo de la derecha se pega al borde haya o no zoom: con zoom, el
       auto lo pone el zoom y los controles lo siguen; sin zoom, el auto lo
       toman los controles. Es el caso de la ventana de Acerca de. */
    .eea-tit .eea-zoom + .eea-ctrl{margin-left:0}
    .eea-zoom button{background:transparent;border:0;color:#38485c;cursor:pointer;height:24px;
      font:600 14px/1 "Segoe UI",Arial,sans-serif;width:26px;border-radius:4px;
      display:inline-flex;align-items:center;justify-content:center}
    .eea-zoom button.eea-zoom-n{width:auto;padding:0 8px;font-size:11px;font-weight:600;
      font-variant-numeric:tabular-nums}
    .eea-zoom button:hover{background:rgba(56,72,92,.15)}
    .eea-tit .eea-ctrl{margin-left:auto;display:flex;align-items:center;gap:2px;flex:none}
    .eea-ctrl button{background:transparent;border:0;color:#38485c;cursor:pointer;
      font:400 15px/1 "Segoe UI",Arial,sans-serif;height:26px;width:30px;border-radius:4px;
      display:inline-flex;align-items:center;justify-content:center}
    .eea-ctrl button:hover{background:rgba(56,72,92,.15)}
    .eea-ctrl button.eea-x:hover{background:#c93b3b;color:#fff}

    /* --- barra de herramientas --- */
    /* Todos los controles de la barra miden exactamente lo mismo y se
       alinean por su centro. Los <select> van con appearance:none y flecha
       propia: el select nativo tiene métricas internas que varían según el
       sistema y el nivel de zoom, y era lo que rompía la línea. */
    .eea-barra{display:flex;align-items:center;gap:8px;padding:9px 12px;background:#fffbea;
      border-bottom:1px solid #efe4bd;flex:none;flex-wrap:wrap}
    .eea-barra > *{flex:none;align-self:center;box-sizing:border-box;
      height:30px;min-height:30px;max-height:30px;margin:0;border-radius:5px;
      font:12px/28px "Segoe UI",Arial,sans-serif;vertical-align:middle}
    .eea-busca{flex:1 1 240px;min-width:200px;display:flex;align-items:center;gap:7px;
      border:1px solid #e3d9b5;padding:0 9px;background:#fff}
    .eea-busca input{border:0;outline:0;flex:1;height:26px;background:transparent;
      font:13px/26px "Segoe UI",Arial,sans-serif;color:#38485c;padding:0}
    .eea-barra select{appearance:none;-webkit-appearance:none;-moz-appearance:none;
      border:1px solid #facf00;background-color:#fff6d1;color:#665812;cursor:pointer;
      padding:0 28px 0 11px;
      background-image:url("data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='9' height='6'%3E%3Cpath fill='%23665812' d='M0 0h9L4.5 6z'/%3E%3C/svg%3E");
      background-repeat:no-repeat;background-position:right 10px center;background-size:9px 6px}
    .eea-barra select:hover{background-color:#ffec9e}
    .eea-b{border:1px solid #facf00;background:#fff6d1;padding:0 11px;cursor:pointer;
      color:#665812;display:inline-flex;align-items:center;justify-content:center;gap:6px}
    .eea-b:hover{background:#ffec9e}
    .eea-b input{margin:0}
    /* inline-block y no inline-flex: en flex cada nodo de texto es un ítem
       y el navegador descarta los espacios que los separan. */
    .eea-cont{margin-left:auto;color:#69788a;white-space:nowrap;
      display:inline-block;line-height:30px}
    .eea-cont b{color:#38485c}

    .eea-aviso{background:#fff6d1;border-bottom:1px solid #facf00;color:#665812;
      padding:7px 12px;font-size:12px;flex:none}

    /* --- tabla --- */
    .eea-cuerpo{flex:1;overflow-x:auto;overflow-y:scroll;background:#fffbea}
    .eea-cuerpo .eea-resumen + table.eea-t th{top:0}
    table.eea-t{width:100%;min-width:1180px;table-layout:fixed;border-collapse:collapse;background:#fff}
    table.eea-t th{position:sticky;top:0;z-index:2;background:#38485c;color:#fff;
      text-align:left;font-weight:600;font-size:12px;padding:9px 10px;white-space:nowrap;
      cursor:pointer;user-select:none}
    table.eea-t th:hover{background:#425266}
    table.eea-t th.eea-th-acc{cursor:default;text-align:right}
    table.eea-t th.eea-th-acc:hover{background:#38485c}
    table.eea-t th .fl{opacity:.5;margin-left:5px;font-size:10px}
    table.eea-t th.act .fl{opacity:1;color:#ffdb2e}
    table.eea-t td{padding:8px 10px;font-size:12.5px;border-bottom:1px solid #eee6cf;
      vertical-align:top;overflow-wrap:anywhere}
    /* Los botones se alinean con la primera línea de la fila, no con su
       centro: así quedan en columna aunque las filas tengan alturas
       distintas. */
    table.eea-t td.eea-td-acc{vertical-align:top;white-space:nowrap;padding-top:7px}
    table.eea-t tr:nth-child(even) td{background:#fffbea}
    table.eea-t tr:hover td{background:#fff6d1}
    .eea-num{font-family:Consolas,monospace;font-size:12px;color:#38485c}
    .eea-num-l{display:flex;align-items:flex-start;gap:2px}
    /* break-word y no anywhere: anywhere achica el ancho mínimo del texto y
       el número se parte aunque entre entero. */
    .eea-num-l span{flex:0 1 auto;min-width:0;font-size:11.5px;word-break:normal;
      overflow-wrap:break-word}
    .eea-num-l .eea-cp{flex:none}
    .eea-fec{color:#69788a;font-size:12px;overflow-wrap:anywhere}
    .eea-tipo{font-weight:700;color:#665812;display:block}
    .eea-par{font-weight:600;color:#38485c}
    .eea-sec{color:#69788a}
    .eea-nada{color:#8a98a8;font-style:italic}
    .eea-cp{border:0;background:transparent;cursor:pointer;padding:0 5px;font-size:12px;
      color:#9eaab8;line-height:1;vertical-align:middle}
    .eea-cp:hover{color:#38485c}
    .eea-cp.ok{color:#26874a}
    .eea-cod{font-family:Consolas,monospace;font-size:11.5px;color:#69788a;overflow-wrap:anywhere}

    /* --- etiquetas y anotaciones --- */
    .eea-chip{display:inline-block;padding:1px 9px;border-radius:10px;font:600 11px "Segoe UI",Arial,sans-serif;
      color:#38485c;margin:0 4px 3px 0;white-space:nowrap;border:1px solid rgba(56,72,92,.2)}
    .eea-chip.eea-off{background:transparent!important;color:#8a98a8!important;
      border-style:dashed;border-color:rgba(56,72,92,.3)!important}
    button.eea-chip{cursor:pointer}
    .eea-toque{cursor:pointer;min-height:20px;border-radius:4px;margin:-3px -5px;padding:3px 5px}
    .eea-toque:hover{background:rgba(255,219,46,.28);box-shadow:inset 0 0 0 1px #facf00}
    .eea-poner{color:#b8c1cc;font-size:11.5px;font-weight:600;visibility:hidden}
    table.eea-t tr:hover .eea-poner{visibility:visible}
    .eea-toque:hover .eea-poner{color:#665812}
    .eea-vacio{color:#cbd3dc}
    .eea-nota-ic{color:#a8850f;font-size:12px;margin-left:3px}
    table.eea-t td .eea-cod.eea-num-l{margin-top:2px}
    .eea-nota-txt{color:#425266;font-size:12px;line-height:1.4;
      display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}

    .eea-et-nueva{display:flex;align-items:center;gap:8px;margin:12px 0 0;flex-wrap:wrap}
    .eea-et-nueva > *{height:30px;flex:none}
    .eea-et-nueva input[type=text]{border:1px solid #e3d9b5;border-radius:5px;
      padding:0 10px;font:12px "Segoe UI",Arial,sans-serif;color:#38485c;width:240px}
    .eea-et-colores{display:inline-flex;align-items:center;gap:5px}
    .eea-col{width:22px;height:22px;border-radius:50%;cursor:pointer;padding:0;
      border:2px solid rgba(56,72,92,.22);flex:none}
    .eea-col.sel{border-color:#38485c;box-shadow:0 0 0 2px #fffbea,0 0 0 3px #38485c}
    .eea-nota{width:100%;min-height:96px;border:1px solid #e3d9b5;border-radius:5px;padding:9px 11px;
      font:13px/1.5 "Segoe UI",Arial,sans-serif;color:#38485c;background:#fff;resize:vertical}
    .eea-nota:focus{outline:2px solid #ffdb2e;outline-offset:-1px}
    .eea-nota-pie{display:flex;align-items:center;gap:10px;margin-top:8px}
    .eea-nota-pie .eea-b{height:28px;flex:none}
    .eea-nota-guardar.eea-pend{background:#ffdb2e;border-color:#edc400;color:#38485c;
      font-weight:600}
    .eea-nota-guardar.eea-pend::after{content:" los cambios"}
    .eea-nota-pie .eea-borrar{height:28px}
    .eea-guardado{font-size:12px;color:#26874a;font-weight:600;opacity:0;
      transition:opacity .15s}
    .eea-guardado::before{content:"✓ "}
    .eea-guardado.eea-ok{opacity:1}

    /* --- panel de datos --- */
    .eea-datos{flex:1;overflow-y:scroll;overflow-x:auto;background:#fffbea}
    .eea-datos-in{max-width:760px;margin:0 auto;padding:26px 30px 40px}
    .eea-datos h2{margin:0 0 4px;font-size:19px;color:#38485c}
    .eea-datos h3{margin:24px 0 6px;font-size:13px;color:#665812;
      border-bottom:1px solid #facf00;padding-bottom:4px}
    .eea-datos p{margin:0 0 10px;font-size:13px;line-height:1.55;color:#425266}
    .eea-datos .eea-bts{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px}
    .eea-datos .eea-bts button{height:30px}
    .eea-et-tabla{width:100%;border-collapse:collapse;margin-top:4px}
    .eea-et-tabla td{padding:6px 8px 6px 0;border-bottom:1px solid #eee6cf;font-size:12.5px}
    .eea-et-tabla td.der{text-align:right;width:1%;white-space:nowrap}
    .eea-et-tabla .uso{color:#69788a;font-size:12px}
    .eea-borrar{height:26px;padding:0 10px;border:1px solid #d1d8e0;background:#fff;color:#425266;
      border-radius:4px;font:12px "Segoe UI",Arial,sans-serif;cursor:pointer}
    .eea-borrar:hover{border-color:#c93b3b;color:#c93b3b}
    .eea-borrar.confirmar{background:#c93b3b;border-color:#c93b3b;color:#fff}

    /* --- botones de cada fila, alineados en columna --- */
    .eea-acc{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap}
    .eea-acc button.eea-acc-g{width:auto;min-width:0;padding:0 10px}
    .eea-acc button{height:28px;width:70px;padding:0;border-radius:4px;
      font:600 12px "Segoe UI",Arial,sans-serif;cursor:pointer;white-space:nowrap;
      display:inline-flex;align-items:center;justify-content:center}
    .eea-ver{border:1px solid #d1d8e0;background:#fff;color:#425266}
    .eea-ver:hover{background:#f3f6f9;border-color:#b8c1cc}
    .eea-tram{border:1px solid #facf00;background:#ffdb2e;color:#38485c}
    .eea-tram:hover{background:#ffd408;border-color:#edc400}

    /* --- resumen del expediente abierto --- */
    .eea-resumen{background:#fffbea;border-bottom:1px solid #efe4bd;padding:14px 16px 16px;
      position:relative}
    .eea-resumen > .eea-res-plegar{position:absolute;right:16px;top:12px;height:28px;z-index:2}
    .eea-resumen.eea-plegado .eea-res-cuerpo{display:none}
    .eea-res-cuerpo{display:grid;grid-template-columns:minmax(320px,1fr) minmax(340px,1fr);
      gap:18px 34px;align-items:start}
    .eea-res-der{border-left:1px solid #efe4bd;padding-left:22px;padding-right:96px}
    .eea-res-der h2{margin:0 0 2px;font:600 15px Consolas,monospace;color:#38485c;
      overflow-wrap:anywhere}
    .eea-res-der h3{margin:12px 0 4px;font-size:11px;color:#665812;letter-spacing:.05em;
      text-transform:uppercase;border-bottom:1px solid #facf00;padding-bottom:3px}
    .eea-res-der .eea-nota{min-height:56px}
    .eea-res-der .eea-et-nueva{margin-top:8px}
    .eea-res-der .eea-et-nueva input[type=text]{width:170px}
    .eea-ex-mano{display:flex;align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap}
    .eea-ex-mano input{height:30px;border:1px solid #e3d9b5;border-radius:5px;padding:0 10px;
      font:12px Consolas,monospace;color:#38485c;width:250px}
    .eea-ex-mano .eea-b{height:30px}
    @media (max-width:1100px){
      .eea-res-cuerpo{grid-template-columns:1fr}
      .eea-res-der{border-left:0;padding-left:0;padding-right:0;border-top:1px solid #efe4bd;
        padding-top:12px}
    }
    .eea-datos-linea{display:flex;flex-wrap:wrap;gap:10px 26px}
    .eea-dato{display:flex;flex-direction:column;gap:2px}
    .eea-dato span{font-size:11px;color:#69788a;letter-spacing:.03em;text-transform:uppercase}
    .eea-dato b{font-size:13px;color:#38485c;font-weight:600}
    .eea-dato b i{color:#8a98a8;font-weight:400}
    .eea-tipos{margin-top:12px;font-size:12.5px;color:#425266;background:#fff;
      border:1px solid #eee6cf;border-radius:5px;padding:8px 11px}
    .eea-tipos b{color:#665812}
    .eea-resumen .eea-sin{margin:6px 0 0;font-size:12.5px;color:#8a98a8;font-style:italic}
    .eea-orden{font-family:Consolas,monospace;color:#69788a}

    /* --- detalle de un documento --- */
    table.eea-t tr.eea-fila-abierta td{background:#fff6d1!important;
      box-shadow:inset 0 2px 0 #ffdb2e}
    table.eea-t tr.eea-det td{background:#fffdf2!important;padding:0;
      border-bottom:2px solid #facf00}
    .eea-det-in{padding:14px 18px 18px;max-width:900px}
    .eea-det-cab{display:flex;align-items:center;gap:12px;font-size:13px;color:#425266;
      padding-bottom:10px;border-bottom:1px solid #eee6cf}
    .eea-det-cab b{font-family:Consolas,monospace;color:#38485c;flex:1}
    .eea-det-cab .eea-b{height:28px;flex:none}
    .eea-det-dl{margin:12px 0 0;display:grid;grid-template-columns:200px 1fr}
    .eea-det-dl dt{padding:6px 12px 6px 0;font-size:12px;color:#69788a;
      border-bottom:1px solid #f2ecda}
    .eea-det-dl dd{margin:0;padding:6px 0;font-size:12.5px;color:#38485c;
      border-bottom:1px solid #f2ecda;overflow-wrap:anywhere}
    .eea-det .eea-marca-caja h3{margin:18px 0 4px;font-size:11.5px;color:#665812;
      letter-spacing:.05em;text-transform:uppercase;border-bottom:1px solid #facf00;
      padding-bottom:4px}
    .eea-det .eea-nota{min-height:64px}
    .eea-det .eea-sin{margin:12px 0 0;font-size:12.5px;color:#8a98a8;font-style:italic}

    /* --- ficha --- */
    .eea-ficha{flex:1;overflow-y:scroll;overflow-x:auto;background:#fffbea}
    .eea-ficha-in{max-width:880px;margin:0 auto;padding:22px 30px 40px}
    .eea-ficha h2{margin:0 0 2px;font:600 17px Consolas,monospace;color:#38485c}
    .eea-ficha .eea-ficha-tipo{font-weight:700;color:#665812;font-size:14px;margin:0 0 16px}
    .eea-ficha h3{margin:20px 0 4px;font-size:11.5px;color:#665812;letter-spacing:.05em;
      text-transform:uppercase;border-bottom:1px solid #facf00;padding-bottom:4px}
    .eea-ficha dl{margin:0;display:grid;grid-template-columns:200px 1fr}
    .eea-ficha dt{padding:7px 12px 7px 0;font-size:12px;color:#69788a;
      border-bottom:1px solid #eee6cf}
    .eea-ficha dd{margin:0;padding:7px 0;font-size:12.5px;color:#38485c;
      border-bottom:1px solid #eee6cf;word-break:break-word}
    .eea-ficha dd.mono{font-family:Consolas,monospace;font-size:12px}
    .eea-ficha dd.vacio{color:#8a98a8;font-style:italic}
    .eea-ficha .eea-sin{margin:8px 0 0;font-size:12.5px;color:#8a98a8;font-style:italic}
    .eea-crudo{background:#fff;border:1px solid #eee6cf;border-radius:5px;padding:10px 12px;
      font-size:12.5px;color:#425266;white-space:pre-wrap;word-break:break-word}
    .eea-ficha-pie{display:flex;align-items:center;gap:8px;margin-top:24px}
    .eea-ficha-pie button{height:30px}

    /* --- acerca de --- */
    .eea-about{flex:1;overflow:auto;background:#fffbea}
    .eea-about-in{max-width:760px;margin:0 auto;padding:26px 30px 40px}
    .eea-about h2{margin:0 0 4px;font-size:19px;color:#38485c}
    .eea-about h2 span{font-size:12px;font-weight:400;color:#8a98a8;margin-left:6px}
    .eea-about h3{margin:22px 0 6px;font-size:13px;color:#665812;
      border-bottom:1px solid #facf00;padding-bottom:4px}
    .eea-about p{margin:0 0 9px;font-size:13px;line-height:1.55;color:#425266}
    .eea-about p.lead{font-size:13.5px;color:#38485c}
    .eea-about ul{margin:0 0 9px;padding-left:20px}
    .eea-about li{font-size:13px;line-height:1.55;color:#425266;margin-bottom:5px}
    .eea-about .eea-volver{margin-top:22px;height:30px}

    /* --- pie --- */
    .eea-pie{display:flex;align-items:center;gap:9px;padding:8px 12px;background:#fffbea;
      border-top:1px solid #efe4bd;flex:none;font-size:12px;color:#69788a}
    .eea-pie button{height:26px;padding:0 11px;border:1px solid #facf00;background:#fff6d1;
      border-radius:5px;cursor:pointer;color:#665812;
      font:12px "Segoe UI",Arial,sans-serif;display:inline-flex;align-items:center}
    .eea-pie button:hover:not(:disabled){background:#ffec9e}
    .eea-pie button:disabled{opacity:.4;cursor:default}
    .eea-pie .pag{font-weight:600;color:#38485c;min-width:56px;text-align:center}
    .eea-pie .nota{font-size:11px;color:#8a98a8;margin-left:10px}
    .eea-pie .eea-geo{margin-left:auto;font:11px Consolas,monospace;color:#b8c1cc;
      white-space:nowrap;padding-left:10px}

    /* --- manijas de tamaño --- */
    .eea-rz{position:absolute;z-index:6}
    .eea-rz[data-d="n"]{top:0;left:12px;right:12px;height:5px;cursor:ns-resize}
    .eea-rz[data-d="s"]{bottom:0;left:12px;right:12px;height:5px;cursor:ns-resize}
    .eea-rz[data-d="e"]{right:0;top:12px;bottom:12px;width:5px;cursor:ew-resize}
    .eea-rz[data-d="w"]{left:0;top:12px;bottom:12px;width:5px;cursor:ew-resize}
    .eea-rz[data-d="ne"]{top:0;right:0;width:12px;height:12px;cursor:nesw-resize}
    .eea-rz[data-d="nw"]{top:0;left:0;width:12px;height:12px;cursor:nwse-resize}
    .eea-rz[data-d="se"]{bottom:0;right:0;width:15px;height:15px;cursor:nwse-resize}
    .eea-rz[data-d="sw"]{bottom:0;left:0;width:12px;height:12px;cursor:nesw-resize}
    .eea-rz[data-d="se"]::after{content:"";position:absolute;right:3px;bottom:3px;
      width:8px;height:8px;border-right:2px solid #cbd3dc;border-bottom:2px solid #cbd3dc}

    /* --- ventana de Acerca de --- */
    #eea-acerca{position:fixed;z-index:2147482200;background:#fffbea;border-radius:8px;
      box-shadow:0 22px 70px rgba(25,32,41,.55);display:flex;flex-direction:column;
      font:13px/1.45 "Segoe UI",Arial,sans-serif;color:#38485c;overflow:hidden;
      min-width:420px;min-height:300px}
    #eea-acerca.eea-max{border-radius:0;box-shadow:none}
    #eea-acerca.eea-min{height:auto!important;min-height:0;min-width:0;
      width:340px!important;border-radius:6px}
    #eea-acerca.eea-min .eea-about,#eea-acerca.eea-min .eea-acerca-pie,
    #eea-acerca.eea-min .eea-rz,#eea-acerca.eea-max .eea-rz{display:none}
    #eea-acerca .eea-about{flex:1;overflow-y:scroll;overflow-x:hidden}
    #eea-acerca .eea-about-in{padding:22px 26px 30px}
    .eea-acerca-pie{display:flex;justify-content:flex-end;align-items:center;gap:8px;
      padding:9px 12px;background:#fffbea;border-top:1px solid #efe4bd;flex:none}
    .eea-acerca-pie button{height:30px}

    /* --- barras de desplazamiento, visibles y con la paleta --- */
    /* Chrome ignora ::-webkit-scrollbar en cuanto se declara scrollbar-color
       o scrollbar-width, y con la barra flotante no ocupa lugar. Por eso acá
       sólo van las reglas -webkit-, que dan una barra clásica, visible y con
       ancho propio. */
    .eea-cuerpo::-webkit-scrollbar,.eea-ficha::-webkit-scrollbar,
    .eea-datos::-webkit-scrollbar,#eea-acerca .eea-about::-webkit-scrollbar{width:14px;height:14px}
    .eea-cuerpo::-webkit-scrollbar-track,.eea-ficha::-webkit-scrollbar-track,
    .eea-datos::-webkit-scrollbar-track,#eea-acerca .eea-about::-webkit-scrollbar-track{
      background:#f6efd8;border-left:1px solid #e8dfc0}
    .eea-cuerpo::-webkit-scrollbar-thumb,.eea-ficha::-webkit-scrollbar-thumb,
    .eea-datos::-webkit-scrollbar-thumb,#eea-acerca .eea-about::-webkit-scrollbar-thumb{
      background:#e0c76a;border:3px solid #f6efd8;border-radius:7px}
    .eea-cuerpo::-webkit-scrollbar-thumb:hover,.eea-ficha::-webkit-scrollbar-thumb:hover,
    .eea-datos::-webkit-scrollbar-thumb:hover,
    #eea-acerca .eea-about::-webkit-scrollbar-thumb:hover{background:#c9ab3d}
    .eea-cuerpo::-webkit-scrollbar-corner,#eea-acerca .eea-about::-webkit-scrollbar-corner{
      background:#f6efd8}

    #eea-abrir{position:fixed;right:18px;bottom:18px;z-index:2147482050;
      background:#ffdb2e;color:#38485c;border:2px solid #edc400;border-radius:8px;
      padding:12px 20px;font:700 14px "Segoe UI",Arial,sans-serif;cursor:pointer;
      box-shadow:0 8px 26px rgba(25,32,41,.45);display:none}
    #eea-abrir:hover{background:#ffd408}
    `;

    // ===================== ACERCA DE =====================
    //
    // Es una ventana aparte, no una vista de la principal: se abre encima,
    // se mueve, se agranda y se cierra sin tocar el listado, que queda
    // debajo tal como estaba.

    let acerca = null;

    function crearAcerca() {
        if (acerca) return;
        acerca = document.createElement('div');
        acerca.id = 'eea-acerca';
        acerca.style.display = 'none';
        acerca.innerHTML = `
          <div class="eea-tit">
            <span class="eea-marca">Acerca de EE ayudante</span>
            <span class="eea-v">${VERSION}</span>
            <span class="eea-ctrl">
              <button data-a="min-acerca" title="Plegar a la barra de título">–</button>
              <button data-a="max-acerca" title="Maximizar o restaurar">□</button>
              <button data-a="cerrar-acerca" class="eea-x" title="Cerrar">×</button>
            </span>
          </div>
          <div class="eea-about">
            <div class="eea-about-in">
              <h2>EE ayudante <span>${VERSION}</span></h2>
              <p class="lead">Vista de lectura para el módulo Expediente Electrónico y para GEDO.
                 Es una aplicación externa al SADE, sin relación con el sistema ni con el
                 organismo, que se limita a presentar de otro modo lo que el sistema ya muestra en
                 pantalla.</p>
              <p>La ventana lleva su nombre y su propia paleta, la institucional de la Ciudad. El
                 Expediente Electrónico es azul, de manera que ambas pantallas se distinguen a
                 simple vista.</p>

              <h3>Qué hace</h3>
              <p>Lee el listado que el sistema ya envió al navegador y lo presenta nuevamente en
                 esta ventana, agregando lo que el listado original no ofrece:</p>
              <ul>
                <li><b>Asunto.</b> Una referencia por actuación, compuesta con el tipo de trámite,
                    traducido de su código, y los datos identificatorios que se extraen del motivo
                    de caratulación. Qué se extrae depende de lo que cada trámite haya
                    traído: referencia o carátula, persona, documento, inmueble, expediente
                    judicial y juzgado interviniente. La ficha muestra únicamente los datos
                    presentes, sin casilleros vacíos.</li>
                <li><b>Texto completo.</b> El listado original trunca varias columnas a veinte
                    caracteres. Aquí se muestran enteras.</li>
                <li><b>Ficha.</b> El botón Ver despliega todos los campos de la actuación y el
                    motivo de caratulación textual, dentro de esta misma ventana.</li>
                <li><b>Etiquetas y anotaciones.</b> Marcas propias sobre cada actuación, que no
                    se escriben en el expediente. Se ponen con un click sobre la celda de
                    Etiquetas o de Anotación de cada fila, o desde el botón Ver; se filtran desde
                    la barra y se llevan a otra computadora exportándolas a un archivo.</li>
                <li><b>Planilla de Excel.</b> El listado a la vista, con los datos identificados,
                    las etiquetas y las anotaciones.</li>
                <li><b>Orden, búsqueda y paginación.</b> Por cualquier columna, sobre todos los
                    campos a la vez, incluidas las etiquetas y las anotaciones, y de cinco en cinco
                    hasta cincuenta.</li>
              </ul>

              <h3>Qué no hace</h3>
              <ul>
                <li>No modifica el sistema. No agrega ni oculta columnas, no reescribe celdas y no
                    altera ningún dato del expediente.</li>
                <li>No consulta al servidor. Todo sale de lo que el navegador ya recibió, de modo
                    que no incide sobre el rendimiento ni sobre la sesión.</li>
                <li>No adquiere expedientes y no realiza pases.</li>
                <li>No envía información a ningún lado. La configuración, las etiquetas y las
                    anotaciones quedan guardadas en este navegador, y salen de él únicamente
                    cuando se exportan a un archivo.</li>
              </ul>

              <h3>Los dos botones de cada fila</h3>
              <p><b>Ver</b> abre la ficha de la actuación dentro de esta ventana. No consulta al
                 sistema, no abre el expediente y no deja constancia: es otra presentación de lo
                 que el listado ya contiene.</p>
              <p><b>Abrir</b> da la orden al listado original, tal como si se eligiera "Tramitar"
                 en su desplegable de Acciones. Antes de accionar se verifica que la opción diga
                 exactamente <b>Tramitar</b>; si dijera otra cosa, la operación se cancela sin
                 tocar nada. Esa comprobación importa porque en la solapa Consultas el mismo
                 desplegable ofrece <b>Adquirir</b>, que toma el expediente.</p>
              <p>Accionar Tramitar recarga la página, de modo que hacerlo en esta misma pestaña
                 haría perder el listado junto con la búsqueda y el orden. Por eso, con la opción
                 <b>Abrir en pestaña nueva</b> activada, la actuación se abre en una pestaña aparte
                 y ésta queda intacta. Si el navegador bloqueara la pestaña, se abre aquí y la
                 ventana se pliega a su barra de título.</p>

              <h3>La ventana</h3>
              <p>Se mueve tomándola de su barra de título y se redimensiona desde cualquier borde o
                 esquina. El botón □ alterna entre pantalla completa y el último tamaño usado. La
                 posición y el tamaño quedan guardados para la próxima vez.</p>

              <h3>GEDO</h3>
              <p>Replica el listado que esté a la vista, sea Mis Tareas, el Porta Firma o
                 Consultas, con las columnas que traiga y el texto sin truncar. No compone ningún
                 asunto, porque la Referencia de GEDO ya es descriptiva: lo único que agrega son
                 la etiqueta y la anotación.</p>
              <p>Cuando la fila nombra un expediente, la marca se guarda sobre ese expediente, de
                 manera que lo anotado en el Expediente Electrónico aparece en GEDO y al revés. Si
                 no lo nombra, se guarda sobre el número del documento, y si tampoco hay, sobre el
                 contenido de la fila, avisando que esa marca se pierde si el listado cambia.</p>
              <p>Los dos módulos están en subdominios distintos y no comparten el almacenamiento
                 del navegador, de modo que las etiquetas y las anotaciones viven en el almacén de
                 Tampermonkey, que sí es común a los dos. Lo que hubiera guardado antes se traslada
                 solo la primera vez.</p>
              <p>De los botones de cada fila quedan afuera los que se apropian de algo o lo
                 destruyen, como <b>Adquirir tarea</b>. Para ésos está el botón del propio sistema,
                 que obliga a ir a buscarlo.</p>

              <h3>Requisito</h3>
              <p>La columna <b>Motivo Caratulación</b> debe estar habilitada en el listado original,
                 desde "Configurar columnas visibles" al pie de la tabla del sistema. Sin ella no
                 puede componerse el asunto. Es configuración propia del sistema, ajena a esta
                 herramienta, y se revierte desde el mismo lugar.</p>

              <h3>Limitación conocida</h3>
              <p>La composición del asunto depende de lo que se haya escrito al caratular. Cuando el
                 motivo carece de contenido identificatorio, se consigna de modo expreso en lugar de
                 suplirlo por inferencia. Los demás datos de la carátula no viajan en el listado y
                 sólo pueden verse abriendo la actuación en el sistema.</p>

              <h3>Uso</h3>
              <p>Herramienta de uso personal, sin autoría declarada, sin licencia y sin
                 distribución. Se cierra con la cruz o con la tecla Escape, y debajo queda el
                 Expediente Electrónico intacto.</p></div>
          </div>
          <div class="eea-acerca-pie">
            <button class="eea-b" data-a="cerrar-acerca">Cerrar</button>
          </div>
          ${['n','s','e','w','ne','nw','se','sw'].map(d => `<div class="eea-rz" data-d="${d}"></div>`).join('')}`;
        document.body.appendChild(acerca);

        acerca.addEventListener('click', e => {
            const b = e.target.closest('[data-a]');
            if (!b) return;
            const a = b.dataset.a;
            if (a === 'cerrar-acerca') { cerrarAcerca(); return; }
            if (a === 'min-acerca') { acerca.classList.toggle('eea-min'); return; }
            if (a === 'max-acerca') {
                if (acerca.classList.contains('eea-min')) { acerca.classList.remove('eea-min'); return; }
                if (acerca.classList.contains('eea-max')) restaurarAcerca();
                else maximizarAcerca();
            }
        });
        hacerMovible(acerca, false);
        hacerRedimensionable(acerca, false, 420, 300);
    }

    // Se guarda la medida anterior para poder volver de pantalla completa.
    let previoAcerca = null;

    function maximizarAcerca() {
        const r = acerca.getBoundingClientRect();
        previoAcerca = { l: r.left, t: r.top, w: r.width, h: r.height };
        acerca.classList.add('eea-max');
        acerca.style.left = '0px'; acerca.style.top = '0px';
        acerca.style.width = '100vw'; acerca.style.height = '100vh';
    }

    function restaurarAcerca() {
        acerca.classList.remove('eea-max');
        const q = previoAcerca || { l: 0, t: 0, w: 720, h: 620 };
        acerca.style.left = Math.round(q.l) + 'px'; acerca.style.top = Math.round(q.t) + 'px';
        acerca.style.width = Math.round(q.w) + 'px'; acerca.style.height = Math.round(q.h) + 'px';
    }

    function abrirAcerca() {
        crearAcerca();
        acerca.classList.remove('eea-min', 'eea-max');
        const w = Math.min(720, innerWidth - 40), h = Math.min(620, innerHeight - 40);
        acerca.style.width = w + 'px';
        acerca.style.height = h + 'px';
        acerca.style.left = Math.round((innerWidth - w) / 2) + 'px';
        acerca.style.top = Math.round((innerHeight - h) / 2) + 'px';
        acerca.style.display = 'flex';
    }
    const cerrarAcerca = () => { if (acerca) acerca.style.display = 'none'; };
    const acercaAbierto = () => !!acerca && acerca.style.display !== 'none';

    // ===================== VENTANA =====================

    let win = null, fondo = null, filtro = '', pagina = 1, fichaDe = null, docAbierto = null;

    const SUB_NORMAL = 'vista externa del Buzón de Tareas · no forma parte del SADE';

    // Al plegarse, el fondo oscurecido se retira para que el expediente
    // quede completamente a la vista, y la barra de título indica cómo
    // volver al listado.
    function plegado(si) {
        if (fondo) fondo.style.display = si ? 'none' : '';
        const sub = win && win.querySelector('.eea-sub');
        if (sub) sub.textContent = si ? 'listado plegado · □ para volver a mostrarlo' : SUB_NORMAL;
    }

    // El ancho de cada columna es fijo y en porcentaje, para que el
    // listado no se reacomode al cambiar de página ni al filtrar.
    const COLS = [
        { k: 'estado', t: 'Estado', an: 6 },
        { k: 'fecha', t: 'Últ. modif.', an: 10 },
        { k: 'etiquetas', t: 'Etiquetas', an: 11 },
        { k: 'numero', t: 'Expediente', an: 16 },
        { k: 'asunto', t: 'Asunto', an: 18 },
        { k: 'pase', t: 'Motivo del pase', an: 8 },
        { k: 'usuario', t: 'Usuario anterior', an: 8 },
        { k: 'nota', t: 'Anotación', an: 12 }
    ];

    const textoMarcas = (clave) => {
        const m = marcaDe(clave);
        return etiquetasDe(clave).map(e => e.nom).join(' ') + ' ' + (m.nota || '');
    };

    const COLS_DOC = [
        { k: 'orden', t: 'Orden', an: 4 },
        { k: 'tipo', t: 'Tipo de documento', an: 15 },
        { k: 'etiquetas', t: 'Etiqueta', an: 10 },
        { k: 'referencia', t: 'Referencia', an: 21 },
        { k: 'resumen', t: 'Resumen', an: 20 },
        { k: 'asociacion', t: 'Asociación', an: 9 },
        { k: 'nota', t: 'Anotación', an: 14 }
    ];

    const valorDoc = (d, k) =>
        k === 'resumen' ? (d.r ? d.r.plano : '') :
        k === 'etiquetas' ? etiquetasDe(d.clave).map(e => e.nom).join(', ') :
        k === 'nota' ? (marcaDe(d.clave).nota || '') : (d[k] || '');

    const valor = (d, k) =>
        k === 'asunto' ? d.a.plano :
        k === 'etiquetas' ? etiquetasDe(d.clave).map(e => e.nom).join(', ') :
        k === 'nota' ? (marcaDe(d.clave).nota || '') : (d[k] || '');

    function filtradas() {
        const f = norm(filtro);
        let L = !f ? DATOS.slice() : DATOS.filter(d =>
            norm([d.estado, d.fecha, d.numero, d.codigo, d.tramite, d.pase, d.motivo, d.usuario,
                d.a.plano, textoMarcas(d.clave)].join(' ')).includes(f));

        L = porEtiqueta(L);
        const { col, desc } = CFG.orden;
        L.sort((x, y) => {
            const a = norm(valor(x, col)), b = norm(valor(y, col));
            return (a < b ? -1 : a > b ? 1 : 0) * (desc ? -1 : 1);
        });
        return L;
    }

    function asuntoHTML(a) {
        if (!a.identificado) {
            return '<span class="eea-tipo">' + esc(a.tipo) + '</span>' +
                   '<span class="eea-nada">sin datos identificatorios en el motivo de caratulación</span>';
        }
        const hay = !!a.particular;
        return '<span class="eea-tipo">' + esc(a.tipo) + '</span>' +
            (hay ? '<span class="eea-par">' + esc(a.particular) + '</span>' : '') +
            a.extras.map((x, i) => (hay || i ? ' <span class="eea-sec">· ' : '<span class="eea-sec">') +
                esc(x) + '</span>').join('');
    }

    // Las etiquetas se ven en el listado; se asignan desde la ficha, que
    // es donde hay lugar para hacerlo sin ambigüedad.
    // Las dos celdas son además el acceso: un click abre la ficha ya
    // posicionada en la sección que corresponde. Vacías muestran qué se
    // puede hacer, en lugar de un guión mudo.
    // En el buzón el click abre la ficha de la actuación; en el expediente,
    // el detalle del documento. El atributo cambia, el resto es igual.
    const toque = (clave, tipo, foco) => tipo === 'doc'
        ? 'data-detalle="' + esc(clave) + '" data-foco="' + foco + '"'
        : 'data-ver="' + esc(clave) + '" data-foco="' + foco + '"';

    function etiquetasHTML(clave, tipo) {
        const et = etiquetasDe(clave);
        const nota = String(marcaDe(clave).nota || '').trim();
        void tipo;
        const dentro = et.length
            ? et.map(e => '<span class="eea-chip" style="' + estiloChip(e.color) + '">' +
                  esc(e.nom) + '</span>').join('')
            : '<span class="eea-poner">+ etiqueta</span>';
        return '<div class="eea-toque" ' + toque(clave, tipo, 'etiquetas') +
               ' title="' + (nota ? esc(nota) : 'Poner o sacar etiquetas') + '">' + dentro + '</div>';
    }

    function notaHTML(clave, tipo) {
        const t = String(marcaDe(clave).nota || '').trim();
        const dentro = t
            ? '<span class="eea-nota-txt">' + esc(t) + '</span>'
            : '<span class="eea-poner">+ anotar</span>';
        return '<div class="eea-toque" ' + toque(clave, tipo, 'nota') +
               ' title="' + (t ? esc(t) : 'Escribir una anotación') + '">' + dentro + '</div>';
    }

    // La barra de herramientas se adapta a la pantalla: en el expediente
    // no hay filtro por etiqueta ni pestaña nueva que valgan.
    function ajustarBarra() {
        const exp = MODO === 'expediente', ged = MODO === 'gedo';
        const sub = win.querySelector('.eea-sub');
        if (sub && !win.classList.contains('eea-min')) {
            sub.textContent = exp ? 'vista externa del expediente · no forma parte del SADE'
                : ged ? 'vista externa de GEDO · no forma parte del sistema'
                : SUB_NORMAL;
        }
        const bus = win.querySelector('.eea-busca input');
        bus.placeholder = exp ? 'Buscar entre los documentos de esta página'
            : ged ? 'Buscar en cualquier campo, incluidas etiquetas y anotaciones'
            : 'Buscar en cualquier campo, incluido el asunto';
        for (const [sel, ver] of [['.eea-fe', !exp], ['.eea-pp', !exp],
                                  ['.eea-pest-caja', !exp && !ged]]) {
            const el = win.querySelector(sel);
            if (el) el.style.display = ver ? '' : 'none';
        }
    }

    // La clave sobre la que se ponen etiquetas y anotaciones: la actuación
    // de la ficha, o el expediente abierto.
    // Puede haber dos bloques de marcas a la vez, el del expediente y el
    // del documento desplegado, así que la clave sale del propio bloque.
    const claveMarca = (destino) => {
        const caja = destino && destino.closest ? destino.closest('[data-marca]') : null;
        if (caja) return caja.dataset.marca;
        if (fichaDe) return fichaDe;
        if (MODO === 'expediente' && EXPTE) return EXPTE.replace(/\s+/g, '');
        return '';
    };

    const editando = () => {
        const a = document.activeElement;
        return !!a && !!win && win.contains(a) && /^(input|textarea)$/i.test(a.tagName);
    };

    // ===================== EXPEDIENTE ABIERTO =====================

    function resumenHTML() {
        const porTipo = {};
        for (const d of DATOS) {
            const t = d.tipo || 'Sin tipo';
            porTipo[t] = (porTipo[t] || 0) + 1;
        }
        const tipos = Object.keys(porTipo).sort((a, b) => porTipo[b] - porTipo[a])
            .map(t => esc(t) + ' <b>' + porTipo[t] + '</b>').join(' · ');
        const ordenes = DATOS.map(d => parseInt(d.orden, 10)).filter(n => !isNaN(n));
        const ultimo = DATOS.slice().sort((a, b) =>
            (parseInt(b.orden, 10) || 0) - (parseInt(a.orden, 10) || 0))[0];
        const pg = paginador();

        const dato = (rot, val) => '<div class="eea-dato"><span>' + esc(rot) + '</span><b>' +
            (val || '<i>sin dato</i>') + '</b></div>';

        const sinNumero =
            '<p class="eea-sin">No se pudo leer el número del expediente en la pantalla. ' +
            'Se lo puede indicar acá y las etiquetas y la anotación quedan colgadas de él.</p>' +
            '<div class="eea-ex-mano">' +
              '<input type="text" class="eea-ex-campo" placeholder="EX-2026-00000000- -GCABA-PG">' +
              '<button class="eea-b eea-ex-usar">Usar este número</button>' +
            '</div>';

        return '<div class="eea-resumen">' +
            '<button class="eea-b eea-res-plegar" title="Mostrar u ocultar el resumen">Resumen</button>' +
            '<div class="eea-res-cuerpo">' +
              '<div class="eea-res-izq">' +
                '<div class="eea-datos-linea">' +
                  dato('Documentos a la vista', String(DATOS.length)) +
                  dato('Órdenes', ordenes.length ? Math.min(...ordenes) + ' a ' + Math.max(...ordenes) : '') +
                  dato('Página del sistema', pg ? (pg.pagina + (pg.total ? ' de ' + pg.total : '')) : '') +
                  dato('Último documento', ultimo ? esc(ultimo.tipo) + ' · ' + esc(ultimo.creacion) : '') +
                '</div>' +
                (tipos ? '<div class="eea-tipos">' + tipos + '</div>' : '') +
              '</div>' +
              '<div class="eea-res-der">' +
                '<h2>' + (EXPTE ? esc(EXPTE) : 'Expediente abierto') +
                (EXPTE ? '<button class="eea-cp" data-cp="' + esc(EXPTE) +
                         '" title="Copiar el número de expediente">&#10697;</button>' : '') + '</h2>' +
                (EXPTE ? bloqueMarcas(EXPTE.replace(/\s+/g, '')) : sinNumero) +
              '</div>' +
            '</div>' +
        '</div>';
    }

    function resumenDocHTML(d) {
        if (!d.r) return '';
        const partes = [];
        if (d.r.sinRef) partes.push('<span class="eea-nada">pase, sin referencia propia</span>');
        if (d.r.citas.length) {
            partes.push('<span class="eea-par">cita ' + esc(d.r.citas.join(', ')) + '</span>');
        }
        if (d.r.dias !== null && d.r.dias > 0) {
            partes.push('<span class="eea-sec">' + d.r.dias +
                (d.r.dias === 1 ? ' día' : ' días') + ' después del anterior</span>');
        }
        return partes.length ? partes.join('<span class="eea-sec"> · </span>')
                             : '<span class="eea-vacio">–</span>';
    }

    // Detalle desplegable de un documento: lo que agrega "Más Datos" del
    // sistema, más sus etiquetas y su anotación.
    function detalleHTML(d) {
        const filas = d.extra.length
            ? '<dl class="eea-det-dl">' + d.extra.map(([r, v]) =>
                  '<dt>' + esc(r) + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl>'
            : '<p class="eea-sin">El sistema no está mostrando datos adicionales.' +
              (d.mandos.includes('datos')
                ? ' Se los puede pedir: agrega usuario generador, número especial y usuario ' +
                  'subsanador, y aparecen acá.' : '') + '</p>' +
              (d.mandos.includes('datos')
                ? '<button class="eea-b" style="margin-top:8px;height:28px" data-doc="' +
                  esc(d.clave) + '" data-acc="datos">Traer datos adicionales</button>' : '');
        return '<tr class="eea-det"><td colspan="' + (COLS_DOC.length + 1) + '">' +
            '<div class="eea-det-in">' +
              '<div class="eea-det-cab">' + esc(d.tipo) + ' · <b>' + esc(d.numero) + '</b>' +
                '<button class="eea-b eea-det-cerrar">Cerrar el detalle</button></div>' +
              filas +
              bloqueMarcas(d.clave) +
            '</div></td></tr>';
    }

    function pintarExpediente() {
        const f = norm(filtro);
        let L = !f ? DATOS.slice() : DATOS.filter(d =>
            norm([d.orden, d.tipo, d.numero, d.referencia, d.asociacion, d.creacion,
                d.r ? d.r.plano : '', etiquetasDe(d.clave).map(e => e.nom).join(' '),
                marcaDe(d.clave).nota || ''].join(' ')).includes(f));
        const col = COLS_DOC.some(c => c.k === CFG.orden.col) ? CFG.orden.col : 'orden';
        const desc = CFG.orden.desc;
        L.sort((x, y) => {
            const a = valorDoc(x, col), b = valorDoc(y, col);
            const na = parseInt(a, 10), nb = parseInt(b, 10);
            const cmp = (!isNaN(na) && !isNaN(nb) && String(na) === a.trim() && String(nb) === b.trim())
                ? na - nb
                : (norm(a) < norm(b) ? -1 : norm(a) > norm(b) ? 1 : 0);
            return cmp * (desc ? -1 : 1);
        });

        win.querySelector('.eea-aviso').style.display = 'none';
        win.querySelector('.eea-cont').innerHTML =
            '<b>' + L.length + '</b> de ' + DATOS.length + ' documentos en esta página';

        const thead = COLS_DOC.map(c => {
            const act = col === c.k;
            return '<th data-k="' + esc(c.k) + '" class="' + (act ? 'act' : '') +
                   '" style="width:' + c.an + '%">' + esc(c.t) +
                   '<span class="fl">' + (act ? (desc ? '▼' : '▲') : '▽') + '</span></th>';
        }).join('') + '<th class="eea-th-acc" style="width:7%">Acción</th>';

        const cuerpo = L.map(d =>
            '<tr class="' + (docAbierto === d.clave ? 'eea-fila-abierta' : '') + '">' +
            '<td class="eea-orden">' + esc(d.orden) + '</td>' +
            '<td>' + esc(d.tipo) +
              '<div class="eea-num-l eea-cod"><span>' + esc(d.numero) + '</span>' +
              '<button class="eea-cp" data-cp="' + esc(d.numero) +
              '" title="Copiar el número de documento">&#10697;</button></div></td>' +
            '<td class="eea-et-celda">' + etiquetasHTML(d.clave, 'doc') + '</td>' +
            '<td>' + (d.referencia ? esc(d.referencia) : '<span class="eea-vacio">–</span>') + '</td>' +
            '<td>' + resumenDocHTML(d) + '</td>' +
            '<td class="eea-fec">' + esc(d.asociacion) + '</td>' +
            '<td class="eea-nota-celda">' + notaHTML(d.clave, 'doc') + '</td>' +
            '<td class="eea-td-acc"><div class="eea-acc">' +
              (d.mandos.includes('bajar')
                ? '<button class="eea-ver" data-doc="' + esc(d.clave) + '" data-acc="bajar" ' +
                  'title="Descarga el documento, tal como el botón del sistema">Bajar</button>'
                : '<span class="eea-vacio">–</span>') +
            '</div></td></tr>' +
            (docAbierto === d.clave ? detalleHTML(d) : '')
        ).join('') || '<tr><td colspan="8" style="padding:26px;text-align:center;color:#8a98a8">' +
            (DATOS.length ? 'Ningún documento coincide con la búsqueda.'
                          : 'No se pudo leer la lista de documentos.') + '</td></tr>';

        win.querySelector('.eea-cuerpo').innerHTML = resumenHTML() +
            '<table class="eea-t"><thead><tr>' + thead + '</tr></thead><tbody>' + cuerpo + '</tbody></table>';

        // el pie mueve el paginador del propio sistema
        const pg = paginador();
        win.querySelector('.eea-pag').textContent = pg
            ? pg.pagina + ' / ' + (pg.total || '?')
            : '1 / 1';
        win.querySelector('.eea-ant').disabled = !(pg && pg.anterior && pg.pagina > 1);
        win.querySelector('.eea-sig').disabled = !(pg && pg.siguiente && (!pg.total || pg.pagina < pg.total));
        win.querySelector('.eea-pie .nota').textContent = pg
            ? 'Anterior y Siguiente mueven el paginador del sistema. Se ve la página que él tiene abierta.'
            : 'Se ven los documentos de la página que el sistema tiene abierta.';
    }

    // Se replica el listado tal como viene, sin componer nada, y se le
    // agregan dos columnas propias: etiqueta y anotación.
    function pintarGedo() {
        const f = norm(filtro);
        const texto = (d) => d.valores.join(' ') + ' ' +
            etiquetasDe(d.clave).map(e => e.nom).join(' ') + ' ' + (marcaDe(d.clave).nota || '');
        let L = porEtiqueta(!f ? DATOS.slice() : DATOS.filter(d => norm(texto(d)).includes(f)));

        const valorG = (d, k) =>
            k === 'etiquetas' ? etiquetasDe(d.clave).map(e => e.nom).join(', ') :
            k === 'nota' ? (marcaDe(d.clave).nota || '') :
            (d.valores[+String(k).slice(1)] || '');

        const cols = COLS_GEDO.concat([{ k: 'etiquetas', t: 'Etiqueta' }, { k: 'nota', t: 'Anotación' }]);
        // Sin un orden elegido, manda la columna de fecha, de la más reciente
        // a la más vieja, que es como se mira un listado de tareas.
        const porFecha = cols.find(c => /fecha/i.test(c.t));
        const col = cols.some(c => c.k === CFG.orden.col)
            ? CFG.orden.col : (porFecha || cols[0] || {}).k;
        const desc = cols.some(c => c.k === CFG.orden.col) ? CFG.orden.desc : true;
        L.sort((x, y) => {
            const a = norm(valorG(x, col)), b = norm(valorG(y, col));
            return (a < b ? -1 : a > b ? 1 : 0) * (desc ? -1 : 1);
        });

        const porPag = CFG.porPagina;
        const paginas = Math.max(1, Math.ceil(L.length / porPag));
        if (pagina > paginas) pagina = paginas;
        const trozo = L.slice((pagina - 1) * porPag, (pagina - 1) * porPag + porPag);

        pintarFiltroEtiquetas();
        win.querySelector('.eea-aviso').style.display = 'none';
        const conMarca = DATOS.filter(d =>
            etiquetasDe(d.clave).length || String(marcaDe(d.clave).nota || '').trim()).length;
        win.querySelector('.eea-cont').innerHTML =
            '<b>' + L.length + '</b> de ' + DATOS.length + ' filas · <b>' + conMarca + '</b> con marca';

        // La columna de acciones crece con la cantidad de botones que el
        // sistema ofrezca; el resto se reparte lo que quede.
        const cuantos = DATOS.reduce((n, d) => Math.max(n, d.mandos.length), 0);
        const anAcc = Math.min(22, 6 + cuantos * 6);
        const propio = 11;
        const anchoSis = Math.max(6, Math.floor((100 - propio * 2 - anAcc) /
            Math.max(1, COLS_GEDO.length)));
        const thead = cols.map(c => {
            const act = col === c.k;
            const an = (c.k === 'etiquetas' || c.k === 'nota') ? propio : anchoSis;
            return '<th data-k="' + esc(c.k) + '" class="' + (act ? 'act' : '') +
                   '" style="width:' + an + '%">' + esc(c.t) +
                   '<span class="fl">' + (act ? (desc ? '▼' : '▲') : '▽') + '</span></th>';
        }).join('') + '<th class="eea-th-acc" style="width:' + anAcc + '%">Acción</th>';

        const cuerpo = trozo.map(d =>
            '<tr class="' + (docAbierto === d.clave ? 'eea-fila-abierta' : '') + '">' +
            d.valores.map(v => '<td>' + (v ? esc(v) : '<span class="eea-vacio">–</span>') + '</td>').join('') +
            '<td class="eea-et-celda">' + etiquetasHTML(d.clave, 'doc') + '</td>' +
            '<td class="eea-nota-celda">' + notaHTML(d.clave, 'doc') + '</td>' +
            '<td class="eea-td-acc"><div class="eea-acc">' +
              (d.mandos.length
                ? d.mandos.map(t => '<button class="eea-ver eea-acc-g" data-gedo="' + esc(d.ancla) +
                    '" data-titulo="' + esc(t) + '" title="' + esc(t) + '">' +
                    esc(rotulo(t)) + '</button>').join('')
                : '<span class="eea-vacio">–</span>') +
            '</div></td></tr>' +
            (docAbierto === d.clave ? detalleGedoHTML(d, cols) : '')
        ).join('') || '<tr><td colspan="' + (cols.length + 1) +
            '" style="padding:26px;text-align:center;color:#8a98a8">' +
            (DATOS.length ? 'Ninguna fila coincide con la búsqueda.'
                          : 'No se pudo leer el listado. Verifique tener una solapa con listado a la vista.') +
            '</td></tr>';

        win.querySelector('.eea-cuerpo').innerHTML =
            '<table class="eea-t"><thead><tr>' + thead + '</tr></thead><tbody>' + cuerpo + '</tbody></table>';

        win.querySelector('.eea-pag').textContent = pagina + ' / ' + paginas;
        win.querySelector('.eea-ant').disabled = pagina <= 1;
        win.querySelector('.eea-sig').disabled = pagina >= paginas;
        win.querySelector('.eea-pie .nota').textContent =
            'Los datos provienen del propio listado del sistema. Al cerrar, la pantalla original queda intacta.';
    }

    // El rótulo del botón sale del título del sistema, cortado en palabra
    // entera y sin la preposición colgando: "Ver historial de la tarea"
    // queda en "Ver historial".
    const COLGANTES = /\s+(?:de|del|la|el|los|las|al|a|en|para|por|con|su)$/i;

    function rotulo(titulo) {
        let t = String(titulo).split(/[.,(]/)[0].replace(/\s+/g, ' ').trim();
        if (t.length > 16) {
            const p = t.split(' ');
            t = '';
            for (const x of p) {
                if ((t + ' ' + x).trim().length > 16) break;
                t = (t + ' ' + x).trim();
            }
            if (!t) t = p[0].slice(0, 16);
        }
        while (COLGANTES.test(t)) t = t.replace(COLGANTES, '');
        return t;
    }

    function detalleGedoHTML(d, cols) {
        const deQue = d.deQue === 'expediente'
            ? 'Se guarda sobre el expediente <b>' + esc(d.clave) + '</b>, de modo que se ve también ' +
              'desde el Expediente Electrónico.'
            : d.deQue === 'documento'
              ? 'Se guarda sobre el documento <b>' + esc(d.clave) + '</b>.'
              : 'La fila no nombra expediente ni documento, así que la marca se guarda sobre su ' +
                'propio contenido y se pierde si el listado cambia.';
        return '<tr class="eea-det"><td colspan="' + (cols.length + 1) + '">' +
            '<div class="eea-det-in">' +
              '<div class="eea-det-cab"><b>' + esc(d.valores[0] || '') + '</b>' +
                '<button class="eea-b eea-det-cerrar">Cerrar el detalle</button></div>' +
              '<p class="eea-sin">' + deQue + '</p>' +
              (d.vedados && d.vedados.length
                ? '<p class="eea-sin">El sistema ofrece además, en esta fila: <b>' +
                  d.vedados.map(esc).join('</b>, <b>') + '</b>. No se replica' +
                  (d.vedados.length === 1 ? '' : 'n') + ' desde esta ventana, porque ' +
                  (d.vedados.length === 1 ? 'toma o elimina' : 'toman o eliminan') +
                  ' lo que nombra' + (d.vedados.length === 1 ? '' : 'n') +
                  '. Para eso está el botón del propio sistema.</p>'
                : '') +
              bloqueMarcas(d.clave) +
            '</div></td></tr>';
    }

    function pintarFiltroEtiquetas() {
        const fe = win.querySelector('.eea-fe');
        if (!fe) return;
        const opciones = [['', 'Todas las etiquetas'], ['@sin', 'Sin etiqueta'], ['@nota', 'Con anotación']]
            .concat(MARCAS.etiquetas.map(e => [e.id, e.nom]));
        const firma = opciones.map(o => o.join('|')).join(';');
        if (fe.dataset.firma !== firma) {
            fe.dataset.firma = firma;
            fe.innerHTML = opciones.map(([v, t]) =>
                '<option value="' + esc(v) + '">' + esc(t) + '</option>').join('');
        }
        if (!opciones.some(o => o[0] === CFG.filtroEtiqueta)) CFG.filtroEtiqueta = '';
        fe.value = CFG.filtroEtiqueta;
    }

    // El filtro por etiqueta de la barra, aplicado a cualquier listado.
    function porEtiqueta(L) {
        const fe = CFG.filtroEtiqueta;
        if (fe === '@sin') return L.filter(d => !marcaDe(d.clave).et.length);
        if (fe === '@nota') return L.filter(d => String(marcaDe(d.clave).nota || '').trim());
        if (fe && etiquetaDe(fe)) return L.filter(d => marcaDe(d.clave).et.includes(fe));
        return L;
    }

    function pintar() {
        if (!win) return;
        if (MODO === 'gedo') { ajustarBarra(); pintarGedo(); return; }
        if (MODO === 'expediente') { ajustarBarra(); pintarExpediente(); return; }
        ajustarBarra();
        const L = filtradas();
        const porPag = CFG.porPagina;
        const paginas = Math.max(1, Math.ceil(L.length / porPag));
        if (pagina > paginas) pagina = paginas;
        const desde = (pagina - 1) * porPag;
        const trozo = L.slice(desde, desde + porPag);

        // aviso de columnas faltantes
        const av = win.querySelector('.eea-aviso');
        if (FALTA.length) {
            av.style.display = '';
            av.innerHTML = 'Falta habilitar en el listado original: <b>' + FALTA.map(esc).join('</b> y <b>') +
                '</b>. Se agrega desde "Configurar columnas visibles", al pie de la tabla del sistema.';
        } else av.style.display = 'none';

        // contador
        const ident = DATOS.filter(d => d.a.identificado).length;
        win.querySelector('.eea-cont').innerHTML =
            '<b>' + L.length + '</b> de ' + DATOS.length + ' actuaciones · <b>' + ident + '</b> identificadas';

        // cabeceras
        const thead = COLS.map(c => {
            const act = CFG.orden.col === c.k;
            return '<th data-k="' + c.k + '" class="' + (act ? 'act' : '') +
                   '" style="width:' + c.an + '%">' + esc(c.t) +
                   '<span class="fl">' + (act ? (CFG.orden.desc ? '▼' : '▲') : '▽') + '</span></th>';
        }).join('') + '<th class="eea-th-acc" style="width:11%">Acciones</th>';

        const cuerpo = trozo.map(d =>
            '<tr>' +
            '<td>' + esc(d.estado) + '</td>' +
            '<td class="eea-fec">' + esc(d.fecha) + '</td>' +
            '<td class="eea-et-celda">' + etiquetasHTML(d.clave) + '</td>' +
            '<td class="eea-num"><div class="eea-num-l"><span>' + esc(d.numero) + '</span>' +
                '<button class="eea-cp" data-cp="' + esc(d.numero) + '" title="Copiar el número de expediente">&#10697;</button>' +
                '</div><div class="eea-cod">' + esc(d.codigo) + '</div></td>' +
            '<td>' + asuntoHTML(d.a) + '</td>' +
            '<td>' + esc(d.pase) + '</td>' +
            '<td class="eea-cod">' + esc(d.usuario) + '</td>' +
            '<td class="eea-nota-celda">' + notaHTML(d.clave) + '</td>' +
            '<td class="eea-td-acc"><div class="eea-acc">' +
                '<button class="eea-ver" data-ver="' + esc(d.clave) + '" ' +
                  'title="Muestra la ficha de la actuación dentro de esta ventana. No la abre ni consulta al sistema.">Ver</button>' +
                '<button class="eea-tram" data-tram="' + esc(d.clave) + '" ' +
                  'title="Abre la actuación en el sistema, como Tramitar. Con la pestaña nueva activada, este listado queda abierto.">Abrir</button>' +
            '</div></td></tr>'
        ).join('') || '<tr><td colspan="9" style="padding:26px;text-align:center;color:#8a98a8">' +
                      (DATOS.length ? 'Ninguna actuación coincide con la búsqueda.'
                                    : 'No fue posible leer el listado. Verifique encontrarse en el Buzón de Tareas.') + '</td></tr>';

        win.querySelector('.eea-cuerpo').innerHTML =
            '<table class="eea-t"><thead><tr>' + thead + '</tr></thead><tbody>' + cuerpo + '</tbody></table>';

        pintarFiltroEtiquetas();

        // pie
        win.querySelector('.eea-pag').textContent = pagina + ' / ' + paginas;
        win.querySelector('.eea-ant').disabled = pagina <= 1;
        win.querySelector('.eea-sig').disabled = pagina >= paginas;
    }

    // ===================== FICHA =====================
    // Todo lo que la ficha muestra sale del listado que ya está en
    // pantalla. No consulta al servidor, no abre la actuación y no deja
    // constancia de nada.

    // Mismo bloque de etiquetas y anotación para la ficha de una actuación
    // y para el resumen del expediente abierto. La clave es el número de
    // expediente en los dos casos, de modo que lo anotado desde el buzón se
    // ve al abrirlo, y al revés.
    function bloqueMarcas(clave) {
        const m = marcaDe(clave);
        return '<div class="eea-marca-caja" data-marca="' + esc(clave) + '">' +
            '<h3 class="eea-h-et">Etiquetas</h3>' +
            (MARCAS.etiquetas.length
                ? '<div>' + MARCAS.etiquetas.map(e => {
                      const puesta = m.et.includes(e.id);
                      return '<button class="eea-chip' + (puesta ? '' : ' eea-off') +
                          '" data-et="' + esc(e.id) + '" style="' + estiloChip(e.color) +
                          '" title="' + (puesta ? 'Quitar' : 'Poner') + ' esta etiqueta">' +
                          esc(e.nom) + '</button>';
                  }).join('') + '</div>'
                : '<p class="eea-sin">Todavía no hay etiquetas. Se escribe un nombre abajo y se crea.</p>') +
            '<div class="eea-et-nueva">' +
              '<input type="text" class="eea-et-nombre" maxlength="28" ' +
                'placeholder="Nombre de una etiqueta nueva">' +
              '<span class="eea-et-colores">' +
                COLORES.map((c, i) => '<button class="eea-col' + (i ? '' : ' sel') +
                  '" data-color="' + c.id + '" style="background:' + c.hex +
                  '" title="' + c.nom + '"></button>').join('') +
              '</span>' +
              '<button class="eea-b eea-et-crear">Crear y poner</button>' +
            '</div>' +
            '<h3 class="eea-h-nota">Anotación</h3>' +
            '<textarea class="eea-nota" placeholder="Anotación privada sobre esta actuación. ' +
              'Queda en este navegador; no se escribe en el expediente.">' + esc(m.nota) + '</textarea>' +
            '<div class="eea-nota-pie">' +
              '<button class="eea-b eea-nota-guardar">Guardar</button>' +
              '<button class="eea-borrar eea-nota-borrar">Borrar</button>' +
              '<span class="eea-guardado">Guardado</span>' +
            '</div>' +
        '</div>';
    }

    function fichaHTML(d) {
        const a = d.a;
        const fila = (rot, val, cls) => '<dt>' + esc(rot) + '</dt><dd class="' + (cls || '') +
            (val ? '' : ' vacio') + '">' + (val ? esc(val) : 'sin dato') + '</dd>';

        // Cada trámite trae lo suyo: una denuncia de herencia vacante puede
        // traer persona e inmueble; un oficio judicial, una carátula y un
        // juzgado; una solicitud, apenas una referencia. No se muestra un
        // formulario fijo con casilleros vacíos, sino lo que hay.
        const ident = [
            a.particular && fila('Referencia', a.particular),
            a.documento && fila('Documento', a.documento, 'mono'),
            a.inmueble && fila('Inmueble', a.inmueble),
            a.expediente && fila('Expediente judicial', a.expediente, 'mono'),
            a.juzgado && fila('Juzgado', a.juzgado)
        ].filter(Boolean);

        return '<div class="eea-ficha-in">' +
            '<h2>' + esc(d.numero) +
              '<button class="eea-cp" data-cp="' + esc(d.numero) + '" title="Copiar el número de expediente">&#10697;</button></h2>' +
            '<p class="eea-ficha-tipo">' + esc(a.tipo) + '</p>' +

            '<h3>Datos identificados</h3>' +
            (ident.length
              ? '<dl>' + ident.join('') + '</dl>'
              : '<p class="eea-sin">El motivo de caratulación no trae datos ' +
                'identificatorios que puedan aislarse. Abajo queda su texto completo.</p>') +

            '<h3>Campos del listado</h3>' +
            '<dl>' +
              fila('Tarea / estado', d.estado) +
              fila('Última modificación', d.fecha, 'mono') +
              fila('Código de trámite', d.codigo, 'mono') +
              fila('Descripción del trámite', d.tramite) +
              fila('Motivo del pase', d.pase) +
              fila('Usuario anterior', d.usuario, 'mono') +
            '</dl>' +

            '<h3>Motivo de caratulación, textual</h3>' +
            '<div class="eea-crudo">' + (d.motivo ? esc(d.motivo) : 'Sin contenido.') + '</div>' +

            bloqueMarcas(d.clave) +

            '<div class="eea-ficha-pie">' +
              '<button class="eea-b eea-ficha-volver">Volver al listado</button>' +
              '<button class="eea-b" data-cp="' + esc([d.numero, a.plano, d.motivo].filter(Boolean).join(' — ')) +
                '">Copiar la ficha</button>' +
              '<button class="eea-tram" style="height:30px;padding:0 14px" data-tram="' + esc(d.clave) +
                '">Abrir en el sistema</button>' +
            '</div>' +
        '</div>';
    }

    function verFicha(clave, foco) {
        const d = DATOS.find(x => x.clave === clave);
        if (!d) { avisar('La actuación ya no figura en el listado.'); return; }
        fichaDe = clave;
        const caja = win.querySelector('.eea-ficha');
        caja.innerHTML = fichaHTML(d);
        panel('ficha');
        caja.scrollTop = 0;
        if (!foco) return;
        const h = caja.querySelector(foco === 'nota' ? '.eea-h-nota' : '.eea-h-et');
        if (h) h.scrollIntoView({ block: 'start' });
        const campo = caja.querySelector(foco === 'nota' ? '.eea-nota' : '.eea-et-nombre');
        if (campo) campo.focus();
    }

    // ===================== PANEL DE ETIQUETAS Y ARCHIVOS =====================

    function datosHTML() {
        const et = MARCAS.etiquetas;
        const conMarca = Object.keys(MARCAS.filas).length;
        return '<div class="eea-datos-in">' +
            '<h2>Etiquetas y archivos</h2>' +
            '<p>Las etiquetas y las anotaciones son datos propios, no del sistema: quedan ' +
            'guardados en este navegador y no se escriben en el expediente. Hoy hay <b>' +
            et.length + '</b> ' + (et.length === 1 ? 'etiqueta' : 'etiquetas') + ' y <b>' +
            conMarca + '</b> ' + (conMarca === 1 ? 'actuación marcada' : 'actuaciones marcadas') + '.</p>' +

            '<h3>Llevarlas a otra computadora</h3>' +
            '<p>La exportación guarda un archivo con las etiquetas y las anotaciones. Al importarlo ' +
            'en otra computadora no se pisa nada: se agregan las etiquetas que falten, se unen las ' +
            'de cada actuación y, si las anotaciones difieren, quedan las dos.</p>' +
            '<div class="eea-bts">' +
              '<button class="eea-b" data-acc="exportar">Exportar etiquetas y anotaciones</button>' +
              '<button class="eea-b" data-acc="importar">Importar desde un archivo</button>' +
            '</div>' +
            '<p class="eea-sin">El archivo sale sin cifrar y las anotaciones pueden decir cosas ' +
            'del expediente. Conviene guardarlo donde se guarde cualquier otro papel de trabajo.</p>' +

            '<h3>Planilla de Excel</h3>' +
            '<p>Exporta el listado que esté a la vista, con la búsqueda y el filtro puestos, más ' +
            'las etiquetas y la anotación de cada fila. Cada pantalla exporta sus propias ' +
            'columnas: en esta hay ' + tablaExportable().cabeceras.length + '.</p>' +
            '<div class="eea-bts">' +
              '<button class="eea-b" data-acc="excel">Exportar el listado a Excel</button>' +
            '</div>' +

            '<h3>Etiquetas</h3>' +
            (et.length
              ? '<table class="eea-et-tabla">' + et.map(e =>
                  '<tr><td><span class="eea-chip" style="' + estiloChip(e.color) + '">' +
                  esc(e.nom) + '</span></td>' +
                  '<td class="uso">' + usoDe(e.id) + ' ' +
                  (usoDe(e.id) === 1 ? 'actuación' : 'actuaciones') + '</td>' +
                  '<td class="der"><button class="eea-borrar" data-borrar="' + esc(e.id) +
                  '">Eliminar</button></td></tr>').join('') + '</table>'
              : '<p class="eea-sin">Todavía no hay etiquetas. Se crean desde la ficha de ' +
                'cualquier actuación, con el botón Ver.</p>') +

            '<div class="eea-ficha-pie">' +
              '<button class="eea-b eea-datos-volver">Volver al listado</button>' +
            '</div>' +
        '</div>';
    }

    // Confirmación visible de que la anotación quedó guardada.
    function confirmarGuardado(clave, caja) {
        const donde = caja && caja.isConnected
            ? caja
            : [...win.querySelectorAll('[data-marca]')].find(x => x.dataset.marca === clave);
        const sello = donde && donde.querySelector('.eea-guardado');
        if (!sello) return;
        sello.classList.add('eea-ok');
        setTimeout(() => sello.classList.remove('eea-ok'), 2500);
    }

    // Alterna entre las vistas de la ventana.
    function panel(cual) {
        if (!win) return;
        if (cual === 'datos') win.querySelector('.eea-datos').innerHTML = datosHTML();
        const m = { lista: '.eea-cuerpo', ficha: '.eea-ficha', datos: '.eea-datos' };
        for (const k in m) win.querySelector(m[k]).style.display = (k === cual) ? '' : 'none';
        win.querySelector('.eea-pie').style.display = (cual === 'lista') ? '' : 'none';
        if (cual !== 'ficha') fichaDe = null;
    }

    // ===================== TAMAÑO Y POSICIÓN =====================

    // El zoom amplía el contenido, no la ventana: la barra de título, la
    // de herramientas y el pie conservan su tamaño, y sólo se agranda lo
    // que hay que leer.
    const ZOOM_MIN = 0.7, ZOOM_MAX = 1.6;

    function aplicarZoom() {
        if (!win) return;
        const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +CFG.zoom || 1));
        CFG.zoom = z;
        for (const sel of ['.eea-cuerpo', '.eea-ficha', '.eea-datos']) {
            const el = win.querySelector(sel);
            if (el) el.style.zoom = z;
        }
        const n = win.querySelector('.eea-zoom-n');
        if (n) n.textContent = Math.round(z * 100) + ' %';
    }

    function cambiarZoom(paso) {
        CFG.zoom = paso === 0 ? 1 : Math.round(((+CFG.zoom || 1) + paso) * 100) / 100;
        aplicarZoom(); guardar();
    }

    function geo() {
        const g = win && win.querySelector('.eea-geo');
        if (!g) return;
        const r = win.getBoundingClientRect();
        g.textContent = Math.round(r.left) + ', ' + Math.round(r.top) + ' · ' +
                        Math.round(r.width) + ' × ' + Math.round(r.height) +
                        (CFG.maximizada ? ' · maximizada' : '');
    }

    function ubicar() {
        if (!win) return;
        if (CFG.maximizada) {
            win.classList.add('eea-max');
            win.style.left = '0px'; win.style.top = '0px';
            win.style.width = '100vw'; win.style.height = '100vh';
        } else {
            win.classList.remove('eea-max');
            const w = Math.min((CFG.tam && CFG.tam.w) || 1200, innerWidth - 20);
            const h = Math.min((CFG.tam && CFG.tam.h) || 720, innerHeight - 20);
            const px = CFG.pos ? CFG.pos.x : Math.round((innerWidth - w) / 2);
            const py = CFG.pos ? CFG.pos.y : Math.round((innerHeight - h) / 2);
            win.style.width = w + 'px'; win.style.height = h + 'px';
            win.style.left = Math.max(0, Math.min(innerWidth - 120, px)) + 'px';
            win.style.top = Math.max(0, Math.min(innerHeight - 40, py)) + 'px';
        }
        geo();
    }

    const MIN_W = 560, MIN_H = 320;

    // Ocho manijas, una por borde y una por esquina. La ventana principal
    // maximizada o plegada no se redimensiona; la de Acerca de sí, siempre.
    function hacerRedimensionable(el, persistir, minW, minH) {
        const mw = minW || MIN_W, mh = minH || MIN_H;
        let on = null;
        el.addEventListener('mousedown', e => {
            const h = e.target.closest('.eea-rz');
            if (!h) return;
            if (el.classList.contains('eea-min') || el.classList.contains('eea-max')) return;
            if (persistir && CFG.maximizada) return;
            const r = el.getBoundingClientRect();
            on = { d: h.dataset.d, x: e.clientX, y: e.clientY,
                   l: r.left, t: r.top, w: r.width, h: r.height };
            e.preventDefault();
        });
        document.addEventListener('mousemove', e => {
            if (!on) return;
            const dx = e.clientX - on.x, dy = e.clientY - on.y;
            let l = on.l, t = on.t, w = on.w, h = on.h;
            if (on.d.includes('e')) w = on.w + dx;
            if (on.d.includes('s')) h = on.h + dy;
            if (on.d.includes('w')) { w = on.w - dx; l = on.l + dx; }
            if (on.d.includes('n')) { h = on.h - dy; t = on.t + dy; }
            if (w < mw) { if (on.d.includes('w')) l = on.l + on.w - mw; w = mw; }
            if (h < mh) { if (on.d.includes('n')) t = on.t + on.h - mh; h = mh; }
            el.style.left = Math.round(l) + 'px'; el.style.top = Math.round(t) + 'px';
            el.style.width = Math.round(w) + 'px'; el.style.height = Math.round(h) + 'px';
            if (persistir) geo();
        });
        document.addEventListener('mouseup', () => {
            if (!on) return;
            on = null;
            if (!persistir) return;
            const r = el.getBoundingClientRect();
            CFG.maximizada = false;
            CFG.pos = { x: Math.round(r.left), y: Math.round(r.top) };
            CFG.tam = { w: Math.round(r.width), h: Math.round(r.height) };
            guardar();
        });
    }

    function hacerMovible(el, persistir) {
        const t = el.querySelector('.eea-tit');
        let dx = 0, dy = 0, on = false;
        t.addEventListener('mousedown', e => {
            if (e.target.closest('button')) return;
            on = true;
            const r = el.getBoundingClientRect();
            dx = e.clientX - r.left; dy = e.clientY - r.top;
            if (!persistir && el.classList.contains('eea-max')) {
                restaurarAcerca();
                dx = Math.min(dx, el.getBoundingClientRect().width - 60);
            }
            if (persistir && CFG.maximizada) {
                // Arrastrar una ventana maximizada la restaura a su tamaño
                // anterior, conservando el punto tomado.
                CFG.maximizada = false;
                el.classList.remove('eea-max');
                const w = Math.min((CFG.tam && CFG.tam.w) || 1200, innerWidth - 20);
                const h = Math.min((CFG.tam && CFG.tam.h) || 720, innerHeight - 20);
                el.style.width = w + 'px'; el.style.height = h + 'px';
                dx = Math.min(dx, w - 60);
            }
            e.preventDefault();
        });
        document.addEventListener('mousemove', e => {
            if (!on) return;
            const x = Math.max(0, Math.min(innerWidth - 120, e.clientX - dx));
            const y = Math.max(0, Math.min(innerHeight - 40, e.clientY - dy));
            el.style.left = x + 'px'; el.style.top = y + 'px';
            if (persistir) { CFG.pos = { x, y }; geo(); }
        });
        document.addEventListener('mouseup', () => {
            if (!on) return;
            on = false;
            if (persistir) guardar();
        });
    }

    // ===================== ABRIR Y CERRAR =====================

    function abrir() {
        CFG.abierta = true; guardar();
        if (fondo) fondo.style.display = '';
        if (win) win.style.display = 'flex';
        const b = document.getElementById('eea-abrir'); if (b) b.style.display = 'none';
        leer(); pintar(); ubicar();
    }
    function cerrar() {
        CFG.abierta = false; guardar();
        cerrarAcerca();
        if (fondo) fondo.style.display = 'none';
        if (win) win.style.display = 'none';
        const b = document.getElementById('eea-abrir'); if (b) b.style.display = '';
    }

    function crear() {
        if (document.getElementById('eea')) return;

        fondo = document.createElement('div');
        fondo.id = 'eea-fondo';
        document.body.appendChild(fondo);

        win = document.createElement('div');
        win.id = 'eea';
        win.innerHTML = `
          <div class="eea-tit">
            <span class="eea-marca">EE ayudante</span>
            <span class="eea-v">${VERSION}</span>
            <span class="eea-sub">${SUB_NORMAL}</span>
            <span class="eea-zoom">
              <button data-a="zoom-menos" title="Achicar el contenido">−</button>
              <button data-a="zoom-reset" class="eea-zoom-n" title="Volver al 100 %">100 %</button>
              <button data-a="zoom-mas" title="Agrandar el contenido">+</button>
            </span>
            <span class="eea-ctrl">
              <button data-a="min" title="Plegar a la barra de título">–</button>
              <button data-a="max" title="Maximizar o restaurar">□</button>
              <button data-a="cerrar" class="eea-x" title="Cerrar y volver al sistema">×</button>
            </span>
          </div>

          <div class="eea-barra">
            <label class="eea-busca">
              <span style="color:#8a98a8">⌕</span>
              <input type="text" placeholder="Buscar en cualquier campo, incluido el asunto">
            </label>
            <select class="eea-pp">
              ${[5,10,15,20,25,30,40,50].map(n => `<option value="${n}">${n} por página</option>`).join('')}
            </select>
            <select class="eea-fe" title="Filtrar por etiqueta"></select>
            <button class="eea-b eea-act">Actualizar</button>
            <button class="eea-b eea-datos-b">Etiquetas y archivos</button>
            <button class="eea-b eea-about-b">Acerca de</button>
            <label class="eea-b eea-pest-caja" style="cursor:pointer"><input type="checkbox" class="eea-pest"><span>Abrir en pestaña nueva</span></label>
            <span class="eea-cont"></span>
          </div>

          <div class="eea-aviso" style="display:none"></div>
          <div class="eea-cuerpo"></div>
          <div class="eea-ficha" style="display:none"></div>
          <div class="eea-datos" style="display:none"></div>
          <input type="file" class="eea-archivo" accept=".json,application/json" style="display:none">

          <div class="eea-pie">
            <button class="eea-ant">Anterior</button>
            <span class="pag eea-pag">1 / 1</span>
            <button class="eea-sig">Siguiente</button>
            <span class="nota">Los datos provienen del propio listado del sistema. Al cerrar, la pantalla original queda intacta.</span>
            <span class="eea-geo"></span>
          </div>

          ${['n','s','e','w','ne','nw','se','sw'].map(d => `<div class="eea-rz" data-d="${d}"></div>`).join('')}`;
        document.body.appendChild(win);

        const abrirBtn = document.createElement('button');
        abrirBtn.id = 'eea-abrir';
        abrirBtn.textContent = 'Abrir EE ayudante';
        abrirBtn.addEventListener('click', abrir);
        document.body.appendChild(abrirBtn);

        win.querySelector('.eea-zoom').addEventListener('click', e => {
            const b = e.target.closest('button'); if (!b) return;
            cambiarZoom(b.dataset.a === 'zoom-mas' ? 0.1 : b.dataset.a === 'zoom-menos' ? -0.1 : 0);
        });

        // controles de ventana
        win.querySelector('.eea-ctrl').addEventListener('click', e => {
            const b = e.target.closest('button'); if (!b) return;
            const a = b.dataset.a;
            if (a === 'cerrar') return cerrar();
            if (a === 'min') { plegado(win.classList.toggle('eea-min')); geo(); return; }
            if (a === 'max') {
                if (win.classList.contains('eea-min')) {
                    win.classList.remove('eea-min'); plegado(false);
                    leer(); pintar(); geo(); return;      // al volver, listado fresco
                }
                CFG.maximizada = !CFG.maximizada; guardar(); ubicar();
            }
        });

        hacerMovible(win, true);
        hacerRedimensionable(win, true);

        // búsqueda
        const inp = win.querySelector('.eea-busca input');
        inp.value = CFG.filtro || '';
        filtro = inp.value;
        inp.addEventListener('input', () => {
            filtro = inp.value; CFG.filtro = filtro; guardar(); pagina = 1;
            panel('lista'); pintar();
        });

        // filas por página
        const sel = win.querySelector('.eea-pp');
        sel.value = String(CFG.porPagina);
        sel.addEventListener('change', () => {
            CFG.porPagina = +sel.value; guardar(); pagina = 1; pintar();
        });

        win.querySelector('.eea-act').addEventListener('click', () => {
            const f = fichaDe;
            leer(); pintar();
            if (f) verFicha(f); else panel('lista');
        });

        const chk = win.querySelector('.eea-pest');
        chk.checked = !!CFG.enPestanaNueva;
        chk.addEventListener('change', () => { CFG.enPestanaNueva = chk.checked; guardar(); });

        win.querySelector('.eea-fe').addEventListener('change', e => {
            CFG.filtroEtiqueta = e.target.value; guardar(); pagina = 1; panel('lista'); pintar();
        });

        win.querySelector('.eea-about-b').addEventListener('click', abrirAcerca);
        win.querySelector('.eea-datos-b').addEventListener('click', () => panel('datos'));

        // ---- etiquetas y anotación ----
        // Los mismos controles sirven en la ficha de una actuación y en el
        // resumen del expediente abierto, así que se escuchan en las dos.
        let colorElegido = COLORES[0].id;

        const marcasClick = (ficha) => e => {
            const col = e.target.closest('.eea-col');
            if (col) {
                colorElegido = col.dataset.color;
                (col.closest('[data-marca]') || ficha)
                    .querySelectorAll('.eea-col').forEach(c => c.classList.toggle('sel', c === col));
                return;
            }
            const clave = claveMarca(e.target);
            const refrescar = () => { if (fichaDe) verFicha(fichaDe); else pintar(); };

            if (e.target.closest('.eea-nota-guardar') && clave) {
                const caja = e.target.closest('[data-marca]');
                const campo = caja && caja.querySelector('.eea-nota');
                if (!campo) return;
                fijarMarca(clave, { nota: campo.value });
                // Se redibuja para que la columna de anotación del listado
                // muestre lo guardado, y el aviso queda a la vista.
                refrescar();
                confirmarGuardado(clave);
                return;
            }

            const bo = e.target.closest('.eea-nota-borrar');
            if (bo && clave) {
                // Dos pasos: una anotación larga no se pierde por un click.
                if (!bo.classList.contains('confirmar')) {
                    bo.classList.add('confirmar');
                    bo.textContent = 'Confirmar el borrado';
                    return;
                }
                fijarMarca(clave, { nota: '' });
                refrescar();
                return;
            }

            const chip = e.target.closest('[data-et]');
            if (chip && clave) { alternarEtiqueta(clave, chip.dataset.et); refrescar(); return; }

            if (e.target.closest('.eea-et-crear') && clave) {
                const caja = e.target.closest('[data-marca]') || ficha;
                const campo = caja.querySelector('.eea-et-nombre');
                const id = crearEtiqueta(campo.value, colorElegido);
                if (!id) { campo.focus(); return; }
                if (!marcaDe(clave).et.includes(id)) alternarEtiqueta(clave, id);
                refrescar();
            }
        };

        // Enter en el nombre de la etiqueta equivale al botón.
        const marcasTecla = (ficha) => e => {
            if (e.key === 'Enter' && e.target.classList.contains('eea-et-nombre')) {
                e.preventDefault();
                const caja = e.target.closest('[data-marca]') || ficha;
                const b = caja.querySelector('.eea-et-crear');
                if (b) b.click();
            }
        };

        // La anotación se guarda con el botón. Mientras haya cambios sin
        // guardar el botón lo dice. Al salir del campo se guarda también,
        // para que nada se pierda por olvido, pero no mientras se escribe:
        // un solo mecanismo, y visible.
        const marcasEscribir = (ficha) => e => {
            if (!e.target.classList.contains('eea-nota')) return;
            if (!claveMarca(e.target)) return;
            const caja = e.target.closest('[data-marca]') || ficha;
            const boton = caja.querySelector('.eea-nota-guardar');
            const sello = caja.querySelector('.eea-guardado');
            if (boton) boton.classList.add('eea-pend');
            if (sello) sello.classList.remove('eea-ok');
        };

        const marcasSalir = (ficha) => e => {
            if (!e.target.classList || !e.target.classList.contains('eea-nota')) return;
            const clave = claveMarca(e.target);
            if (!clave) return;
            const caja = e.target.closest('[data-marca]') || ficha;
            const boton = caja.querySelector('.eea-nota-guardar');
            if (!boton || !boton.classList.contains('eea-pend')) return;
            fijarMarca(clave, { nota: e.target.value });
            boton.classList.remove('eea-pend');
            confirmarGuardado(clave, caja);
        };

        for (const caja of [win.querySelector('.eea-ficha'), win.querySelector('.eea-cuerpo')]) {
            caja.addEventListener('click', marcasClick(caja));
            caja.addEventListener('keydown', marcasTecla(caja));
            caja.addEventListener('input', marcasEscribir(caja));
            caja.addEventListener('focusout', marcasSalir(caja));
        }

        // ---- panel de etiquetas y archivos ----
        const archivo = win.querySelector('.eea-archivo');
        win.querySelector('.eea-datos').addEventListener('click', e => {
            if (e.target.closest('.eea-datos-volver')) { panel('lista'); pintar(); return; }

            const bo = e.target.closest('[data-borrar]');
            if (bo) {
                // Dos pasos: el primer click pide confirmación en el propio botón.
                if (bo.classList.contains('confirmar')) {
                    borrarEtiqueta(bo.dataset.borrar);
                    panel('datos'); pintar();
                } else {
                    win.querySelectorAll('.eea-borrar.confirmar').forEach(x => {
                        x.classList.remove('confirmar'); x.textContent = 'Eliminar';
                    });
                    bo.classList.add('confirmar');
                    bo.textContent = 'Confirmar: se quita de todas';
                }
                return;
            }

            const acc = e.target.closest('[data-acc]');
            if (!acc) return;
            if (acc.dataset.acc === 'exportar') exportarMarcas();
            if (acc.dataset.acc === 'excel') exportarExcel();
            if (acc.dataset.acc === 'importar') archivo.click();
        });

        archivo.addEventListener('change', () => {
            const f = archivo.files && archivo.files[0];
            if (!f) return;
            const lector = new FileReader();
            lector.onload = () => {
                const r = importarMarcas(String(lector.result || ''));
                archivo.value = '';
                if (typeof r === 'string') { avisar(r); return; }
                panel('datos'); pintar();
                avisar('Importadas ' + r.filas + ' actuaciones marcadas. Quedan ' +
                       r.etiquetas + ' etiquetas.', 7);
            };
            lector.onerror = () => { archivo.value = ''; avisar('No se pudo leer el archivo.'); };
            lector.readAsText(f);
        });
        const paso = (cual) => {
            if (MODO === 'gedo') {
                if (cual === 'anterior') { if (pagina > 1) { pagina--; pintar(); } }
                else { pagina++; pintar(); }
                return;
            }
            if (MODO === 'expediente') {
                const pg = paginador();
                const b = pg && pg[cual];
                if (b) { b.click(); setTimeout(() => { leer(); pintar(); }, 900); }
                else avisar('No se encuentra el paginador del sistema.', 6);
                return;
            }
            if (cual === 'anterior') { if (pagina > 1) { pagina--; pintar(); } }
            else { pagina++; pintar(); }
        };
        win.querySelector('.eea-ant').addEventListener('click', () => paso('anterior'));
        win.querySelector('.eea-sig').addEventListener('click', () => paso('siguiente'));

        // orden, copiar, ver y abrir: delegados en el listado y en la ficha
        const acciones = e => {
            const th = e.target.closest('th[data-k]');
            if (th) {
                const k = th.dataset.k;
                if (CFG.orden.col === k) CFG.orden.desc = !CFG.orden.desc;
                else CFG.orden = { col: k, desc: false };
                guardar(); pintar(); return;
            }
            if (e.target.closest('.eea-nota') || e.target.closest('.eea-et-nombre')) return;
            if (e.target.closest('.eea-ficha-volver')) { panel('lista'); pintar(); return; }

            const cp = e.target.closest('[data-cp]');
            if (cp) { copiar(cp.dataset.cp, cp); return; }

            if (e.target.closest('.eea-ex-usar')) {
                const campo = win.querySelector('.eea-ex-campo');
                const m = campo && campo.value.match(RE_EX);
                if (!m) {
                    avisar('Ese texto no tiene la forma de un número de expediente.', 6);
                    if (campo) campo.focus();
                    return;
                }
                EXPTE_MANO = m[0];
                leer(); pintar();
                return;
            }

            if (e.target.closest('.eea-res-plegar')) {
                win.querySelector('.eea-resumen').classList.toggle('eea-plegado');
                return;
            }

            if (e.target.closest('.eea-det-cerrar')) { docAbierto = null; pintar(); return; }

            const det = e.target.closest('[data-detalle]');
            if (det) {
                docAbierto = docAbierto === det.dataset.detalle ? null : det.dataset.detalle;
                pintar();
                if (docAbierto) {
                    const caja = win.querySelector('.eea-det [data-marca]');
                    const campo = caja && caja.querySelector(
                        det.dataset.foco === 'nota' ? '.eea-nota' : '.eea-et-nombre');
                    if (campo) { campo.scrollIntoView({ block: 'nearest' }); campo.focus(); }
                }
                return;
            }

            const ged = e.target.closest('[data-gedo]');
            if (ged) {
                const r = mandoGedo(ged.dataset.gedo, ged.dataset.titulo);
                if (!r.ok) avisar(r.msg, 8);
                return;
            }

            const doc = e.target.closest('[data-doc]');
            if (doc) {
                // "Más Datos" no abre ninguna ventana: le pide al sistema que
                // despliegue tres columnas más en su propia grilla, que esta
                // ventana tapa. Por eso, además de accionarlo, se abre acá el
                // detalle del documento y se vuelve a leer para mostrarlas.
                const r = mandoDoc(doc.dataset.doc, doc.dataset.acc);
                if (!r.ok) { avisar(r.msg, 8); return; }
                if (doc.dataset.acc === 'datos') {
                    docAbierto = doc.dataset.doc;
                    setTimeout(() => { leer(); pintar(); }, 700);
                }
                return;
            }

            const vr = e.target.closest('[data-ver]');
            if (vr) { verFicha(vr.dataset.ver, vr.dataset.foco); return; }

            const bt = e.target.closest('[data-tram]');
            if (bt) abrirActuacion(bt.dataset.tram);
        };
        win.querySelector('.eea-cuerpo').addEventListener('click', acciones);
        win.querySelector('.eea-ficha').addEventListener('click', acciones);

        aplicarZoom();
        ubicar();
        panel('lista');
        if (!CFG.abierta) cerrar();
    }

    // ===================== ARRANQUE =====================

    function arrancar() {
        const st = document.createElement('style');
        st.id = 'eea-css'; st.textContent = CSS;
        (document.head || document.documentElement).appendChild(st);

        crear();
        leer(); pintar();

        // Si esta pestaña se abrió para tramitar una actuación, cumple el
        // encargo y no muestra el listado: lo que corresponde ver aquí es
        // el expediente.
        if (cumplirEncargo()) cerrar();

        // Relectura periódica. No se reescribe la tabla si nada cambió,
        // para no interrumpir la búsqueda ni el orden en curso, y se
        // suspende mientras haya una ficha abierta.
        let firma = '';
        setInterval(() => {
            if (!CFG.abierta || fichaDe || docAbierto || editando()) return;
            const antes = MODO + '|' + DATOS.length + '|' + DATOS.map(d => d.clave).join(',');
            leer();
            const ahora = MODO + '|' + DATOS.length + '|' + DATOS.map(d => d.clave).join(',');
            if (ahora !== antes || ahora !== firma) { firma = ahora; pintar(); }
        }, 4000);

        addEventListener('resize', () => { if (CFG.abierta) ubicar(); });

        addEventListener('keydown', e => {
            if (e.key !== 'Escape' || !CFG.abierta) return;
            // Escape cierra primero la vista de adentro, y recién después
            // la ventana.
            if (acercaAbierto()) { cerrarAcerca(); return; }
            if (fichaDe) { panel('lista'); pintar(); return; }
            if (win.querySelector('.eea-datos').style.display !== 'none') {
                panel('lista'); pintar(); return;
            }
            cerrar();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', arrancar, { once: true });
    } else {
        arrancar();
    }
})();