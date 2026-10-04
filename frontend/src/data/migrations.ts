import type { EntryRow, PersistedEnvelope } from './types'

/**
 * 结构迁移：有序、按模块记进度的纯函数步骤表。
 * 不碰 localStorage、不引 Vue，既能在浏览器里跑，也能在 Node 校验脚本里直接跑。
 */

export const BASELINE_MIGRATION = '0001-baseline'
/** 行上缺 id 时的确定性补号基数：100001 + 模块序号 * 1000 + 槽位，重复迁移不造新号。 */
const FALLBACK_ID_BASE = 100001

type StoredField = string | number | boolean

function isStoredField(value: unknown): value is StoredField {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

/**
 * 0001-baseline：把任意历史结构的单个模块数据规范化成当前 EntryRow[]。
 * - 非数组（模块槽位损坏）→ 空模块；数组里的非对象元素（坏行）→ 丢弃
 * - 缺 id / id 非整数 → 按槽位补确定性 id；同模块重复 id → 保留第一条
 * - status 非字符串 → 空字符串（取数侧按“非末态”记为待处理，不会漏）
 * - abnormal 缺失 → false；行上遗留的 pending 是派生缓存，一律剥离不持久化
 */
export function normalizeModule(rawRows: unknown, moduleIndex: number): EntryRow[] {
  if (!Array.isArray(rawRows)) {
    return []
  }
  const seenIds = new Set<number>()
  const rows: EntryRow[] = []
  rawRows.forEach((raw, slot) => {
    if (typeof raw !== 'object' || raw === null) {
      return
    }
    const source = raw as Record<string, unknown>
    let id = Number(source.id)
    if (!Number.isInteger(id)) {
      id = FALLBACK_ID_BASE + moduleIndex * 1000 + slot + 1
    }
    if (seenIds.has(id)) {
      return
    }
    seenIds.add(id)

    const row: EntryRow = { id, status: '', abnormal: source.abnormal === true }
    for (const [key, value] of Object.entries(source)) {
      if (key === 'id' || key === 'pending' || key === 'abnormal') {
        continue
      }
      if (key === 'status') {
        if (typeof value === 'string') {
          row.status = value
        }
        continue
      }
      if (isStoredField(value)) {
        row[key] = value
      }
    }
    rows.push(row)
  })
  return rows
}

type Migration = {
  id: string
  targetVersion: number
  convert: (rawRows: unknown, moduleIndex: number) => EntryRow[]
}

/** 迁移步骤表：将来结构再变，往后追加，不改老步骤。 */
export const MIGRATIONS: Migration[] = [
  { id: BASELINE_MIGRATION, targetVersion: 1, convert: normalizeModule },
]

export function isPersistedEnvelope(value: unknown): value is PersistedEnvelope {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.version === 'number' &&
    typeof candidate.modules === 'object' &&
    candidate.modules !== null
  )
}

/**
 * 把 localStorage 里解析出的 JSON 收敛成迁移输入。
 * 无版本号的旧扁平结构 { key: rows } 视为 version 0 的信封；其余形态视为空库。
 */
export function createEnvelope(parsed: unknown): PersistedEnvelope {
  if (isPersistedEnvelope(parsed)) {
    const modules: PersistedEnvelope['modules'] = {}
    for (const [key, value] of Object.entries(
      parsed.modules as Record<string, unknown>,
    )) {
      modules[key] = Array.isArray(value) ? (value as EntryRow[]) : []
    }
    return {
      version: Number.isInteger(parsed.version) ? (parsed.version as number) : 0,
      modules,
      appliedMigrations: Array.isArray(parsed.appliedMigrations)
        ? parsed.appliedMigrations.filter((item): item is string => typeof item === 'string')
        : [],
    }
  }
  const modules: PersistedEnvelope['modules'] = {}
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      modules[key] = Array.isArray(value) ? (value as EntryRow[]) : []
    }
  }
  return { version: 0, modules, appliedMigrations: [] }
}

/**
 * 执行迁移，每完成一个模块就调一次 sink 落盘。
 * 已在 appliedMigrations 里的模块步骤跳过：中断后重跑从同一个未完成模块继续。
 */
export function migrateEnvelope(
  envelope: PersistedEnvelope,
  sink: (envelope: PersistedEnvelope) => void,
): PersistedEnvelope {
  const keys = Object.keys(envelope.modules).sort()
  for (const migration of MIGRATIONS) {
    if (envelope.version >= migration.targetVersion) {
      continue
    }
    keys.forEach((key, index) => {
      const step = `${migration.id}:${key}`
      if (envelope.appliedMigrations.includes(step)) {
        return
      }
      envelope.modules[key] = migration.convert(envelope.modules[key], index)
      envelope.appliedMigrations.push(step)
      sink(envelope)
    })
    envelope.version = migration.targetVersion
    sink(envelope)
  }
  return envelope
}

/** 最后一个迁移步骤落到的版本号，即当前代码认识的结构版本。 */
export const CURRENT_VERSION = MIGRATIONS[MIGRATIONS.length - 1].targetVersion

/** 解析存储原文：空库、解析成功、损坏三种结果，由持久化层决定怎么处置。 */
export function parseStored(raw: string | null):
  | { kind: 'empty' }
  | { kind: 'parsed'; value: unknown }
  | { kind: 'corrupt'; raw: string } {
  if (raw === null) {
    return { kind: 'empty' }
  }
  try {
    return { kind: 'parsed', value: JSON.parse(raw) }
  } catch {
    return { kind: 'corrupt', raw }
  }
}
