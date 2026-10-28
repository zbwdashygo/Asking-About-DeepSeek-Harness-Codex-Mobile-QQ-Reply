param([string]$NodePath = 'node.exe', [string]$OutputDirectory = '')
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $root 'dist' }
$output = [IO.Path]::GetFullPath($OutputDirectory)
$scratch = Join-Path $root '.build'
New-Item -ItemType Directory -Force -Path $scratch,$output | Out-Null
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw 'Windows .NET Framework C# compiler is missing.' }
Push-Location $root
try {
  & $NodePath --test test/config.test.mjs test/coordinator.test.mjs test/dsh.test.mjs test/mcp.test.mjs test/onebot.test.mjs test/wake.test.mjs test/native-app.test.mjs test/question-numbers.test.mjs test/files.test.mjs test/file-routing.test.mjs test/mobile-questions.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Node regression tests failed.' }
  $iconTool = Join-Path $scratch 'IconMaker.exe'
  $icon = Join-Path $scratch 'stella.ico'
  & $compiler /nologo /target:exe /reference:System.Drawing.dll ('/out:' + $iconTool) (Join-Path $root 'src/IconMaker.cs')
  if ($LASTEXITCODE -ne 0) { throw 'Icon build failed.' }
  & $iconTool $icon
  $stage = Join-Path $scratch ('StellaRelay-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $stage | Out-Null
  $sourceFiles = @(Get-ChildItem -LiteralPath (Join-Path $root 'src') -Filter '*.cs' | Where-Object { $_.Name -ne 'IconMaker.cs' } | ForEach-Object FullName)
  $exe = Join-Path $stage 'StellaRelay.exe'
  & $compiler /nologo /target:winexe /platform:x64 /optimize+ /codepage:65001 /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll /reference:Microsoft.CSharp.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll ('/win32icon:' + $icon) ('/out:' + $exe) @sourceFiles
  if ($LASTEXITCODE -ne 0) { throw 'Application build failed.' }
  Copy-Item -LiteralPath (Join-Path $root 'app') -Destination (Join-Path $stage 'app') -Recurse
  foreach ($name in @('README.md','LICENSE','THIRD-PARTY-NOTICES.md','RELEASE-NOTES.md')) { Copy-Item -LiteralPath (Join-Path $root $name) -Destination $stage }
  $selfTest = Join-Path $scratch ('self-test-' + [Guid]::NewGuid().ToString('N'))
  $process = Start-Process -FilePath $exe -ArgumentList @('--self-test',('"' + $selfTest + '"')) -Wait -PassThru -WindowStyle Hidden
  if ($process.ExitCode -ne 0) { if (Test-Path -LiteralPath (Join-Path $selfTest 'self-test-error.txt')) { Get-Content -LiteralPath (Join-Path $selfTest 'self-test-error.txt') }; throw 'Windows application self-test failed.' }
  Get-Content -LiteralPath (Join-Path $selfTest 'self-test.json')
  $package = Join-Path $output 'StellaRelay-0.4.0-beta.4-windows-x64.zip'
  if (Test-Path -LiteralPath $package) { throw 'Release ZIP exists; choose a new output directory to preserve previous builds.' }
  Compress-Archive -LiteralPath (Get-ChildItem -LiteralPath $stage | ForEach-Object FullName) -DestinationPath $package -CompressionLevel Optimal
  $hash = (Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash.ToLowerInvariant()
  [IO.File]::WriteAllText((Join-Path $output 'SHA256SUMS.txt'), ($hash + '  ' + [IO.Path]::GetFileName($package) + "`n"), (New-Object Text.UTF8Encoding($false)))
  Write-Output ('APP_STAGE=' + $stage)
  Get-Item -LiteralPath $package | Select-Object FullName,Length
} finally { Pop-Location }
