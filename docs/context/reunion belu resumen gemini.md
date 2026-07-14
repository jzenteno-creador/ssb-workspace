jul 14, 2026

## **Reunión del 14 jul 2026 a las 14:25 GMT-03:00**

Registros de la reunión [Transcripción](https://docs.google.com/document/d/1N2P5TMAaLomj4dfnwfdsI1hK9gNc7ijj2Hsfx5JtbjE/edit?usp=drive_web&tab=t.59bki1ftzpqp) 

### **Resumen**

Reunión técnica para definir mejoras en tarifas terrestres y establecer el flujo de seguimiento de cargas.

**Optimización de tarifas terrestres**  
Se implementarán filtros desplegables y una función de carga masiva mediante Excel para agilizar la gestión de tarifas. El sistema validará automáticamente duplicados y destinos nuevos para asegurar la integridad de datos.

**Seguimiento y automatización operativa**  
Se definió un nuevo módulo de seguimiento terrestre con carga de datos en 2 etapas para documentos y monitoreo. El sistema integrará la búsqueda automática de documentación y cálculo de tiempos.

**Prioridades de desarrollo tecnológico**  
El desarrollo priorizará la funcionalidad completa de las tarifas terrestres antes de avanzar hacia el seguimiento. Se trabajará en los ajustes visuales de la interfaz solo después de finalizar ambas funcionalidades.

### **Próximos pasos**

- [ ] \[J. Zenteno\] Mejorar filtros de tarifas: Implementar un filtro en la solapa de tarifas terrestres que permita autocompletar y seleccionar el destino al escribir, reemplazando el clic manual con la navegación por teclado.

- [ ] \[J. Zenteno\] Desarrollar integración masiva: Desarrollar una herramienta de integración masiva para tarifas similar al macro update de Matrix, permitiendo pegar datos de Excel y validando destinos duplicados o nuevos mediante un botón específico.

- [ ] \[J. Zenteno\] Habilitar filtros edición: Habilitar filtros en el modo edición de tarifas para permitir búsquedas rápidas y actualizaciones grupales de datos similares.

- [ ] \[J. Zenteno\] Automatizar usuario edición: Modificar el sistema de edición de tarifas para capturar el usuario logueado automáticamente al guardar cambios, eliminando la necesidad de seleccionar el usuario manualmente.

- [ ] \[J. Zenteno\] Ajustar alta de tarifas: Ajustar la funcionalidad de alta de nueva tarifa para validar destinos contra la base de datos existente y permitir la creación de nuevos registros mediante escritura manual.

- [ ] \[J. Zenteno\] Implementar pegado masivo: Desarrollar una función para pegar columnas de órdenes y certificados de origen de forma masiva en el sistema, similar al proceso de macro update.

- [ ] \[J. Zenteno\] Diseñar seguimiento terrestre: Diseñar la solapa de seguimiento de operaciones terrestres, incluyendo la automatización de la carga de datos desde informes terrestres y la gestión documental asociada al despacho.

- [ ] \[Maria Belen Ahumada\] Configurar planilla seguimiento: Agregar una columna con búsqueda VLOOKUP para permisos de exportación en la planilla de seguimiento para facilitar la carga de datos al aplicativo.

### **Detalles**

* **Mejoras visuales para tarifas terrestres**: J. Zenteno y Maria Belen Ahumada acuerdan realizar mejoras en la interfaz de la solapa de tarifas. Se implementará un filtro que permita buscar y seleccionar destinos, carriers, puntos de departure y aduanas directamente desde un desplegable sin necesidad de completar el texto manualmente, solucionando el problema actual donde el botón hacia abajo no funciona para seleccionar coincidencias ([00:00:00](?tab=t.59bki1ftzpqp#heading=h.b15pgz1wgvix)).

* **Integración masiva de tarifas**: J. Zenteno propone desarrollar una funcionalidad de integración masiva similar al "macro update" de Matrix. Esta permitirá copiar datos desde un archivo Excel y pegarlos en un cuadro con títulos preestablecidos (carrier, origen, destino, país, aduana, flete, seguro). El sistema incluirá un botón de validación para detectar destinos nuevos o duplicados antes de proceder con la carga definitiva ([00:02:25](?tab=t.59bki1ftzpqp#heading=h.g3o7616eoqzr)).

* **Edición y filtrado de tarifas**: Se acuerda habilitar filtros en el modo edición de tarifas terrestres, permitiendo realizar búsquedas rápidas para editar registros específicos o actualizar múltiples rutas similares (por ejemplo, rutas a Chile que solo difieren en la aduana) simultáneamente ([00:03:47](?tab=t.59bki1ftzpqp#heading=h.1d0rn5cvy89e)).

* **Gestión de cambios y usuarios**: J. Zenteno confirma que se mantendrá el historial de cambios, registrando quién realiza cada modificación. Se eliminará el filtro manual de usuario para la edición, y el sistema detectará automáticamente al usuario logueado. Además, al guardar o descartar cambios, se activará una ventana emergente (popup) que validará la identidad del usuario ([00:04:59](?tab=t.59bki1ftzpqp#heading=h.ujfd574egfyk)) ([00:07:28](?tab=t.59bki1ftzpqp#heading=h.3fp60rsnqn5o)).

* **Creación de nuevas tarifas**: Para la carga de nuevas tarifas, el sistema listará los transportes y destinos que ya existen en la base de datos. Se permitirá agregar nuevos transportes y destinos mediante una opción específica, la cual validará la información ingresada contra los registros existentes para asegurar la integridad de la base de datos ([00:06:16](?tab=t.59bki1ftzpqp#heading=h.w6ezmt3nzeoc)).

* **Integración de certificados de origen**: Se discutió la necesidad de gestionar certificados de origen mediante el pegado masivo, similar al funcionamiento del "macro update". J. Zenteno confirma que se mapeará esta funcionalidad para permitir pegar números de orden y de certificado desde Excel, incluyendo un buscador para localizar certificados generados previamente en la base de datos ([00:07:28](?tab=t.59bki1ftzpqp#heading=h.3fp60rsnqn5o)).

* **Iniciativa de seguimiento terrestre**: J. Zenteno y Maria Belen Ahumada definen el concepto para el nuevo "seguimiento terrestre", separándolo de la herramienta de seguimiento marítimo existente. Se acuerda iniciar este proceso mediante la carga de operaciones (número de orden/PO) una vez que se recibe el informe terrestre o se tiene la documentación disponible ([00:10:00](?tab=t.59bki1ftzpqp#heading=h.uewnvyg8hf7c)).

* **Automatización de documentación y KPIs**: Se establece que el sistema debe buscar automáticamente en el Drive documentos como la factura, el packing list, el certificado de origen y el permiso de exportación (requerido para clientes como Bolivia y Criobac). El seguimiento debe permitir controlar el KPI de un día hábil para el envío de documentación ([00:11:22](?tab=t.59bki1ftzpqp#heading=h.m241w12zqg5)).

* **Mailing y validación de contactos**: Se desarrollará un módulo de mailing para el seguimiento terrestre, replicando la lógica de marítimo. El sistema extraerá los contactos del "booking advice" y permitirá al usuario validar si los contactos son correctos o excluir aquellos que no corresponden. Esta validación se guardará para futuras órdenes con el mismo cliente ([00:14:15](?tab=t.59bki1ftzpqp#heading=h.b87bhmhh8ne3)).

* **Cálculo de tiempos y fechas**: Se acuerda que el cálculo del tránsito estimado se realizará automáticamente basándose en la fecha de salida de planta confirmada por el informe terrestre y el destino, evitando confiar únicamente en datos variables como el CRT, que han demostrado no ser totalmente fiables ([00:15:45](?tab=t.59bki1ftzpqp#heading=h.qm95caist77l)).

* **Flujo de trabajo de carga de datos**: Tras evaluar la fiabilidad de las fuentes de datos, J. Zenteno y Maria Belen Ahumada acuerdan que el usuario copiará la información directamente desde su planilla de seguimiento interna hacia la aplicación para asegurar la precisión de los datos enviados ([00:18:45](?tab=t.59bki1ftzpqp#heading=h.5afz0zw5csvh)).

* **Propuesta de carga en dos etapas**: J. Zenteno propone un flujo de trabajo en dos instancias para la carga de datos: una carga inicial por la mañana con el número de orden, fecha de informe terrestre y permiso de exportación para monitoreo, y una segunda carga con los documentos finales (factura, certificado, etc.) necesaria para ejecutar el envío de los correos electrónicos ([00:21:48](?tab=t.59bki1ftzpqp#heading=h.1yvduaqt2le4)).

* **Prioridades de desarrollo**: J. Zenteno concluye que, antes de avanzar con el diseño visual del seguimiento terrestre, se enfocará primero en completar la funcionalidad de las tarifas terrestres. Posteriormente, se trabajará en la funcionalidad de seguimiento y finalmente en los ajustes visuales de la interfaz ([00:26:19](?tab=t.59bki1ftzpqp#heading=h.5te7lhgydpe)).

*Revisa las notas de Gemini para asegurarte de que sean precisas. [Obtén sugerencias y descubre cómo Gemini toma notas](https://support.google.com/meet/answer/14754931)*

*Cómo es la calidad de **estas notas específicas?** [Responde una breve encuesta](https://google.qualtrics.com/jfe/form/SV_9vK3UZEaIQKKE7A?confid=CGQOdbdZcwu27kHLvgc-DxIVOBABMgUIigIgABgFCA&detailid=standard&screenshot=false) para darnos tu opinión; por ejemplo, cuán útiles te resultaron las notas.*