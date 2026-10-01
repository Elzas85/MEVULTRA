# MEV Ultra

Programa de usuario (userscript) para **Tampermonkey** que presenta **una sola
ventana** sobre la
[Mesa de Entradas Virtual (MEV) de la SCBA](https://mev.scba.gov.ar/).

Incluye **MEV+ completo** (la descarga fiel del expediente en un PDF único) y
agrega la lista de **todas las causas del usuario**, de todos sus Sets de
Búsqueda, en todas las jurisdicciones. No se instala junto con MEV+, dado que
MEV Ultra ya lo contiene.

## Motivo por el cual la MEV no muestra todas las causas de un Set

La MEV muestra cada Set **por partes**:

1. Solo las causas de la **jurisdicción** elegida al ingresar (departamento y
   fuero, o Suprema Corte, Casación o Justicia de Paz).
2. Dentro de esa jurisdicción, **un organismo por vez**. La página de
   resultados muestra el primer juzgado y ofrece un desplegable "Organismos del Set" con
   los restantes.

Por esa razón, un Set que según la MEV contiene 77 causas mostraba solamente 9.
MEV Ultra recorre todas esas combinaciones y confecciona una lista única.

## Funciones

- **Apertura automática:** la ventana se abre automáticamente al ingresar a la MEV y
  ocupa toda la pantalla. Puede minimizarse, maximizarse, restaurarse,
  moverse, redimensionarse, ampliarse y reducirse. Cuando está minimizada o
  cerrada, permanece un indicador verde en el ángulo inferior derecho, que
  cambia a rojo si existe un aviso.
- **Mis causas:** una tabla con todas las causas. Permite la búsqueda en todos
  los campos (con varias palabras) y el filtrado por departamento, organismo,
  Set, estado, etiqueta y fechas del último movimiento (desde la 0.9.5, las
  fechas se escriben como dd/mm/aaaa, igual que en SuPJN+: las barras se
  colocan solas, el año puede escribirse con dos cifras y una fecha inexistente
  se marca en rojo y no se aplica; hasta la 0.9.4 se usaba el campo de fecha
  del navegador, que al escribir el año devolvía el cursor al día). Las columnas pueden
  ordenarse, desplazarse, ensancharse y ocultarse. El paginado avanza de 5 en
  5 hasta 50. La lista se exporta a un archivo que puede abrirse con Excel.
- **Disposición del listado (desde la 0.9.9):** la misma de SuPJN+, en el verde
  de MEV Ultra. La barra de Mis causas reúne la búsqueda (que hasta la 0.9.8
  estaba en la barra de título) y los filtros, con Exportar y Columnas a la
  derecha; debajo, un renglón con la cantidad de causas, la última lectura y
  el botón Leer causas, que avisa en ámbar cuando hay un filtro puesto; luego,
  la barra de lo seleccionado (Bajar las seleccionadas, Elegir actuaciones y
  Quitar selección), la tabla y, al pie, las páginas y cuántas causas se
  muestran. La tabla lleva la cabecera en el color de la ventana, con la
  flecha de ordenar siempre a la vista; el número de la causa en letra de
  ancho fijo con la marca "nuevo"; las partes con su rol adelante; el estado
  en una placa de color (verde en trámite, ámbar a despacho, rojo paralizada,
  gris archivada, violeta en instancia superior, azul los demás), y en cada
  fila los botones Abrir, abrir en la MEV en una pestaña nueva, bajar y más
  acciones. Al instalar la 0.9.9, el orden y los anchos de las columnas
  vuelven una sola vez a los iniciales.
- **Fechas en placas de color (desde la 0.9.9):** criterio común de Lex+. Cada
  fecha va en una placa según su antigüedad: verde la del día, azul de uno a
  siete días atrás, naranja las más viejas, con letra blanca dos puntos más
  grande que la de la tabla. Se aplica a Mis causas, a las actuaciones de cada
  causa, a los resultados de Buscar sucesorio y a los índices. El texto de la
  fecha no cambia, de modo que la búsqueda, los filtros, el orden y la
  exportación funcionan igual.
- **Novedades:** después de cada lectura, se marcan con la marca verde "nuevo" (hasta la 0.9.8, un punto verde) las
  causas que registran un movimiento nuevo, un cambio de estado o que fueron
  recién agregadas a un Set. Las que dejaron de figurar se conservan por
  separado.
- **Etiquetas y anotaciones** propias, que se asignan con un clic sobre la
  celda. Son notas privadas de trabajo y no modifican la MEV.
- **Este expediente:** datos de la causa y sus pasos procesales, con las
  opciones Ver (en pestaña nueva), descargar una sola actuación o elegir
  manualmente qué descargar, por rango de fechas (dd/mm/aaaa, desde la
  0.9.5; una fecha incompleta o inexistente se advierte y no se aplica) o
  mediante un filtro de texto.
- **Descargas:** el motor de MEV+, que procesa un expediente por vez y en
  segundo plano. Admite un máximo de 15 expedientes en espera.
- **Sets:** el contenido de cada Set, la cantidad de causas que declara la
  MEV, la cantidad efectivamente encontrada y las jurisdicciones en que se
  hallaron.
- **Buscar sucesorio** (desde 0.5.0; hasta la 0.9.0 se denominaba "Buscar persona"):
  buscador de sucesiones. Busca el nombre del causante en la carátula de las
  causas consultando cada juzgado de la MEV (no los Sets del usuario), en uno
  o varios departamentos (desplegable con casillas, desde 0.9.1; hasta
  entonces existía una opción "Varios departamentos" que resultaba casi
  imperceptible; desde 0.9.4, cuando el panel de casillas excedería el borde
  derecho de la ventana, se alinea con el borde derecho del botón) o en toda
  la provincia, en los fueros que se marquen: Civil y
  Comercial, Justicia de Paz o ambos (por el momento, solo esos dos). Las
  sucesiones aparecen primero en los resultados; las demás causas con ese
  nombre también se muestran. La búsqueda avanza al mismo ritmo que la lectura
  de causas (1 segundo entre consultas, o más si la MEV impone demoras; hasta
  la 0.8.3 eran 4 segundos fijos, medidos con un temporizador que el navegador
  ralentizaba en las pestañas ocultas), continúa en segundo plano, puede
  pausarse y reanudarse, y las búsquedas se conservan en un historial, junto
  con sus causas encontradas, hasta que se las elimine de allí; al abrir la
  solapa se muestra la última. Cada causa encontrada ofrece el mismo menú que
  las de Mis causas: verla en MEV Ultra, abrirla en la MEV en la misma pestaña
  o en una nueva, o descargar el expediente. Desde la 0.8.1 se muestra la
  respuesta de la MEV en cada juzgado; si la MEV informa causas que no pueden
  leerse, la búsqueda se detiene con un diagnóstico en lugar de informar "0 encontradas";
  y si no hubo una causa conocida con la cual comprobar la búsqueda, así lo
  indica ("Terminada, sin comprobar"). Si la MEV solicita verificar que quien
  consulta es una persona, la búsqueda aguarda a que el usuario resuelva esa
  verificación; si la MEV cierra la sesión, aguarda el nuevo ingreso y
  continúa.
- **Índices** (desde 0.9.0): tres índices, reunidos en una solapa.
  *Personas*: quiénes figuran en las carátulas de las causas leídas
  (causantes, actoras, demandadas) y en qué causas, con filtro por nombre.
  *Sucesiones*: una planilla por causa sucesoria (causante, tipo, juzgado,
  estado, último movimiento, Set, etiquetas, anotación). Ambos se confeccionan
  en el momento con la información ya leída (Mis causas más lo encontrado por
  Buscar sucesorio), sin consultar la MEV, y se exportan a .csv.
  *Actuaciones*: guarda el texto de los proveídos y escritos de cada causa,
  tal como los muestra la MEV, para buscar palabras dentro de los expedientes
  desde MEV Ultra. La indexación se realiza por causa (menú de la causa), por
  las causas faltantes o por las novedades de la última lectura, al ritmo de
  la lectura y en segundo plano, sin cambiar la jurisdicción de la sesión;
  cada actuación se solicita una sola vez; si la sesión vence, se aguarda el
  reingreso y se continúa; una indexación interrumpida se reanuda. Los
  adjuntos no se indexan. Toda la información queda almacenada en el equipo,
  separada por usuario de la MEV.
- **Guía** (desde 0.9.6): consulta, en los sitios oficiales y sin usar la
  sesión de la MEV, los datos de los organismos de la Provincia.
  *Organismos (Guía de la SCBA)*: domicilio, teléfonos, correo e integrantes
  de cada organismo, por departamento judicial (organismos con sede en él),
  por fuero o por ambos, con filtro por parte del nombre ("civil 5", "cámara
  penal", "paz bragado"); el departamento también puede escribirse en el
  texto ("civil 5 san isidro"). Cada organismo se copia con un botón y se
  abre en Google Maps con el mapita (📍): en la ubicación que publica la
  Guía (95 de los 99 organismos de San Isidro la tienen) o, si falta, buscando
  el domicilio.
  *Magistrados y funcionarios*: el buscador de personal de la SCBA, por
  apellido, nombre y cargo; el nombre del organismo de cada persona lleva a
  sus datos y el mapita busca su domicilio en Google Maps. *Fiscalías, defensorías, asesorías y curadurías*: el mapa de
  dependencias del Ministerio Público, por departamento o en toda la
  provincia, con sección y subgrupo (descentralizadas, responsabilidad penal
  juvenil, violencia familiar y de género); admite siglas como UFI, UFIJ y
  RPJ. El listado de cada departamento se guarda siete días. El domicilio,
  los teléfonos y los integrantes de cada dependencia del Ministerio Público
  se muestran en su propio sitio después de una verificación que MEV Ultra no
  reproduce: "Ver en el MPBA" abre la página del departamento, y el mapita
  busca en Google Maps por el nombre y el departamento. La Fiscalía de
  Estado figura como enlace, porque su sitio no respondió durante el
  relevamiento. La solapa reúne además los enlaces a los buscadores oficiales
  y a los organismos en turno.
- **Datos y respaldo:** etiquetas, respaldo cifrado (.mevu, con una
  contraseña que se establece una sola vez) y respaldo automático en una
  carpeta.
- **Pruebas:** `pruebas/banco.py` simula la MEV con Playwright y ejecuta el
  programa contra esa réplica. Requiere Python 3, el paquete Playwright y su
  navegador Chromium. La instalación se realiza una sola vez:

  ```sh
  # Windows
  py -3 -m pip install playwright
  py -3 -m playwright install chromium

  # Linux o macOS
  python3 -m pip install playwright
  python3 -m playwright install chromium
  ```

  Ejecución: `py -3 pruebas/banco.py` en Windows o
  `python3 pruebas/banco.py` en Linux y macOS. La revisión de código requiere
  Node.js/npm y se realiza con `npx eslint mev-ultra.user.js` (ESLint 9 o
  posterior). Desde la 0.8.0, el banco también prueba el motor de descarga
  con las mismas bibliotecas pdf-lib y html2canvas que carga Tampermonkey: se
  encuentran en `pruebas/vendor`, y el banco comprueba que su huella coincida
  con la declarada en el `@require` antes de utilizarlas. Para revisar el
  texto de los PDF se utiliza `pdftotext` (paquete poppler), si está
  instalado. El banco todavía no cubre el respaldo automático en carpeta.

## Lectura de las causas

- **Completa:** recorre todas las jurisdicciones hasta completar el total que
  declara cada Set. Corresponde a la primera lectura y a los casos en que se
  desee revisar todo.
- **Rápida:** vuelve solamente a las jurisdicciones donde ya encontró causas
  de cada Set.
- **Por partes (desde 0.7.0):** en la solapa Sets, permite releer un solo Set
  (botón de cada fila) o solo uno o varios departamentos o fueros (desde 0.9.1
  se marcan en un desplegable con casillas; el botón indica "Leer ese departamento"
  o "Leer esos N departamentos"). San Isidro, con 16 juzgados, insume unas 20
  consultas, menos de un minuto al ritmo normal. Lo que no se relee se
  mantiene sin cambios. Desde la 0.8.0, el desplegable incluye **todas** las
  jurisdicciones: primero las que ya tienen causas cargadas y después el
  resto, agrupado por fuero (civil y comercial, familia, penal; paz, Suprema
  Corte y Casación). Si alguna de las jurisdicciones elegidas no tiene causas
  cargadas, la lectura es completa en todas ellas. En una jurisdicción sin
  causas cargadas se leen los Sets cuyo nombre la sugiere (por ejemplo,
  "Causas MDQ" corresponde a Mar del Plata) y los Sets a los que todavía les
  faltan causas, respetando el fuero de cada Set.

- **Automática (desde 0.9.2):** medio minuto después del ingreso a la MEV, si
  la última lectura tiene más de 6 horas de antigüedad, se realiza una
  lectura rápida sin intervención del usuario (completa, si nunca se efectuó
  una lectura) y, al finalizar, se indexan las actuaciones de las causas con
  novedades (lo mismo que "Indexar las novedades" en Índices). Mientras la
  pestaña permanezca abierta, la verificación se repite cada media hora. En la
  barra se identifica como "Lectura automática" y se pausa con el mismo botón.
  Si hay otra tarea en curso o si otra pestaña ya está leyendo, no se emite
  ningún aviso: se vuelve a intentar en la siguiente verificación. Se
  desactiva con la casilla de la solapa Sets (desactivarla en una pestaña la
  desactiva en todas). Por decisión del autor (27/09/2026), la lectura
  automática se realiza al ingresar, si la última lectura tiene más de 6
  horas.

Durante la lectura, la aplicación cambia la jurisdicción de la sesión del
usuario en la MEV; al terminar, restablece la que estaba seleccionada. Se
recomienda no navegar la MEV en otras pestañas mientras tanto.

**Ritmo.** La lectura avanza con 1 segundo entre consultas (hasta la 0.7.3
eran 2,5). Si la MEV solicita verificar que quien consulta es una persona, la
pausa se duplica (hasta 6 segundos) y ese ritmo lento se conserva durante 2
horas; se reduce automáticamente después de 40 consultas consecutivas sin
frenos. La solapa **Sets** muestra la pausa vigente y los frenos registrados
en las últimas 24 horas, con un botón para volver al ritmo normal. Con los
Sets de una oficina (unas 260 causas en 21 Sets), una lectura rápida insume
unas 95 consultas (un minuto y medio al ritmo normal) y una completa, unas 280
(5 minutos), más el tiempo que la MEV demore en responder. Si la MEV solicita
la verificación con frecuencia, se recomienda volver a un ritmo más pausado:
los valores se encuentran en `RITMO` (base, tope) y `MEMORIA_RITMO_MS`.

**Verificación en una ventana (desde 0.9.3).** Si durante una lectura o una
búsqueda la MEV solicita verificar que quien consulta es una persona, la barra
de la tarea ofrece el botón **Verificar**, que abre la página frenada en una
ventana pequeña, sobre la MEV. El control lo resuelve el usuario en esa
ventana; en cuanto la ventana muestra una página normal de la MEV, MEV Ultra
la cierra y la tarea continúa, sin cambiar de pestaña. El cierre manual de la
ventana también reanuda la tarea (si la MEV vuelve a frenar, se solicita de
nuevo). La ventana solo se abre con un clic del usuario, porque el navegador
no permite abrirla de otro modo; si el navegador la bloquea, la página se abre
en una pestaña, como en las versiones anteriores. En esa ventana MEV Ultra no
muestra su interfaz ni ejecuta tareas: solo registra que la página cargó
correctamente. La solapa **Descargas** ofrece el mismo botón. Cuando el pedido
frenado es un envío de formulario (la página de un organismo o la consulta
por carátula), la verificación se muestra en la página de la que proviene (la
del Set o la de la consulta), y no en la de los Sets, que no se encuentra
frenada. En esos casos no se consulta periódicamente otra página para
detectar la resolución: la tarea continúa cuando la ventana se cierra o
cuando el usuario pulsa "Ya validé: seguir".

**Registro de verificaciones (desde 0.9.3).** La solapa **Sets** incluye,
plegada, la lista de las verificaciones de las últimas 24 horas: hora,
página, consultas que llevaba la lectura, pausa vigente, tiempo transcurrido
desde la verificación anterior y tiempo que demoró en superarse. Esos datos
permiten ajustar el ritmo de las consultas a lo que tolera la MEV.

**Sesión.** Mientras haya una pestaña de la MEV abierta, si transcurren 3
minutos sin ningún pedido a la MEV, MEV Ultra solicita una vez la página de
los Sets para evitar que la sesión venza. Lo hace si el usuario utilizó el
ratón o el teclado en alguna pestaña de la MEV durante las últimas 2 horas
(aunque esa pestaña no esté visible, ya que el usuario puede estar leyendo un
documento en otra pestaña o en otro programa), o si hay una lectura, una
búsqueda o una descarga en curso. Si la computadora permanece sin uso durante
más de 2 horas, la sesión vence normalmente. Cada vez que MEV Ultra encuentra
la sesión vencida, lo registra (hora, tiempo transcurrido desde el último
pedido y desde la última interacción del usuario), y la solapa **Sets** lo
muestra en el recuadro "Sesión de la MEV", a fin de conocer con qué frecuencia
la MEV cierra la sesión. La barra muestra la duración de la sesión
("Sesión: 12 min"; con el signo ~ si MEV Ultra no registró el momento del
ingreso). La MEV cierra la sesión en momentos aleatorios (a veces, apenas se
ingresa y se realiza un clic): por ese motivo, desde la 0.8.1 no hay aviso por
tiempo, y las tareas se ejecutan siempre en segundo plano. Si la sesión se
interrumpe durante una lectura, una descarga o una búsqueda, la tarea no se
pierde: se emite un aviso, se aguarda a que el usuario vuelva a ingresar (en
otra pestaña) y la tarea continúa desde el punto en que se encontraba. El
botón **Cerrar sesión** de la barra utiliza la opción Desconectarse de la propia MEV
(0.9.8).

**Descargas: validación de la MEV (0.9.1).** Si durante una descarga la MEV
interpone la pantalla "Validando acceso" (o la verificación de Cloudflare), la
descarga se pausa sin pérdida de datos y ocurren dos cosas en simultáneo: la
solapa Descargas solicita la intervención del usuario (abrir la página
bloqueada en otra pestaña, superar el control y regresar) y el motor intenta
superarla por sí mismo, cargando la página en un marco oculto, con esperas de
5, 10, 20, 40 y 60 segundos; agotados esos intentos, continúa con un pedido
liviano por minuto. El proceso concluye con lo que ocurra primero: al
regresar a la pestaña de MEV Ultra, o cuando otra pestaña de la MEV carga
correctamente una página, se reintenta de inmediato; el botón
"Ya validé: seguir" permite insistir manualmente. Cada reaparición
consecutiva de la pantalla de validación (denominada internamente portero en
el código) comienza con una espera más larga. Con los adjuntos
(docs.scba.gov.ar), el contenido del marco no puede leerse: se lo carga de
todos modos para que quede registrada la cookie, y la comprobación consiste en
volver a solicitar el adjunto, sin consumir reintentos. Hasta la 0.9.0, los
intentos automáticos se realizaban primero (unos 3 minutos) y recién después
se solicitaba la intervención del usuario, con sondeos cada 10 segundos.

**Descargas: errores y cancelación (desde 0.8.0).** La cancelación interrumpe
en el acto el pedido en curso (antes, un adjunto grande continuaba
descargándose) y el PDF se confecciona con lo obtenido hasta ese momento. Un
error que no se resuelve repitiendo el pedido (404, o 403 sin validación de
por medio) se informa de inmediato, sin reintentos; ante un 429
("demasiados pedidos") se espera el tiempo que indique la MEV, con un máximo
de 2 minutos. Una actuación cuyo enlace no pertenece a la propia MEV (https,
mismo sitio, página proveido.asp) no se abre ni se descarga: figura en la
lista y en el anexo del PDF. Para capturar la imagen de un proveído no se
ejecuta ningún programa de la página. Si un proveído no termina de cargar
(por ejemplo, una imagen o una hoja de estilos que no llega), esa actuación se
conserva con su texto y una incidencia, y la descarga continúa.

MEV Ultra **solo lee**: no crea ni modifica Sets, no solicita autorizaciones y
no realiza presentaciones. La solapa Guía consulta páginas públicas de la
Suprema Corte (www.scba.gov.ar) y del Ministerio Público (www.mpba.gov.ar) con
los datos escritos en su formulario, sin enviar información de la MEV.

## Instalación

1. Contar con [Tampermonkey](https://www.tampermonkey.net/) instalado.
2. Desactivar **MEV+** en Tampermonkey (MEV Ultra ya lo incluye).
3. Instalar: **[mev-ultra.user.js](https://raw.githubusercontent.com/Elzas85/MEVULTRA/main/mev-ultra.user.js)**
4. La primera consulta de la solapa Guía hace que Tampermonkey solicite
   permiso para conectarse con www.scba.gov.ar y con www.mpba.gov.ar (ambos
   declarados en `@connect` desde la 0.9.6). Corresponde elegir la opción que
   lo permite siempre, para que no vuelva a preguntarlo.

## Autor

Programa creado por **Ignacio Kinbaum** con Claude.
Contacto: estudiojuridicokinbaum@gmail.com

## Licencia

Licencia de tipo copyleft: **GNU General Public License v3.0 o posterior**
(GPL-3.0-or-later).
