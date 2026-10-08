# ==============================================================================
# Lumina Flipbook - Zero-Dependency Local Static Server (PowerShell)
# ==============================================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$port = 8080
$rootDir = $PSScriptRoot

# Find the PDF file in root directory (e.g. เล่ม.pdf)
$pdfFile = Get-ChildItem -Path $rootDir -Filter *.pdf | Select-Object -First 1
$pdfPath = if ($pdfFile) { $pdfFile.FullName } else { $null }

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
if ($pdfFile) {
    Write-Host "   เปิดเอกสาร: $($pdfFile.Name)" -ForegroundColor Yellow
}
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
    ".ico"  = "image/x-icon"
}

try {
    while ($listener.IsListening) {
        try {
            $context = $listener.GetContext()
            $request = $context.Request
            $response = $context.Response

            $rawPath = $request.Url.LocalPath.TrimStart('/')
            $relPath = [System.Uri]::UnescapeDataString($rawPath)
            if ([string]::IsNullOrWhiteSpace($relPath)) {
                $relPath = "index.html"
            }

            $filePath = Join-Path $rootDir $relPath

            # Smart PDF routing:
            # Map book.pdf, doc.pdf, or any .pdf request (including mojibake from HTTP.sys) to the PDF file
            if (-not (Test-Path $filePath -PathType Leaf) -and $pdfPath) {
                if ($relPath -like "*.pdf" -or $rawPath -like "*.pdf" -or $relPath -match "\.pdf" -or $rawPath -match "\.pdf") {
                    $filePath = $pdfPath
                }
            }

            if (Test-Path $filePath -PathType Leaf) {
                $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
                $contentType = "application/octet-stream"
                if ($mimeTypes.ContainsKey($ext)) {
                    $contentType = $mimeTypes[$ext]
                }

                $response.ContentType = $contentType
                $response.StatusCode = 200
                $response.AddHeader("Access-Control-Allow-Origin", "*")
                $response.AddHeader("Accept-Ranges", "none")
                $response.AddHeader("Cache-Control", "no-cache")

                $bytes = [System.IO.File]::ReadAllBytes($filePath)
                $response.ContentLength64 = $bytes.Length

                # Only write body for non-HEAD requests to prevent ProtocolViolationException
                if ($request.HttpMethod -ne "HEAD") {
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                }
            } else {
                $response.StatusCode = 404
                $msg = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $relPath")
                $response.OutputStream.Write($msg, 0, $msg.Length)
            }

            $response.Close()
        } catch {
            # Safely continue loop on client connection drop or error
        }
    }
} finally {
    $listener.Stop()
    $listener.Close()
}
