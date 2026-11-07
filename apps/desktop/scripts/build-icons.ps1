# 由项目自绘品牌图标（apps/web/public/favicon.svg，与顶部栏 BrandMark 同源）
# 生成 Windows 需要的图标资源：多尺寸 icon.ico + icon.png + tray.png
# 用法：pwsh apps/desktop/scripts/build-icons.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$SvgPath = Join-Path $ProjectRoot 'apps\web\public\favicon.svg'
$AssetsDir = Join-Path $ProjectRoot 'apps\desktop\assets'
if (-not (Test-Path -LiteralPath $AssetsDir)) { New-Item -ItemType Directory -Path $AssetsDir | Out-Null }

$RenderSize = 1024
$IcoSizes = @(16, 24, 32, 48, 64, 128, 256)

$Edge = @(
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $Edge) { throw '找不到 Edge/Chrome，无法把 SVG 栅格化' }

$Work = Join-Path $env:TEMP ("pa-icon-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Work | Out-Null
try {
  $svg = [IO.File]::ReadAllText($SvgPath)
  $html = @"
<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:transparent;overflow:hidden}
svg{display:block;width:${RenderSize}px;height:${RenderSize}px}
</style></head><body>$svg</body></html>
"@
  $htmlPath = Join-Path $Work 'icon.html'
  [IO.File]::WriteAllText($htmlPath, $html, (New-Object Text.UTF8Encoding $false))

  $renderPng = Join-Path $Work 'render-1024.png'
  $profileDir = Join-Path $Work 'profile'
  $uri = ([Uri]$htmlPath).AbsoluteUri
  & $Edge '--headless=new' '--disable-gpu' '--no-first-run' '--hide-scrollbars' `
          '--default-background-color=00000000' "--user-data-dir=$profileDir" `
          "--screenshot=$renderPng" "--window-size=$RenderSize,$RenderSize" $uri | Out-Null
  if (-not (Test-Path -LiteralPath $renderPng)) { throw 'SVG 渲染失败，未生成 PNG' }

  $source = [System.Drawing.Image]::FromFile($renderPng)
  try {
    # 逐档高保真缩放
    $frames = @{}
    foreach ($size in $IcoSizes + @(512)) {
      $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
      $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $g.Clear([System.Drawing.Color]::Transparent)
      $g.DrawImage($source, (New-Object System.Drawing.Rectangle(0, 0, $size, $size)))
      $g.Dispose()
      $ms = New-Object IO.MemoryStream
      $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
      $frames[$size] = $ms.ToArray()
      $bmp.Dispose()
      $ms.Dispose()
    }

    # 单独文件
    [IO.File]::WriteAllBytes((Join-Path $AssetsDir 'icon.png'), $frames[256])
    [IO.File]::WriteAllBytes((Join-Path $AssetsDir 'icon-512.png'), $frames[512])
    [IO.File]::WriteAllBytes((Join-Path $AssetsDir 'tray.png'), $frames[32])

    # 打包多尺寸 ICO（Vista+ 支持直接内嵌 PNG 帧）
    $icoPath = Join-Path $AssetsDir 'icon.ico'
    $fs = [IO.File]::Create($icoPath)
    $bw = New-Object IO.BinaryWriter($fs)
    try {
      $bw.Write([UInt16]0)                 # reserved
      $bw.Write([UInt16]1)                 # type: icon
      $bw.Write([UInt16]$IcoSizes.Count)   # image count
      $offset = 6 + 16 * $IcoSizes.Count
      foreach ($size in $IcoSizes) {
        $data = $frames[$size]
        $bw.Write([Byte]$(if ($size -ge 256) { 0 } else { $size }))  # width
        $bw.Write([Byte]$(if ($size -ge 256) { 0 } else { $size }))  # height
        $bw.Write([Byte]0)   # palette
        $bw.Write([Byte]0)   # reserved
        $bw.Write([UInt16]1) # planes
        $bw.Write([UInt16]32) # bpp
        $bw.Write([UInt32]$data.Length)
        $bw.Write([UInt32]$offset)
        $offset += $data.Length
      }
      foreach ($size in $IcoSizes) { $bw.Write($frames[$size]) }
    } finally {
      $bw.Dispose(); $fs.Dispose()
    }
  } finally {
    $source.Dispose()
  }

  "生成完成："
  Get-ChildItem -LiteralPath $AssetsDir | Select-Object Name, Length | Format-Table -AutoSize | Out-String -Width 100
} finally {
  Remove-Item -LiteralPath $Work -Recurse -Force -ErrorAction SilentlyContinue
}
