# Charito · Conector SFS para Windows

Este programa vincula **una tienda** con la instalación oficial de **SFS 2.5** de su PC. No requiere Python instalado. El administrador descarga una conexión distinta para cada tienda en Charito → Boletas y facturas → Configurar → Conectar la PC de esta tienda.

## Instalación

1. Instala y configura SFS desde la [página oficial de SUNAT](https://cpe.sunat.gob.pe/guias-y-manuales). La descarga de SFS, Java y el certificado se tramitan por separado. No basta con abrir Charito.
2. Configura en SFS el emisor correcto, el certificado y el envío. Sigue el instructivo oficial y activa sus procesos batch de generación y envío. Restringe SFS a la PC o red autorizada; no expongas su puerto 9000 a Internet.
3. Descarga el archivo `charito-sfs-conexion.json` de **la tienda de esta PC**. No lo compartas con trabajadores ni lo importes en las dos PC.
4. Extrae este ZIP completo. Abre `Instalar.cmd` con la misma cuenta de Windows que se usará diariamente. No es necesario instalar Python ni ejecutar como administrador.
5. En la ventana, selecciona el JSON de conexión y la carpeta donde instalaste SFS. Puedes elegir la raíz de instalación o `sunat_archivos/sfs`. Pulsa **Guardar y comprobar conexión**.
6. Después de verificar el guardado, elimina el JSON de Descargas y conserva solamente una copia protegida si la necesitas. El conector guarda el acceso cifrado por DPAPI para esta cuenta de Windows.
7. Abre Charito y comprueba la conexión de la PC. Completa los datos fiscales y las pruebas antes de activar emisión real.

Al entrar a Windows, el conector se iniciará en segundo plano mediante un acceso directo de Inicio. **SFS también debe estar funcionando.** La PC no debe suspenderse durante la atención. El registro está en `%LOCALAPPDATA%\CharitoSFS\connector.log`. El conector no configura el inicio de SFS ni modifica sus credenciales.

## Operación

- El botón **Boleta / factura** utiliza la venta ya registrada. No vuelve a descontar stock ni a sumar dinero en caja.
- El conector entrega un JSON completo a `DATA` mediante escritura atómica. SFS genera, firma y envía usando sus propios procesos. Charito no llama a endpoints internos de SFS ni usa su contraseña SOL.
- `En SFS` significa pendiente de respuesta. Solo un CDR coincidente con código `0` cambia el comprobante a `Aceptado por SUNAT`.
- XML firmado, CDR y PDF se archivan en Storage privado cuando están disponibles. Si SFS no generó su PDF, ese botón no aparece. Si SFS no entregó una respuesta individual reconocible, Charito mantiene el comprobante pendiente o para revisión; no inventa aceptación a partir del PDF o de un ticket de envío.
- Si aparece **Requiere revisión**, revisa la bandeja de SFS. No crees otra venta ni otro comprobante para solucionar un reintento.
- Tras un corte de Internet o reinicio, se conserva el número reservado y se reintenta sincronizar. Si falta el diario local, el programa pide conciliación y no vuelve a emitir a ciegas.

## Copias y cambio de PC

Respalda la carpeta oficial de SFS (incluidos XML, CDR y PDF) y el directorio del conector. Su diario contiene datos fiscales y está cifrado para la cuenta Windows original. **Copiar archivos DPAPI a otra PC o reinstalar Windows no garantiza poder descifrarlos.** Antes de cambiar de PC: desactiva emisión, concilia todos los pendientes, exporta los archivos de SFS, y configura la nueva PC con otra conexión. Un pendiente sin diario requiere revisión, no reemisión automática. La copia local de SFS es necesaria incluso si se utiliza Storage.

## Detener y quitar inicio automático

Desactiva emisión en Charito y concilia lo pendiente. Elimina el acceso directo `Charito SFS` de la carpeta Inicio de tu cuenta de Windows (`shell:startup`). Finaliza únicamente el proceso `CharitoSFS.exe` desde el Administrador de tareas. Revoca su acceso en Charito → Configurar. Conserva SFS y los archivos fiscales; este paquete no incluye borrado de comprobantes ni desinstalación de SFS.

## Alcance de esta versión

Ventas individuales cobradas completamente, en soles, del día actual; boletas y facturas de venta interna, unidades, kg o litros, IGV configurado, exoneración e inafectación verificadas. El ciento de bocaditos se convierte en 100 unidades fiscales. El descuento de venta se reparte en los precios netos de los ítems.

No emite adelantos de pedidos, ventas a crédito, notas de crédito/débito, resúmenes o bajas desde Charito, detracciones, retenciones, ISC, ICBPER ni operaciones gratuitas. Si corresponden, se tramitan con contabilidad por el mecanismo autorizado; no se convierten en ventas normales para eludir ese tratamiento. La devolución o corrección de una venta con comprobante fiscal requiere su regularización fiscal y posterior conciliación de caja/stock. Este conector no realiza esa conciliación automáticamente.

## Verificación realizada

Se probaron la cola en PostgreSQL aislado, controles por tienda, numeración concurrente, reintentos, DPAPI, recuperación y análisis de CDR ficticios. El JSON de boleta y factura se convirtió a XML con el lector de la distribución oficial SFS 2.5. **No se realizó un envío real a SUNAT ni se usó tu certificado.** El contador debe confirmar la modalidad permitida, la tasa, las series y el establecimiento. La emisión permanece desactivada inicialmente.
