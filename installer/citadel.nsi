; ══════════════════════════════════════════════════════════════
; Citadel — NSIS Installer Script
;
; Produces a branded Windows installer that bundles Node.js runtime,
; the Citadel application, and all dependencies into a one-click setup.
;
; Build via:  node installer/build.js
; ══════════════════════════════════════════════════════════════

!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"

; ─── Build-time defines (passed via makensis /D flags) ────
; VERSION, STAGING_DIR, OUTPUT_DIR are set by build.js

!ifndef VERSION
  !define VERSION "2.0.0"
!endif

!ifndef STAGING_DIR
  !define STAGING_DIR "..\build\staging"
!endif

!ifndef OUTPUT_DIR
  !define OUTPUT_DIR "..\build"
!endif

; ─── Installer metadata ──────────────────────────────────
Name "Citadel"
OutFile "${OUTPUT_DIR}\CitadelSetup-${VERSION}.exe"
InstallDir "C:\Citadel"
InstallDirRegKey HKLM "Software\Citadel" "InstallDir"
RequestExecutionLevel admin
ShowInstDetails show
ShowUnInstDetails show

; ─── Version info ─────────────────────────────────────────
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Citadel"
VIAddVersionKey "CompanyName" "Citadel"
VIAddVersionKey "LegalCopyright" "Copyright Citadel"
VIAddVersionKey "FileDescription" "Citadel DayZ Server Controller Installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"

; ─── MUI Settings ─────────────────────────────────────────
!define MUI_ABORTWARNING
!define MUI_WELCOMEFINISHPAGE_BITMAP "${NSISDIR}\Contrib\Graphics\Wizard\win.bmp"

; Use default NSIS icons (custom icon can be added later)
; !define MUI_ICON "citadel.ico"
; !define MUI_UNICON "citadel.ico"

; ─── Pages ────────────────────────────────────────────────
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Launch Citadel"
!define MUI_FINISHPAGE_RUN_FUNCTION "LaunchDashboard"
!insertmacro MUI_PAGE_FINISH

; Uninstaller pages
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; ─── Language ─────────────────────────────────────────────
!insertmacro MUI_LANGUAGE "English"

; ═══════════════════════════════════════════════════════════
; Pre-install checks
; ═══════════════════════════════════════════════════════════
Function .onInit
  ; ── Port conflict check ──
  ; If something else is already listening on :3001, fail fast with a clear
  ; message rather than silently producing a broken install.
  nsExec::ExecToStack 'powershell -NoProfile -WindowStyle Hidden -Command "if (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }"'
  Pop $0
  ${If} $0 == 1
    MessageBox MB_ICONEXCLAMATION|MB_YESNO "Port 3001 is already in use on this machine.$\n$\nCitadel uses port 3001 for its dashboard and API. Another application is currently listening on this port.$\n$\nRecommended: Cancel, stop the other service, and run the installer again.$\n$\nContinue anyway?" /SD IDNO IDYES continueInstall
    Abort "Installation cancelled — port 3001 is in use."
    continueInstall:
  ${EndIf}
FunctionEnd

