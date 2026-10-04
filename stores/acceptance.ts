import { computed, ref, toRaw } from 'vue'
import { defineStore } from 'pinia'
import { buildSeed } from '../data/seed'
import type {
  AcceptanceDefect, AcceptanceItem, AuditEntry, Certificate, EquipmentNode, FieldConflict,
  FieldConflictStatus, InvalidationSource, NodeBasisState, OfflinePackage, PartyReply, Plant, SignOffBatch, SyncLedgerEntry
} from '../types/domain'

const STORAGE_KEY = 'gsb67:grid-acceptance:v2'
let idSeed = 100
const nowIso = () => new Date().toISOString()
const nextId = (prefix: string) => `${prefix}-${Date.now()}-${idSeed++}`

type SeedState = ReturnType<typeof buildSeed>

export const useAcceptanceStore = defineStore('acceptance', () => {
  const seed0: SeedState = buildSeed()
  const plant = ref<Plant>(structuredClone(seed0.plant))
  const equipment = ref<EquipmentNode[]>(structuredClone(seed0.equipment))
  const defects = ref<AcceptanceDefect[]>(structuredClone(seed0.defects))
  const audit = ref<AuditEntry[]>(structuredClone(seed0.audit))
  const batches = ref<SignOffBatch[]>(structuredClone(seed0.batches))
  const ledger = ref<SyncLedgerEntry[]>(structuredClone(seed0.ledger))
  const conflicts = ref<FieldConflict[]>(structuredClone(seed0.conflicts))
  const selectedEquipmentId = ref(equipment.value[0].id)
  const keyword = ref('')
  const hydrated = ref(false)

  /* ---------------- 依赖链与依据状态 ---------------- */

  function findNode(id: string) {
    return equipment.value.find((node) => node.id === id)
  }

  /** 从节点沿 parentId 向并网点（上游）归集，含自身 */
  function upstreamChain(equipmentId: string): EquipmentNode[] {
    const chain: EquipmentNode[] = []
    let current = findNode(equipmentId)
    const guard = new Set<string>()
    while (current && !guard.has(current.id)) {
      guard.add(current.id)
      chain.push(current)
      current = current.parentId ? (findNode(current.parentId) ?? undefined) : undefined
    }
    return chain
  }

  function openReasons(node: EquipmentNode) {
    return node.invalidations.filter((reason) => !reason.clearedAt)
  }

  function unresolvedConflictsOf(equipmentId: string) {
    return conflicts.value.filter((item) => item.equipmentId === equipmentId && item.status === '待裁决')
  }

  const delivered = computed(() => batches.value.length > 0)
  const revisionOpen = computed(() => plant.value.status === '修订中')

  /** 节点依据状态：失效待复核 → 已复核待签署 → 有效 */
  function stateOf(node: EquipmentNode): NodeBasisState {
    if (openReasons(node).length || unresolvedConflictsOf(node.id).length) return '失效待复核'
    const drifted = node.itemVersion > node.itemBasis || node.certVersion > node.certBasis || node.defectVersion > node.defectBasis
    if (revisionOpen.value && delivered.value && drifted) return '已复核待签署'
    return '有效'
  }

  const selectedEquipment = computed(() => findNode(selectedEquipmentId.value))

  const blockingNodes = computed(() => equipment.value
    .map((node) => ({ node, state: stateOf(node), reasons: openReasons(node), conflictList: unresolvedConflictsOf(node.id) }))
    .filter((item) => item.state !== '有效'))

  const stats = computed(() => {
    const items = equipment.value.flatMap((item) => item.items)
    return {
      total: items.length,
      passed: items.filter((item) => item.status === '合格').length,
      failed: items.filter((item) => item.status === '不合格' || item.status === '待复验').length,
      openDefects: defects.value.filter((item) => !['已关闭', '带条件通过'].includes(item.status)).length,
      blocking: blockingNodes.value.length,
      conflicts: conflicts.value.filter((item) => item.status === '待裁决').length
    }
  })

  const latestBatch = computed(() => batches.value[batches.value.length - 1] ?? null)

  const revisionLabel = computed(() => {
    if (!delivered.value) return `V${plant.value.version}（交付前）`
    return revisionOpen.value
      ? `V${plant.value.version} 修订中（基于V${plant.value.basedOnRevision}）`
      : `V${plant.value.version} 已交付`
  })

  const preflight = computed(() => {
    const blocking: string[] = []
    const items = equipment.value.flatMap((item) => item.items)
    if (items.some((item) => item.status === '待检查')) blocking.push('仍有验收项未检查')
    if (items.some((item) => item.status === '不合格' || item.status === '待复验')) blocking.push('存在不合格或待复验项')
    if (defects.value.some((item) => !['已关闭', '带条件通过'].includes(item.status))) blocking.push('存在未闭环缺陷')
    if (equipment.value.flatMap((item) => item.certificates).some((item) => !item.verified)) blocking.push('存在未核验证书')
    const expired = equipment.value.flatMap((item) => item.certificates).some((item) => item.expiresAt < plant.value.commissioningDate)
    if (expired) blocking.push('证书在并网日期前失效')
    if (stats.value.conflicts > 0) blocking.push(`离线对账存在${stats.value.conflicts}项字段冲突待裁决（两版已保留）`)
    const invalid = blockingNodes.value.filter((item) => item.state === '失效待复核')
    if (invalid.length) blocking.push(`失效节点未完成逐项复核：${invalid.map((item) => item.node.name).join('、')}`)
    return { allowed: blocking.length === 0, blocking }
  })

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
        batches.value = stored.batches ?? []
        ledger.value = stored.ledger ?? []
        conflicts.value = stored.conflicts ?? []
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
      batches: batches.value, ledger: ledger.value, conflicts: conflicts.value
    }))
  }

  /* ---------------- 审计（幂等） ---------------- */

  function log(entityId: string, action: string, operator: string, detail: string, extra: { batchId?: string; syncKey?: string } = {}) {
    if (extra.syncKey && audit.value.some((entry) => entry.syncKey === extra.syncKey)) return
    audit.value.unshift({ id: nextId('AUD'), entityId, action, operator, detail, createdAt: nowIso(), ...extra })
  }

  /* ---------------- 修订链 ---------------- */

  /** 交付后的首次更正：从最近签署快照自动开立工作修订，旧快照不动 */
  function openRevisionIfDelivered() {
    if (plant.value.status !== '已签署') return
    const basis = latestBatch.value
    plant.value = {
      ...plant.value,
      status: '修订中',
      version: (basis?.revision ?? plant.value.version) + 1,
      basedOnRevision: basis?.revision ?? null,
      revisionNote: '交付后更正，按依赖链逐项复核',
      revisedAt: nowIso()
    }
    log(plant.value.id, '开立修订', '陆川', `基于V${basis?.revision}交付快照生成工作修订V${plant.value.version}，旧快照冻结可查`, { batchId: basis?.id })
  }

  /** 沿依赖链标记失效：本节点及全部上游；链外节点保持有效 */
  function markInvalid(equipmentId: string, source: InvalidationSource, entityId: string, label: string) {
    openRevisionIfDelivered()
    const createdAt = nowIso()
    for (const node of upstreamChain(equipmentId)) {
      node.invalidations.push({ id: nextId('IV'), source, entityId, label, createdAt, clearedAt: null, reviewer: null })
      if (node.status === '已验收') node.status = '待复核'
    }
  }

  /** 负责人对单个失效节点逐项复核恢复 */
  function reviewNode(equipmentId: string, note = '') {
    const node = findNode(equipmentId)
    if (!node) return { ok: false, message: '设备节点不存在' }
    const pending = unresolvedConflictsOf(equipmentId)
    if (pending.length) return { ok: false, message: `该节点有${pending.length}项离线字段冲突待裁决，两版保留中` }
    const open = openReasons(node)
    if (!open.length) return { ok: false, message: '该节点没有待复核的失效依据' }
    const at = nowIso()
    open.forEach((reason) => { reason.clearedAt = at; reason.reviewer = '陆川' })
    node.status = '已验收'
    log(node.id, '节点复核恢复', '陆川', `失效依据${open.length}项逐项复核通过：${open.map((item) => item.label).join('；')}${note ? `。${note}` : ''}`)
    persist()
    return { ok: true, message: `${node.name} 已复核恢复，待全部节点恢复后生成新修订版` }
  }

  function updateItem(equipmentId: string, itemId: string, patch: Partial<AcceptanceItem>) {
    const node = findNode(equipmentId)
    const item = node?.items.find((value) => value.id === itemId)
    if (!node || !item) return
    Object.assign(item, patch, { version: item.version + 1 })
    node.itemVersion += 1
    if (node.status === '待验收') node.status = '验收中'
    if (delivered.value) {
      markInvalid(node.id, '验收项更正', item.id, `验收项「${item.standard}」依据更正至V${item.version}`)
      log(node.id, '验收项更正', '当前用户', `${item.id}状态更新为${item.status}，节点依据版本冻结值→V${node.itemVersion}，沿依赖链标记失效`)
    } else {
      log(equipmentId, '更新验收项', '当前用户', `${item.id}状态更新为${item.status}`)
    }
    persist()
  }

  function updateCertificate(equipmentId: string, certId: string, patch: Partial<Certificate>) {
    const node = findNode(equipmentId)
    const cert = node?.certificates.find((value) => value.id === certId)
    if (!node || !cert) return { ok: false, message: '证书不存在' }
    Object.assign(cert, patch, { version: cert.version + 1 })
    node.certVersion += 1
    if (delivered.value) {
      markInvalid(node.id, '证书更新', cert.id, `证书「${cert.name}」更新至V${cert.version}`)
      log(cert.id, '证书更新', '当前用户', `证书换版V${cert.version}，仅${upstreamChain(node.id).map((item) => item.name).join('→')}失效，其他节点继续有效`)
    } else {
      log(cert.id, '更新证书', '当前用户', `证书「${cert.name}」更新`)
    }
    persist()
    return { ok: true, message: `证书已更新至V${cert.version}，依赖链节点已标记失效` }
  }

  /* ---------------- 缺陷 ---------------- */

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
    defect.retests.unshift({ round: defect.retests.length + 1, passed, result, tester: '联合验收组', testedAt: nowIso() })
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

  /** 交付后缺陷重开：缺陷所在节点沿依赖链向上游失效 */
  function reopenDefect(id: string, note: string, party: PartyReply['party'] = '运维单位', owner = '现场负责人') {
    const defect = defects.value.find((item) => item.id === id)
    if (!defect) return { ok: false, message: '缺陷不存在' }
    if (!['已关闭', '带条件通过'].includes(defect.status)) return { ok: false, message: '只有已闭环缺陷可以重开' }
    if (!note.trim()) return { ok: false, message: '重开原因不能为空' }
    defect.status = '整改中'
    defect.decisionNote = ''
    defect.version += 1
    defect.replies.unshift({ party, owner, content: note, evidence: '重开依据待补充', repliedAt: nowIso() })
    const node = findNode(defect.equipmentId)
    if (node) {
      node.defectVersion += 1
      if (delivered.value) {
        markInvalid(node.id, '缺陷重开', defect.id, `${defect.severity}缺陷「${defect.title}」重开`)
        log(id, '缺陷重开', owner, `${note}；节点${node.name}及上游依据失效，其他节点继续有效`)
      } else {
        log(id, '缺陷重开', owner, note)
      }
    }
    persist()
    return { ok: true, message: `缺陷已重开，依赖链节点已标记失效` }
  }

  /* ---------------- 签署：冻结依据版本 + 不可变快照 ---------------- */

  function signOff(note = '') {
    if (!preflight.value.allowed) return { ok: false, message: preflight.value.blocking.join('；') }
    const revision = plant.value.version
    const equipmentFrozen = structuredClone(toRaw(equipment.value))
    equipmentFrozen.forEach((node) => {
      node.status = '已验收'
      node.itemBasis = node.itemVersion
      node.certBasis = node.certVersion
      node.defectBasis = node.defectVersion
      node.invalidations = []
    })
    const plantFrozen: Plant = { ...structuredClone(toRaw(plant.value)), status: '已签署' }
    const batch: SignOffBatch = {
      id: nextId('SIGN'),
      revision,
      basedOnRevision: plant.value.basedOnRevision,
      signedAt: nowIso(),
      operator: '验收负责人陆川',
      note: note || (revisionOpen.value ? `修订交付：失效节点全部复核恢复，基于V${plant.value.basedOnRevision}生成V${revision}` : '首次并网交付'),
      basis: Object.fromEntries(equipment.value.map((node) => [node.id, {
        itemBasis: node.itemVersion, certBasis: node.certVersion, defectBasis: node.defectVersion
      }])),
      snapshot: { plant: plantFrozen, equipment: equipmentFrozen, defects: structuredClone(toRaw(defects.value)) }
    }
    batches.value.push(batch)
    equipment.value.forEach((node) => {
      node.status = '已验收'
      node.itemBasis = node.itemVersion
      node.certBasis = node.certVersion
      node.defectBasis = node.defectVersion
      node.invalidations = []
    })
    plant.value = { ...plant.value, status: '已签署', revisionNote: batch.note }
    log(plant.value.id, '签署交付版本', '验收负责人陆川', `锁定V${revision}并生成交付包（基于${batch.basedOnRevision ? `V${batch.basedOnRevision}修订链` : '交付前工作版'}），旧批次快照仍可查看`, { batchId: batch.id })
    persist()
    return { ok: true, message: `V${revision} 修订版已签署冻结，历史快照保留可查` }
  }

  /* ---------------- 离线同步：字段对账 + 断点恢复 + 幂等 ---------------- */

  type EntityRef = { kind: 'item' | 'certificate' | 'defect'; node: EquipmentNode; entity: AcceptanceItem | Certificate | AcceptanceDefect }

  function locateEntity(change: OfflinePackage['changes'][number]): EntityRef | null {
    const node = findNode(change.equipmentId)
    if (!node) return null
    if (change.entity === 'item') {
      const entity = node.items.find((item) => item.id === change.id)
      return entity ? { kind: 'item', node, entity } : null
    }
    if (change.entity === 'certificate') {
      const entity = node.certificates.find((item) => item.id === change.id)
      return entity ? { kind: 'certificate', node, entity } : null
    }
    const defect = defects.value.find((item) => item.id === change.id)
    return defect ? { kind: 'defect', node, entity: defect } : null
  }

  function getEntityField(ref: EntityRef, field: string): string {
    return String((ref.entity as unknown as Record<string, unknown>)[field] ?? '')
  }

  function setEntityField(ref: EntityRef, field: string, value: string) {
    (ref.entity as unknown as Record<string, unknown>)[field] = value
  }

  function bumpEntity(ref: EntityRef) {
    if (ref.kind === 'item') {
      ref.entity.version = (ref.entity as AcceptanceItem).version + 1
      ref.node.itemVersion += 1
    } else if (ref.kind === 'certificate') {
      ref.entity.version = (ref.entity as Certificate).version + 1
      ref.node.certVersion += 1
    } else {
      ref.entity.version = (ref.entity as AcceptanceDefect).version + 1
      ref.node.defectVersion += 1
    }
  }

  function applyOfflinePackage(pkg: OfflinePackage) {
    // 重复批次：已完成的包绝不重复追加任何审计
    const finished = ledger.value.find((entry) => entry.batchId === pkg.batchId && entry.status === '已完成')
    if (finished) return { ok: true, duplicate: true, resumed: false, applied: 0, conflicts: 0, skipped: pkg.changes.length, message: `批次 ${pkg.batchId} 已同步过，重复导入未重复追加审计` }

    let entry = ledger.value.find((item) => item.batchId === pkg.batchId)
    const resumed = !!entry && (entry.status === '失败' || entry.status === '进行中')
    if (!entry) {
      entry = { batchId: pkg.batchId, status: '进行中', startedAt: nowIso(), finishedAt: null, appliedKeys: [], total: pkg.changes.length, lastError: null }
      ledger.value.unshift(entry)
    }

    let applied = 0
    let conflictCount = 0
    let skipped = 0
    const conflictNames: string[] = []
    try {
      pkg.changes.forEach((change, index) => {
        const syncKey = `${pkg.batchId}:${change.entity}:${change.id}:${change.field}`
        if (entry!.appliedKeys.includes(syncKey)) { skipped += 1; return } // 断点恢复：已对账字段跳过
        const ref = locateEntity(change)
        if (!ref) throw new Error(`找不到同步对象 ${change.id}`)
        const localValue = getEntityField(ref, change.field)
        if (localValue === change.remoteValue || change.remoteValue === change.baseValue) {
          // 两边一致，或现场侧未改（仅本地改过）：无需写入
        } else if (localValue === change.baseValue) {
          // 仅现场改过：快进采用现场值
          setEntityField(ref, change.field, change.remoteValue)
          bumpEntity(ref)
          if (delivered.value) markInvalid(ref.node.id, '离线同步', change.id, `现场回连快进：${change.fieldLabel}更新`)
          log(change.id, '离线对账快进', change.operator, `${change.fieldLabel}：${change.baseValue || '空'} → ${change.remoteValue}`, { batchId: pkg.batchId, syncKey })
          applied += 1
        } else {
          // 同一字段两边都改过：保留两版，不覆盖，待负责人裁决
          if (!conflicts.value.some((item) => item.syncKey === syncKey)) {
            conflicts.value.unshift({
              id: nextId('CFL'), batchId: pkg.batchId, syncKey, entity: change.entity, entityId: change.id,
              equipmentId: change.equipmentId, field: change.field, fieldLabel: change.fieldLabel,
              baseValue: change.baseValue, localValue, remoteValue: change.remoteValue,
              detectedAt: nowIso(), status: '待裁决', resolvedValue: null, resolvedAt: null, resolver: null
            })
            log(change.id, '离线字段冲突·保留两版', change.operator, `${change.fieldLabel}本地为「${localValue}」，现场为「${change.remoteValue}」，两版均保留待裁决`, { batchId: pkg.batchId, syncKey })
          }
          conflictCount += 1
          conflictNames.push(change.fieldLabel)
        }
        entry!.appliedKeys.push(syncKey)
        // 模拟现场链路中断：前 failAfter 条已落盘，后续从断点恢复
        if (pkg.failAfter != null && index + 1 === pkg.failAfter && index + 1 < pkg.changes.length) {
          throw new Error('现场链路中断，等待回连重试')
        }
      })
      entry.status = '已完成'
      entry.finishedAt = nowIso()
      entry.lastError = null
    } catch (error) {
      entry.status = '失败'
      entry.finishedAt = nowIso()
      entry.lastError = error instanceof Error ? error.message : '同步失败'
      persist()
      return {
        ok: false, duplicate: false, resumed, applied, conflicts: conflictCount, skipped,
        message: `${entry.lastError}；已落盘${applied}条/冲突${conflictCount}条，进度已保存，回连后从断点恢复（剩余${pkg.changes.length - entry.appliedKeys.length}条）`
      }
    }
    persist()
    return {
      ok: true, duplicate: false, resumed, applied, conflicts: conflictCount, skipped,
      message: resumed
        ? `断点恢复完成：跳过已同步${skipped}条，新增快进${applied}条${conflictCount ? `，冲突${conflictCount}条（${conflictNames.join('、')}）两版保留` : ''}`
        : `对账完成：快进${applied}条，冲突${conflictCount}条两版保留${skipped ? `，跳过${skipped}条` : ''}`
    }
  }

  /** 裁决字段冲突：采用本地/采用现场/合并两版；裁决后按依赖链失效 */
  function resolveConflict(conflictId: string, status: Exclude<FieldConflictStatus, '待裁决'>, mergedValue?: string) {
    const conflict = conflicts.value.find((item) => item.id === conflictId)
    if (!conflict) return { ok: false, message: '冲突不存在' }
    if (conflict.status !== '待裁决') return { ok: false, message: '该冲突已裁决' }
    const value = status === '已保留本地' ? conflict.localValue : status === '已采用现场' ? conflict.remoteValue : (mergedValue ?? '').trim()
    if (status === '已合并两版' && !value) return { ok: false, message: '合并两版时必须填写合并后的取值' }
    const ref = locateEntity({ entity: conflict.entity, id: conflict.entityId, equipmentId: conflict.equipmentId, field: conflict.field } as OfflinePackage['changes'][number])
    if (!ref) return { ok: false, message: '冲突对象已不存在' }
    setEntityField(ref, conflict.field, value)
    bumpEntity(ref)
    if (delivered.value) markInvalid(ref.node.id, '离线冲突', conflict.entityId, `离线冲突裁决（${conflict.fieldLabel}）：${status}`)
    conflict.status = status
    conflict.resolvedValue = value
    conflict.resolvedAt = nowIso()
    conflict.resolver = '陆川'
    log(conflict.entityId, '离线冲突裁决', '陆川', `${conflict.fieldLabel}${status}，最终取值「${value}」；节点${ref.node.name}转逐项复核`, { batchId: conflict.batchId, syncKey: conflict.syncKey })
    persist()
    return { ok: true, message: `冲突已${status}，请在设备页复核恢复节点` }
  }

  function reset() {
    const fresh = buildSeed()
    plant.value = structuredClone(fresh.plant)
    equipment.value = structuredClone(fresh.equipment)
    defects.value = structuredClone(fresh.defects)
    audit.value = structuredClone(fresh.audit)
    batches.value = structuredClone(fresh.batches)
    ledger.value = structuredClone(fresh.ledger)
    conflicts.value = structuredClone(fresh.conflicts)
    persist()
  }

  return {
    plant, equipment, defects, audit, batches, ledger, conflicts,
    selectedEquipmentId, keyword, hydrated,
    delivered, revisionOpen, latestBatch, revisionLabel,
    selectedEquipment, stats, preflight, blockingNodes,
    hydrate, persist, stateOf, openReasons, unresolvedConflictsOf, upstreamChain,
    updateItem, updateCertificate, assignDefect, addReply, addRetest, decideDefect, reopenDefect,
    reviewNode, signOff, applyOfflinePackage, resolveConflict, reset
  }
})
