#!/usr/bin/env node
/* Write Brotli and gzip siblings (file.br, file.gz) for the app's static text files so @fastify/static (preCompressed: true)
   can serve them: the Great League data file alone is 800 KB uncompressed and ~110 KB as Brotli. Run at container build
   (Dockerfile) and before a local server start; the outputs are git-ignored. */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = [...fs.readdirSync(path.join(ROOT, 'data')).filter(f => f.endsWith('.json')).map(f => path.join('data', f)),
  ...fs.readdirSync(ROOT).filter(f => /\.(js|css|html|webmanifest)$/.test(f))];
let n = 0, before = 0, after = 0;
for (const rel of FILES) {
  const p = path.join(ROOT, rel), src = fs.readFileSync(p);
  if (src.length < 1024) continue;
  const stamp = fs.statSync(p).mtimeMs;
  for (const [ext, make] of [['.br', b => zlib.brotliCompressSync(b, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: b.length } })], ['.gz', b => zlib.gzipSync(b, { level: 9 })]]) {
    const out = p + ext;
    if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= stamp && !process.argv.includes('--force')) continue;
    const buf = make(src); fs.writeFileSync(out, buf); n++;
    if (ext === '.br') { before += src.length; after += buf.length; }
  }
}
console.log(`precompress: ${n} files written${before ? `, ${Math.round(before / 1024)} KB → ${Math.round(after / 1024)} KB as Brotli` : ''}`);