; ═══════════════════════════════════════════════════════════
; Installation
; ═══════════════════════════════════════════════════════════
Section "Citadel" SecMain
  SectionIn RO

  SetOutPath "$INSTDIR"
  DetailPrint "Installing Citadel v${VERSION}..."

  ; ── Copy Node.js runtime and NSSM service wrapper ──
  DetailPrint "Installing Node.js runtime and NSSM..."
  SetOutPath "$INSTDIR\runtime"
  File "${STAGING_DIR}\runtime\node.exe"
  File "${STAGING_DIR}\runtime\nssm.exe"

  ; ── Copy application files ──
  DetailPrint "Installing application files..."
  SetOutPath "$INSTDIR"
  File /r "${STAGING_DIR}\app\*.*"

  ; ── Copy Electron desktop app (optional — skipped if staging/desktop is empty) ──
  DetailPrint "Installing desktop app..."
  SetOutPath "$INSTDIR\desktop"
  File /r /nonfatal "${STAGING_DIR}\desktop\*.*"

  ; ── Create data directory ──
  CreateDirectory "$INSTDIR\data"

  ; ── Write install directory to registry ──
  WriteRegStr HKLM "Software\Citadel" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "Software\Citadel" "Version" "${VERSION}"

  ; ── Register Windows Service ──
  DetailPrint "Registering Windows Service..."
  nsExec::ExecToLog '"$INSTDIR\runtime\node.exe" "$INSTDIR\backend\lib\service-installer.js" install'
  Pop $0

  ; ── Open Windows Firewall for LAN access ──
  ; Lets the user access the dashboard from other machines on their LAN
  ; (e.g. their desktop browsing to http://<server-ip>:3001).
  ; Scope limited to private + domain profiles — public networks stay blocked.
  DetailPrint "Creating Windows Firewall rule for dashboard access..."
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="Citadel Dashboard" dir=in action=allow protocol=TCP localport=3001 profile=private,domain description="Citadel DayZ Server Controller — dashboard + API"'
  Pop $0

  ; ── Start the service via NSSM ──
  DetailPrint "Starting Citadel service..."
  nsExec::ExecToLog '"$INSTDIR\runtime\nssm.exe" start CitadelServer'
  Pop $0
  DetailPrint "Service log: $INSTDIR\data\service.log"

  ; ── Create Start Menu shortcuts ──
  ; Primary shortcut launches the Electron desktop app. We also keep a
  ; "Dashboard in Browser" shortcut for power users who prefer browsing
  ; to localhost:3001 from another machine on the LAN.
  CreateDirectory "$SMPROGRAMS\Citadel"
  CreateShortCut "$SMPROGRAMS\Citadel\Citadel.lnk" \
    "$INSTDIR\desktop\Citadel.exe" "" "$INSTDIR\desktop\Citadel.exe" 0 \
    SW_SHOWNORMAL "" "Citadel DayZ Server Controller"
  CreateShortCut "$SMPROGRAMS\Citadel\Dashboard (Browser).lnk" \
    "http://localhost:3001" "" "$INSTDIR\runtime\node.exe" 0
  CreateShortCut "$SMPROGRAMS\Citadel\Uninstall Citadel.lnk" \
    "$INSTDIR\Uninstall.exe"

  ; ── Desktop shortcut ──
  CreateShortCut "$DESKTOP\Citadel.lnk" \
    "$INSTDIR\desktop\Citadel.exe" "" "$INSTDIR\desktop\Citadel.exe" 0 \
    SW_SHOWNORMAL "" "Citadel DayZ Server Controller"

  ; ── Add/Remove Programs entry ──
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Citadel" \
    "DisplayName" "Citadel — DayZ Server Controller"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Citadel" \
    "UninstallString" "$\"$INSTDIR\Uninstall.exe$\""
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Citadel" \
    "QuietUninstallString" "$\"$INSTDIR\Uninstall.exe$\" /S"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Citadel" \
    "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Citadel" \
    "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Citadel" \
    "Publisher" "Citadel"
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Citadel" \
    "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Citadel" \
    "NoRepair" 1

  ; Estimate install size
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Citadel" \
    "EstimatedSize" $0

  ; ── Write uninstaller ──
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  DetailPrint "Installation complete!"
SectionEnd

; ═══════════════════════════════════════════════════════════
; Finish page — open dashboard
; ═══════════════════════════════════════════════════════════
Function LaunchDashboard
  ; Wait for the backend API to be ready before launching anything —
  ; prevents "connection refused" on a fresh install where the service
  ; is still booting.
  DetailPrint "Waiting for Citadel API to respond..."
  nsExec::ExecToLog '"$INSTDIR\runtime\node.exe" "$INSTDIR\backend\lib\wait-for-ready.js"'
  Pop $0

  ; Prefer the native desktop app; fall back to a browser tab if it's a
  ; backend-only build (no desktop/ in staging).
  IfFileExists "$INSTDIR\desktop\Citadel.exe" launchApp launchBrowser
  launchApp:
    Exec '"$INSTDIR\desktop\Citadel.exe"'
    Goto done
  launchBrowser:
    IfFileExists "$INSTDIR\data\setup_complete.json" openHome openSetup
    openHome:
      ExecShell "open" "http://localhost:3001"
      Goto done
    openSetup:
      ExecShell "open" "http://localhost:3001/setup"
  done:
FunctionEnd

; ═══════════════════════════════════════════════════════════
; Uninstaller
; ═══════════════════════════════════════════════════════════
Section "Uninstall"
  ; ── Stop and remove Windows Service via NSSM ──
  ; NSSM's stop command takes a graceful shutdown timeout. If node.exe
  ; doesn't exit within 30s we escalate to termination.
  DetailPrint "Stopping Citadel service (up to 30s for graceful shutdown)..."
  nsExec::ExecToLog '"$INSTDIR\runtime\nssm.exe" stop CitadelServer'
  Pop $0
  Sleep 1000

  ; Force-kill any orphaned node.exe processes still holding files from our install dir
  nsExec::ExecToLog 'powershell -NoProfile -WindowStyle Hidden -Command "Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like \"$INSTDIR\runtime\node.exe\" } | Stop-Process -Force -ErrorAction SilentlyContinue"'
  Pop $0

  DetailPrint "Removing Citadel service..."
  nsExec::ExecToLog '"$INSTDIR\runtime\nssm.exe" remove CitadelServer confirm'
  Pop $0

  ; ── Remove Windows Firewall rule ──
  DetailPrint "Removing Windows Firewall rule..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="Citadel Dashboard"'
  Pop $0

  ; ── Remove Start Menu shortcuts ──
  RMDir /r "$SMPROGRAMS\Citadel"
  Delete "$DESKTOP\Citadel.lnk"
  Delete "$DESKTOP\Citadel Dashboard.lnk"

  ; ── Ask whether to keep user data ──
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Do you want to keep your server configurations and data?$\n$\n\
    Choosing 'No' will delete the data/ directory permanently." \
    IDYES keepData

  ; Remove data directory
  RMDir /r "$INSTDIR\data"

  keepData:

  ; ── Remove application files (but not data/ if kept) ──
  RMDir /r "$INSTDIR\runtime"
  RMDir /r "$INSTDIR\backend"
  RMDir /r "$INSTDIR\web"
  RMDir /r "$INSTDIR\discord-bot"
  RMDir /r "$INSTDIR\desktop"
  RMDir /r "$INSTDIR\node_modules"
  Delete "$INSTDIR\package.json"
  Delete "$INSTDIR\package-lock.json"
  Delete "$INSTDIR\.env"
  Delete "$INSTDIR\.env.example"
  Delete "$INSTDIR\Uninstall.exe"

  ; Try to remove install dir (will only succeed if empty)
  RMDir "$INSTDIR"

  ; ── Remove registry entries ──
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Citadel"
  DeleteRegKey HKLM "Software\Citadel"

  DetailPrint "Uninstallation complete."
SectionEnd
