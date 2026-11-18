# Runs build.py --ci repeatedly (its CI mode stops ninja every 3.5 h with exit 124; reruns resume).
# Keeps the PC from idle-sleeping only while this process lives.
Add-Type -Namespace W -Name P -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'
[W.P]::SetThreadExecutionState(0x80000001) | Out-Null  # ES_CONTINUOUS | ES_SYSTEM_REQUIRED
Set-Location C:\uc
$log = 'C:\uc\build.log'
for ($i = 1; $i -le 6; $i++) {
  "=== run $i start $(Get-Date -Format s) ===" | Add-Content $log
  & python3 build.py --ci *>> $log
  $code = $LASTEXITCODE
  "=== run $i exit $code $(Get-Date -Format s) ===" | Add-Content $log
  if ($code -ne 124) { "EXIT $code after run $i"; exit $code }
}
"GAVE UP after 6 timeouts"; exit 2
