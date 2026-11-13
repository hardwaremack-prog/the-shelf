# The Shelf - one-line installer for Windows.
# Run in PowerShell:
#   irm https://raw.githubusercontent.com/hardwaremack-prog/the-shelf/main/install.ps1 | iex
# It gets Node.js if it's missing (with winget), downloads the newest The Shelf from GitHub,
# and opens the usual setup page in your browser (pick where it goes, start automatically, Install).
# Your shelves and data in an existing install are never touched.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$repo = 'hardwaremack-prog/the-shelf'
Write-Host ''
Write-Host 'The Shelf - installing' -ForegroundColor Yellow

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Host 'Node.js is needed: installing it with winget...'
        winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements | Out-Host
        $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    }
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Host 'Node.js is needed. Install the LTS version from https://nodejs.org, then run this again.' -ForegroundColor Red
        return
    }
}

$sha = $null; $date = $null; $msg = ''
try {
    $c = Invoke-RestMethod "https://api.github.com/repos/$repo/commits/main" -Headers @{ 'User-Agent' = 'TheShelf' }
    $sha = $c.sha; $date = $c.commit.committer.date; $msg = ($c.commit.message -split "`n")[0]
} catch { }
$ref = if ($sha) { $sha } else { 'refs/heads/main' }

$tmp = Join-Path $env:TEMP ("theshelf-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $tmp | Out-Null
Write-Host 'Downloading the newest The Shelf from GitHub...'
Invoke-WebRequest "https://codeload.github.com/$repo/zip/$ref" -OutFile (Join-Path $tmp 'shelf.zip') -UseBasicParsing
Expand-Archive (Join-Path $tmp 'shelf.zip') -DestinationPath $tmp
$src = Get-ChildItem $tmp -Directory | Select-Object -First 1
if ($sha) {   # so "Check for updates" knows which version this is
    @{ sha = $sha; date = $date; message = $msg; installedAt = 0 } | ConvertTo-Json | Set-Content -Path (Join-Path $src.FullName '.shelf-version.json') -Encoding UTF8
}
Write-Host 'Opening the setup page in your browser. Leave this window open until setup says it is done.' -ForegroundColor Green
node (Join-Path $src.FullName 'installer\install.js')
