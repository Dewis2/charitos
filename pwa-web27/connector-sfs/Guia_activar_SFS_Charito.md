# Activar comprobantes electrónicos en Charito

RUC: **00000000000**. Empresa: **INVERSIONES VINCULA E.I.R.L.** Tiendas: **Tienda grande** y **Tienda chica**. Los precios del catálogo ya incluyen IGV, según lo confirmado por el propietario. La tasa de IGV y el tratamiento de cada producto aún deben confirmarse con contabilidad; no se fijaron automáticamente.

## Qué está preparado

- Módulo **Boletas y facturas**, separado de ventas, stock y caja.
- Botón **Boleta / factura** en el ticket y el historial de ventas. Usa la venta existente, sin registrar nuevamente productos ni dinero.
- Series y numeración independientes por tienda, asignadas por el servidor y protegidas contra reintentos y emisión simultánea.
- Estados de cola, preparación, exportación a SFS, aceptación, rechazo y revisión. La aceptación exige una constancia CDR coincidente.
- Conector Windows para cada tienda, con acceso revocable propio y registro local protegido con DPAPI. No usa la clave privada de Supabase.
- Archivo privado de XML firmado, CDR y PDF cuando SFS los genere. Descarga disponible para usuarios autorizados en web y APK.
- Bloqueo de la eliminación de una venta con comprobante fiscal en proceso o emitido. La regularización mediante notas y su conciliación se gestionan con contabilidad; no se anula un comprobante borrando la venta.

La actualización **no habilita emisión real** al ejecutar el SQL. No se usó certificado ni clave SOL y no se enviaron comprobantes reales a SUNAT.

## 1. Confirmar los datos fiscales

Entra personalmente a SUNAT Operaciones en Línea. Para la ficha RUC, la ruta oficial es **Mi RUC y Otros Registros → Mis datos del RUC → Mi RUC → Ficha RUC**. Revisa también los establecimientos anexos registrados y la dirección de cada local. El código es asignado por SUNAT; no se puede deducir a partir del RUC. Que ambas tiendas usen el mismo RUC no confirma que compartan código. No escribas `0000` sin verificar que corresponda al domicilio fiscal o al caso autorizado.

Con tu contador confirma:

1. Que puedes usar **SEE-SFS** con este RUC y no estás sujeto a una obligación incompatible, por ejemplo una designación SEE-OSE aplicable.
2. Código de establecimiento de cada tienda, razón social, dirección y ubigeo fiscal.
3. Series que utilizarás en SFS y último correlativo realmente usado. Este módulo exige una serie de boletas y otra de facturas **distintas por tienda**, aunque compartieran establecimiento. Evita series usadas en otra PC o proveedor.
4. Tasa de IGV aplicable y productos gravados, exonerados o inafectos. «Precio con IGV incluido» no determina por sí solo la tasa ni la afectación.
5. Disponibilidad de certificado digital y credenciales de envío habilitadas. Se configuran en SFS; no se comparten por el chat ni se colocan en la web o APK.

