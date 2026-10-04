import { MODULES } from './modules'
import { CURRENT_VERSION, MIGRATION_STATE_KEY, runMigrations } from './migrations'
import { NORMALIZED_SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// 数据形态是带版本号的信封 { version, rows }，启动时经 migrations.ts
// 逐步迁移到当前版本；元数据里没有的模块按空模块处理，存储损坏不拖垮页面。
const STORAGE_KEY = 'airport-ground-ops:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** localStorage 适配层：SSR / 隐私模式下退化为内存存储，读写永不抛错。 */
function createKV(): Storage | Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage
  }
  const memory = new Map<string, string>()
  return {
    getItem: (key: string) => (memory.has(key) ? memory.get(key)! : null),
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
  }
}

let kv = createKV()

type StoreState = {
  version: number
  rows: Record<string, EntryRow[]>
}

let cache: StoreState | null = null

/** 首次播种：每个已登记模块都有一份种子；纯空模块也会显式登记为空数组。 */
function seedEnvelope(): StoreState {
  const rows: Record<string, EntryRow[]> = {}
  for (const meta of MODULES) {
    rows[meta.key] = clone(NORMALIZED_SEED_ROWS[meta.key] ?? [])
  }
  return { version: CURRENT_VERSION, rows }
}

function bootstrap(): StoreState {
  const hasRaw = kv.getItem(STORAGE_KEY) !== null
  if (!hasRaw) {
    const seeded = seedEnvelope()
    kv.setItem(STORAGE_KEY, JSON.stringify(seeded))
    return seeded
  }
  // 已有数据（含旧结构/损坏）一律先进迁移管线，缺模块由迁移和读取侧兜空。
  const envelope = runMigrations(kv, STORAGE_KEY, MODULES)
  return { version: envelope.version, rows: envelope.rows }
}

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = bootstrap()
  }
  return cache.rows
}

/** 缺模块即空模块：永不向页面抛 undefined / 异常。 */
export function listRows(key: string): EntryRow[] {
  const rows = allRows()[key]
  return Array.isArray(rows) ? rows : []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  if (cache === null) {
    cache = bootstrap()
  }
  cache.rows = { ...cache.rows, [key]: rows }
  kv.setItem(
    STORAGE_KEY,
    JSON.stringify({ version: cache.version, rows: cache.rows }),
  )
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(NORMALIZED_SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

/** 重新播种并清空迁移检查点：供「恢复示例数据」与测试使用。 */
export function resetAll(): void {
  kv.removeItem(MIGRATION_STATE_KEY)
  cache = seedEnvelope()
  kv.setItem(STORAGE_KEY, JSON.stringify(cache))
}

export function storageKey(): string {
  return STORAGE_KEY
}

/** 测试/多实例隔离：换一个 KV 实现并丢弃内存缓存。 */
export function bindKV(next: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): void {
  kv = next
  cache = null
}
