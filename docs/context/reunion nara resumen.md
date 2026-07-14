jul 14, 2026

## **Reunión del 14 jul 2026 a las 12:18 GMT-03:00**

Registros de la reunión [Transcripción](https://docs.google.com/document/d/17TDYCapwf98tHHnt-7zrSFoivLi9EeNwf0rRv9wi9gA/edit?usp=drive_web&tab=t.dmxuoty89ds3) 

### **Resumen**

Se discutieron optimizaciones del sistema de Bills of Lading, validando procesos de envío y configuración técnica operativa.

**Problemas operativos y migración**  
Se identificaron fallas en la ejecución automática de los Bills of Lading tras el guardado en el sistema. La plataforma técnica fue migrada al servidor Vercel para resolver errores de acceso.

**Automatización y gestión documental**  
El flujo de envío de correos se vinculará a la confirmación de zarpe y documentos específicos como certificados. El sistema asumirá la responsabilidad ante errores técnicos inesperados fuera de configuración.

**Mejoras de interfaz implementadas**  
Se acordó implementar mejoras en los filtros de búsqueda y la terminología de estado antes del viernes. La actualización completa permitirá una gestión más eficiente de las órdenes pendientes.

### **Próximos pasos**

- [ ] \[J. Zenteno\] Revisar casos: Investigar 6 casos de Bill of Lading donde el proceso falló o no generó alertas al guardarse.

- [ ] \[La comunidad\] Procesar Bill of Lading: Eliminar el archivo antiguo al realizar actualizaciones y reprocesar manualmente el documento en la plataforma web marcando como revisado.

- [ ] \[J. Zenteno\] Implementar filtro: Agregar una funcionalidad de búsqueda y filtrado por buque y órdenes pendientes en la interfaz de control.

- [ ] \[Naara Estefania Ovejero\] Entregar órdenes: Facilitar los números de orden que disparó el usuario Jorge para que sean analizados y corregidos en el sistema.

- [ ] \[Naara Estefania Ovejero\] Actualizar acceso: Configurar el nuevo link de la aplicación en los marcadores del navegador y eliminar el acceso antiguo.

- [ ] \[J. Zenteno\] Habilitar historial: Desarrollar una funcionalidad de búsqueda para consultar operaciones pasadas y documentación asociada.

- [ ] \[J. Zenteno\] Relacionar certificados: Crear un botón para reasignar certificados a la orden correcta en caso de error en la carga.

- [ ] \[J. Zenteno\] Mejorar control BL: Implementar mejoras en el control del Bill of Lading para identificar automáticamente los cambios de buque. Incluir el estado pendiente en la tarjeta de orden.

- [ ] \[J. Zenteno\] Implementar seguimiento: Desarrollar la funcionalidad de seguimiento para visualizar las órdenes pendientes, vencidas o por vencer. Asegurar la visualización clara de cada estado operativo.

- [ ] \[Naara Estefania Ovejero\] Actualizar contactos Brasil: Recopilar y enviar el listado de contactos de las líneas marítimas en Brasil. Proveer los detalles necesarios para la coordinación de retiro de contenedores.

- [ ] \[J. Zenteno\] Revisar adjuntos: Investigar la causa de los errores en la adjunción de archivos comprimidos y certificados. Corregir los fallos en la visualización o generación de documentos.

- [ ] \[J. Zenteno\] Configurar notificaciones: Integrar el campo de Notify en el sistema de mailing. Asegurar que la configuración del envío de documentación sea correcta según el cliente y el tipo de operación.

- [ ] \[Naara Estefania Ovejero\] Familiarizarse sistema: Explorar las nuevas funcionalidades del sistema de seguimiento y mailing. Reportar errores o sugerencias de mejora tras el uso práctico.

### **Detalles**

* **Problemas de ejecución de BL**: J. Zenteno y Naara Estefania Ovejero discutieron las fallas en la ejecución automática de los Bills of Lading (BL) tras ser guardados en el sistema. Identificaron que algunos archivos no se procesaron correctamente después de ser guardados y tuvieron que ser forzados manualmente ([00:00:05](?tab=t.dmxuoty89ds3#heading=h.tr0loe82i6kz)). Se acordó revisar seis casos específicos para determinar por qué el flujo se interrumpió y no generó la alerta correspondiente ([00:02:12](?tab=t.dmxuoty89ds3#heading=h.t0k1dkso8rtz)).

* **Protocolo de reemplazo de BL**: Ante un cambio o modificación en un BL, J. Zenteno estableció que el procedimiento correcto es eliminar el archivo antiguo y guardar uno nuevo. Dado que el activador automático no funciona al sobrescribir archivos con el mismo nombre y código, el personal deberá realizar una ejecución manual a través de la interfaz web, utilizando la opción de reprocesar el BL draft y marcar la orden como revisada ([00:02:12](?tab=t.dmxuoty89ds3#heading=h.t0k1dkso8rtz)).

* **Mejoras en la interfaz de búsqueda**: Se planteó la necesidad de implementar filtros más eficientes para el control de BL, como la posibilidad de filtrar por buque o por fechas de próximas salidas. Naara Estefania Ovejero sugirió que asociar el buque a la orden permitiría una gestión más clara, y J. Zenteno confirmó que se utilizará la información del BL para facilitar el seguimiento de las órdenes pendientes de revisión ([00:03:21](?tab=t.dmxuoty89ds3#heading=h.7p4k0z30l9dt)).

* **Revisión de errores operativos**: Se discutió la importancia de que Naara Estefania Ovejero gestione el control de los BL marcando las órdenes como revisadas o informando errores de origen, como discrepancias en el destino o datos de planilla. J. Zenteno enfatizó que este proceso de revisión es un requisito previo indispensable para que el sistema de mailing procese la documentación ([00:09:09](?tab=t.dmxuoty89ds3#heading=h.kbak2f830gqp)).

* **Migración técnica y acceso a la plataforma**: J. Zenteno informó sobre la migración del servidor de la aplicación de Netlify a Vercel, por lo que el enlace anterior dejó de funcionar. Se proporcionó la nueva dirección web (versel.app) y se instruyó a Naara Estefania Ovejero para actualizar sus marcadores y contraseñas, resolviendo problemas de acceso experimentados previamente ([00:12:31](?tab=t.dmxuoty89ds3#heading=h.ryfbx697p0vm)).

* **Retención de documentos e histórico**: Para optimizar el espacio de almacenamiento en Drive, J. Zenteno explicó que los documentos se mantendrán disponibles en la nube durante un periodo de un mes. Posteriormente, la documentación será trasladada a Matrix para consulta histórica. Se discutió la necesidad de implementar un buscador de registros anteriores por número de orden para casos de consultas de clientes, manteniendo la capacidad de visualizar el análisis previo ([00:20:00](?tab=t.dmxuoty89ds3#heading=h.u69gtupa0kw2)).

* **Gestión de errores no detectados**: Ante la inquietud de Naara Estefania Ovejero sobre posibles errores no detectados por el sistema, J. Zenteno aclaró que la responsabilidad principal reside en el sistema y en su propia configuración. Se acordó que, si se detecta un error fuera de lo previsto, se analizará para realizar ajustes, evitando cargar con la culpa individual por fallas técnicas ([00:23:18](?tab=t.dmxuoty89ds3#heading=h.5ghtd69f8l4z)).

* **Certificados de origen**: Respecto a los certificados de origen, J. Zenteno indicó que es necesario relacionar la orden con el número de archivo ZIP para que el sistema genere el PDF automáticamente. Se planea eliminar la función de regeneración y enfocar el sistema en la actualización múltiple de órdenes, además de añadir un botón para revisar y reasignar certificados en caso de errores en la carga inicial ([00:26:04](?tab=t.dmxuoty89ds3#heading=h.gtkeo04fsvvp)).

* **Sistema de mailing y confirmación de zarpe**: Se detalló el funcionamiento del sistema de mailing, que se activará tras confirmar el zarpe (ATD). El sistema utilizará la información de documentos como el 315 o correos de confirmación para procesar el envío de documentación. Naara Estefania Ovejero y J. Zenteno validaron el proceso ingresando órdenes y fechas en la interfaz de prueba ([00:29:42](?tab=t.dmxuoty89ds3#heading=h.hdr19ltfrphu)).

* **Gestión de cambios de buque (Roll-overs)**: Se analizó la problemática de los BLs que quedan desactualizados tras cambios de buque. J. Zenteno propone que, al momento de confirmar el zarpe, el sistema identifique las órdenes pendientes para que se pueda informar el roll-over, forzando así la carga de un nuevo BL y su correspondiente control antes del envío ([00:33:29](?tab=t.dmxuoty89ds3#heading=h.fkwfdxp8vvqm)) ([00:38:45](?tab=t.dmxuoty89ds3#heading=h.ed4rkaq7dxzd)).

* **Configuración de contactos para mailing**: El sistema de mailing permitirá gestionar los contactos de envío por cliente y por "Ship-to" o "Consignee". J. Zenteno explicó que, una vez que el personal valide los contactos en la primera operación, estos quedarán configurados para futuras órdenes. Se incluyó la posibilidad de bloquear contactos o agregar nuevos si es necesario ([00:42:07](?tab=t.dmxuoty89ds3#heading=h.bqjt4ql8634j)) ([00:48:24](?tab=t.dmxuoty89ds3#heading=h.ih14d1sc8jt8)).

* **Pruebas de envío y correcciones de diseño**: Durante una prueba exitosa, se verificó el envío de documentación para la operación de "Lupin". J. Zenteno tomó nota para mejorar el diseño del correo electrónico y está trabajando en la automatización del flujo para el Certificado de Análisis (COA), el cual aún requiere ajustes manuales ([00:49:18](?tab=t.dmxuoty89ds3#heading=h.qrwusq2833f8)) ([00:54:18](?tab=t.dmxuoty89ds3#heading=h.ux33nwas4kv3)).

* **Certificados de seguro (SE)**: Se definió el flujo para el manejo de certificados de seguro. Se acordó que el personal debe guardarlos en el Drive con la nomenclatura "número de orden\_sec". En el futuro, el sistema marcará si el documento está presente o no cuando la condición de la carga lo requiera, integrando esto en la alerta de envío de documentación ([00:56:19](?tab=t.dmxuoty89ds3#heading=h.5zxu9qf597ot)).

* **Carga de trabajo manual e implementación**: J. Zenteno y Naara Estefania Ovejero discuten el proceso manual de ingreso de certificados de origen y declaraciones, señalando que esta tarea será realizada por una sola persona. J. Zenteno indica que utilizará la grabación de la reunión para desarrollar la implementación del sistema ([00:58:37](?tab=t.dmxuoty89ds3#heading=h.5tzmex8bciq0)).

* **Filtros del sistema y seguimiento de pedidos**: J. Zenteno demuestra el sistema de filtros, revisando alertas sobre vencimientos y pedidos pendientes de envío. Se menciona el caso de "Planta Goodillu" y la orden "311 BL", donde J. Zenteno aclara la necesidad de mejorar la visibilidad sobre la disponibilidad de documentación y el estado del COA (Certificado de Análisis) ([00:59:37](?tab=t.dmxuoty89ds3#heading=h.3zkuns73e7dm)).

* **Control de SAPE ZARPE y Bill of Lading**: J. Zenteno revisa el estado de confirmación de SAPE ZARPE y demuestra la funcionalidad de control del BL (Bill of Lading). Se explica cómo marcar un BL como revisado y cómo el sistema registra al usuario responsable de dicha validación ([01:01:29](?tab=t.dmxuoty89ds3#heading=h.uh4ymu8fxv3k)).

* **Mejoras en la funcionalidad del sistema**: J. Zenteno repasa las opciones de filtrado por transporte y cliente, y se compromete a añadir campos para "sold-to" y "ship-to" en la base de datos. Naara Estefania Ovejero expresa su interés en ver el estado de las órdenes de manera más clara, citando como ejemplo el seguimiento de la orden 241 ([01:04:07](?tab=t.dmxuoty89ds3#heading=h.c2uj5mokn8jk)).

* **Preferencias de interfaz y terminología**: Naara Estefania Ovejero y J. Zenteno discuten aspectos visuales y de usabilidad, acordando modificar las etiquetas de estado, como cambiar "Envío" por "pendiente" o "enviado documentos" para mayor claridad. J. Zenteno también se compromete a facilitar el acceso directo a la configuración de correos electrónicos desde la orden ([01:06:13](?tab=t.dmxuoty89ds3#heading=h.xe70pbegp1it)).

* **Cronograma de implementación**: J. Zenteno establece el objetivo de tener los cambios y correcciones implementados para el viernes de la semana en curso. Se acuerda que Naara Estefania Ovejero comenzará a utilizar el sistema la semana siguiente, con la posibilidad de realizar reuniones adicionales para evaluar pendientes ([01:07:53](?tab=t.dmxuoty89ds3#heading=h.w6xdmwdkwhp6)).

* **Familiarización con la plataforma**: J. Zenteno incentiva a Naara Estefania Ovejero a explorar el sistema una vez que los cambios estén operativos. El objetivo es que Naara Estefania Ovejero gane práctica para identificar mejoras adicionales y posibles procesos que puedan ser automatizados en el futuro ([01:09:33](?tab=t.dmxuoty89ds3#heading=h.i7zc54o0qdxx)).

*Revisa las notas de Gemini para asegurarte de que sean precisas. [Obtén sugerencias y descubre cómo Gemini toma notas](https://support.google.com/meet/answer/14754931)*

*Cómo es la calidad de **estas notas específicas?** [Responde una breve encuesta](https://google.qualtrics.com/jfe/form/SV_9vK3UZEaIQKKE7A?confid=dYui9EItmU-AVJebQzSLDxIYOAIIigIgABgFCA&detailid=standard&screenshot=false) para darnos tu opinión; por ejemplo, cuán útiles te resultaron las notas.*