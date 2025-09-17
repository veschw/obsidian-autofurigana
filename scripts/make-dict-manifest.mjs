// scripts/make-dict-manifest.mjs
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
if (!dir) {
  console.error('Usage: node scripts/make-dict-manifest.mjs <path-to-dict>')
  process.exit(1)
}

const entries = await fs.readdir(dir)
const manifest = {}
for (const name of entries) {
  const p = join(dir, name)
  const st = await fs.stat(p)
  if (!st.isFile()) continue
  const buf = await fs.readFile(p)
  const sha = createHash('sha256').update(buf).digest('hex')
  manifest[name] = { sha256: sha, bytes: buf.byteLength }
}

await fs.writeFile('dict.manifest.json', JSON.stringify(manifest, null, 2))
console.log(`Wrote dict.manifest.json with ${Object.keys(manifest).length} entries`)
