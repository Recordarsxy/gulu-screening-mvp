param([string]$NodeVersion = "24.18.0", [string]$OutputDirectory = "release")
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseRoot = Join-Path $projectRoot $OutputDirectory
$stageRoot = Join-Path $releaseRoot "gulu-screening-portable-v1.4.0-win-x64"
$appRoot = Join-Path $stageRoot "app"
$runtimeRoot = Join-Path $stageRoot "runtime"
$archiveName = "node-v$NodeVersion-win-x64.zip"
$runtimeArchive = Join-Path $releaseRoot $archiveName
$runtimeExtract = Join-Path $releaseRoot "node-runtime-extract"
$zipPath = Join-Path $releaseRoot "gulu-screening-portable-v1.4.0-win-x64.zip"
New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
Remove-Item -LiteralPath $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $runtimeExtract -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
Push-Location $projectRoot
try { npm.cmd run build } finally { Pop-Location }
New-Item -ItemType Directory -Force -Path $appRoot,$runtimeRoot,(Join-Path $stageRoot "data") | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot "dist") -Destination $appRoot -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot "dist-server") -Destination $appRoot -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot "package.json") -Destination $appRoot
Copy-Item -LiteralPath (Join-Path $projectRoot "package-lock.json") -Destination $appRoot
Push-Location $appRoot
try { npm.cmd ci --omit=dev --ignore-scripts } finally { Pop-Location }
if (-not (Test-Path -LiteralPath $runtimeArchive)) {
  Invoke-WebRequest -Uri "https://nodejs.org/dist/v$NodeVersion/$archiveName" -OutFile $runtimeArchive
}
$expectedNodeHash = @{ "24.18.0" = "0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821" }[$NodeVersion]
if (-not $expectedNodeHash) { throw "No pinned SHA-256 for Node.js $NodeVersion" }
$actualNodeHash = (Get-FileHash -LiteralPath $runtimeArchive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualNodeHash -ne $expectedNodeHash) { throw "Node.js archive SHA-256 mismatch" }
New-Item -ItemType Directory -Force -Path $runtimeExtract | Out-Null
& tar.exe -xf $runtimeArchive -C $runtimeExtract
if ($LASTEXITCODE -ne 0) { throw "Node.js archive extraction failed" }
$nodeFolder = Join-Path $runtimeExtract "node-v$NodeVersion-win-x64"
Copy-Item -LiteralPath (Join-Path $nodeFolder "node.exe") -Destination $runtimeRoot
Copy-Item -LiteralPath (Join-Path $nodeFolder "LICENSE") -Destination (Join-Path $runtimeRoot "NODE-LICENSE.txt")
Set-Content -LiteralPath (Join-Path $runtimeRoot "NODE-VERSION.txt") -Encoding utf8 -Value "Official Node.js v$NodeVersion Windows x64 portable runtime`nhttps://nodejs.org/dist/v$NodeVersion/"
$launcher = Get-ChildItem -LiteralPath $projectRoot -Filter "*.cmd" | Where-Object { (Get-Content -LiteralPath $_.FullName -Raw) -match 'runtime\\node.exe' } | Select-Object -First 1
if (-not $launcher) { throw "Portable launcher not found" }
Copy-Item -LiteralPath $launcher.FullName -Destination $stageRoot
$guide = Get-ChildItem -LiteralPath (Join-Path $projectRoot "docs") -Filter "*.txt" | Where-Object { (Get-Content -LiteralPath $_.FullName -Raw) -match 'Windows x64' } | Select-Object -First 1
if (-not $guide) { throw "Portable guide not found" }
Copy-Item -LiteralPath $guide.FullName -Destination $stageRoot
Set-Content -LiteralPath (Join-Path $stageRoot "data\DATA-README.txt") -Encoding utf8 -Value "Runtime data is stored here. The release candidate contains no real database, uploads, or logs."
Push-Location $releaseRoot
try {
  & tar.exe -a -cf $zipPath (Split-Path -Leaf $stageRoot)
  if ($LASTEXITCODE -ne 0) { throw "Portable ZIP creation failed" }
} finally { Pop-Location }
$hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath "$zipPath.sha256" -Encoding ascii -Value "$hash  $(Split-Path -Leaf $zipPath)"
Write-Host "Portable release candidate: $zipPath"
Write-Host "SHA-256: $hash"
