import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const jar = String.raw`D:\QQ下载\落幕曲\.minecraft\versions\落幕曲\mods\alexsmobs-1.22.9.jar`;
console.log('exists', fs.existsSync(jar), fs.statSync(jar).size);
const entry = 'com/github/alexthe666/alexsmobs/client/model/ModelGrizzlyBear.class';
const tmp = path.join(os.tmpdir(), 'mg-debug.class');
const script = `
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z = [IO.Compression.ZipFile]::OpenRead(@'${jar}'@)
$e = $z.Entries | Where-Object { $_.FullName -eq '${entry}' }
if (-not $e) { Write-Host 'no entry'; exit 2 }
$s = $e.Open(); $ms = New-Object IO.MemoryStream; $s.CopyTo($ms)
[IO.File]::WriteAllBytes(@'${tmp}'@, $ms.ToArray())
$z.Dispose()
Write-Host extracted $ms.Length
`;
try {
  const out = execFileSync('powershell', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
  });
  console.log(out);
} catch (e) {
  console.error('ps fail', e.message, e.stdout, e.stderr);
}
const buf = fs.readFileSync(tmp);
console.log('len', buf.length, 'magic', buf.subarray(0, 4));
