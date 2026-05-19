!macro NSIS_HOOK_POSTINSTALL
  ; Tauri v2 NSIS template places resources next to the main binary while
  ; preserving the path declared in tauri.conf.json. Sherpa runtime DLLs
  ; therefore land in $INSTDIR\src-tauri\runtime-libs\; copy them next to
  ; the .exe so Windows can resolve sherpa-onnx-c-api.dll at load time.
  IfFileExists "$INSTDIR\src-tauri\runtime-libs\*.dll" 0 +2
    CopyFiles /SILENT "$INSTDIR\src-tauri\runtime-libs\*.dll" "$INSTDIR"
  IfFileExists "$INSTDIR\resources\src-tauri\runtime-libs\*.dll" 0 +2
    CopyFiles /SILENT "$INSTDIR\resources\src-tauri\runtime-libs\*.dll" "$INSTDIR"
!macroend
