param([Parameter(Mandatory=$true)][string]$PackageRoot)
$ErrorActionPreference = "Stop"
$root = (Resolve-Path -LiteralPath $PackageRoot).Path
$forbiddenNames = @('.env','.git','package-lock-dev.json')
$badFiles = Get-ChildItem -LiteralPath $root -Recurse -Force | Where-Object {
  $forbiddenNames -contains $_.Name -or $_.Extension -in @('.sqlite','.db','.log') -or $_.FullName -match '\\uploads\\'
}
if ($badFiles) { throw "Forbidden release files: $($badFiles.FullName -join ', ')" }
$textFiles = Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object { $_.Length -lt 5MB -and $_.Extension -in @('.js','.json','.txt','.cmd','.md') }
$patterns = @('DEEPSEEK_API_KEY\s*=\s*\S+','Bearer\s+[A-Za-z0-9._-]{16,}','C:\\Users\\','Recordarsxy')
foreach ($file in $textFiles) {
  $content = Get-Content -LiteralPath $file.FullName -Raw -ErrorAction SilentlyContinue
  foreach ($pattern in $patterns) { if ($content -match $pattern) { throw "Sensitive release content in $($file.FullName): $pattern" } }
}
if (-not (Test-Path -LiteralPath (Join-Path $root 'runtime\node.exe'))) { throw 'Bundled node.exe missing' }
$launcher = Get-ChildItem -LiteralPath $root -Filter '*.cmd' | Where-Object { (Get-Content -LiteralPath $_.FullName -Raw) -match 'runtime\\node.exe' } | Select-Object -First 1
if (-not $launcher) { throw 'Launcher missing' }
Write-Host "Portable package scan passed: $root"
