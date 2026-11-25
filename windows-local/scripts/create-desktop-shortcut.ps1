# Puts a "what the flick is this" shortcut (with the app icon) on the Desktop and in the Start menu.
# It points at the repo's start-what-the-flick.cmd, which starts the app (and installs it on first run).
$appFolder = Split-Path -Parent $PSScriptRoot
$repositoryFolder = Split-Path -Parent $appFolder
$launcherPath = Join-Path $repositoryFolder 'start-what-the-flick.cmd'
$iconPath = Join-Path $appFolder 'assets\icon.ico'
$shell = New-Object -ComObject WScript.Shell
$shortcutFolders = @([Environment]::GetFolderPath('Desktop'), (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'))
foreach ($shortcutFolder in $shortcutFolders) {
  $shortcut = $shell.CreateShortcut((Join-Path $shortcutFolder 'what the flick is this.lnk'))
  $shortcut.TargetPath = $launcherPath
  $shortcut.WorkingDirectory = $repositoryFolder
  $shortcut.IconLocation = "$iconPath,0"
  $shortcut.WindowStyle = 7  # minimized, so the launcher console does not pop up
  $shortcut.Description = 'what the flick is this? your screen-reading study buddy'
  $shortcut.Save()
}
Write-Output "Shortcut created on the Desktop and in the Start menu."
