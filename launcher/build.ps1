# Builds Argonaut.exe into the project root using the C# compiler that ships with Windows
# (.NET Framework 4.x), so no .NET SDK is needed. Re-run after changing Launcher.cs or the icon.
#
# The window is a WebView2, so the build needs Microsoft's WebView2 SDK: a fixed version is
# fetched from nuget.org once into launcher\packages, its DLLs' Microsoft signatures are
# checked, and three of them are put beside Argonaut.exe, which loads them from there.

$ErrorActionPreference = 'Stop'

$launcherDir = $PSScriptRoot
$projectDir = Split-Path $launcherDir -Parent
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) {
    throw "csc.exe not found at $csc. The .NET Framework 4.x compiler is required."
}

# Bake in the project location so a copy of the exe elsewhere can still find it.
$objDir = Join-Path $launcherDir 'obj'
New-Item -ItemType Directory -Force $objDir | Out-Null
$escapedProjectDir = $projectDir.Replace('"', '""')
$buildInfo = @"
namespace Argonaut
{
    internal static class BuildInfo
    {
        public const string ProjectDir = @"$escapedProjectDir";
    }
}
"@
Set-Content -Path (Join-Path $objDir 'BuildInfo.cs') -Value $buildInfo -Encoding UTF8

$webView2Version = '1.0.4314.35'
$packages = Join-Path $launcherDir 'packages'
$sdk = Join-Path $packages "webview2.$webView2Version"
if (-not (Test-Path (Join-Path $sdk 'lib\net462\Microsoft.Web.WebView2.Core.dll'))) {
    New-Item -ItemType Directory -Force $packages | Out-Null
    $zip = "$sdk.zip"
    Write-Host "Fetching the WebView2 SDK $webView2Version from nuget.org"
    Invoke-WebRequest -UseBasicParsing "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/$webView2Version" -OutFile $zip
    Expand-Archive $zip -DestinationPath $sdk -Force
    Remove-Item $zip
}
$dlls = @(
    (Join-Path $sdk 'lib\net462\Microsoft.Web.WebView2.Core.dll'),
    (Join-Path $sdk 'lib\net462\Microsoft.Web.WebView2.WinForms.dll'),
    (Join-Path $sdk 'runtimes\win-x64\native\WebView2Loader.dll')
)
foreach ($dll in $dlls) {
    $signature = Get-AuthenticodeSignature $dll
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
        throw "$dll isn't signed by Microsoft ($($signature.Status)). Delete launcher\packages and build again."
    }
    Copy-Item $dll $projectDir -Force
}

$output = Join-Path $projectDir 'Argonaut.exe'
& $csc /nologo /target:winexe /platform:x64 /optimize+ `
    "/win32icon:$launcherDir\argonaut.ico" `
    "/resource:$launcherDir\argonaut-256.png,Argonaut.Mark.png" `
    /reference:System.dll /reference:System.Drawing.dll `
    /reference:System.Windows.Forms.dll `
    "/reference:$($dlls[0])" "/reference:$($dlls[1])" `
    "/out:$output" "$launcherDir\Launcher.cs" "$objDir\BuildInfo.cs"

if ($LASTEXITCODE -ne 0) {
    throw "csc failed with exit code $LASTEXITCODE"
}
Write-Host "Built $output"
