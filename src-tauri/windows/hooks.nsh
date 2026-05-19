!macro NSIS_HOOK_POSTINSTALL
  IfFileExists "$INSTDIR\resources\windows-runtime\*.dll" 0 done
    CopyFiles /SILENT "$INSTDIR\resources\windows-runtime\*.dll" "$INSTDIR"
  done:
!macroend
