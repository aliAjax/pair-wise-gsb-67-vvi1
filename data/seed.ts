import type { AcceptanceDefect, AuditEntry, EquipmentNode, FieldConflict, InvalidationReason, InvalidationSource, Plant, SignOffBatch, SyncLedgerEntry } from '../types/domain'

export const seedPlant: Plant = {
  id: 'PV-2609-NW', name: '西北沙岭一期 120MW光伏电站', gridPoint: '沙岭110kV升压站', capacity: '120 MWp',
  commissioningDate: '2026-10-08', status: '修订中', version: 8, basedOnRevision: 7,
  revisionNote: '并网点保护报告换版、主变档位缺陷重开，按依赖链逐项复核中', revisedAt: '2026-10-04T08:40:00'
}

/** 构建交付时刻（V7）全部合格、已闭环的设备树 */
function buildV7Equipment(): EquipmentNode[] {
  const nodes: EquipmentNode[] = [
    {
      id: 'EQ-GRID', parentId: null, name: '110kV并网点', type: '并网点', code: 'GRID-110', status: '已验收',
      items: [
        { id: 'IT-G1', standard: '保护定值与调度单一致', method: '逐项比对定值单与装置报文', condition: '并网点开关合位，通信正常', status: '合格', measured: '18/18项一致', evidence: '定值核对记录.pdf', version: 3 },
        { id: 'IT-G2', standard: '故障录波可正确触发', method: '模拟保护启动', condition: '录波装置已对时', status: '合格', measured: '触发成功，时标偏差4ms', evidence: '录波触发截图.png', version: 3 }
      ],
      certificates: [{ id: 'C-G1', name: '继电保护装置检验报告', issuer: '省电科院', expiresAt: '2027-09-20', version: 2, verified: true }],
      itemBasis: 0, certBasis: 0, defectBasis: 0, itemVersion: 3, certVersion: 2, defectVersion: 1, invalidations: []
    },
    {
      id: 'EQ-TR1', parentId: 'EQ-GRID', name: '1号主变压器', type: '变压器', code: 'TR-01', status: '已验收',
      items: [
        { id: 'IT-T1', standard: '绝缘电阻不低于出厂值70%', method: '2500V绝缘电阻表测量', condition: '绕组温度25±5℃，湿度低于80%', status: '合格', measured: '高压对地 12.8GΩ', evidence: '绝缘测试原始记录.xlsx', version: 2 },
        { id: 'IT-T2', standard: '有载调压档位与监控一致', method: '远方/就地逐档操作', condition: '变压器空载', status: '合格', measured: '17档逐档一致', evidence: '档位传动试验记录.pdf', version: 3 }
      ],
      certificates: [{ id: 'C-T1', name: '主变出厂试验报告', issuer: '特变电工', expiresAt: '2031-04-10', version: 1, verified: true }],
      itemBasis: 0, certBasis: 0, defectBasis: 0, itemVersion: 3, certVersion: 1, defectVersion: 2, invalidations: []
    },
    {
      id: 'EQ-AR1', parentId: 'EQ-TR1', name: '1号方阵', type: '方阵', code: 'ARRAY-01', status: '已验收',
      items: [{ id: 'IT-A1', standard: '接地连续性符合设计', method: '微欧计抽测30处', condition: '汇流箱断电', status: '合格', measured: '30/30处≤0.1Ω', evidence: '接地连续性测试记录.xlsx', version: 2 }],
      certificates: [],
      itemBasis: 0, certBasis: 0, defectBasis: 0, itemVersion: 2, certVersion: 1, defectVersion: 1, invalidations: []
    },
    {
      id: 'EQ-INV11', parentId: 'EQ-AR1', name: '1-1号逆变器', type: '逆变器', code: 'INV-1-1', status: '已验收',
      items: [
        { id: 'IT-I1', standard: '通信点表与SCADA一致', method: '逐点置数核对', condition: '调度数据网连通', status: '合格', measured: '126/126点一致', evidence: '点表核对记录.xlsx', version: 3 },
        { id: 'IT-I2', standard: '额定功率下转换效率不低于98.5%', method: '功率分析仪连续测量30分钟', condition: '辐照度≥700W/m²，功率稳定', status: '合格', measured: '98.62%', evidence: '效率测试曲线.csv', version: 3 }
      ],
      certificates: [{ id: 'C-I1', name: '逆变器低电压穿越证书', issuer: '中国电科院', expiresAt: '2028-06-30', version: 2, verified: true }],
      itemBasis: 0, certBasis: 0, defectBasis: 0, itemVersion: 3, certVersion: 2, defectVersion: 2, invalidations: []
    },
    {
      id: 'EQ-CB111', parentId: 'EQ-INV11', name: '1-1-1汇流箱', type: '汇流箱', code: 'CB-1-1-1', status: '已验收',
      items: [{ id: 'IT-C1', standard: '组串极性及开路电压正常', method: '逐路测量并核对设计', condition: '辐照度300-800W/m²', status: '合格', measured: '16/16路正常', evidence: '组串测试记录.xlsx', version: 2 }],
      certificates: [],
      itemBasis: 0, certBasis: 0, defectBasis: 0, itemVersion: 2, certVersion: 1, defectVersion: 1, invalidations: []
    }
  ]
  const frozen = structuredClone(nodes)
  frozen.forEach((node) => {
    node.status = '已验收'
    node.itemBasis = node.itemVersion
    node.certBasis = node.certVersion
    node.defectBasis = node.defectVersion
    node.invalidations = []
  })
  return frozen
}

