# Charito · Usuarios e instalación en Android

## Activar usuarios con nombre

Esta actualización añade la pantalla Usuarios para el administrador. Los nuevos usuarios entran con un identificador como maria y contraseña. Nombre de la persona y usuario de acceso son distintos: el nombre puede incluir espacios y tildes; el usuario utiliza de 3 a 30 letras, números, punto, guion o guion bajo. El usuario es único y se convierte a minúsculas.

Supabase conserva internamente una dirección técnica para autenticar; nadie debe escribir un correo al crear ni al usar las nuevas cuentas. Tu cuenta anterior sigue entrando con su correo y contraseña actuales. No se han cambiado cuentas, contraseñas ni roles existentes.

### 1. Base de datos

En Supabase → SQL Editor → New query, pegar todo 07_usuarios_supabase.sql y pulsar Run, una sola vez. No repetir scripts anteriores. La aplicación principal requiere las migraciones anteriores, incluida 05 para la fase 2.

### 2. Función para crear cuentas

En Supabase → Edge Functions → Deploy a new function → Via Editor:

1. Crear una función con el nombre exacto charito-users.
2. Reemplazar todo el contenido de index.ts por el contenido completo de 08_charito_users.ts.
3. Pulsar Deploy function y esperar la confirmación.
4. Mantener activada la verificación JWT (Verify JWT) si aparece en la configuración. La función también verifica la sesión con Supabase Auth y exige administrador activo.

No pegar ese archivo en SQL Editor. No copiar contraseñas de base de datos ni claves secretas en el código. La función utiliza SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY, variables del servidor proporcionadas por Supabase.

Referencia oficial: https://supabase.com/docs/guides/functions/quickstart-dashboard

### 3. Contraseñas sencillas

Charito permite de 6 a 72 caracteres, sin imponer mayúsculas ni símbolos. Supabase aplica adicionalmente los requisitos que tenga configurados tu proyecto. Si rechaza una contraseña, revisar Authentication → Sign In / Providers → Email → requisitos de contraseña. Para permitir contraseñas sencillas de 6 caracteres, la longitud mínima debe ser 6 y no deben exigirse combinaciones de caracteres. No desactivar la autenticación. Cada persona debe tener una contraseña individual; para el administrador conviene una más larga.

Referencia: https://supabase.com/docs/guides/auth/password-security

### 4. Crear trabajadores

Recargar Charito, entrar como administrador y abrir Usuarios. Escribir nombre, usuario, contraseña y rol. Para un vendedor, seleccionar al menos una tienda. Los encargados y administradores tienen acceso a todas las tiendas activas. Pulsar Crear usuario. El administrador permanece en su propia sesión. La lista muestra nombres, roles y tiendas; no muestra contraseñas.

La primera prueba debe incluir crear un vendedor, entrar con su nuevo usuario, comprobar su tienda y confirmar que no aparece la sección Usuarios. Esta actualización incluye creación y consulta; todavía no incluye restablecer contraseñas ni editar o desactivar usuarios desde esa pantalla.

## Instalar PWA en Android

1. Abrir Chrome en el teléfono.
2. Entrar en https://charito.example.com y completar el acceso al sitio si lo solicita.
3. Esperar a que cargue Charito. Pulsar Instalar Charito si aparece el botón.
4. También se puede pulsar ⋮ de Chrome → Instalar aplicación, o Añadir a pantalla de inicio → Instalar, según la versión.
5. Abrir Charito desde su icono nuevo. La aplicación instalada usa una ventana independiente sin barra de direcciones. La barra de estado y navegación de Android puede permanecer.

Si solo se crea un acceso directo y se abre con la barra del navegador, no está instalada en modo aplicación. Abrir el sitio directamente en Chrome, no dentro de WhatsApp u otra app, y revisar su menú de instalación. La instalación depende del navegador y del dispositivo.

No hay que descargar un APK. Se requiere internet para guardar datos. Instalar no cambia los permisos: el sitio conserva acceso privado del propietario y el acceso de los trabajadores al alojamiento debe configurarse por separado.

Referencia: https://web.dev/learn/pwa/installation

## Verificación y archivos

Pasaron 13 comprobaciones locales de usuarios y permisos en PostgreSQL y 15 de la función con clientes simulados, validación y acceso por nombre. No se ha instalado esta migración ni desplegado la Edge Function en el proyecto Supabase real: no hay una sesión de Supabase disponible en los navegadores conectados ni credenciales de administración de su API. La clave pública del sitio no permite esas operaciones.

08_charito_users.ts es una copia del archivo versionado supabase/functions/charito-users/index.ts. La función no se incluye en los archivos públicos del sitio. El código y las instrucciones se incluyen en Charito_aplicacion.zip.
