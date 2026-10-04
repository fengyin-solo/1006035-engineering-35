// 用 esbuild JS API 打包 TS 校验脚本后依次执行：
// 比走 bin shim 更稳，跨架构安装 node_modules 时也能自动选中当前平台二进制。
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import { rmSync } from 'node:fs'

const targets = ['src/scripts/migrate-check.ts', 'src/scripts/pipeline-check.ts']

for (const entry of targets) {
  const outfile = `node_modules/.cache/${entry.split('/').pop().replace(/\.ts$/, '.mjs')}`
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'warning',
  })
  try {
    await import(pathToFileURL(outfile).href)
  } finally {
    rmSync(outfile, { force: true })
  }
}
