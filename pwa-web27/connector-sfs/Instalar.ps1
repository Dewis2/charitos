$ErrorActionPreference = 'Stop'
$taskInstallDir = Join-Path $env:LOCALAPPDATA 'CharitoSFS\bin'
$taskSourceExe = Join-Path $PSScriptRoot 'CharitoSFS.exe'
$taskInstalledExe = Join-Path $taskInstallDir 'CharitoSFS.exe'
if (-not (Test-Path -LiteralPath $taskSourceExe)) { throw 'Extrae primero todo el ZIP en una carpeta.' }
New-Item -ItemType Directory -Path $taskInstallDir -Force | Out-Null
# Only stop the connector installed at this exact current-user location.
Get-Process -Name 'CharitoSFS' -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -and [System.IO.Path]::GetFullPath($_.Path) -eq [System.IO.Path]::GetFullPath($taskInstalledExe)
} | Stop-Process -ErrorAction Stop
if ([System.IO.Path]::GetFullPath($taskSourceExe) -ne [System.IO.Path]::GetFullPath($taskInstalledExe)) {
    Copy-Item -LiteralPath $taskSourceExe -Destination $taskInstalledExe -Force
}
# This is an interactive setup window explicitly launched by the installer.
Start-Process -FilePath $taskInstalledExe -ArgumentList 'configure' -Wait
if (-not (Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'CharitoSFS\connection.dpapi'))) {
    throw 'No se guardó la conexión. Ejecuta de nuevo el instalador cuando tengas el JSON y SFS configurado.'
}
$taskStartupLink = Join-Path ([Environment]::GetFolderPath('Startup')) 'Charito SFS.lnk'
$taskShortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($taskStartupLink)
$taskShortcut.TargetPath = $taskInstalledExe
$taskShortcut.Arguments = 'run'
$taskShortcut.WorkingDirectory = $taskInstallDir
$taskShortcut.WindowStyle = 7
$taskShortcut.Description = 'Sincronización de comprobantes Charito con SFS de esta tienda'
$taskShortcut.Save()
Start-Process -FilePath $taskInstalledExe -ArgumentList 'run' -WindowStyle Hidden
Write-Host 'Conector instalado para esta cuenta de Windows. Se iniciará al entrar a Windows.'
Write-Host 'Registros: %LOCALAPPDATA%\CharitoSFS\connector.log'
Write-Host 'SFS debe estar abierto y configurado con sus procesos automáticos.'
Read-Host 'Pulsa Enter para cerrar'
