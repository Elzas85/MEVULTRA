# Cambios en MEV Ultra

## Manejo de la validación

Cuando la MEV devuelve la pantalla de validación, el programa deja de procesarla como si fuera el proveído o del documento adjunto. La descarga pendiente no se procesa como contenido del expediente.

A partir de este cambio, la validación requiere una intervención visible del usuario:

1. El panel informa que la descarga se encuentra pausada.
2. Se abre la página de la MEV en otra pestaña.
3. La persona usuaria completa allí la validación y pulsa el botón "Ya validé: seguir" en el panel.
4. El programa vuelve a solicitar el elemento que estaba pendiente.
5. Si la MEV continúa devolviendo la validación, la descarga se pausa nuevamente y se vuelve a solicitar la confirmación.

Mientras la ejecución está pausada, no se envían sondeos periódicos a la página protegida. La compuerta compartida mantiene en espera las demás solicitudes, lo que evita que la cola continúe avanzando mientras se atiende la validación. La pausa puede cancelarse; al reanudar, se conserva el trabajo descargado hasta ese momento.

## Actuaciones y adjuntos

Las actuaciones vuelven a consultarse después de la confirmación manual. Los adjuntos siguen el mismo procedimiento: si el repositorio de documentos devuelve una validación, el programa solicita abrir el enlace y, una vez pulsado el botón "Ya validé: seguir", reintenta la descarga original.

La detección de respuestas limpias, la pausa adaptativa entre pedidos y el descanso periódico entre actuaciones se mantienen vigentes. Cada validación aumenta la pausa; las respuestas correctas la reducen gradualmente.

## Código que permanece sin uso

Permanecen en el archivo las antiguas funciones `navegarEnMarco` y `sondear`, además de opciones de configuración relacionadas con ellas. El procedimiento actualizado ya no las invoca. También subsisten comentarios del encabezado que describen el mecanismo anterior; se recomienda actualizarlos para que la documentación interna del programa de usuario (userscript) coincida con este comportamiento.

## Comprobación

Se ejecutó `node --check` sobre `mev-ultra.user.js` después del cambio del procedimiento manual; el comando no informó errores de sintaxis.
