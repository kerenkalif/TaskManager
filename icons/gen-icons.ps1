Add-Type -AssemblyName System.Drawing
function New-IconPng {
    param([int]$size, [string]$path)
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $teal = [System.Drawing.Color]::FromArgb(0,153,153)
    $yellow = [System.Drawing.Color]::FromArgb(255,213,79)
    $tealBrush = New-Object System.Drawing.SolidBrush($teal)
    $yellowBrush = New-Object System.Drawing.SolidBrush($yellow)
    $g.FillRectangle($tealBrush, 0, 0, $size, $size)
    $pad = [int]($size * 0.18)
    $cs = $size - 2*$pad
    $g.FillEllipse($yellowBrush, $pad, $pad, $cs, $cs)
    $penWidth = [single]($size * 0.08)
    $pen = New-Object System.Drawing.Pen($teal, $penWidth)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $cx = $size / 2.0
    $cy = $size / 2.0
    $r = $cs * 0.35
    $g.DrawLine($pen, [single]($cx - $r*0.6), [single]$cy, [single]($cx - $r*0.1), [single]($cy + $r*0.5))
    $g.DrawLine($pen, [single]($cx - $r*0.1), [single]($cy + $r*0.5), [single]($cx + $r*0.7), [single]($cy - $r*0.5))
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
}
$dir = "C:\Users\user\OneDrive\Teaching\AI-Driven-Programming\TaskManager\icons"
New-IconPng -size 192 -path "$dir\icon-192.png"
New-IconPng -size 512 -path "$dir\icon-512.png"
Write-Output "Generated icons in $dir"
Get-ChildItem $dir | Select-Object Name, Length | Format-Table
