/**
 * Turn near-black pixels transparent in a PNG.
 *
 * Usage:
 *   node scripts/black-to-transparent.mjs <input.png> [output.png] [--threshold=24]
 *
 * threshold: max channel value treated as "black" (0–255, default 24)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.replace(/^--/, '').split('=');
      return [k, v ?? 'true'];
    }),
);

const input = args[0];
if (!input) {
  console.error(
    'Usage: node scripts/black-to-transparent.mjs <input.png> [output.png] [--threshold=24]',
  );
  process.exit(1);
}

const inputPath = path.resolve(input);
const outputPath = path.resolve(
  args[1] || inputPath.replace(/(\.png)$/i, '') + '-transparent.png',
);
const threshold = Math.max(0, Math.min(255, Number(flags.threshold ?? 24) || 24));

if (!fs.existsSync(inputPath)) {
  console.error(`not found: ${inputPath}`);
  process.exit(1);
}
if (os.platform() !== 'win32') {
  console.error('This script currently uses System.Drawing (Windows only).');
  process.exit(1);
}

const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$in = ${JSON.stringify(inputPath)}
$out = ${JSON.stringify(outputPath)}
$th = ${threshold}
$src = [System.Drawing.Bitmap]::FromFile($in)
try {
  $bmp = New-Object System.Drawing.Bitmap $src.Width, $src.Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bmp.SetResolution($src.HorizontalResolution, $src.VerticalResolution)
  $cleared = 0
  for ($y = 0; $y -lt $src.Height; $y++) {
    for ($x = 0; $x -lt $src.Width; $x++) {
      $c = $src.GetPixel($x, $y)
      if ($c.R -le $th -and $c.G -le $th -and $c.B -le $th) {
        $bmp.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(0, 0, 0, 0))
        $cleared++
      } else {
        $bmp.SetPixel($x, $y, $c)
      }
    }
  }
  $dir = Split-Path $out -Parent
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output ("cleared=$cleared size=$($src.Width)x$($src.Height) out=$out")
} finally {
  $src.Dispose()
}
`;

const result = execFileSync(
  'powershell.exe',
  ['-NoProfile', '-NonInteractive', '-Command', ps],
  { encoding: 'utf8' },
).trim();
console.log(result);
