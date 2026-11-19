# Módulos y puntos de integración de Charito

La aplicación conserva un único catálogo de productos terminados, usuarios y tiendas, con autorización en Supabase. Las existencias de insumos del taller se diseñarán separadas de las existencias de productos terminados de cada tienda.

## Implementado

`dist/sale-history.js` contiene la consulta local, los filtros, la confirmación y la validación previa a eliminar una venta. `v2.js` conecta este componente con la pantalla de ventas mediante el contexto existente: estado, operación segura, recarga y representación. El componente no escribe directamente en tablas ni conoce credenciales privilegiadas.

La acción `void_sale` de `charito_operate` es el contrato del servidor: valida rol y turno, marca la venta como anulada, registra las reversiones de cobros y stock e invalida el conteo final. La interfaz la presenta como venta eliminada y conserva la trazabilidad. No se ejecuta DELETE ni se modifican cierres anteriores.

El cierre de sesión limpia el estado del componente y las respuestas antiguas no reabren su interfaz. La confirmación de eliminación no se guarda en borradores. La sincronización de fondo espera mientras un diálogo está abierto; la operación vuelve a ser validada en el servidor al confirmarla.

## Recetas del taller y perfiles

La versión 26 incorpora `workshop.js`, `workshop-model.js` y `workshop.css`. La migración `22_recetas_taller.sql` carga seis preparaciones con 29 ingredientes como recetas provisionales. Las unidades, equivalencias de huevos, aceite, leche y rendimientos quedan pendientes de confirmación del quequero. No incluye tiempos de batido.

El administrador y la gerente pueden consultar, editar, validar y archivar recetas. El quequero consulta y edita. El almacenero consulta y calcula cantidades por tanda. Vendedores y encargados de tienda no tienen acceso al catálogo de recetas, ni mediante la interfaz ni por consultas directas. Las escrituras usan una transacción, validación de versión, clave de reintento y auditoría de los estados anterior y posterior. Editar una receta validada la devuelve a provisional.

Los perfiles nuevos `owner`, `warehouse` y `baker` no se asignan a tiendas ni heredan autorización para operar caja. La gerente recibe permiso de lectura para stock y reportes de ventas de ambas tiendas, conservando la separación entre consultar y operar. La gestión de cuentas y permisos sigue reservada al administrador con su verificación de seguridad.

`shift-entry.js` presenta tienda y luego turno para vendedores y encargados. Reutiliza los turnos compartidos existentes. Cambiar de tienda no cierra el turno anterior ni crea otro automáticamente. La apertura conserva el conteo físico y la restricción de un turno activo por tienda.

## Extensión propuesta

Compras, almacén central, producción, pagos a proveedores y rentabilidad tendrán componentes y funciones de servidor propios. Compartirán identificadores y contratos explícitos, con migraciones aditivas, permisos de módulo y políticas RLS. Las pantallas y consultas de esos módulos se cargarán al necesitarlas.

Completar una producción deberá consumir insumos y generar productos terminados atómicamente. Despachar y recibir productos del taller deberá usar una referencia única para evitar duplicar las entregas manuales actuales. Pagar un proveedor desde una tienda deberá producir un único movimiento vinculado de caja; un pago central no cambiará la caja de tienda.

El costeo guardará versiones y costos históricos. Las tablas nuevas no sustituirán los registros de caja ni recalcularán sus cierres. Las integraciones requerirán pruebas de regresión en el entorno aislado antes de activarse por módulo.

El diseño funcional detallado se entrega en `outputs/Propuesta_modulos_almacen_costos_Charito.md` dentro del espacio de trabajo. Es una propuesta; los módulos de almacén y rentabilidad todavía no están implementados.