Fuentes oficiales: [obtener ficha RUC](https://www.gob.pe/7475-obtener-ficha-ruc-electronica), [SEE-SFS](https://cpe.sunat.gob.pe/sistema_emision/facturador_sunat), [guías, estructuras e instalador vigente](https://cpe.sunat.gob.pe/guias-y-manuales), [certificados digitales](https://cpe.sunat.gob.pe/certificado-digital).

## 2. Actualizar Supabase

Esta parte requiere tu cuenta de propietario. Aquí solo se dispone de la clave pública de la app.

1. Abre **SQL Editor → nueva consulta**.
2. Pega **todo** `20_comprobantes_sfs.sql` y pulsa **Run**. Conserva los datos existentes y deja emisión desactivada. Se puede volver a ejecutar.
3. Abre **Edge Functions → crear función → editor**.
4. Conserva el archivo predeterminado `index.ts`; reemplaza **todo su contenido** por `21_charito_sfs_archivos.ts`. No crees un archivo vacío llamado `charito-sfs`.
5. En **Function name** escribe exactamente **charito-sfs** y despliega.
6. En la configuración de esa función, desactiva **Verify JWT / Enforce JWT verification**. Esta función está destinada al conector y valida su token revocable de tienda, no un JWT de sesión. No cambies la verificación de `charito-users` ni otras funciones.
7. Las variables estándar `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` se leen únicamente en la función del servidor. No copies esa clave a la app, a la APK ni al JSON del conector.

Por CLI, la configuración equivalente es `[functions.charito-sfs] verify_jwt = false` en `supabase/config.toml`, o desplegar esa función con `--no-verify-jwt`. El paquete incluye el código; la guía usa el editor para evitar exigir una instalación de CLI.

## 3. Instalar SFS en las dos PC

Descarga la distribución vigente desde el enlace oficial de **Guías y manuales → Facturador SUNAT**. La revisión realizada usó **SFS 2.5** y `Estructuras.xlsx` publicado en junio de 2026. Sigue el instructivo oficial para Java, emisor, certificado, credenciales, directorios y procesos batch. No reutilices un certificado o una serie de pruebas en producción.

El conector utiliza los directorios oficiales `DATA`, `ORIDAT`, `PARSE`, `FIRMA`, `ENVIO`, `RPTA` y `REPO`. No instala SFS, no altera su configuración y no llama a endpoints HTTP internos. SFS debe generar y enviar; si sus procesos automáticos no están configurados, el empleado deberá operarlos en su bandeja y el estado seguirá pendiente. No abras su puerto local 9000 a Internet.

## 4. Configurar Charito y el conector

1. Entra como administrador a **Boletas y facturas** y selecciona la tienda correcta.
2. Abre **Configurar → Empresa e impuestos**. Completa los datos confirmados. Deja **Activar emisión real** desmarcado mientras preparas todo.
3. En **Series y establecimiento**, completa los datos de esa tienda. El campo «Último número utilizado» es el último que ya existe; Charito reservará el siguiente.
4. En **Impuestos y unidad de los productos**, busca y revisa cada producto que venderás. La lista muestra hasta ocho coincidencias. En bocaditos: `NIU` y multiplicador `100`; así 0,5 ciento se emite como 50 unidades.
5. Pulsa **Conectar la PC de esta tienda**. Se descargará `charito-sfs-conexion.json`, que contiene una credencial limitada a esa tienda. Debe importarse en su PC, no en ambas.
6. Extrae `Conector_SFS_Charito_Windows.zip` en esa PC y abre `Instalar.cmd`. Selecciona el JSON y la carpeta SFS. El acceso queda protegido para esa cuenta Windows. Después elimina el JSON de Descargas.
7. Repite con la otra tienda y su propia conexión. Los accesos caducan a los 180 días y pueden revocarse/regenerarse desde el administrador.
8. Revisa la sincronización de ambas PC y completa las comprobaciones del siguiente apartado. Solo entonces confirma los controles de verificación y activa emisión real.

Cada PC debe permanecer encendida, conectada y con SFS funcionando. El conector se inicia al entrar a la cuenta de Windows usada en la instalación. Instalarlo no configura el arranque de SFS.

## 5. Comprobaciones antes de la puesta en marcha

Realiza primero pruebas en el entorno de pruebas que corresponda a SFS, con numeración y archivos separados. Este módulo de Charito queda preparado para producción; no incluye un selector que envíe tus ventas reales al entorno beta. Para las pruebas locales se proporcionaron documentos ficticios y se usó el lector oficial sin firmar ni enviar. La prueba de extremo a extremo con tus credenciales sigue pendiente.

Con contabilidad y el instalador de SFS verifica boleta y factura, venta por efectivo/Yape/mixta, medio ciento, descuento, reconexión y reinicio. Contrasta importe, IGV, cliente, establecimiento, serie y número. Comprueba en SUNAT que el documento corresponde al RUC y su CDR; revisa XML firmado, representación PDF y QR generados por SFS. Si SFS entrega respuestas en una modalidad distinta de CDR individual, valida esa modalidad antes de activar Charito: el conector no deduce aceptación de resúmenes, tickets ni estados de bandeja sin evidencia individual coincidente.

**No pulses emitir ventas reales como «prueba».** Un comprobante de producción crea efectos fiscales y requiere la regularización autorizada si hay un error. La validación tributaria debe completarse antes de poner a trabajadores a emitir.

## 6. Uso diario

Registra la venta una sola vez. Desde su ticket o historial pulsa **Boleta / factura**, revisa tipo y cliente, y confirma. Para factura se exige RUC con dígito verificador correcto; esto no sustituye consultar su situación y razón social en SUNAT. Para boletas superiores a S/700 se exige identificar al cliente, según la [orientación oficial](https://orientacion.sunat.gob.pe/01-preguntas-frecuentes-comprobantes-de-pago-0).

La cola y la numeración viven en Supabase. La emisión del mismo comprobante puede reanudarse sin crear otra venta ni otro número. Si hay rechazo, error, falta de CDR o pérdida del diario de la PC, revisa SFS y concilia. **No vuelvas a registrar ni a emitir la venta para solucionar el aviso.**

Un pedido con adelantos, una operación a crédito, una devolución fiscal, una venta de otro día, una entrega gratuita o un tributo especial requieren su flujo tributario específico. Esta primera versión no los emite desde Charito. Las notas de crédito/débito, bajas y resúmenes se gestionan por el mecanismo autorizado y aún no tienen conciliación automática con caja y stock en este módulo.

## Costos y conservación

SFS es software gratuito de SUNAT. El conector no introduce un proveedor de cobro por comprobante. Pueden existir costos de certificado, instalación/soporte, impresora y almacenamiento o crecimiento de Supabase; la gratuidad del software no elimina esos posibles costos.

XML, CDR y PDF consumen almacenamiento privado y transferencia. Vigila las cuotas de tu plan y conserva respaldos locales de SFS y de la base de datos. El diario DPAPI del conector depende de la cuenta y equipo Windows; no es un mecanismo de recuperación portátil. Antes de cambiar de PC o reinstalar Windows, desactiva emisión y concilia los pendientes.

## Evidencia técnica disponible

- 34 comprobaciones SQL del módulo en PostgreSQL aislado: acceso por tienda, idempotencia, numeración concurrente, impuestos, respuesta CDR, revocación y bloqueo de eliminaciones.
- 24 comprobaciones del conector: cálculo decimal, formato JSON, protección DPAPI, entrega atómica, reintentos, archivo ya consumido, ZIP y constancias ficticias.
- 59 comprobaciones de regresión y recuperación de ventas, caja, stock y pedidos con el módulo instalado y emisión desactivada.
- Conversión de boleta y factura con el lector y plantilla oficiales de SFS 2.5. Datos UBL contrastados con XSD tras quitar únicamente el contenedor vacío reservado para firma; no equivalen a XML firmado ni a aceptación SUNAT.
- Verificación de la interfaz en escritorio y móvil con datos ficticios. Compilación y firma de la APK, sin prueba en un teléfono físico.

Pendiente: configuración por el propietario, instalación y prueba en las PC de tienda, certificado y credenciales, aceptación real de boleta/factura, descarga desde Storage real, revisión contable y capacitación.
