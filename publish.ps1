param(
  [string]$Repository = 'zbwdashygo/Asking-About-DeepSeek-Harness-Codex-Mobile-QQ-Reply',
  [string]$ReleaseDirectory = '',
  [string]$GhPath = 'gh',
  [switch]$PrepareOnly
)
$ErrorActionPreference = 'Stop'
$version = 'v0.3.0-beta.2'
$root = $PSScriptRoot
if (-not $ReleaseDirectory) { $ReleaseDirectory = Join-Path $root 'dist' }
$release = [IO.Path]::GetFullPath($ReleaseDirectory)
$zip = Join-Path $release 'StellaRelay-0.3.0-beta.2-windows-x64.zip'
$sums = Join-Path $release 'SHA256SUMS.txt'
$utf8 = New-Object Text.UTF8Encoding($false)
if ($Repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { throw 'Invalid repository' }
if (-not (Test-Path -LiteralPath $zip) -or -not (Test-Path -LiteralPath $sums)) { throw 'Build release ZIP and checksum file first.' }
$expected = ((Get-Content -LiteralPath $sums -Raw).Trim() -split '\s+')[0]
if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Release ZIP checksum mismatch' }
$files = New-Object 'Collections.Generic.List[string]'
foreach ($name in @('README.md','RELEASE-NOTES.md','THIRD-PARTY-NOTICES.md','LICENSE','package.json','.gitignore','build.ps1','publish.ps1')) { $files.Add((Join-Path $root $name)) }
foreach ($folder in @('app','src','test','examples')) { foreach ($file in Get-ChildItem -LiteralPath (Join-Path $root $folder) -File -Recurse) { $files.Add($file.FullName) } }
$treeEntries = @()
foreach ($file in $files) {
  $relative = $file.Substring($root.Length).TrimStart([char]92,[char]47).Replace([char]92,[char]47)
  if ($relative -match '(?i)(^|/)(runtime|qq-data|\.build|node_modules|\.github)(/|$)|\.(exe|dll|node|zip|log)$|(^|/)(relay|config.local|relay-location)\.json$') { throw ('Unexpected source file: ' + $relative) }
  $content = [IO.File]::ReadAllText($file, [Text.Encoding]::UTF8)
  if ($content -match '(?:C|E):[/\\]Users[/\\]|"token"\s*:\s*"[a-f0-9]{64}"') { throw ('Local path or credential literal in ' + $relative) }
  $treeEntries += @{path=$relative;mode='100644';type='blob';content=$content}
}
$scratch = Join-Path $root '.build/publish'
New-Item -ItemType Directory -Force -Path $scratch | Out-Null
$plan = @{repository=$Repository;tag=$version;sourceFiles=@($treeEntries | ForEach-Object path);assets=@([IO.Path]::GetFileName($zip),'SHA256SUMS.txt');sha256=$expected;activeWorkflows=$false}
[IO.File]::WriteAllText((Join-Path $scratch 'plan.json'), ($plan | ConvertTo-Json -Depth 8), $utf8)
Write-Output ('Verified ' + $treeEntries.Count + ' source files; no active workflow or user login data.')
if ($PrepareOnly) { Write-Output ('PLAN=' + (Join-Path $scratch 'plan.json')); exit 0 }
function Api([string]$method,[string]$endpoint,$body=$null) {
  $arguments = @('api','--method',$method,$endpoint)
  if ($null -ne $body) {
    $inputFile = Join-Path $scratch ('body-' + [Guid]::NewGuid().ToString('N') + '.json')
    [IO.File]::WriteAllText($inputFile, ($body | ConvertTo-Json -Depth 30 -Compress), $utf8)
    $arguments += @('--input',$inputFile)
  }
  $answer = & $GhPath @arguments
  if ($LASTEXITCODE -ne 0) { throw ('GitHub API failed: ' + $method + ' ' + $endpoint) }
  return ($answer | ConvertFrom-Json)
}
$repo = Api 'GET' ('repos/' + $Repository)
if (-not $repo.permissions.push) { throw 'The signed-in account cannot push to this repository.' }
$branch = $repo.default_branch
$head = Api 'GET' ('repos/' + $Repository + '/git/ref/heads/' + $branch)
$base = Api 'GET' ('repos/' + $Repository + '/git/commits/' + $head.object.sha)
# Preserve all unrelated remote files and never force-update a branch or tag.
$tree = Api 'POST' ('repos/' + $Repository + '/git/trees') @{base_tree=$base.tree.sha;tree=$treeEntries}
$commit = Api 'POST' ('repos/' + $Repository + '/git/commits') @{message='Release Stella Relay 0.3.0-beta.2';tree=$tree.sha;parents=@($head.object.sha)}
Api 'PATCH' ('repos/' + $Repository + '/git/refs/heads/' + $branch) @{sha=$commit.sha;force=$false} | Out-Null
Api 'POST' ('repos/' + $Repository + '/git/refs') @{ref=('refs/tags/' + $version);sha=$commit.sha} | Out-Null
& $GhPath release create $version --repo $Repository --draft --prerelease --verify-tag --title 'Stella Relay 0.3.0-beta.2' --notes-file (Join-Path $root 'RELEASE-NOTES.md')
if ($LASTEXITCODE -ne 0) { throw 'Draft release creation failed.' }
& $GhPath release upload $version $zip $sums --repo $Repository
if ($LASTEXITCODE -ne 0) { throw 'Asset upload failed; release remains a draft.' }
& $GhPath release edit $version --repo $Repository --draft=false
if ($LASTEXITCODE -ne 0) { throw 'Release publication failed.' }
$published = Api 'GET' ('repos/' + $Repository + '/releases/tags/' + $version)
[IO.File]::WriteAllText((Join-Path $scratch 'published.json'), ($published | ConvertTo-Json -Depth 20), $utf8)
Write-Output ('RELEASE_URL=' + $published.html_url)
$published.assets | Select-Object name,size,browser_download_url
