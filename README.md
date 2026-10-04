# 机场地面保障作业管理平台

面向航班保障、机位分配、廊桥靠接、摆渡车调度、行李装卸、航油加注、除冰作业与延误处置的一体化机场地面保障作业工作台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 航班保障 | `flight` | 航班保障任务 | 保障编号、航班号、机型 |
| 机位分配 | `stand` | 停机位 | 机位编号、机位类型、适用机型 |
| 廊桥靠接 | `bridge` | 廊桥作业 | 作业编号、廊桥编号、对应机位 |
| 摆渡车调度 | `shuttle` | 摆渡车 | 车辆编号、核载人数、驾驶员 |
| 行李装卸 | `baggage` | 行李作业 | 作业编号、航班号、行李件数 |
| 机务勤务 | `line` | 勤务任务 | 任务编号、航班号、勤务项目 |
| 航油加注 | `fueling` | 加油作业 | 作业编号、航班号、油品规格 |
| 除冰作业 | `deice` | 除冰任务 | 任务编号、航班号、除冰液型号 |
| 地面电源 | `gpu` | 电源车 | 设备编号、设备类型、功率等级 |
| 航空器牵引 | `tow` | 牵引任务 | 任务编号、航班号、牵引车号 |
| 航空配餐 | `catering` | 配餐作业 | 作业编号、航班号、餐食数量 |
| 客舱清洁 | `cabin` | 清洁作业 | 作业编号、航班号、清洁班组 |
| 保障班组 | `team` | 保障班组 | 班组编号、班组名称、负责区域 |
| 特种车辆维保 | `vehmaint` | 维保记录 | 维保单号、车辆编号、维保类型 |
| 要客保障 | `vip` | 要客保障单 | 保障编号、航班号、要客等级 |
| 延误处置 | `delay` | 延误事件 | 事件编号、航班号、延误原因 |
| 机坪安全巡查 | `apron` | 巡查记录 | 巡查编号、巡查区域、巡查人员 |
| 保障资源调度 | `resplan` | 资源计划 | 计划编号、保障时段、机位需求 |

## 约定

- 每个模块共用一个页面 `frontend/src/views/ModulePage.vue`：路由、导航、页面字段/状态/动作
  全部由模块元数据生成。在 `frontend/src/data/modules.ts` 增删一条模块，
  路由、导航、概览统计表、待办清单自动跟着变，不用回头改页面。
- 页面只负责渲染，读写统一走 `frontend/src/api/local-service.ts`；状态流转只允许在
  `local-service.ts` 里改，页面组件不做业务判断。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`（只在首次打开或显式重置时使用，不参与统计口径）。

### 运营概览取数链路

```
modules.ts 元数据 ─→ seed.ts 种子（仅首次/重置）─→ local-store 持久化（版本信封+迁移）
                                          ─→ selectors 唯一口径（总量/待处理/异常）
                                                ├─→ loadOverview 运营概览
                                                └─→ ModuleTodos 各模块待办清单
```

- 持久化结构是带版本号的信封 `{ version, modules, appliedMigrations }`，
  旧的扁平结构 `{ key: rows }` 在加载时经 `src/data/migrations.ts` 自动升级。
- 「待处理」由元数据末态（`statuses` 最后一个）实时派生，不读行上的冗余标记；
  「异常」是负向动作打上的事实标记，迁移时缺失补 `false`、不反推。
- 缺模块按空模块统计（三项都是 0，不报错）；存储里未知模块的数据保留但不统计。
- 迁移按模块逐个落盘并登记进度，可重复执行、断点续跑，不会重复造记录或覆盖已有改动。
  损坏的存储原文会被隔离到 `airport-ground-ops:quarantine:<时间戳>`，不再回退示例数据。
- 完整的链路说明与迁移裁决依据见 `frontend/docs/data-pipeline.md`。
- 想回到初始数据：在模块页动作区调用重置（或清除 `airport-ground-ops:entries` 这一项）。

## 校验

```bash
cd frontend
npm run typecheck      # 类型检查
npm run migrate:check  # 迁移幂等/断点续跑/口径一致性（Node 内存假存储，无需浏览器）
npm run build          # 生产构建
npm run dev            # 本地开发
```

构建产物 `dist/` 只含随仓库发布的静态资源与种子常量，不含任何 localStorage 运行数据；
`.dockerignore` 也排除了本机 `node_modules`、`dist` 与本地环境文件。
