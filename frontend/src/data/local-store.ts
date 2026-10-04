import { readonly, ref } from 'vue'

import { CURRENT_VERSION, createEnvelope, migrateEnvelope, parseStored } from './migrations'
import { SEED_ROWS } from './seed'
import type { EntryRow, PersistedEnvelope } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'airport-ground-ops:entries'
const QUARANTINE_PREFIX = 'airport-ground-ops:quarantine:'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function seedEnvelope(): PersistedEnvelope {
  return { version: 0, modules: clone(SEED_ROWS), appliedMigrations: [] }
}

/** 写入前兜底：动作服务保证结构，这里再防一层，避免任何入口把脏结构落盘。 */
function sanitizeRows(rows: EntryRow[]): EntryRow[] {
  const clean: EntryRow[] = []
  let nextId = 0
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) {
      continue
    }
    if (Number.isInteger(row.id)) {
      nextId = Math.max(nextId, Number(row.id))
    }
  }
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) {
      continue
    }
    const out: EntryRow = {
      id: Number.isInteger(row.id) ? Number(row.id) : ++nextId,
      status: typeof row.status === 'string' ? row.status : '',
      abnormal: row.abnormal === true,
    }
    for (const [key, value] of Object.entries(row)) {
      if (key === 'id' || key === 'status' || key === 'pending' || key === 'abnormal') {
        continue
      }
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        out[key] = value
      }
    }
    clean.push(out)
  }
  return clean
}

let cache: PersistedEnvelope | null = null

// 每次落盘自增；概览与各模块待办清单 watch 它，取数结论自动刷新，两处口径不会分家。
const dataVersion = ref(0)
export const storeVersion = readonly(dataVersion)

function storage(): Storage | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  return window.localStorage
}

function persist(envelope: PersistedEnvelope): void {
  const target = storage()
  if (target) {
    target.setItem(STORAGE_KEY, JSON.stringify(envelope))
  }
  dataVersion.value += 1
}

function quarantine(raw: string): void {
  const target = storage()
  if (!target) {
    return
  }
  try {
    target.setItem(`${QUARANTINE_PREFIX}${Date.now()}`, raw)
  } catch {
    // 备份失败也不阻断启动：坏数据留在原 key 之外，不再让整页崩或回退示例数据。
  }
}

function load(): PersistedEnvelope {
  if (cache !== null) {
    return cache
  }
  const target = storage()
  if (!target) {
    // SSR / 无 localStorage 环境：用种子在内存里跑，不落盘。
    cache = migrateEnvelope(seedEnvelope(), () => {})
    return cache
  }

  const parsed = parseStored(target.getItem(STORAGE_KEY))
  if (parsed.kind === 'corrupt') {
    // 旧逻辑是 JSON 解析失败就拿种子覆盖（表现为“回到示例数据”）。
    // 现在：原文隔离备份，本次以空库启动，绝不覆盖也不回退种子。
    quarantine(parsed.raw)
    cache = { version: 1, modules: {}, appliedMigrations: [] }
    persist(cache)
    return cache
  }
  if (parsed.kind === 'empty') {
    // 从未打开过：播种示例数据并迁到当前结构；之后用户改动优先。
    cache = migrateEnvelope(seedEnvelope(), persist)
    persist(cache)
    return cache
  }

  // 正常路径：旧扁平结构或低版本信封在此升级，按模块断点续跑。
  cache = migrateEnvelope(createEnvelope(parsed.value), persist)
  persist(cache)
  return cache
}

// 其他标签页改了数据：同步缓存并通知本页取数方重算。
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY || event.newValue === null) {
      return
    }
    const parsed = parseStored(event.newValue)
    if (parsed.kind !== 'parsed') {
      return
    }
    const incoming = createEnvelope(parsed.value)
    // 对端写入的已是当前版本：直接采用，不再重复迁移、不回写，避免两个标签页互相触发。
    if (incoming.version >= CURRENT_VERSION) {
      cache = incoming
    } else {
      cache = migrateEnvelope(incoming, persist)
      persist(cache)
    }
    dataVersion.value += 1
  })
}

/** 原始行（不含派生 pending）；返回引用只读使用，改动请走 saveRows。 */
export function allRows(): Record<string, EntryRow[]> {
  return load().modules
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const envelope = load()
  envelope.modules[key] = sanitizeRows(rows)
  persist(envelope)
}

export function resetRows(key: string): EntryRow[] {
  const rows = sanitizeRows(clone(SEED_ROWS[key] ?? []) as EntryRow[])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

/** 仅供 Node 校验脚本使用：换一块内存存储后清掉模块级缓存，重新走加载/迁移链路。 */
export function __resetCacheForTests(): void {
  cache = null
  dataVersion.value = 0
}
