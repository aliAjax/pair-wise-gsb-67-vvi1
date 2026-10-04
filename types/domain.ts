export type InspectionStatus = '待检查' | '合格' | '不合格' | '待复验'
export type DefectStatus = '待分派' | '整改中' | '待联合复验' | '已关闭' | '带条件通过'
export type Party = '建设单位' | '设备厂家' | '运维单位'

export interface AcceptanceItem {
  id: string
  standard: string
  method: string
  condition: string
  status: InspectionStatus
  measured: string
  evidence: string
  version: number
}

export interface Certificate {
  id: string
  name: string
  issuer: string
  expiresAt: string
  version: number
  verified: boolean
}

export interface EquipmentNode {
  id: string
  parentId: string | null
  name: string
  type: '并网点' | '变压器' | '方阵' | '逆变器' | '汇流箱'
  code: string
  status: '待验收' | '验收中' | '已验收'
  items: AcceptanceItem[]
  certificates: Certificate[]
}

export interface PartyReply {
  party: Party
  owner: string
  content: string
  evidence: string
  repliedAt: string
}

export interface AcceptanceDefect {
  id: string
  equipmentId: string
  itemId: string
  title: string
  severity: '一般' | '重大'
  status: DefectStatus
  owner: string
  dueDate: string
  replies: PartyReply[]
  retests: Array<{ round: number; passed: boolean; result: string; tester: string; testedAt: string }>
  decisionNote: string
  version: number
}

export interface Plant {
  id: string
  name: string
  gridPoint: string
  capacity: string
  commissioningDate: string
  status: '验收中' | '待复核' | '已签署'
  version: number
}

export interface AuditEntry {
  id: string
  entityId: string
  action: string
  operator: string
  detail: string
  createdAt: string
  /** 该审计动作归属的修订号，签署后才存在 */
  revisionNo?: number
  /** 关联的签署批次或离线同步批次 */
  batchId?: string
}

/* ---------------- 修订链 ---------------- */

/** 签署时为每个设备节点冻结的依据版本（验收项/证书/缺陷） */
export interface NodeBasisVersions {
  items: Record<string, number>
  certificates: Record<string, number>
  defects: Record<string, number>
}

/** 签署批次：每一次签署/新修订生成一个批次，按 revisionNo 串成链 */
export interface SignBatch {
  id: string
  revisionNo: number
  signedAt: string
  operator: string
  snapshotId: string
  note: string
  /** 被哪个更新的修订替代 */
  supersededBy?: string
}

/** 交付快照：签署瞬间整体冻结，事后任何更正都不会回写 */
export interface DeliverySnapshot {
  id: string
  revisionNo: number
  signBatchId: string
  createdAt: string
  plant: Plant
  equipment: EquipmentNode[]
  defects: AcceptanceDefect[]
  basis: Record<string, NodeBasisVersions>
}

export type InvalidationSource = '证书更新' | '验收项更正' | '缺陷重开' | '离线对账'

/** 一次更正引起的依赖链失效记录 */
export interface InvalidationRecord {
  id: string
  sourceType: InvalidationSource
  sourceId: string
  sourceLabel: string
  originNodeId: string
  reason: string
  /** 受影响节点：源头节点及其全部上游（祖先）节点 */
  affectedNodeIds: string[]
  operator: string
  createdAt: string
}

export type NodeRevisionState = '有效' | '阻断' | '已复核'

/* ---------------- 现场离线同步 ---------------- */

export type SyncEntityType = '验收项' | '证书' | '缺陷' | '电站'

/** 离线包内的单字段对账操作 */
export interface SyncFieldOp {
  id: string
  entity: SyncEntityType
  entityId: string
  /** 验收项/证书所在设备节点；缺陷取其 equipmentId */
  nodeId?: string
  field: string
  fieldLabel: string
  /** 离线包导出时（基线修订）的字段值 */
  baseValue: string
  /** 现场离线修改后的值 */
  newValue: string
}

export interface OfflineSyncBatch {
  id: string
  siteName: string
  exportedAt: string
  /** 导包时所基于的修订号 */
  baseRevisionNo: number
  ops: SyncFieldOp[]
  /** 演示用：回连处理到中途模拟网络中断 */
  simulateFailure?: boolean
}

/** 同一字段中心与现场都改过：两版均保留，待负责人裁定 */
export interface SyncConflict {
  id: string
  batchId: string
  entity: SyncEntityType
  entityId: string
  nodeId?: string
  field: string
  fieldLabel: string
  centralValue: string
  siteValue: string
  detectedAt: string
  status: '待裁定' | '已采用中心版' | '已采用现场版'
  resolvedAt?: string
}

/** 同步断点：记录批次与下一条待处理操作下标 */
export interface SyncCursor {
  batchId: string
  nextIndex: number
  total: number
  updatedAt: string
}
