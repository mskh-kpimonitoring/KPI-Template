# ==============================================================================
# Lumina Flipbook - Zero-Dependency Local Static Server (PowerShell)
# ==============================================================================

$port = 8080
$rootDir = $PSScriptRoot

# Check if port is in use, find next available if needed
while ($true) {
    try {
        $listener = New-Object System.Net.HttpListener
        $listener.Prefixes.Add("http://localhost:$port/")
        $listener.Start()
        break
    } catch {
        $port++
        if ($port -gt 8100) {
            Write-Error "No available port found between 8080 and 8100."
            exit 1
        }
    }
}

$url = "http://localhost:$port/"
Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   📖 Lumina Flipbook กำลังทำงานที่: $url" -ForegroundColor Green
Write-Host "   เปิดเอกสาร: เล่ม.pdf (571 หน้า)" -ForegroundColor Yellow
Write-Host "   กด Ctrl+C เพื่อหยุดการทำงาน" -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

# Open default browser
Start-Process $url

$mimeTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".js"   = "application/javascript; charset=utf-8"
    ".json" = "application/json"
    ".pdf"  = "application/pdf"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".jpeg" = "image/jpeg"
    ".svg"  = "image/svg+xml"
    ".woff" = "font/woff"
    ".woff2"= "font/woff2"
}

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $relPath = [System.Uri]::UnescapeDataString($request.Url.LocalPath.TrimStart('/'))
        if ([string]::IsNullOrWhiteSpace($relPath)) {
            $relPath = "index.html"
        }

        $filePath = Join-Path $rootDir $relPath

        if (Test-Path $filePath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $contentType = "application/octet-stream"
            if ($mimeTypes.ContainsKey($ext)) {
                $contentType = $mimeTypes[$ext]
            }

            $response.ContentType = $contentType
            $response.AddHeader("Access-Control-Allow-Origin", "*")
            $response.AddHeader("Cache-Control", "no-cache")

            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $response.StatusCode = 404
            $msg = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $relPath")
            $response.OutputStream.Write($msg, 0, $msg.Length)
        }

        $response.OutputStream.Close()
    }
} finally {
    $listener.Stop()
    $listener.Close()
}
