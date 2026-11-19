# Charito PWA web 27

Versión de referencia del sistema modular de Inversiones Vincula EIRL para la tesis de Ingeniería de Sistemas e Informática. El código de origen corresponde al commit `0d6be304442be5c1c1073593fd78db9c2a0edea8` del repositorio Sites. Esta copia utiliza parámetros de ejemplo y parte de un catálogo de recetas vacío.

- `dist/` contiene el cliente web instalable. Puedes servirlo con un servidor estático. El service worker requiere HTTPS o localhost.
- `supabase/` contiene las migraciones incrementales y las Edge Functions. Las migraciones se aplican en orden sobre el esquema base de Charito. Antes de conectar un entorno, configura su URL y clave publicable en `dist/app.js`, el origen en `dist/index.html` y `dist/_headers`, y la variable `CHARITO_ALLOWED_ORIGINS` de la función. La clave de servicio corresponde exclusivamente al entorno de servidor.
- `connector-sfs/` contiene el conector fiscal opcional para Windows. Para habilitarlo se requieren el RUC y los parámetros de emisión autorizados para el entorno. La emisión real requiere activación explícita.

No se incluyen bases de datos, fichas de prueba ni fotografías.
