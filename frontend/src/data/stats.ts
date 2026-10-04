import type { EntryRow, ModuleMeta, ModuleStats, TodoItem } from './types'

// 统计口径层：概览、模块页待办都只从这里取 pending/abnormal，
// 全应用不再有第二处「数 pending」的代码。口径完全跟随模块元数据，
// 元数据增减模块或状态，统计自动变化，页面不用回头改。

/** 终态：状态表登记的最后一个状态。不在终态即视为待处理。 */
export function isPendingStatus(meta: ModuleMeta, status: string): boolean {
  return status !== meta.statuses[meta.statuses.length - 1]
}

/** 异常态：只认元数据里显式登记的 abnormalStatuses。 */
export function isAbnormalStatus(meta: ModuleMeta, status: string): boolean {
  return (meta.abnormalStatuses ?? []).includes(status)
}

/** 单模块统计。rows 缺省/非数组都按空模块处理，不向调用方抛错。 */
export function computeModuleStats(meta: ModuleMeta, rows: EntryRow[] | undefined | null): ModuleStats {
  const list = Array.isArray(rows) ? rows : []
  let pending = 0
  let abnormal = 0
  for (const row of list) {
    const status = String(row?.status ?? '')
    if (isPendingStatus(meta, status)) pending += 1
    if (isAbnormalStatus(meta, status)) abnormal += 1
  }
  return { key: meta.key, name: meta.name, created: list.length, pending, abnormal }
}

/**
 * 模块待办：与概览同一份 pending 口径，只挑未到终态的记录。
 * summary 取第一个业务字段（通常是业务编号），拿不到就回退实体名+id。
 * nextAction 取把记录推进到「下一个登记状态」的那个动作；
 * 当前状态不在状态表里时回退到第一个动作。
 */
export function listModuleTodos(
  meta: ModuleMeta,
  rows: EntryRow[] | undefined | null,
  limit?: number,
): TodoItem[] {
  const list = Array.isArray(rows) ? rows : []
  const todos: TodoItem[] = []
  for (const row of list) {
    const status = String(row?.status ?? '')
    if (!isPendingStatus(meta, status)) continue
    const summaryField = meta.fields[0]
    const summaryValue = summaryField ? row[summaryField] : ''
    const statusIndex = meta.statuses.indexOf(status)
    const nextStatus = statusIndex >= 0 ? meta.statuses[statusIndex + 1] : undefined
    const nextAction = nextStatus
      ? Object.entries(meta.actionTargets).find(([, target]) => target === nextStatus)?.[0] ?? ''
      : meta.actions[0] ?? ''
    todos.push({
      id: Number(row.id),
      status,
      summary: summaryField && summaryValue !== undefined && summaryValue !== ''
        ? String(summaryValue)
        : `${meta.entity}#${row.id}`,
      nextAction,
    })
    if (limit !== undefined && todos.length >= limit) break
  }
  return todos
}
