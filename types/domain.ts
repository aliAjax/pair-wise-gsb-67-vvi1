export type InspectionStatus = '待检查' | '合格' | '不合格' | '待复验'
export type DefectStatus = '待分派' | '整改中' | '待联合复验' | '已关闭' | '带条件通过'
export type Party = '建设单位' | '设备厂家' | '运维单位'
export type PlantStatus = '验收中' | '待复核' | '修订中' | '已签署'
/** 依据失效来源：更正沿设备依赖链向上游传播 */
export type InvalidationSource = '验收项更正' | '证书更新' | '缺陷重开' | '离线同步' | '离线冲突'
export type NodeBasisState = '有效' | '失效待复核' | '已复核待签署'

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

/** 单次失效原因；在依赖链上的每个节点各存一份，逐节点复核清除 */
export interface InvalidationReason {
  id: string
  source: InvalidationSource
  entityId: string
  label: string
  createdAt: string
  clearedAt: string | null
  reviewer: string | null
}

export interface EquipmentNode {
  id: string
  parentId: string | null
  name: string
  type: '并网点' | '变压器' | '方阵' | '逆变器' | '汇流箱'
  code: string
  status: '待验收' | '验收中' | '已验收' | '待复核'
  items: AcceptanceItem[]
  certificates: Certificate[]
  /** 最近一次签署冻结的依据版本；当前版本高于它即说明签署后发生更正 */
  itemBasis: number
  certBasis: number
  defectBasis: number
  /** 节点级滚动版本，签署时冻结到上面的依据位 */
  itemVersion: number
  certVersion: number
  defectVersion: number
  invalidations: InvalidationReason[]
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
  status: PlantStatus
  /** 当前工作修订版号 */
  version: number
  /** 本工作修订基于哪个已签署修订 */
  basedOnRevision: number | null
  revisionNote: string
  revisedAt: string | null
}

export interface AuditEntry {
  id: string
  entityId: string
  action: string
  operator: string
  detail: string
  createdAt: string
  /** 归属签署批次 */
  batchId?: string
  /** 离线同步幂等键：批次:实体:字段，重复同步不重复追加审计 */
  syncKey?: string
}

/** 签署时刻的不可变交付快照 */
export interface DeliverySnapshot {
  plant: Plant
  equipment: EquipmentNode[]
  defects: AcceptanceDefect[]
}

/** 签署批次：修订链的一环 */
export interface SignOffBatch {
  id: string
  revision: number
  basedOnRevision: number | null
  signedAt: string
  operator: string
  note: string
  /** 每个设备节点冻结的依据版本 */
  basis: Record<string, { itemBasis: number; certBasis: number; defectBasis: number }>
  snapshot: DeliverySnapshot
}

/** 现场离线同步单条字段变更 */
export interface SyncChange {
  entity: 'item' | 'certificate' | 'defect'
  id: string
  equipmentId: string
  field: string
  fieldLabel: string
  /** 离线包导出时的基线值（即已签署快照里的值） */
  baseValue: string
  remoteValue: string
  remoteUpdatedAt: string
  operator: string
}

export interface OfflinePackage {
  batchId: string
  siteName: string
  exportedAt: string
  basedOnRevision: number
  /** 演示用：应用到第几条后中断，制造断点 */
  failAfter: number | null
  changes: SyncChange[]
}

export interface SyncLedgerEntry {
  batchId: string
  status: '进行中' | '失败' | '已完成'
  startedAt: string
  finishedAt: string | null
  /** 已完成对账的字段键，断点恢复时跳过 */
  appliedKeys: string[]
  total: number
  lastError: string | null
}

export type FieldConflictStatus = '待裁决' | '已保留本地' | '已采用现场' | '已合并两版'

/** 同一字段两端都改：两版都保留，负责人裁决 */
export interface FieldConflict {
  id: string
  batchId: string
  syncKey: string
  entity: SyncChange['entity']
  entityId: string
  equipmentId: string
  field: string
  fieldLabel: string
  baseValue: string
  localValue: string
  remoteValue: string
  detectedAt: string
  status: FieldConflictStatus
  resolvedValue: string | null
  resolvedAt: string | null
  resolver: string | null
}
