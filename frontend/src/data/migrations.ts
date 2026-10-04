import type { EntryRow, ModuleMeta } from './types'

/**
 * 版本化数据迁移框架。
 *
 * 裁决口径（依据见 README「数据口径与迁移」）：
 * - 模块元数据的状态机是唯一事实源；记录只认 id / status 两个登记项。
 * - pending / abnormal 不再入库，读取时由状态机派生。
 * - 迁移只做结构归一，绝不改业务字段、不重置用户数据。
 *
 * 持久化信封：{ version: number, rows: Record<key, EntryRow[]> }。
 * 旧版本（无 version 的裸 Record）一律视为 version 0 起步迁移。
 *
 * 断点续跑：迁移按模块推进，每处理完一个模块就同时落数据和检查点；
 * 中断后重跑从检查点之后的第一个模块继续。每个变换本身幂等
 * （去重保留首条、只补缺、删派生位），即使检查点丢了重放也安全。
 */

export type StoredEnvelope = {
  version: number
  rows: Record<string, EntryRow[]>
}

/** 迁移检查点：记录每个版本已经处理完的模块，供中断续跑。 */
export type MigrationState = {
  currentVersion: number
  doneKeysByVersion: Record<number, string[]>
}

/** 最小键值存储接口：浏览器实现是 localStorage，测试可注入内存假实现。 */
export type KVStore = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const MIGRATION_STATE_KEY = 'airport-ground-ops:migration'
export const CORRUPT_BACKUP_KEY = 'airport-ground-ops:entries-corrupt-backup'

export function isEnvelope(value: unknown): value is StoredEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as StoredEnvelope).version === 'number' &&
    typeof (value as StoredEnvelope).rows === 'object' &&
    (value as StoredEnvelope).rows !== null
  )
}

/** 读取迁移检查点；损坏或缺失时返回全新状态，不影响主流程。 */
export function readMigrationState(kv: KVStore): MigrationState {
  const empty: MigrationState = { currentVersion: 0, doneKeysByVersion: {} }
  const raw = kv.getItem(MIGRATION_STATE_KEY)
  if (!raw) return empty
  try {
    const parsed = JSON.parse(raw) as Partial<MigrationState>
    if (typeof parsed.currentVersion !== 'number') return empty
    return {
      currentVersion: parsed.currentVersion,
      doneKeysByVersion: parsed.doneKeysByVersion ?? {},
    }
  } catch {
    return empty
  }
}

export function writeMigrationState(kv: KVStore, state: MigrationState): void {
  kv.setItem(MIGRATION_STATE_KEY, JSON.stringify(state))
}

type MigrationContext = {
  kv: KVStore
  dataKey: string
  modules: ModuleMeta[]
  envelope: StoredEnvelope
  doneKeys: Set<string>
}

type Migration = {
  version: number
  /** 变换单个模块的记录，必须幂等；返回归一后的记录。 */
  transformModule: (rows: EntryRow[], meta: ModuleMeta) => EntryRow[]
  /** 元数据里没有的遗留模块也照样过一遍（只做与模块无关的通用归一）。 */
  transformOrphan?: (rows: EntryRow[]) => EntryRow[]
}

/**
 * v1：旧结构 -> 状态机口径。
 * 1) 按 id 去重（重复执行/中断重放可能留下重复记录），保留第一条；
 * 2) status 缺失或不在状态表内：补为状态表第一个状态（待处理态），
 *    不猜旧布尔位；status 已合法则原样保留（不覆盖用户改动）；
 * 3) 删除遗留的 pending / abnormal 派生位；
 * 4) 业务字段一律不动。
 */
const v1: Migration = {
  version: 1,
  transformModule(rows, meta) {
    const seen = new Set<unknown>()
    const out: EntryRow[] = []
    for (const raw of rows) {
      if (typeof raw !== 'object' || raw === null) continue
      const row = { ...raw } as EntryRow
      // 只对有 id 的记录按 id 去重，id 缺失的脏记录各自保留，不折叠。
      if (row.id !== undefined && row.id !== null && seen.has(row.id)) continue
      seen.add(row.id)
      const status = String(row.status ?? '')
      if (!meta.statuses.includes(status)) {
        row.status = meta.statuses[0]
      }
      delete (row as Record<string, unknown>).pending
      delete (row as Record<string, unknown>).abnormal
      out.push(row)
    }
    return out
  },
  transformOrphan(rows) {
    return rows
      .filter((raw) => typeof raw === 'object' && raw !== null)
      .map((raw) => {
        const row = { ...raw } as EntryRow
        if (typeof row.status !== 'string') row.status = ''
        delete (row as Record<string, unknown>).pending
        delete (row as Record<string, unknown>).abnormal
        return row
      })
  },
}

