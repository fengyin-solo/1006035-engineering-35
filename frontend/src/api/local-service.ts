import { MODULE_BY_KEY } from '@/data/modules'
import { listRows, resetRows, saveRows } from '@/data/local-store'
import {
  allModuleStats,
  isPendingStatus,
  moduleStats as computeModuleStats,
  nextActionFor,
  pendingEntries as selectPendingEntries,
  toDerivedRow,
} from '@/data/selectors'
import type {
  ActionResult,
  DerivedEntryRow,
  EntryRow,
  ModuleMeta,
  ModuleStats,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

/** 找不到模块时返回 null，由页面决定显示空态而不是整页报错。 */
export function findModuleMeta(key: string): ModuleMeta | null {
  return MODULE_BY_KEY.get(key) ?? null
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const meta = findModuleMeta(key)
  if (!meta) {
    return { items: [], total: 0, page: 1, size: 0 }
  }
  const matched = filterRows(listRows(key), filters).map((row) => toDerivedRow(meta, row))
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const wasAbnormal = rows[index].abnormal === true
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    // 异常是负向动作产生的事实：打上后保留，不会被后续正向动作清掉。
    abnormal: wasAbnormal || NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function moduleSummary(key: string): ModuleStats | null {
  const meta = findModuleMeta(key)
  return meta ? computeModuleStats(meta) : null
}

export function pendingList(key: string): DerivedEntryRow[] {
  return selectPendingEntries(key)
}

export { isPendingStatus, nextActionFor }

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  // 只迭代模块元数据：元数据增减后统计自动变；存储缺模块由口径层记空，不报错。
  const modules = allModuleStats()
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
