/**
 * 取数链路端到端校验：用内存假 localStorage 驱动 local-store → selectors → local-service。
 * 覆盖：旧数据稳定重建、缺模块记空不报错、动作流转后概览与模块待办同源相等、
 * 重复执行不产生重复记录、损坏原文隔离后不回退示例数据、首次播种总量。
 */
import assert from 'node:assert/strict'

import {
  listEntries,
  loadOverview,
  moduleMeta,
  moduleSummary,
  nextActionFor,
  pendingList,
  runAction,
} from '../api/local-service'
import { __resetCacheForTests, allRows, listRows, storageKey } from '../data/local-store'

const STORAGE_KEY = storageKey()

class MemoryStorage {
  readonly map: Map<string, string>

  constructor(initial: Record<string, string> = {}) {
    this.map = new Map(Object.entries(initial))
  }

  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
}

const memoryStorages: MemoryStorage[] = []

function useStorage(initial: Record<string, string> = {}): MemoryStorage {
  const storage = new MemoryStorage(initial)
  memoryStorages.push(storage)
  ;(globalThis as { window?: unknown }).window = {
    localStorage: storage,
    addEventListener: () => {},
  }
  __resetCacheForTests()
  return storage
}

let passed = 0
async function check(name: string, fn: () => void): Promise<void> {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

await check('旧结构重建：pending 以元数据末态为准，不看旧标记', () => {
  useStorage({
    [STORAGE_KEY]: JSON.stringify({
      flight: [
        { id: 1, status: '待接收', pending: false, abnormal: false }, // 旧标记说“不待处理”
        { id: 2, status: '保障完成', pending: true, abnormal: true }, // 旧标记说“待处理”
        { id: 3, status: '已终止', abnormal: false },
      ],
    }),
  })
  const stats = moduleSummary('flight')
  assert.ok(stats)
  assert.deepEqual(
    { created: stats.created, pending: stats.pending, abnormal: stats.abnormal },
    { created: 3, pending: 2, abnormal: 1 },
  )
  assert.equal('pending' in listRows('flight')[0], false)
})

await check('缺模块记 0 不报错，未知模块不统计', () => {
  useStorage({ [STORAGE_KEY]: JSON.stringify({ ghost_module: [{ id: 1, status: 'x' }] }) })
  const overview = loadOverview()
  assert.equal(overview.modules.length, 18)
  const flight = overview.modules.find((m) => m.key === 'flight')
  assert.ok(flight)
  assert.deepEqual([flight.created, flight.pending, flight.abnormal], [0, 0, 0])
  assert.equal(overview.cards.find((c) => c.label === '登记总量')?.value, 0)
})

await check('动作流转后：概览待处理与模块待办清单严格相等', () => {
  useStorage()
  const meta = moduleMeta('flight')
  const before = moduleSummary('flight')?.pending ?? 0
  assert.equal(before, pendingList('flight').length)

  // 种子三条分别停在前三个状态；元数据末态是「已终止」，只有推进到末态待处理才减一。
  const penultimate = meta.statuses[meta.statuses.length - 2]
  const target = pendingList('flight').find((row) => String(row.status) === penultimate)
  assert.ok(target)
  const action = nextActionFor(meta, penultimate)
  assert.ok(action)
  const result = runAction('flight', target.id, action)
  assert.equal(result.ok, true)
  assert.equal(moduleSummary('flight')?.pending, before - 1)

  // 再往前推进一个非末态：仍是待处理，两处读数相等且数量不变
  const first = pendingList('flight')[0]
  const next = nextActionFor(meta, String(first.status))
  assert.ok(next)
  runAction('flight', first.id, next)
  assert.equal(moduleSummary('flight')?.pending, pendingList('flight').length)
})

await check('重复加载与重复动作不产生重复记录', () => {
  const storage = useStorage()
  const count = listRows('stand').length
  listEntries('stand')
  const row = pendingList('stand')[0]
  const action = nextActionFor(moduleMeta('stand'), String(row.status))
  assert.ok(action)
  runAction('stand', row.id, action)
  const repeat = runAction('stand', row.id, action)
  assert.equal(repeat.ok, false)
  assert.equal(listRows('stand').length, count)

  const onDisk = JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}') as {
    version: number
    appliedMigrations: unknown
  }
  assert.equal(onDisk.version, 1)
  assert.ok(Array.isArray(onDisk.appliedMigrations))
})

await check('损坏原文隔离备份，不回退示例数据', () => {
  useStorage({ [STORAGE_KEY]: '{broken' })
  assert.equal(allRows().flight, undefined)
  assert.equal(loadOverview().cards.find((c) => c.label === '登记总量')?.value, 0)
  const current = memoryStorages[memoryStorages.length - 1]
  const quarantined = [...current.map.keys()].filter((k) =>
    k.startsWith('airport-ground-ops:quarantine:'),
  )
  assert.equal(quarantined.length, 1)
})

await check('首次打开播种，概览总量等于种子行数', () => {
  useStorage()
  const overview = loadOverview()
  assert.equal(overview.cards.find((c) => c.label === '登记总量')?.value, 18 * 3)
  assert.ok(overview.modules.every((m) => m.created === 3))
})

console.log(`链路校验通过：${passed} 项`)
