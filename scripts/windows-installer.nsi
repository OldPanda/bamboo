Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
Name "Bamboo"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\Bamboo"
RequestExecutionLevel user
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "..\LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "SimpChinese"
Function .onInit
 ; The app performs the definitive WebView2 detection. Explain the prerequisite
 ; before installation without downloading or executing an unverified bootstrapper.
 IfSilent done
 MessageBox MB_OK "Bamboo requires the Microsoft Edge WebView2 Evergreen Runtime. If Bamboo reports that WebView2 is missing, install the x64 runtime from https://developer.microsoft.com/microsoft-edge/webview2/ and then launch Bamboo."
 done:
FunctionEnd
Section "Bamboo"
 SetOutPath "$INSTDIR"
 File /r "${APPDIR}\*"
 WriteUninstaller "$INSTDIR\Uninstall.exe"
 CreateDirectory "$SMPROGRAMS\Bamboo"
 CreateShortcut "$SMPROGRAMS\Bamboo\Bamboo.lnk" "$INSTDIR\bamboo.exe"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Bamboo" "DisplayName" "Bamboo"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Bamboo" "DisplayVersion" "${VERSION}"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Bamboo" "UninstallString" '$"$INSTDIR\Uninstall.exe$"'
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Bamboo" "InstallLocation" "$INSTDIR"
SectionEnd
Section "Uninstall"
 Delete "$SMPROGRAMS\Bamboo\Bamboo.lnk"
 RMDir "$SMPROGRAMS\Bamboo"
 ; Delete only installed application files, never the user's configuration/data.
 Delete "$INSTDIR\bamboo.exe"
 Delete "$INSTDIR\build-info.json"
 Delete "$INSTDIR\LICENSE"
 Delete "$INSTDIR\THIRD_PARTY.md"
 Delete "$INSTDIR\windows-linux.md"
 RMDir /r "$INSTDIR\extensions"
 RMDir /r "$INSTDIR\licenses"
 Delete "$INSTDIR\Uninstall.exe"
 RMDir "$INSTDIR"
 DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Bamboo"
SectionEnd
