# SADE+: revisión y recomendaciones

Fecha: 12 de septiembre de 2026

## Estado general

SADE+ presenta una orientación adecuada para una herramienta interna de lectura y organización:

- replica el listado sin modificar el sistema original;
- muestra el texto completo y ofrece búsqueda, orden y paginación;
- mantiene las etiquetas y anotaciones separadas del expediente;
- verifica que la acción disponible diga exactamente `Tramitar`;
- permite abrir la actuación en una pestaña nueva;
- incluye exportación e importación de anotaciones;
- funciona tanto sobre el Expediente Electrónico como sobre GEDO.

Dado que SADE+ es de uso interno, el objetivo no es publicarlo para el público en general. El objetivo es que resulte confiable para el autor y sus colegas, que no pierda anotaciones y que no ejecute una acción dos veces.

## 1. Evitar que dos pestañas sobrescriban mutuamente las anotaciones

### Problema

SADE+ carga todas las marcas en la variable `MARCAS`. Cuando se modifica una fila, `fijarMarca` cambia esa copia en memoria y guarda el objeto completo.

Si hay dos pestañas abiertas:

1. la pestaña A lee las marcas;
2. la pestaña B lee las mismas marcas;
3. A agrega una anotación y guarda;
4. B agrega otra anotación a partir de su copia desactualizada y guarda;
5. el guardado de B puede eliminar el cambio de A.

### Relevancia

Se trata de una pérdida de trabajo que se produce sin aviso. Puede ocurrir precisamente cuando se trabaja con un expediente en una pestaña y con el listado en otra.

### Recomendación

Antes de cada cambio:

1. volver a leer el objeto guardado;
2. aplicar únicamente el cambio de la fila que se está editando;
3. guardar el resultado actualizado.

Para una mayor robustez, se recomienda agregar una marca de tiempo por fila. Si dos copias modifican filas distintas, es posible combinarlas. Si modifican la misma fila, puede conservarse el texto más reciente o ambos textos con una separación visible.

Asimismo, resulta conveniente atender el evento `storage` cuando se utiliza `localStorage`, y volver a dibujar el listado si otra pestaña modificó una anotación.

### Prueba necesaria

1. Abrir SADE+ en dos pestañas.
2. Registrar una anotación sobre una actuación en la pestaña A.
3. Registrar una anotación sobre otra actuación en la pestaña B.
4. Recargar ambas pestañas.
5. Confirmar que se conservan las dos anotaciones.
6. Repetir el procedimiento modificando la misma fila y comprobar que no se pierde texto sin aviso.

## 2. Asociar el encargo de apertura de una actuación a una ventana determinada

### Problema

Para abrir una actuación en otra pestaña, SADE+ registra un encargo en una única clave de `localStorage`:

```js
sade.plus.abrir
```

La pestaña nueva lo toma y lo elimina. Si otra pestaña de SADE+ se está cargando al mismo tiempo, puede leer ese encargo antes que la pestaña correcta.

### Consecuencias posibles

La actuación podría tramitarse en la pestaña equivocada, o el encargo podría desaparecer si la pestaña nueva demora demasiado en cargarse.

### Recomendación

Agregar un identificador aleatorio de encargo y asociarlo a la ventana que se abre:

- `id` aleatorio;
- fecha de creación;
- clave de la actuación;
- origen esperado;
- estado `pendiente`.

La pestaña nueva debería reclamar el encargo mediante ese identificador. Si no puede reclamarlo, no debe ejecutar `Tramitar`.

Como mínimo, se recomienda incluir la URL esperada y no permitir que una pantalla de GEDO consuma un encargo del Expediente Electrónico.

### Pruebas necesarias

- Abrir dos actuaciones en rápida sucesión.
- Mantener dos pestañas de SADE+ abiertas antes de abrir una nueva.
- Abrir una actuación con GEDO a la vista.
- Bloquear la ventana emergente y confirmar que no queda ningún encargo pendiente.
- Recargar la pestaña nueva antes de que aparezca el listado.

## 3. Reforzar la protección de la acción Tramitar

La comprobación de que la opción diga exactamente `Tramitar` constituye una protección adecuada y debe conservarse.

Como refuerzo:

- deshabilitar temporalmente el botón de apertura mientras se espera la respuesta;
- guardar la clave de la actuación en curso;
- rechazar otro intento con la misma clave;
- después del clic, comprobar que la fila cambió o que apareció la pantalla del expediente;
- si no se produce el cambio, informar `No se pudo confirmar que Tramitar haya sido ejecutado`.

No es conveniente reintentar automáticamente `Tramitar`: se trata de una orden sobre el sistema y podría ejecutarse dos veces.

## 4. Respaldos y uso interno

Dado que SADE+ está destinado al autor y a sus colegas, se recomienda:

- mantener el repositorio privado;
- no incluir expedientes, anotaciones ni exportaciones reales;
- no guardar datos sensibles en capturas de prueba;
- mantener una carpeta de ejemplos anonimizados;
- explicar al equipo de trabajo que las anotaciones se almacenan en el navegador de cada computadora;
- recomendar su exportación como respaldo antes de limpiar el perfil del navegador.

Si varias personas utilizan la misma computadora, es conveniente que cada perfil del navegador tenga su propio almacenamiento. Si ello no es posible, las anotaciones requieren una separación adicional por usuario.

## 5. Mejoras recomendadas para una etapa posterior

### Registro de fallas

Cuando `Tramitar`, la lectura o la apertura de una ficha fallan, se recomienda guardar localmente un registro breve con:

- fecha y hora;
- módulo: Expediente o GEDO;
- etapa;
- mensaje;
- clave de la actuación anonimizada.

No debe guardarse el contenido completo del expediente.

### Estado de carga

En listados extensos es conveniente indicar:

- la página actual;
- la cantidad de filas leídas;
- si la ventana muestra todo el listado o solo la parte ya recibida;
- si una anotación se guardó correctamente.

### Consistencia de vocabulario

Se recomienda utilizar siempre:

- `anotacion` para los datos privados;
- `Tramitar` para la acción del sistema;
- `abrir` para mostrar una pantalla;
- `guardar` para persistir una anotación;
- `exportar` e `importar` para trasladar datos entre computadoras.

De ese modo se evita confundir una anotación interna con una acción del expediente.

## Orden sugerido

1. Evitar que dos pestañas sobrescriban las anotaciones.
2. Aislar y validar los encargos de pestañas nuevas.
3. Bloquear las acciones duplicadas de `Tramitar`.
4. Agregar pruebas de dos pestañas y de recargas.
5. Mejorar el registro de fallas y los textos visibles.

## Verificación actual

El userscript supera la validación de sintaxis y el editor no informa errores. La presente revisión es estática. Las pruebas reales deben realizarse primero sobre una actuación que no implique una acción sensible y, en el caso de `Tramitar`, solo cuando el usuario tenga certeza de que corresponde ejecutarla.