function buildV7Defects(): AcceptanceDefect[] {
  return [
    {
      id: 'AD-260929-01', equipmentId: 'EQ-TR1', itemId: 'IT-T2', title: '有载调压第7档监控档位不一致', severity: '重大', status: '已关闭', owner: '设备厂家', dueDate: '2026-09-30', version: 5, decisionNote: '更换变送器并校准，17档传动全部一致，复验关闭',
      replies: [{ party: '设备厂家', owner: '王新', content: '档位变送器输出线性偏差，已更换并重新校准。', evidence: '更换记录与校准报告.pdf', repliedAt: '2026-09-29T14:20:00' }],
      retests: [{ round: 1, passed: true, result: '远方/就地17档逐档传动，监控档位全部一致', tester: '联合验收组', testedAt: '2026-10-02T10:30:00' }]
    },
    {
      id: 'AD-260929-02', equipmentId: 'EQ-INV11', itemId: 'IT-I2', title: '逆变器效率低于合同保证值', severity: '一般', status: '已关闭', owner: '设备厂家', dueDate: '2026-10-02', version: 4, decisionNote: '固件升级后复测98.62%，满足98.5%保证值',
      replies: [
        { party: '设备厂家', owner: '赵晶', content: '已更新控制固件，在相同测试条件下复测效率98.62%。', evidence: '固件版本记录与复测曲线.zip', repliedAt: '2026-09-29T16:05:00' },
        { party: '运维单位', owner: '罗宇', content: '复测条件满足，建议联合见证。', evidence: '测试条件确认单.pdf', repliedAt: '2026-09-29T16:30:00' }
      ],
      retests: [
        { round: 2, passed: true, result: '30分钟连续测量效率98.62%', tester: '联合验收组', testedAt: '2026-10-02T15:40:00' },
        { round: 1, passed: false, result: '效率98.27%，未达到98.5%', tester: '联合验收组', testedAt: '2026-09-28T17:10:00' }
      ]
    }
  ]
}

