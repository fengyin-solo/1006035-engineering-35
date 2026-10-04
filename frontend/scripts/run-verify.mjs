// 通过 esbuild 的 JS API 转译验证脚本，规避 CLI 原生 shim 的架构问题。
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outfile = path.join(root, 'node_modules/.verify-data-layer.mjs')

await build({
  entryPoints: [path.join(root, 'scripts/verify-data-layer.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  alias: { '@': path.join(root, 'src') },
  outfile,
  logLevel: 'info',
})

const result = spawnSync(process.execPath, [outfile], { stdio: 'inherit' })
process.exit(result.status ?? 0)