export const MIGRATIONS: Migration[] = [v1]

/** 当前代码要求的数据版本；新增迁移时在 MIGRATIONS 末尾追加即可。 */
export const CURRENT_VERSION = MIGRATIONS.reduce((max, item) => Math.max(max, item.version), 0)

function persistEnvelope(ctx: MigrationContext): void {
  ctx.kv.setItem(ctx.dataKey, JSON.stringify(ctx.envelope))
}

/**
 * 按模块执行一次迁移。每完成一个模块就落「数据 + 检查点」，
 * 任何一步之后中断，下次都能从同一个模块的下一位继续。
 */
function runOneMigration(ctx: MigrationContext, migration: Migration): void {
  const byKey = new Map(ctx.modules.map((meta) => [meta.key, meta]))
  const keys = [...new Set([...ctx.modules.map((m) => m.key), ...Object.keys(ctx.envelope.rows)])]
  for (const key of keys) {
    if (ctx.doneKeys.has(key)) continue
    const meta = byKey.get(key)
    const before = Array.isArray(ctx.envelope.rows[key]) ? ctx.envelope.rows[key] : []
    ctx.envelope.rows[key] = meta
      ? migration.transformModule(before, meta)
      : (migration.transformOrphan?.(before) ?? before)
    persistEnvelope(ctx)
    ctx.doneKeys.add(key)
    // 注意：信封版本要到全部模块处理完才提升，所以中途的检查点必须登记为
    // 「目标版本进行中」（migration.version），续跑时才能据此认出这是本版本的断点。
    const state: MigrationState = {
      currentVersion: migration.version,
      doneKeysByVersion: { [migration.version]: [...ctx.doneKeys] },
    }
    writeMigrationState(ctx.kv, state)
  }
  ctx.envelope.version = migration.version
  persistEnvelope(ctx)
  const state: MigrationState = {
    currentVersion: migration.version,
    doneKeysByVersion: { [migration.version]: [...ctx.doneKeys] },
  }
  writeMigrationState(ctx.kv, state)
}

/**
 * 迁移入口：解析旧/新两种存储形态，逐版本推进到 CURRENT_VERSION。
 * 纯函数式地操作传入的 KVStore，可重复执行：已是最新版本时直接原样返回，
 * 不写任何存储、不产生重复记录。
 */
export function runMigrations(
  kv: KVStore,
  dataKey: string,
  modules: ModuleMeta[],
): StoredEnvelope {
  const state = readMigrationState(kv)
  const raw = kv.getItem(dataKey)

  let envelope: StoredEnvelope
  if (!raw) {
    // 空存储由调用方负责首次播种；这里给出空信封即可。
    envelope = { version: 0, rows: {} }
  } else {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = null
    }
    if (isEnvelope(parsed)) {
      envelope = { version: parsed.version, rows: { ...parsed.rows } }
    } else if (typeof parsed === 'object' && parsed !== null) {
      // 旧结构：裸 Record<string, EntryRow[]>，从 version 0 起步。
      envelope = { version: 0, rows: parsed as Record<string, EntryRow[]> }
    } else {
      // 无法识别（含 JSON 损坏）：保留现场后按空库处理，绝不让整页报错。
      kv.setItem(CORRUPT_BACKUP_KEY, raw)
      envelope = { version: 0, rows: {} }
    }
  }

  // 中断现场的形态就是「信封仍为旧版本 + 检查点 currentVersion=新版本」
  //（版本号要到所有模块处理完才提升）。因此这里不按版本差清空检查点；
  // 变换本身幂等，即便检查点来自更新的版本，按 key 跳过/重放也都安全。

  for (const migration of MIGRATIONS) {
    if (envelope.version >= migration.version) continue
    // currentVersion === 本版本号 表示上一轮跑到本版本时中断，按检查点续跑；
    // 否则是全新开始一个版本，空集合起步。变换本身幂等，两边都安全。
    const resumeKeys =
      state.currentVersion === migration.version
        ? state.doneKeysByVersion[migration.version] ?? []
        : []
    const doneKeys = new Set(resumeKeys)
    runOneMigration({ kv, dataKey, modules, envelope, doneKeys }, migration)
  }
  return envelope
}
