!macro NSIS_HOOK_POSTINSTALL
  IfFileExists "$INSTDIR\resources\src-tauri\runtime-libs\*.dll" 0 done
    CopyFiles /SILENT "$INSTDIR\resources\src-tauri\runtime-libs\*.dll" "$INSTDIR"
  done:
!macroend
