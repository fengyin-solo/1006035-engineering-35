/**
 * 迁移与取数口径的 Node 校验：不依赖浏览器，用内存假存储执行。
 * 由 npm run migrate:check 经 esbuild 打包为 ESM 后用 node 直接运行。
 */
import assert from 'node:assert/strict'

import {
  BASELINE_MIGRATION,
  createEnvelope,
  migrateEnvelope,
  normalizeModule,
  parseStored,
} from '../data/migrations'
import type { PersistedEnvelope } from '../data/types'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

function runMigration(raw: unknown): PersistedEnvelope {
  return migrateEnvelope(createEnvelope(raw), () => {})
}

// 1) 旧扁平结构升级到带版本号的信封，pending 被剥离、abnormal 缺失补 false
check('旧扁平结构升级：版本号/字段规范化', () => {
  const old = {
    flight: [
      { id: 1, status: '待接收', pending: true, abnormal: false, 保障编号: 'FLIG-0001' },
      { id: 2, status: '保障完成', pending: false, 保障编号: 'FLIG-0002' },
    ],
  }
  const env = runMigration(old)
  assert.equal(env.version, 1)
  assert.deepEqual(env.appliedMigrations.sort(), ['0001-baseline:flight'].sort())
  const rows = env.modules.flight
  assert.equal(rows.length, 2)
  assert.equal('pending' in rows[0], false)
  assert.equal(rows[0].abnormal, false)
  assert.equal(rows[1].abnormal, false)
  assert.equal(rows[0].保障编号, 'FLIG-0001')
})

// 2) 缺模块元数据不影响；存储里的坏模块槽位与坏行被隔离为空/丢弃，整库不炸
check('坏模块（非数组）按空模块、坏行（非对象）丢弃', () => {
  const raw = { good: [{ id: 1, status: '在岗' }], broken: 'oops', badRows: [{ id: 1 }, 'x', null, 42] }
  const env = runMigration(raw)
  assert.deepEqual(env.modules.broken, [])
  assert.equal(env.modules.badRows.length, 1)
})

// 3) 缺 id 的行补确定性 id；重复 id 去重；重复迁移幂等不产生重复记录
check('确定性补 id、重复 id 去重', () => {
  const raw = { m: [{ status: '在岗' }, { id: 7, status: '轮休' }, { status: '培训中' }] }
  const once = normalizeModule(raw.m, 0)
  assert.deepEqual(once.map((r) => r.id), [100002, 7, 100004])
  const twice = normalizeModule(JSON.parse(JSON.stringify(once)), 0)
  assert.deepEqual(twice.map((r) => r.id), [100002, 7, 100004])

  const dup = normalizeModule([{ id: 1, status: 'a' }, { id: 1, status: 'b' }], 0)
  assert.equal(dup.length, 1)
  assert.equal(dup[0].status, 'a')
})

// 4) 迁移可重复执行：再跑一遍不新增记录、不改写已有 status/业务字段
check('整库重复迁移幂等', () => {
  const raw = { flight: [{ id: 1, status: '保障中', 保障编号: 'FLIG-1' }] }
  const first = runMigration(raw)
  const snapshot = JSON.stringify(first)
  const second = migrateEnvelope(
    JSON.parse(JSON.stringify(first)) as PersistedEnvelope,
    () => {},
  )
  assert.equal(JSON.stringify(second), snapshot)
  assert.equal(second.version, 1)
  assert.equal(second.modules.flight.length, 1)
})

// 5) 断点续跑：处理到第二个模块前中断，重试时只续跑剩余模块，已完成的不重复处理
check('中断后续跑：从同一个未完成模块接着走', () => {
  const env = createEnvelope({ a: [{ id: 1, status: 'x' }], b: [{ id: 1, status: 'y' }] })
  let firstRunFailed = false
  try {
    migrateEnvelope(env, (snapshot) => {
      // 第一个 sink 是 a 完成落盘的时刻：此刻“断电”，b 还没动
      if (!snapshot.appliedMigrations.includes(`${BASELINE_MIGRATION}:b`)) {
        throw new Error('模拟中途断电')
      }
    })
  } catch (error) {
    firstRunFailed = error instanceof Error && error.message === '模拟中途断电'
  }
  assert.equal(firstRunFailed, true)
  assert.deepEqual(env.appliedMigrations, [`${BASELINE_MIGRATION}:a`])

  // 用“磁盘上”的同一信封重试
  const resumed = migrateEnvelope(
    JSON.parse(JSON.stringify(env)) as PersistedEnvelope,
    () => {},
  )
  assert.deepEqual(resumed.appliedMigrations.sort(), [
    `${BASELINE_MIGRATION}:a`,
    `${BASELINE_MIGRATION}:b`,
  ])
  assert.equal(resumed.version, 1)
  assert.equal(resumed.modules.a.length, 1)
  assert.equal(resumed.modules.b.length, 1)
})

// 6) 存储原文解析：空、合法 JSON、损坏三种结果
check('parseStored 区分空/合法/损坏', () => {
  assert.equal(parseStored(null).kind, 'empty')
  assert.equal(parseStored('{"a":1}').kind, 'parsed')
  assert.equal(parseStored('{bad json').kind, 'corrupt')
})

// 7) 空库与非对象库都安全
check('空对象/数组/非对象都收敛为空模块集合', () => {
  assert.deepEqual(runMigration({}).modules, {})
  const fromArray = runMigration([1, 2, 3])
  assert.deepEqual(fromArray.modules, {})
})

console.log(`迁移校验通过：${passed} 项`)
