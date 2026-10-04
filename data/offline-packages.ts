import type { OfflinePackage } from '../types/domain'

/**
 * 现场离线同步包（回连后导入对账）：
 * - PACK-A：同一字段两边都改过（录波实测值、证书有效期）→ 保留两版；另有快进与“仅本地改”场景
 * - PACK-B：应用到第2条后中断，回连从断点恢复，重复批次不重复追加审计
 */
export const offlinePackages: OfflinePackage[] = [
  {
    batchId: 'OFFLINE-261004-A',
    siteName: '沙岭一期现场组（夜间复核）',
    exportedAt: '2026-10-04T11:20:00',
    basedOnRevision: 7,
    failAfter: null,
    changes: [
      {
        entity: 'defect', id: 'AD-260929-01', equipmentId: 'EQ-TR1', field: 'dueDate', fieldLabel: '整改截止',
        baseValue: '2026-09-30', remoteValue: '2026-10-06', remoteUpdatedAt: '2026-10-04T10:55:00', operator: '现场组-罗宇'
      },
      {
        entity: 'item', id: 'IT-G2', equipmentId: 'EQ-GRID', field: 'measured', fieldLabel: '实测结果',
        baseValue: '触发成功，时标偏差4ms', remoteValue: '触发成功，时标偏差18ms（夜间复测）', remoteUpdatedAt: '2026-10-04T11:02:00', operator: '现场组-罗宇'
      },
      {
        entity: 'certificate', id: 'C-G1', equipmentId: 'EQ-GRID', field: 'expiresAt', fieldLabel: '证书有效期',
        baseValue: '2027-09-20', remoteValue: '2029-09-20', remoteUpdatedAt: '2026-10-04T11:10:00', operator: '现场组-罗宇'
      }
    ]
  },
  {
    batchId: 'OFFLINE-261004-B',
    siteName: '沙岭一期现场组（雨后补测）',
    exportedAt: '2026-10-04T12:40:00',
    basedOnRevision: 7,
    failAfter: 2,
    changes: [
      {
        entity: 'item', id: 'IT-I1', equipmentId: 'EQ-INV11', field: 'measured', fieldLabel: '实测结果',
        baseValue: '126/126点一致', remoteValue: '126/126点一致（新增2个遥调点已核对）', remoteUpdatedAt: '2026-10-04T12:10:00', operator: '现场组-周敏'
      },
      {
        entity: 'item', id: 'IT-T1', equipmentId: 'EQ-TR1', field: 'measured', fieldLabel: '实测结果',
        baseValue: '高压对地 12.8GΩ', remoteValue: '高压对地 11.9GΩ（雨后复测）', remoteUpdatedAt: '2026-10-04T12:25:00', operator: '现场组-周敏'
      },
      {
        entity: 'defect', id: 'AD-260929-02', equipmentId: 'EQ-INV11', field: 'dueDate', fieldLabel: '整改截止',
        baseValue: '2026-10-02', remoteValue: '2026-10-09', remoteUpdatedAt: '2026-10-04T12:35:00', operator: '现场组-周敏'
      }
    ]
  }
]
