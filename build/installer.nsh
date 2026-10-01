; Extra uninstall steps. electron-builder's uninstaller removes the program, its shortcut and its
; registration; this removes what Orbit set up elsewhere. It runs only on a real uninstall, never
; when an update replaces the old version.

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ; Start with Windows, and Windows' notification settings for Orbit.
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.Orbit"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\electron.app.Orbit"
    ; Downloaded updates.
    RMDir /r "$LOCALAPPDATA\orbit-updater"

    ; Your data is a separate question: keeping it makes a reinstall pick up where you left off.
    ; A silent uninstall keeps it unless --delete-app-data is passed.
    ClearErrors
    ${GetParameters} $R0
    ${GetOptions} $R0 "--delete-app-data" $R1
    ${if} ${Errors}
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
        "Also delete everything Orbit saved on this PC?$\r$\n$\r$\nThat's your chats, memories, settings and saved keys, the files Orbit made that you kept, backups of changed files, the browser profile and downloaded models (in $APPDATA\Orbit).$\r$\n$\r$\nChoose No to keep them in case you reinstall." \
        /SD IDNO IDNO orbit_keep_data
    ${endIf}
    RMDir /r "$APPDATA\Orbit"
    orbit_keep_data:
  ${endIf}
!macroend