export function buildSeed(): {
  plant: Plant
  equipment: EquipmentNode[]
  defects: AcceptanceDefect[]
  audit: AuditEntry[]
  batches: SignOffBatch[]
  ledger: SyncLedgerEntry[]
  conflicts: FieldConflict[]
} {
  const v7Equipment = buildV7Equipment()
  const v7Defects = buildV7Defects()
  const v7Plant: Plant = { ...seedPlant, status: '已签署', version: 7, basedOnRevision: 6, revisionNote: '首次并网交付', revisedAt: '2026-10-03T17:20:00' }

  const batchV7: SignOffBatch = {
    id: 'SIGN-V7',
    revision: 7,
    basedOnRevision: 6,
    signedAt: '2026-10-03T17:20:00',
    operator: '陆川',
    note: '首次并网交付：全部验收项合格、证书在有效期内、缺陷全部闭环',
    basis: Object.fromEntries(v7Equipment.map((node) => [node.id, { itemBasis: node.itemBasis, certBasis: node.certBasis, defectBasis: node.defectBasis }])),
    snapshot: { plant: structuredClone(v7Plant), equipment: structuredClone(v7Equipment), defects: structuredClone(v7Defects) }
  }

  // 工作修订 V8：从 V7 快照复制后更正
  const equipment = structuredClone(v7Equipment)
  const defects = structuredClone(v7Defects)
  const now = '2026-10-04T08:40:00'
  const makeReason = (id: string, source: InvalidationSource, entityId: string, label: string, createdAt: string, cleared: boolean): InvalidationReason =>
    ({ id, source, entityId, label, createdAt, clearedAt: cleared ? '2026-10-04T10:05:00' : null, reviewer: cleared ? '陆川' : null })

  // 1) 证书更新：C-G1 换版（V2→V3），GRID 及其全部上游失效
  const grid = equipment.find((node) => node.id === 'EQ-GRID')!
  grid.certificates = [{ id: 'C-G1', name: '继电保护装置检验报告', issuer: '省电科院', expiresAt: '2028-09-20', version: 3, verified: true }]
  grid.certVersion = 3
  grid.invalidations.push(makeReason('IV-CERT-GRID', '证书更新', 'C-G1', '继电保护装置检验报告换版V3（有效期延至2028-09-20）', '2026-10-04T08:40:00', false))
  equipment.find((node) => node.id === 'EQ-TR1')!.invalidations.push(makeReason('IV-CERT-TR1', '证书更新', 'C-G1', '上游并网点保护报告换版', '2026-10-04T08:40:00', false))
  equipment.find((node) => node.id === 'EQ-AR1')!.invalidations.push(makeReason('IV-CERT-AR1', '证书更新', 'C-G1', '上游并网点保护报告换版', '2026-10-04T08:40:00', false))
  const inv11 = equipment.find((node) => node.id === 'EQ-INV11')!
  inv11.invalidations.push(makeReason('IV-CERT-INV11', '证书更新', 'C-G1', '上游并网点保护报告换版', '2026-10-04T08:40:00', true))
  // 2) 缺陷重开：AD-260929-01 主变档位（同链，不再额外增加 INV11/CB，缺陷不挂在它们上）
  const defect01 = defects.find((item) => item.id === 'AD-260929-01')!
  defect01.status = '整改中'
  defect01.version = 6
  defect01.decisionNote = ''
  defect01.replies.unshift({ party: '运维单位', owner: '罗宇', content: '送电后第7档再次出现档位偏差，申请重开缺陷。', evidence: '送电后台账截图.png', repliedAt: '2026-10-04T09:10:00' })
  equipment.find((node) => node.id === 'EQ-GRID')!.invalidations.push(makeReason('IV-DEF-GRID', '缺陷重开', 'AD-260929-01', '重大缺陷「有载调压档位不一致」重开', '2026-10-04T09:12:00', false))
  equipment.find((node) => node.id === 'EQ-TR1')!.invalidations.push(makeReason('IV-DEF-TR1', '缺陷重开', 'AD-260929-01', '本节点重大缺陷重开', '2026-10-04T09:12:00', false))
  equipment.find((node) => node.id === 'EQ-AR1')!.invalidations.push(makeReason('IV-DEF-AR1', '缺陷重开', 'AD-260929-01', '下游主变重大缺陷重开', '2026-10-04T09:12:00', false))
  inv11.invalidations.push(makeReason('IV-DEF-INV11', '缺陷重开', 'AD-260929-01', '下游主变重大缺陷重开', '2026-10-04T09:12:00', true))
  // 3) 验收项更正：并网点录波时标重新录入（V3→V4）
  const g2 = grid.items.find((item) => item.id === 'IT-G2')!
  g2.measured = '触发成功，时标偏差12ms（复核修正）'
  g2.evidence = '录波触发截图_复核版.png'
  g2.version = 4
  grid.itemVersion = 4
  grid.invalidations.push(makeReason('IV-ITEM-GRID', '验收项更正', 'IT-G2', '故障录波实测结果与证据更正', '2026-10-04T09:40:00', false))
  // INV11 已由负责人复核（证书+缺陷两条均恢复）；其他链上节点仍阻断
  inv11.status = '已验收'
  inv11.invalidations = inv11.invalidations.map((reason) => ({ ...reason, clearedAt: '2026-10-04T10:05:00', reviewer: '陆川' }))
  // 失效节点状态
  for (const id of ['EQ-GRID', 'EQ-TR1', 'EQ-AR1']) {
    const node = equipment.find((item) => item.id === id)!
    node.status = '待复核'
  }

  const audit: AuditEntry[] = [
    { id: 'A-V8-ITEM', entityId: 'IT-G2', action: '验收项更正', operator: '现场测试组', detail: 'V7交付后复核修正录波时标为12ms，依据版本V3→V4，沿依赖链标记并网点失效', createdAt: '2026-10-04T09:40:00', batchId: 'SIGN-V7' },
    { id: 'A-V8-DEF', entityId: 'AD-260929-01', action: '缺陷重开', operator: '罗宇', detail: '送电后第7档档位偏差复现，AD-260929-01重开，EQ-TR1及上游节点失效', createdAt: '2026-10-04T09:12:00', batchId: 'SIGN-V7' },
    { id: 'A-V8-CERT', entityId: 'C-G1', action: '证书更新', operator: '建设单位', detail: '继电保护装置检验报告换版V3，仅依赖链 EQ-GRID→TR1→AR1→INV11 失效，EQ-CB111保持有效', createdAt: '2026-10-04T08:40:00', batchId: 'SIGN-V7' },
    { id: 'A-V8-REV', entityId: 'EQ-INV11', action: '节点复核恢复', operator: '陆川', detail: '逆变器节点失效依据逐项复核通过，恢复为已复核待签署', createdAt: '2026-10-04T10:05:00', batchId: 'SIGN-V7' },
    { id: 'A-V8-OPEN', entityId: 'PV-2609-NW', action: '开立修订', operator: '陆川', detail: '基于V7交付快照生成工作修订V8，V7快照冻结不变', createdAt: '2026-10-04T08:35:00', batchId: 'SIGN-V7' },
    { id: 'A-V7-SIGN', entityId: 'PV-2609-NW', action: '签署交付版本', operator: '陆川', detail: '锁定V7并生成交付包：5节点/8项验收项/3份证书/2项缺陷', createdAt: '2026-10-03T17:20:00', batchId: 'SIGN-V7' },
    { id: 'A-1', entityId: 'PV-2609-NW', action: '创建验收计划', operator: '陆川', detail: '建立5类设备树与验收要求', createdAt: '2026-09-25T08:30:00' }
  ]

  return { plant: seedPlant, equipment, defects, audit, batches: [batchV7], ledger: [], conflicts: [] }
}
