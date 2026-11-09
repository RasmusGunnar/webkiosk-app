# Local test environment only. Never reads the Python PoC's saved session.
param([Parameter(Mandatory=$true)][string]$StateDirectory)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$stateRoot=[IO.Path]::GetFullPath($StateDirectory)
$expectedRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../supabase/.temp/aula-integration-10'))
if($stateRoot -ne $expectedRoot){throw 'Unexpected local Aula directory'}
[IO.Directory]::CreateDirectory($stateRoot) | Out-Null
$keyPath=Join-Path $stateRoot 'local-secrets.dpapi'
$entropy=[Text.Encoding]::UTF8.GetBytes('familiekalender-aula-local-v1')
if(-not [IO.File]::Exists($keyPath)){
 $values=@{}
 foreach($name in @('AULA_SESSION_ENCRYPTION_KEY','AULA_HMAC_KEY','AULA_SYNC_SECRET','AULA_ANALYZE_SECRET','LOCAL_FIXTURE_PASSWORD')){
  $bytes=New-Object byte[] 32
  $rng=[Security.Cryptography.RandomNumberGenerator]::Create();$rng.GetBytes($bytes);$rng.Dispose()
  $values[$name]=[Convert]::ToBase64String($bytes)
 }
 $plaintext=[Text.Encoding]::UTF8.GetBytes(($values|ConvertTo-Json -Compress))
 $protected=[Security.Cryptography.ProtectedData]::Protect($plaintext,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
 [IO.File]::WriteAllBytes($keyPath,$protected)
 $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
 $acl=New-Object Security.AccessControl.FileSecurity
 $acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false)
 $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','Allow')))
 Set-Acl -LiteralPath $keyPath -AclObject $acl
 [Array]::Clear($plaintext,0,$plaintext.Length)
}
# stdout is consumed only by the Node launcher; it must never be logged.
$plain=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($keyPath),$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))
[Array]::Clear($plain,0,$plain.Length)
