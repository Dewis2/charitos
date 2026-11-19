# Análisis de Charito PWA con SonarQube

Ejecuta SonarScanner CLI desde esta carpeta, donde está `sonar-project.properties`. El proyecto de SonarQube usa la clave `charito-pwa`.

1. Abre el panel local en `http://127.0.0.1:19000`. Si la instalación de la tesis está detenida, ejecuta `..\tesis-work\start_academic_sonar.ps1` desde esta carpeta.
2. Si vas a usar otro servidor, crea un proyecto privado con la clave `charito-pwa`. Genera un token de análisis para ese proyecto.
3. En PowerShell 7, establece la URL y proporciona el token cuando se te pida. Este ejemplo utiliza el escáner que ya está en la carpeta de la tesis.

```powershell
$env:SONAR_HOST_URL = 'http://127.0.0.1:19000'
$env:SONAR_TOKEN = Read-Host 'Token de análisis' -MaskInput
try {
    & '..\tesis-work\academic-20261028\sonar-scanner-8.1.0.6389\bin\sonar-scanner.bat'
} finally {
    Remove-Item Env:SONAR_TOKEN -ErrorAction SilentlyContinue
}
```

Para otra versión, actualiza `sonar.projectVersion` en la configuración. El alcance comprende el código editable de `dist` y `supabase/functions`. Quedan fuera la biblioteca distribuida de Supabase, las migraciones de PostgreSQL, Android y los datos de producción. El análisis del 12 de noviembre de 2026 no importó un informe LCOV.

El panel local está en [Charito PWA](http://127.0.0.1:19000/dashboard?id=charito-pwa). El estado del Quality Gate y la lista de incidencias se consultan por separado en el panel. [Documentación de SonarScanner CLI](https://docs.sonarsource.com/sonarqube-community-build/analyzing-source-code/scanners/sonarscanner)
