param([string]$OutputDirectory = 'artifacts')
$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$publishRoot = if ([System.IO.Path]::IsPathRooted($OutputDirectory)) {
    [System.IO.Path]::GetFullPath($OutputDirectory)
} else {
    [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot $OutputDirectory))
}
$portableDirectory = Join-Path $publishRoot 'portable'
New-Item -ItemType Directory -Force $portableDirectory | Out-Null
dotnet publish (Join-Path $repositoryRoot 'src/TexturePacker.Desktop/TexturePacker.Desktop.csproj') `
    -c Release -r win-x64 --self-contained true `
    -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o $portableDirectory
if ($LASTEXITCODE -ne 0) { throw 'Windows publish failed.' }
Get-ChildItem -LiteralPath $portableDirectory -File -Filter '*.pdb' | Remove-Item -Force
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'LICENSE') -Destination $portableDirectory
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'THIRD-PARTY-NOTICES.md') -Destination $portableDirectory
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'licenses') -Destination $portableDirectory -Recurse -Force
@'
Texture Packer for Windows x64

Extract the ZIP and run TexturePacker.exe. No .NET installation is required.
All images are processed locally. Original source files are never overwritten.

Ctrl+O: add textures  |  Ctrl+Enter: process  |  Ctrl+S: export PNG
Web version: https://so2k.github.io/TexturePacker/
Source: https://github.com/So2K/TexturePacker

Project license: MIT. Dependency notices are included beside this file.
'@ | Set-Content -LiteralPath (Join-Path $portableDirectory 'Readme.txt') -Encoding utf8
$zipPath = Join-Path $publishRoot 'TexturePacker-win-x64.zip'
Compress-Archive -Path (Join-Path $portableDirectory '*') -DestinationPath $zipPath -Force
(Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant() + '  TexturePacker-win-x64.zip' |
    Set-Content -LiteralPath (Join-Path $publishRoot 'SHA256SUMS.txt') -Encoding ascii
Write-Output $zipPath
