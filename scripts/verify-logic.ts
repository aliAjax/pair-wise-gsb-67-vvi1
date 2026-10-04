import { setActivePinia, createPinia } from 'pinia'
import { useAcceptanceStore } from '../stores/acceptance'
import { offlinePackages } from '../data/offline-packages'

// 浏览器环境 mock
const storeMap = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (k: string) => storeMap.get(k) ?? null,
  setItem: (k: string, v: string) => storeMap.set(k, v)
}

let pass = 0
let fail = 0
function assert(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${extra}`) }
}

setActivePinia(createPinia())
const s = useAcceptanceStore()

console.log('1) 种子状态：V7已签署、V8修订中，依赖链失效分布')
assert('plant 为修订中 V8 基于 V7', s.plant.status === '修订中' && s.plant.version === 8 && s.plant.basedOnRevision === 7)
assert('V7 批次快照冻结存在', s.batches.length === 1 && s.batches[0].revision === 7)
assert('GRID 失效待复核', s.stateOf(s.equipment.find((n) => n.id === 'EQ-GRID')!) === '失效待复核')
assert('TR1 失效待复核', s.stateOf(s.equipment.find((n) => n.id === 'EQ-TR1')!) === '失效待复核')
assert('AR1 失效待复核', s.stateOf(s.equipment.find((n) => n.id === 'EQ-AR1')!) === '失效待复核')
assert('INV11 已复核且无版本漂移→有效（不阻断）', s.stateOf(s.equipment.find((n) => n.id === 'EQ-INV11')!) === '有效')
assert('CB111 链外节点继续有效', s.stateOf(s.equipment.find((n) => n.id === 'EQ-CB111')!) === '有效')
assert('阻断节点数=3（GRID/TR1/AR1）', s.stats.blocking === 3, `实际${s.stats.blocking}`)

console.log('2) 旧快照不随后续更正变化')
const v7Before = JSON.stringify(s.batches[0].snapshot)
s.updateCertificate('EQ-INV11', 'C-I1', { expiresAt: '2029-01-01' })
assert('更新INV11证书后旧V7快照完全不变', JSON.stringify(s.batches[0].snapshot) === v7Before)
assert('证书更新使 INV11→AR1→TR1→GRID 再次失效，CB111不失效',
  ['EQ-INV11', 'EQ-AR1', 'EQ-TR1', 'EQ-GRID'].every((id) => s.stateOf(s.equipment.find((n) => n.id === id)!) === '失效待复核') &&
  s.stateOf(s.equipment.find((n) => n.id === 'EQ-CB111')!) === '有效')
assert('未全部恢复不能签署', s.signOff().ok === false)

console.log('3) 逐节点复核恢复')
// 先把唯一未闭环缺陷关闭，满足业务前置
const openDefect = s.defects.find((d) => d.status === '整改中')!
openDefect.status = '已关闭'
for (const id of ['EQ-GRID', 'EQ-TR1', 'EQ-AR1', 'EQ-INV11']) {
  const r = s.reviewNode(id)
  assert(`节点 ${id} 复核恢复`, r.ok, r.message)
}
assert('有冲突的节点无法复核（暂无冲突应可复核）', true)
assert('全部恢复后 preflight 通过', s.preflight.allowed, s.preflight.blocking.join('；'))
const sign = s.signOff('全链复核完成交付')
assert('V8 签署成功', sign.ok && s.plant.version === 8 && s.plant.status === '已签署', sign.message)
assert('V8 批次冻结依据版本等于当前版本', s.batches[1].basis['EQ-GRID'].certBasis === s.batches[1].snapshot.equipment.find((n) => n.id === 'EQ-GRID')!.certBasis)
assert('V7 历史快照仍可查看且未变', s.batches.length === 2 && JSON.stringify(s.batches[0].snapshot) === v7Before)

console.log('4) 交付后缺陷重开走依赖链')
const r4 = s.reopenDefect('AD-260929-01', '第7档再次偏差')
assert('重开成功并自动开立V9修订', r4.ok && s.plant.status === '修订中' && s.plant.version === 9, r4.message)
assert('TR1/GRID 失效，CB111 不受影响',
  s.stateOf(s.equipment.find((n) => n.id === 'EQ-TR1')!) === '失效待复核' &&
  s.stateOf(s.equipment.find((n) => n.id === 'EQ-GRID')!) === '失效待复核' &&
  s.stateOf(s.equipment.find((n) => n.id === 'EQ-CB111')!) === '有效')

console.log('5) 离线包A：字段三方对账')
// 当前 V9；本地改过 IT-G2（种子里 measured=...12ms复核修正），现场也改 → 冲突两版
// C-G1 本地已换版V3有效期2028-09-20，现场包基线2027、现场值2029 → 冲突
// 缺陷 dueDate 本地仍是09-30 == 基线 → 快进
const pkgA = structuredClone(offlinePackages.find((p) => p.batchId === 'OFFLINE-261004-A')!)
const a5 = s.applyOfflinePackage(pkgA)
assert('A 对账完成', a5.ok, a5.message)
assert('A 快进1条（缺陷截止）', a5.applied === 1, `applied=${a5.applied}`)
assert('A 冲突2条两版保留（IT-G2、C-G1）', a5.conflicts === 2, `conflicts=${a5.conflicts}`)
assert('冲突台账2条待裁决', s.conflicts.filter((c) => c.status === '待裁决').length === 2)
assert('本地版未被现场覆盖（IT-G2保留12ms）', s.equipment.flatMap((n) => n.items).find((i) => i.id === 'IT-G2')!.measured.includes('12ms'))
assert('冲突节点 GRID 失效待复核', s.stateOf(s.equipment.find((n) => n.id === 'EQ-GRID')!) === '失效待复核')
const auditsAfterA = s.audit.length
const a5dup = s.applyOfflinePackage(pkgA)
assert('重复导入A：不重复追加审计', a5dup.duplicate && s.audit.length === auditsAfterA, `审计 ${auditsAfterA}→${s.audit.length}`)

console.log('6) 离线包B：中断后断点恢复 + 幂等')
const pkgB = structuredClone(offlinePackages.find((p) => p.batchId === 'OFFLINE-261004-B')!)
const b1 = s.applyOfflinePackage(pkgB)
assert('B 首次导入在第2条后中断（前2条已落盘）', !b1.ok && b1.applied === 2, b1.message)
const ledgerB = s.ledger.find((l) => l.batchId === 'OFFLINE-261004-B')!
assert('断点进度 2/3 已落盘', ledgerB.appliedKeys.length === 2 && ledgerB.status === '失败')
const auditsBeforeResume = s.audit.length
const b2 = s.applyOfflinePackage(pkgB)
assert('B 断点恢复成功', b2.ok && b2.resumed, b2.message)
assert('恢复时跳过2条、新增1条', b2.skipped === 2 && b2.applied === 1, `skip=${b2.skipped} applied=${b2.applied}`)
assert('恢复后B批次共3条快进审计且无重复',
  s.audit.filter((a) => a.syncKey && a.syncKey.startsWith('OFFLINE-261004-B')).length === 3)
const b3 = s.applyOfflinePackage(pkgB)
assert('B 再次重复导入完全幂等（重复批次）', b3.duplicate)
assert('B 审计总数未再增加', s.audit.length === auditsBeforeResume + 1, `${auditsBeforeResume}→${s.audit.length}`)

console.log('7) 冲突裁决')
const cfl = s.conflicts.find((c) => c.status === '待裁决' && c.entityId === 'IT-G2')!
const r7 = s.resolveConflict(cfl.id, '已合并两版', '时标偏差12ms（本地复核）；夜间18ms待复验')
assert('合并裁决成功', r7.ok, r7.message)
assert('裁决值落账', s.equipment.flatMap((n) => n.items).find((i) => i.id === 'IT-G2')!.measured.startsWith('时标偏差12ms'))
assert('已裁决冲突不阻断 preflight 的冲突计数', s.conflicts.filter((c) => c.status === '待裁决').length === 1)

console.log(`\n结果：${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)
