# Salvis local static file server (dev only)
$port = 8000
$root = $PSScriptRoot

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Host "Serving Salvis at http://localhost:$port (Ctrl+C to stop)" -ForegroundColor Green

function Get-ContentType([string]$ext) {
    switch ($ext) {
        '.html' { 'text/html' }
        '.css'  { 'text/css' }
        '.js'   { 'application/javascript' }
        '.json' { 'application/json' }
        '.png'  { 'image/png' }
        '.jpg'  { 'image/jpeg' }
        '.svg'  { 'image/svg+xml' }
        '.ico'  { 'image/x-icon' }
        '.webmanifest' { 'application/manifest+json' }
        default { 'application/octet-stream' }
    }
}

try {
    while ($listener.IsListening) {
        $ctx = $listener.GetContext()
        $req = $ctx.Request
        $res = $ctx.Response

        $path = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath)
        if ($path -eq '/' -or $path -eq '') { $path = '/Salvis.html' }

        $filePath = Join-Path $root ($path.TrimStart('/'))
        if (Test-Path -LiteralPath $filePath -PathType Leaf) {
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $res.ContentType = Get-ContentType ([System.IO.Path]::GetExtension($filePath))
            $res.StatusCode = 200
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $res.StatusCode = 404
        }
        $res.Close()
    }
} finally {
    $listener.Stop()
}