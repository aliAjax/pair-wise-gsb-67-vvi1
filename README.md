# 光伏电站并网验收与缺陷闭环平台

基于Nuxt3、PrimeVue、Pinia、Nuxt Router、TanStack Query、ofetch、Vite和TypeScript的独立前端工程。Nuxt提供页面路由和服务端构建，业务数据在浏览器本地持久化。

## 功能

- 方阵、逆变器、汇流箱、变压器和并网点的设备树。
- 绝缘、接地、通信、保护、发电性能等验收项和证书附件。
- 建设单位、设备厂家、运维单位多方处理说明。
- 联合复验轮次、整改退回、带条件接受和关闭校验。
- 并网前完整性与证书有效期检查，签署锁定和交付包导出。
- **修订链**：签署批次冻结每个设备节点的依据版本（验收项/证书/缺陷三个版本位）并保存不可变交付快照；交付后验收项更正、证书更新、缺陷重开沿设备依赖链只使所在节点及上游失效，链外节点继续有效；负责人对失效节点逐项复核，全部恢复后从旧快照生成新修订版，原快照只读可查。
- **离线同步**：现场同步包回连后按字段三方对账（基线/本地/现场）——仅现场改快进，同字段两边都改则两版保留待裁决；同步中断按已对账字段从断点恢复，批次与 syncKey 双重幂等，重复批次不重复追加审计。
- 设备与测试页、缺陷页、签署与审计页均显示当前修订与阻断节点。

端口为`18467`。

```bash
npm install
npm run build
npm run dev
```

## 逻辑自检

修订链、依赖失效、断点恢复与审计幂等的纯逻辑验证脚本：

```bash
node_modules/.bin/esbuild scripts/verify-logic.ts --bundle --platform=node --format=esm --outfile=scripts/verify-logic.mjs
node scripts/verify-logic.mjs
```

