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
!define MUI_FINISHPAGE_RUN_TEXT "Open Citadel Dashboard"
!define MUI_FINISHPAGE_RUN_FUNCTION "LaunchDashboard"
!insertmacro MUI_PAGE_FINISH

; Uninstaller pages
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; ─── Language ─────────────────────────────────────────────
!insertmacro MUI_LANGUAGE "English"

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

  ; ── Create data directory ──
  CreateDirectory "$INSTDIR\data"

  ; ── Write install directory to registry ──
  WriteRegStr HKLM "Software\Citadel" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "Software\Citadel" "Version" "${VERSION}"

  ; ── Register Windows Service ──
  DetailPrint "Registering Windows Service..."
  nsExec::ExecToLog '"$INSTDIR\runtime\node.exe" "$INSTDIR\backend\lib\service-installer.js" install'
  Pop $0

  ; ── Start the service via NSSM ──
  DetailPrint "Starting Citadel service..."
  nsExec::ExecToLog '"$INSTDIR\runtime\nssm.exe" start CitadelServer'
  Pop $0
  DetailPrint "Service log: $INSTDIR\data\service.log"

  ; ── Create Start Menu shortcuts ──
  CreateDirectory "$SMPROGRAMS\Citadel"
  CreateShortCut "$SMPROGRAMS\Citadel\Citadel Dashboard.lnk" \
    "http://localhost:3001" "" "$INSTDIR\runtime\node.exe" 0
  CreateShortCut "$SMPROGRAMS\Citadel\Start Citadel.lnk" \
    "$INSTDIR\runtime\node.exe" '"$INSTDIR\backend\server.js"' \
    "$INSTDIR\runtime\node.exe" 0
  CreateShortCut "$SMPROGRAMS\Citadel\Uninstall Citadel.lnk" \
    "$INSTDIR\Uninstall.exe"

  ; ── Desktop shortcut ──
  CreateShortCut "$DESKTOP\Citadel Dashboard.lnk" \
    "http://localhost:3001" "" "$INSTDIR\runtime\node.exe" 0

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
  ; If setup hasn't been completed yet, go to /setup
  IfFileExists "$INSTDIR\data\setup_complete.json" 0 +3
    ExecShell "open" "http://localhost:3001"
    Goto done
  ExecShell "open" "http://localhost:3001/setup"
  done:
FunctionEnd

; ═══════════════════════════════════════════════════════════
; Uninstaller
; ═══════════════════════════════════════════════════════════
Section "Uninstall"
  ; ── Stop and remove Windows Service via NSSM ──
  DetailPrint "Stopping Citadel service..."
  nsExec::ExecToLog '"$INSTDIR\runtime\nssm.exe" stop CitadelServer'
  Pop $0
  ; Wait for service to stop
  Sleep 3000
  DetailPrint "Removing Citadel service..."
  nsExec::ExecToLog '"$INSTDIR\runtime\nssm.exe" remove CitadelServer confirm'
  Pop $0

  ; ── Remove Start Menu shortcuts ──
  RMDir /r "$SMPROGRAMS\Citadel"
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
