import { MODULE_BY_KEY, MODULES } from './modules'
import { allRows } from './local-store'
import type { DerivedEntryRow, EntryRow, ModuleMeta, ModuleStats } from './types'

/**
 * 取数口径层：总量 / 待处理 / 异常只在这里算一次。
 * pending 永远由「当前状态是否为元数据末态」派生，不读行上持久化的任何冗余标记。
 */

export function isPendingStatus(meta: ModuleMeta, status: string): boolean {
  return status !== meta.statuses[meta.statuses.length - 1]
}

export function toDerivedRow(meta: ModuleMeta, row: EntryRow): DerivedEntryRow {
  return { ...row, pending: isPendingStatus(meta, String(row.status)) }
}

export function moduleStats(meta: ModuleMeta): ModuleStats {
  const rows = allRows()[meta.key] ?? []
  let pending = 0
  let abnormal = 0
  for (const row of rows) {
    if (row.abnormal === true) {
      abnormal += 1
    }
    if (isPendingStatus(meta, String(row.status))) {
      pending += 1
    }
  }
  return {
    key: meta.key,
    name: meta.name,
    created: rows.length,
    pending,
    abnormal,
  }
}

/** 按元数据迭代：元数据里有、存储里没有的模块按空模块统计，未知 key 不统计。 */
export function allModuleStats(): ModuleStats[] {
  return MODULES.map(moduleStats)
}

/** 一个模块当前待办的行（与概览待处理数同源，待办清单与卡片永远相等）。 */
export function pendingEntries(key: string): DerivedEntryRow[] {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    return []
  }
  const rows = allRows()[key] ?? []
  return rows
    .filter((row) => isPendingStatus(meta, String(row.status)))
    .map((row) => toDerivedRow(meta, row))
}

/** 某条待办记录当前可执行的下一个动作（状态在 statuses 中的位置决定）。 */
export function nextActionFor(meta: ModuleMeta, status: string): string | null {
  const index = meta.statuses.indexOf(status)
  if (index < 0) {
    return meta.actions[0] ?? null
  }
  return meta.actions[index] ?? null
}
