# MEV Ultra

Userscript para **Tampermonkey** que pone **una sola ventana** sobre la
[Mesa de Entradas Virtual (MEV) de la SCBA](https://mev.scba.gov.ar/).

Incluye **MEV+ completo** (la descarga fiel del expediente en un PDF único) y le
suma la lista de **todas tus causas**, de todos tus Sets de Búsqueda, en todas
las jurisdicciones. No se instala junto con MEV+: MEV Ultra ya lo trae.

## Por qué la MEV no muestra todas las causas de un Set

La MEV muestra cada Set **por partes**:

1. Solo las causas de la **jurisdicción** elegida al ingresar (departamento y
   fuero, o Suprema Corte, Casación o Justicia de Paz).
2. Dentro de esa jurisdicción, **de a un organismo**. La página de resultados
   muestra el primer juzgado y tiene un desplegable "Organismos del Set" con
   los demás.

Por eso un Set que según la MEV tiene 77 causas mostraba 9. MEV Ultra recorre
todas esas combinaciones y arma una sola lista.

## Qué hace

- **Se abre sola** al entrar a la MEV, ocupando la pantalla. Se minimiza,
  maximiza, restaura, mueve, redimensiona y acerca o aleja. Minimizada o
  cerrada queda un indicador verde abajo a la derecha, que se pone rojo si hay
  un aviso.
- **Mis causas:** una tabla con todas las causas. Búsqueda en todos los campos
  (varias palabras), filtros por departamento, organismo, Set, estado,
  etiqueta y fechas del último movimiento. Columnas que se ordenan, se mueven,
  se ensanchan y se ocultan. Paginado de 5 en 5 hasta 50. Exporta la lista a un
  archivo que abre Excel.
- **Novedades:** después de cada lectura marca con un punto verde las causas
  con un movimiento nuevo, un cambio de estado o recién agregadas a un Set. Las
  que dejaron de figurar se conservan aparte.
- **Etiquetas y anotaciones** propias, con un clic sobre la celda. Son notas
  privadas de trabajo y no tocan la MEV.
- **Este expediente:** datos de la causa y sus pasos procesales, con Ver (en
  pestaña nueva), bajar una sola actuación, o elegir qué bajar a mano, por
  rango de fechas o filtrando por texto.
- **Descargas:** el motor de MEV+, de a un expediente por vez y en segundo
  plano. Tope de 15 en espera.
- **Sets:** qué contiene cada Set, cuántas causas declara la MEV, cuántas se
  encontraron y en qué jurisdicciones.
- **Buscar persona** (desde 0.5.0): busca un nombre en la carátula de las
  causas de los juzgados civiles y comerciales de los 23 departamentos
  judiciales y de los juzgados de paz, sin recorrer la MEV juzgado por
  juzgado. Va pausado, una consulta cada 4 segundos; se puede pausar y
  retomar, y las búsquedas quedan en un historial. Si la MEV pide verificar
  que sos una persona, espera a que lo resuelvas.
- **Datos y respaldo:** etiquetas, respaldo cifrado (.mevu, con contraseña que
  se pone una vez) y respaldo automático en una carpeta.

## Lectura de las causas

- **Completa:** recorre todas las jurisdicciones hasta completar el total que
  declara cada Set. Es la primera vez y cuando se quiera revisar todo.
- **Rápida:** vuelve solo a donde ya encontró causas de cada Set.

Mientras lee cambia la jurisdicción de tu sesión de la MEV; al terminar deja la
que tenías. Conviene no navegar la MEV en otras pestañas mientras tanto.

MEV Ultra **solo lee**: no crea ni modifica Sets, no solicita autorizaciones y
no presenta nada.

## Instalación

1. Tené [Tampermonkey](https://www.tampermonkey.net/) instalado.
2. Desactivá **MEV+** en Tampermonkey (MEV Ultra ya lo incluye).
3. Instalá: **[mev-ultra.user.js](https://raw.githubusercontent.com/Elzas85/MEVULTRA/main/mev-ultra.user.js)**

## Autor

Creado por **Ignacio Kinbaum** con Claude.
Contacto: estudiojuridicokinbaum@gmail.com

## Licencia

Copyleft: **GNU General Public License v3.0 o posterior** (GPL-3.0-or-later).
