import { computed, ref, toRaw } from 'vue'
import { defineStore } from 'pinia'
import { seedAudit, seedDefects, seedEquipment, seedPlant } from '../data/seed'
import type {
  AcceptanceDefect, AcceptanceItem, AuditEntry, Certificate, DeliverySnapshot,
  EquipmentNode, InvalidationRecord, InvalidationSource, NodeBasisVersions,
  NodeRevisionState, OfflineSyncBatch, PartyReply, Plant, SignBatch, SyncConflict, SyncCursor, SyncFieldOp
} from '../types/domain'

const STORAGE_KEY = 'gsb67:grid-acceptance'
let idSeed = 30

function nextId(prefix: string) {
  idSeed += 1
  return `${prefix}-${Date.now()}-${idSeed}`
}

export const useAcceptanceStore = defineStore('acceptance', () => {
  const plant = ref<Plant>(structuredClone(seedPlant))
  const equipment = ref<EquipmentNode[]>(structuredClone(seedEquipment))
  const defects = ref<AcceptanceDefect[]>(structuredClone(seedDefects))
  const audit = ref<AuditEntry[]>(structuredClone(seedAudit))

  // 修订链
  const signBatches = ref<SignBatch[]>([])
  const snapshots = ref<DeliverySnapshot[]>([])
  const invalidations = ref<InvalidationRecord[]>([])
  const nodeReviews = ref<Record<string, { reviewedAt: string; operator: string; note: string }>>({})

  // 现场离线同步
  const conflicts = ref<SyncConflict[]>([])
  const syncCursor = ref<SyncCursor | null>(null)
  const syncedBatchIds = ref<string[]>([])

  const selectedEquipmentId = ref(equipment.value[0].id)
  const keyword = ref('')
  const hydrated = ref(false)
  /** 正在查看的历史修订号；null 表示查看当前工作区 */
  const viewingRevisionNo = ref<number | null>(null)

  /* ---------------- 基础查询 ---------------- */

  const selectedEquipment = computed(() => equipment.value.find((item) => item.id === selectedEquipmentId.value))
  const stats = computed(() => {
    const items = equipment.value.flatMap((item) => item.items)
    return {
      total: items.length,
      passed: items.filter((item) => item.status === '合格').length,
      failed: items.filter((item) => item.status === '不合格' || item.status === '待复验').length,
      openDefects: defects.value.filter((item) => !['已关闭', '带条件通过'].includes(item.status)).length
    }
  })

  const latestSignedBatch = computed(() =>
    signBatches.value.filter((batch) => !batch.supersededBy).sort((a, b) => b.revisionNo - a.revisionNo)[0] ?? null
  )
  const currentSnapshot = computed(() =>
    latestSignedBatch.value ? snapshots.value.find((snapshot) => snapshot.id === latestSignedBatch.value!.snapshotId) ?? null : null
  )
  const currentRevisionNo = computed(() => latestSignedBatch.value?.revisionNo ?? 0)
  const isDelivered = computed(() => currentRevisionNo.value > 0)
  const isViewing = computed(() => viewingRevisionNo.value !== null)
  const viewSnapshot = computed(() =>
    viewingRevisionNo.value === null ? null : snapshots.value.find((snapshot) => snapshot.revisionNo === viewingRevisionNo.value) ?? null
  )
  /** 页面统一通过这三个 getter 取数：查看旧快照时自动切到冻结数据 */
  const activePlant = computed<Plant>(() => viewSnapshot.value?.plant ?? plant.value)
  const activeEquipment = computed<EquipmentNode[]>(() => viewSnapshot.value?.equipment ?? equipment.value)
  const activeDefects = computed<AcceptanceDefect[]>(() => viewSnapshot.value?.defects ?? defects.value)

  function nodeName(nodeId: string) {
    return equipment.value.find((node) => node.id === nodeId)?.name
      ?? currentSnapshot.value?.equipment.find((node) => node.id === nodeId)?.name
      ?? nodeId
  }

  /** 依赖链：节点本身 + 全部上游（祖先）。下游子节点不在链上，继续有效。 */
  function upstreamChain(nodeId: string): string[] {
    const chain: string[] = []
    let current = equipment.value.find((node) => node.id === nodeId)
    while (current) {
      chain.push(current.id)
      current = current.parentId ? equipment.value.find((node) => node.id === current!.parentId) : undefined
    }
    return chain
  }

  /** 当前修订下，本次修订以来仍未恢复的失效所涉及的节点集合 */
  const invalidatedNodeIds = computed(() => new Set(invalidations.value.flatMap((record) => record.affectedNodeIds)))

  const nodeStates = computed<Record<string, NodeRevisionState>>(() => {
    const map: Record<string, NodeRevisionState> = {}
    for (const node of equipment.value) {
      if (!isDelivered.value) { map[node.id] = '有效'; continue }
      if (!invalidatedNodeIds.value.has(node.id)) { map[node.id] = '有效'; continue }
      map[node.id] = nodeReviews.value[node.id] ? '已复核' : '阻断'
    }
    return map
  })

  const blockingNodes = computed(() =>
    equipment.value.filter((node) => nodeStates.value[node.id] === '阻断')
  )
  const reviewedNodes = computed(() =>
    equipment.value.filter((node) => nodeStates.value[node.id] === '已复核')
  )
  const unresolvedConflicts = computed(() => conflicts.value.filter((item) => item.status === '待裁定'))

  const preflight = computed(() => {
    const blocking: string[] = []
    const items = equipment.value.flatMap((item) => item.items)
    if (items.some((item) => item.status === '待检查')) blocking.push('仍有验收项未检查')
    if (items.some((item) => item.status === '不合格' || item.status === '待复验')) blocking.push('存在不合格或待复验项')
    if (defects.value.some((item) => !['已关闭', '带条件通过'].includes(item.status))) blocking.push('存在未闭环缺陷')
    if (equipment.value.flatMap((item) => item.certificates).some((item) => !item.verified)) blocking.push('存在未核验证书')
    const expired = equipment.value.flatMap((item) => item.certificates).some((item) => item.expiresAt < plant.value.commissioningDate)
    if (expired) blocking.push('证书在并网日期前失效')
    if (unresolvedConflicts.value.length) blocking.push(`存在${unresolvedConflicts.value.length}个离线对账待裁定字段`)
    return { allowed: blocking.length === 0, blocking }
  })

  /** 已交付且存在失效链时，全部阻断节点复核完即可生成新修订 */
  const revisionReady = computed(() =>
    isDelivered.value && invalidations.value.length > 0 && blockingNodes.value.length === 0 && preflight.value.allowed
  )

  /* ---------------- 持久化 ---------------- */

  function hydrate() {
    if (!import.meta.client || hydrated.value) return
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const stored = JSON.parse(raw)
        plant.value = stored.plant
        equipment.value = stored.equipment
        defects.value = stored.defects
        audit.value = stored.audit
        signBatches.value = stored.signBatches ?? []
        snapshots.value = stored.snapshots ?? []
        invalidations.value = stored.invalidations ?? []
        nodeReviews.value = stored.nodeReviews ?? {}
        conflicts.value = stored.conflicts ?? []
        syncCursor.value = stored.syncCursor ?? null
        syncedBatchIds.value = stored.syncedBatchIds ?? []
      }
    } catch {
      // Seed data is kept when browser storage is corrupt.
    }
    hydrated.value = true
  }

  function persist() {
    if (!import.meta.client) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      plant: plant.value, equipment: equipment.value, defects: defects.value, audit: audit.value,
      signBatches: signBatches.value, snapshots: snapshots.value, invalidations: invalidations.value,
      nodeReviews: nodeReviews.value, conflicts: conflicts.value, syncCursor: syncCursor.value, syncedBatchIds: syncedBatchIds.value
    }))
  }

  /* ---------------- 审计 ---------------- */

  function log(entityId: string, action: string, operator: string, detail: string, extra?: { revisionNo?: number; batchId?: string }) {
    audit.value.unshift({
      id: nextId('AUD'), entityId, action, operator, detail, createdAt: new Date().toISOString(),
      revisionNo: extra?.revisionNo, batchId: extra?.batchId
    })
  }

  /* ---------------- 修订链内核 ---------------- */

  function freezeBasis(): Record<string, NodeBasisVersions> {
    const basis: Record<string, NodeBasisVersions> = {}
    for (const node of equipment.value) {
      basis[node.id] = {
        items: Object.fromEntries(node.items.map((item) => [item.id, item.version])),
        certificates: Object.fromEntries(node.certificates.map((cert) => [cert.id, cert.version])),
        defects: Object.fromEntries(
          defects.value.filter((defect) => defect.equipmentId === node.id).map((defect) => [defect.id, defect.version])
        )
      }
    }
    return basis
  }

  /** 冻结快照并生成签署批次；修订号沿链递增 */
  function freezeRevision(operator: string, note: string): SignBatch {
    const revisionNo = signBatches.value.length + 1
    const batchId = `SIGN-R${revisionNo}`
    const snapshot: DeliverySnapshot = {
      id: `SNAP-R${revisionNo}`,
      revisionNo,
      signBatchId: batchId,
      createdAt: new Date().toISOString(),
      plant: structuredClone(toRaw(plant.value)),
      equipment: structuredClone(toRaw(equipment.value)),
      defects: structuredClone(toRaw(defects.value)),
      basis: freezeBasis()
    }
    const batch: SignBatch = { id: batchId, revisionNo, signedAt: snapshot.createdAt, operator, snapshotId: snapshot.id, note }
    snapshots.value.push(snapshot)
    signBatches.value.push(batch)
    return batch
  }

  /**
   * 更正沿依赖链传播失效：只让源头节点及其上游失效，
   * 同节点多来源更正合并为一份复核工作项；已复核节点被再次波及则打回。
   */
  function invalidateChain(sourceType: InvalidationSource, sourceId: string, sourceLabel: string, originNodeId: string, reason: string, operator: string) {
    if (!isDelivered.value) return
    const affected = upstreamChain(originNodeId)
    invalidations.value.unshift({
      id: nextId('INV'), sourceType, sourceId, sourceLabel, originNodeId, reason,
      affectedNodeIds: affected, operator, createdAt: new Date().toISOString()
    })
    for (const nodeId of affected) {
      delete nodeReviews.value[nodeId]
      const node = equipment.value.find((item) => item.id === nodeId)
      if (node && node.status === '已验收') node.status = '验收中'
    }
    plant.value.status = '待复核'
    const chainText = affected.map((id) => nodeName(id)).join(' → ')
    log(originNodeId, `失效传播：${sourceType}`, operator, `${sourceLabel}：${reason}；失效链 ${chainText}`, { revisionNo: currentRevisionNo.value })
  }

  function signOff() {
    if (isDelivered.value) return { ok: false, message: '当前修订已签署；更正恢复后请生成新修订版' }
    if (!preflight.value.allowed) return { ok: false, message: preflight.value.blocking.join('；') }
    plant.value.status = '已签署'
    plant.value.version += 1
    equipment.value.forEach((node) => { node.status = '已验收' })
    const batch = freezeRevision('验收负责人陆川', '首次并网交付签署')
    log(plant.value.id, '签署交付版本', '验收负责人陆川', `签署批次${batch.id}，冻结全部设备节点依据版本并生成交付包`, { revisionNo: batch.revisionNo, batchId: batch.id })
    persist()
    return { ok: true, message: `签署完成，修订R${batch.revisionNo}已冻结，旧工作区转为不可变快照` }
  }

  /** 全部阻断节点逐项复核恢复后，从旧快照生成新修订版；旧快照保留可查看 */
  function createRevision() {
    if (!isDelivered.value) return { ok: false, message: '尚未完成首次签署' }
    if (!invalidations.value.length) return { ok: false, message: '当前没有需要修订的失效更正' }
    if (blockingNodes.value.length) return { ok: false, message: `仍有${blockingNodes.value.length}个阻断节点未复核` }
    if (!preflight.value.allowed) return { ok: false, message: preflight.value.blocking.join('；') }
    const oldBatch = latestSignedBatch.value!
    oldBatch.supersededBy = `SIGN-R${oldBatch.revisionNo + 1}`
    plant.value.status = '已签署'
    plant.value.version += 1
    equipment.value.forEach((node) => { node.status = '已验收' })
    const batch = freezeRevision('验收负责人陆川', `由R${oldBatch.revisionNo}修订生成，恢复${invalidations.value.length}项交付后更正`)
    invalidations.value = []
    nodeReviews.value = {}
    viewingRevisionNo.value = null
    log(plant.value.id, '生成新修订版', '验收负责人陆川', `基于${oldBatch.id}生成${batch.id}，旧快照保留可查`, { revisionNo: batch.revisionNo, batchId: batch.id })
    persist()
    return { ok: true, message: `${batch.id} 已签署，${oldBatch.id} 快照仍可查看` }
  }

  /* ---------------- 交付后更正入口 ---------------- */

  function updateItem(equipmentId: string, itemId: string, patch: Partial<AcceptanceItem>) {
    const node = equipment.value.find((item) => item.id === equipmentId)
    const item = node?.items.find((value) => value.id === itemId)
    if (!node || !item) return
    const before = `${item.status}/${item.measured}`
    Object.assign(item, patch, { version: item.version + 1 })
    log(equipmentId, '更新验收项', '当前用户', `${item.id}：${before} → ${item.status}/${item.measured}`)
    invalidateChain('验收项更正', item.id, `验收项 ${item.standard}`, node.id, `依据版本V${item.version - 1}更正为V${item.version}`, '当前用户')
    persist()
  }

  function updateCertificate(equipmentId: string, certificateId: string, patch: Partial<Certificate>) {
    const node = equipment.value.find((item) => item.id === equipmentId)
    const certificate = node?.certificates.find((value) => value.id === certificateId)
    if (!node || !certificate) return { ok: false, message: '证书不存在' }
    Object.assign(certificate, patch, { version: certificate.version + 1 })
    log(equipmentId, '更新证书', '当前用户', `${certificate.name} 升级至V${certificate.version}`)
    invalidateChain('证书更新', certificate.id, `证书 ${certificate.name}`, node.id, `证书V${certificate.version - 1}被V${certificate.version}替代，依赖它的上游节点失效`, '当前用户')
    persist()
    return { ok: true, message: '证书已更新，依赖链上游节点已失效' }
  }

  /** 已关闭/带条件通过的缺陷交付后重开：沿设备依赖链失效 */
  function reopenDefect(id: string, note: string) {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return { ok: false, message: '缺陷不存在' }
    if (!['已关闭', '带条件通过'].includes(defect.status)) return { ok: false, message: '仅已闭环缺陷需要重开' }
    if (!note.trim()) return { ok: false, message: '请填写重开原因' }
    defect.status = '整改中'
    defect.decisionNote = note
    defect.version += 1
    log(id, '缺陷重开', '验收负责人', note)
    invalidateChain('缺陷重开', defect.id, `缺陷 ${defect.title}`, defect.equipmentId, note, '验收负责人')
    persist()
    return { ok: true, message: '缺陷已重开，关联节点及上游已失效' }
  }

  /** 负责人对单个阻断节点逐项复核并恢复有效 */
  function reviewNode(nodeId: string, note: string) {
    if (nodeStates.value[nodeId] !== '阻断') return { ok: false, message: '该节点当前不是阻断状态' }
    nodeReviews.value[nodeId] = { reviewedAt: new Date().toISOString(), operator: '陆川', note }
    log(nodeId, '复核恢复节点', '验收负责人陆川', note || '逐项核对依据版本后恢复有效', { revisionNo: currentRevisionNo.value })
    if (blockingNodes.value.length === 0) plant.value.status = '已签署'
    persist()
    return { ok: true, message: '节点已复核恢复，可生成新修订版' }
  }

  /** 签署快照依据 vs 当前工作区版本的逐项差异（复核对话框用） */
  function basisDiffs(nodeId: string) {
    const snapshot = currentSnapshot.value
    if (!snapshot) return []
    const frozen = snapshot.basis[nodeId] ?? { items: {}, certificates: {}, defects: {} }
    const node = equipment.value.find((item) => item.id === nodeId)
    const diffs: Array<{ kind: string; label: string; frozen: string; current: string }> = []
    for (const item of node?.items ?? []) {
      const frozenVersion = frozen.items[item.id]
      if (frozenVersion !== undefined && frozenVersion !== item.version) {
        diffs.push({ kind: '验收项', label: item.standard, frozen: `V${frozenVersion} · ${item.status}`, current: `V${item.version} · ${item.status}` })
      }
    }
    for (const cert of node?.certificates ?? []) {
      const frozenVersion = frozen.certificates[cert.id]
      if (frozenVersion !== undefined && frozenVersion !== cert.version) {
        diffs.push({ kind: '证书', label: cert.name, frozen: `V${frozenVersion}`, current: `V${cert.version}` })
      }
    }
    for (const defect of defects.value.filter((item) => item.equipmentId === nodeId)) {
      const frozenVersion = frozen.defects[defect.id]
      if (frozenVersion !== undefined && frozenVersion !== defect.version) {
        diffs.push({ kind: '缺陷', label: defect.title, frozen: `V${frozenVersion}`, current: `V${defect.version} · ${defect.status}` })
      }
    }
    return diffs
  }

  function invalidationsOf(nodeId: string) {
    return invalidations.value.filter((record) => record.affectedNodeIds.includes(nodeId))
  }

  /* ---------------- 缺陷既有处置流程 ---------------- */

  function assignDefect(id: string, owner: string) {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return
    defect.owner = owner
    defect.status = '整改中'
    defect.version += 1
    log(id, '分派缺陷', '验收负责人', `责任方调整为${owner}`)
    persist()
  }

  function addReply(id: string, reply: PartyReply) {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect || !reply.content || !reply.evidence) return { ok: false, message: '回复内容和证据均不能为空' }
    defect.replies.unshift(reply)
    defect.status = '待联合复验'
    defect.version += 1
    log(id, `${reply.party}提交处理说明`, reply.owner, reply.content)
    persist()
    return { ok: true, message: '已提交处理说明并进入联合复验' }
  }

  function addRetest(id: string, result: string, passed: boolean) {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return
    defect.retests.unshift({ round: defect.retests.length + 1, passed, result, tester: '联合验收组', testedAt: new Date().toISOString() })
    defect.status = passed ? '已关闭' : '整改中'
    defect.version += 1
    log(id, '执行联合复验', '联合验收组', result)
    persist()
  }

  function decideDefect(id: string, status: '已关闭' | '带条件通过' | '整改中', note: string) {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return { ok: false, message: '缺陷不存在' }
    if (status === '已关闭' && !defect.retests.some((item) => item.passed)) return { ok: false, message: '没有合格复验记录，不能关闭' }
    if (status === '带条件通过' && !note.trim()) return { ok: false, message: '带条件通过必须说明限制条件' }
    defect.status = status
    defect.decisionNote = note
    defect.version += 1
    log(id, `验收决定：${status}`, '验收负责人', note || '完成整改闭环')
    persist()
    return { ok: true, message: `缺陷已更新为${status}` }
  }

  /* ---------------- 现场离线同步：字段对账 / 断点 / 幂等 ---------------- */

  type Located = { kind: 'item'; node: EquipmentNode; target: AcceptanceItem }
    | { kind: 'certificate'; node: EquipmentNode; target: Certificate }
    | { kind: 'defect'; node?: EquipmentNode; target: AcceptanceDefect }
    | { kind: 'plant'; node?: never; target: Plant }

  function locateOp(op: SyncFieldOp): Located | null {
    if (op.entity === '电站') return { kind: 'plant', target: plant.value }
    if (op.entity === '缺陷') {
      const target = defects.value.find((defect) => defect.id === op.entityId)
      if (!target) return null
      const node = equipment.value.find((item) => item.id === (op.nodeId ?? target.equipmentId))
      return { kind: 'defect', node, target }
    }
    const node = op.nodeId ? equipment.value.find((item) => item.id === op.nodeId) : undefined
    if (!node) {
      for (const candidate of equipment.value) {
        if (op.entity === '验收项' && candidate.items.some((item) => item.id === op.entityId)) {
          return { kind: 'item', node: candidate, target: candidate.items.find((item) => item.id === op.entityId)! }
        }
        if (op.entity === '证书' && candidate.certificates.some((item) => item.id === op.entityId)) {
          return { kind: 'certificate', node: candidate, target: candidate.certificates.find((item) => item.id === op.entityId)! }
        }
      }
      return null
    }
    if (op.entity === '验收项') {
      const target = node.items.find((item) => item.id === op.entityId)
      return target ? { kind: 'item', node, target } : null
    }
    const target = node.certificates.find((item) => item.id === op.entityId)
    return target ? { kind: 'certificate', node, target } : null
  }

  /** 应用现场值；属于交付后更正的，按同一条依赖链失效 */
  function applySiteValue(op: SyncFieldOp, located: Located, batchId: string) {
    const labelPrefix = `${op.entity} ${op.entityId} 字段「${op.fieldLabel}」`
    if (located.kind === 'plant') {
      ;(located.target as unknown as Record<string, unknown>)[op.field] = op.newValue
      plant.value.version += 1
      log(plant.value.id, '离线字段应用', '现场同步包', `${labelPrefix} 快进为现场版`, { revisionNo: currentRevisionNo.value, batchId })
      return
    }
    ;(located.target as unknown as Record<string, unknown>)[op.field] = op.newValue
    located.target.version += 1
    if (located.node) {
      invalidateChain('离线对账', op.id, labelPrefix, located.node.id,
        `现场包${batchId}将该字段由「${op.baseValue || '空'}」更正为「${op.newValue || '空'}」（依据升至V${located.target.version}）`, '现场同步包')
    }
  }

  function pushSyncBatch(batch: OfflineSyncBatch) {
    // 幂等：完整处理过的批次直接忽略，审计不重复追加
    if (syncedBatchIds.value.includes(batch.id)) {
      return { ok: true, duplicated: true, applied: 0, conflicts: 0, interrupted: false,
        message: `批次${batch.id}为重复批次，已按断点记录忽略，审计未重复追加` }
    }

    // 断点恢复：同批次重连从下一条未处理操作继续
    let index = syncCursor.value?.batchId === batch.id ? syncCursor.value!.nextIndex : 0
    const resumeFrom = index
    let applied = 0
    let conflictCount = 0

    // 首次处理且带中断演练标记：处理到一半模拟回连中断
    const failAt = resumeFrom === 0 && batch.simulateFailure ? Math.ceil(batch.ops.length / 2) : -1

    for (; index < batch.ops.length; index++) {
      if (index === failAt) {
        syncCursor.value = { batchId: batch.id, nextIndex: index, total: batch.ops.length, updatedAt: new Date().toISOString() }
        log(batch.id, '离线同步中断', '现场同步包', `已处理${index}/${batch.ops.length}条，断点已保存，重连后从第${index + 1}条恢复`, { batchId: batch.id })
        persist()
        return { ok: false, interrupted: true, applied, conflicts: conflictCount, cursor: index, total: batch.ops.length,
          message: `同步在第${index + 1}条中断，断点已保存` }
      }

      const op = batch.ops[index]
      const located = locateOp(op)
      if (!located) continue

      const centralValue = String((located.target as unknown as Record<string, unknown>)[op.field] ?? '')
      const existing = conflicts.value.find((item) => item.batchId === batch.id && item.entityId === op.entityId && item.field === op.field)

      if (centralValue === op.baseValue) {
        // 中心侧未改过：快进应用现场值
        applySiteValue(op, located, batch.id)
        applied += 1
      } else if (!existing) {
        // 同一字段两边都改过：两版都保留，不覆盖
        conflicts.value.unshift({
          id: nextId('CFL'), batchId: batch.id, entity: op.entity, entityId: op.entityId, nodeId: op.nodeId,
          field: op.field, fieldLabel: op.fieldLabel, centralValue, siteValue: op.newValue,
          detectedAt: new Date().toISOString(), status: '待裁定'
        })
        conflictCount += 1
        log(op.entityId, '离线对账冲突', '现场同步包',
          `字段「${op.fieldLabel}」两边都改过：中心版「${centralValue}」/ 现场版「${op.newValue}」，两版均保留待裁定`,
          { revisionNo: currentRevisionNo.value, batchId: batch.id })
      } else {
        conflictCount += 1
      }
    }

    syncCursor.value = null
    syncedBatchIds.value.push(batch.id)
    log(batch.id, '离线同步批次完成', '现场同步包',
      `基线R${batch.baseRevisionNo}，${resumeFrom > 0 ? `自断点${resumeFrom}/${batch.ops.length}恢复，` : ''}应用${applied}条，冲突保留两版${conflictCount}条`,
      { revisionNo: currentRevisionNo.value, batchId: batch.id })
    persist()
    return {
      ok: true, duplicated: false, applied, conflicts: conflictCount, interrupted: false, resumed: resumeFrom > 0,
      message: resumeFrom > 0
        ? `已从断点恢复并完成：应用${applied}条，${conflictCount}条冲突两版并存`
        : `同步完成：应用${applied}条，${conflictCount}条冲突两版并存`
    }
  }

  /** 负责人裁定冲突字段：采用中心版即丢弃现场版；采用现场版则此刻按依赖链失效 */
  function resolveConflict(conflictId: string, choice: 'central' | 'site') {
    const conflict = conflicts.value.find((item) => item.id === conflictId)
    if (!conflict || conflict.status !== '待裁定') return { ok: false, message: '冲突不存在或已裁定' }
    if (choice === 'central') {
      conflict.status = '已采用中心版'
      conflict.resolvedAt = new Date().toISOString()
      log(conflict.entityId, '裁定对账冲突', '验收负责人', `字段「${conflict.fieldLabel}」保留中心版「${conflict.centralValue}」`, { revisionNo: currentRevisionNo.value, batchId: conflict.batchId })
    } else {
      const op: SyncFieldOp = {
        id: nextId('OP'), entity: conflict.entity, entityId: conflict.entityId, nodeId: conflict.nodeId,
        field: conflict.field, fieldLabel: conflict.fieldLabel, baseValue: conflict.centralValue, newValue: conflict.siteValue
      }
      const located = locateOp(op)
      if (!located) return { ok: false, message: '目标实体已不存在' }
      applySiteValue(op, located, conflict.batchId)
      conflict.status = '已采用现场版'
      conflict.resolvedAt = new Date().toISOString()
    }
    persist()
    return { ok: true, message: choice === 'central' ? '已采用中心版' : '已采用现场版，相关节点按依赖链失效' }
  }

  function reset() {
    plant.value = structuredClone(seedPlant)
    equipment.value = structuredClone(seedEquipment)
    defects.value = structuredClone(seedDefects)
    audit.value = structuredClone(seedAudit)
    signBatches.value = []
    snapshots.value = []
    invalidations.value = []
    nodeReviews.value = {}
    conflicts.value = []
    syncCursor.value = null
    syncedBatchIds.value = []
    viewingRevisionNo.value = null
    persist()
  }

  return {
    // state
    plant, equipment, defects, audit, signBatches, snapshots, invalidations, nodeReviews,
    conflicts, syncCursor, syncedBatchIds, selectedEquipmentId, keyword, hydrated, viewingRevisionNo,
    // getters
    selectedEquipment, stats, latestSignedBatch, currentSnapshot, currentRevisionNo, isDelivered,
    isViewing, viewSnapshot, activePlant, activeEquipment, activeDefects,
    nodeStates, blockingNodes, reviewedNodes, invalidatedNodeIds, unresolvedConflicts,
    preflight, revisionReady,
    // actions
    hydrate, persist, updateItem, updateCertificate, reopenDefect, reviewNode, basisDiffs, invalidationsOf,
    assignDefect, addReply, addRetest, decideDefect, signOff, createRevision,
    pushSyncBatch, resolveConflict, nodeName, reset
  }
})
