; electron-builder's hooks into the Windows installer, found here by `nsis.include` in
; electron-builder.yml. specs/desktop.md §7.4 states the rule this keeps.
;
; Jx Studio appears under Open With for .json and is never its default. It cannot say that through
; `fileAssociations`: electron-builder's APP_ASSOCIATE always writes the class of the extension
; itself, which takes the default unless the user has already chosen one, and its APP_UNASSOCIATE
; leaves that value behind. Earlier builds shipped exactly that, naming the class
; "Jx Project", so an install or an upgrade also has to take the claim back.

; Remove what an earlier build wrote, from one hive. An install may have changed between per-user
; and per-machine, so both are checked. The default is removed only when it is still ours: a class
; the user or another application set is not this installer's to touch.
!macro jxForgetJsonClaim HIVE
  ReadRegStr $0 ${HIVE} "Software\Classes\.json" ""
  StrCmp $0 "Jx Project" 0 +2
    DeleteRegValue ${HIVE} "Software\Classes\.json" ""
  DeleteRegValue ${HIVE} "Software\Classes\.json\OpenWithProgids" "Jx Project"
  DeleteRegKey ${HIVE} "Software\Classes\Jx Project"
!macroend

!macro customInstall
  Push $0
  !insertmacro jxForgetJsonClaim HKCU
  !insertmacro jxForgetJsonClaim HKLM
  Pop $0

  WriteRegStr SHELL_CONTEXT "Software\Classes\JxStudio.Json" "" "JSON file"
  WriteRegStr SHELL_CONTEXT "Software\Classes\JxStudio.Json\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\JxStudio.Json\shell\open" "" "Open with Jx Studio"
  WriteRegStr SHELL_CONTEXT "Software\Classes\JxStudio.Json\shell\open\command" "" '"$appExe" "%1"'
  WriteRegNone SHELL_CONTEXT "Software\Classes\.json\OpenWithProgids" "JxStudio.Json"

  ; A hive this install cannot write sets the error flag, and that is expected for HKLM per-user.
  ClearErrors
  ; SHCNE_ASSOCCHANGED, SHCNF_FLUSH. FileAssociation.nsh, which spells these for its own macro, is
  ; included only when `fileAssociations` is non-empty.
  System::Call "shell32::SHChangeNotify(i,i,i,i) (0x08000000, 0x1000, 0, 0)"
!macroend

!macro customUnInstall
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.json\OpenWithProgids" "JxStudio.Json"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\JxStudio.Json"
  ClearErrors
  System::Call "shell32::SHChangeNotify(i,i,i,i) (0x08000000, 0x1000, 0, 0)"
!macroend
