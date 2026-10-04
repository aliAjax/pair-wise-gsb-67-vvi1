<script setup lang="ts">
import { computed, ref } from 'vue'
import Button from 'primevue/button'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import InputText from 'primevue/inputtext'
import Tag from 'primevue/tag'
import Checkbox from 'primevue/checkbox'
import Textarea from 'primevue/textarea'
import { useToast } from 'primevue/usetoast'
import { useAcceptanceStore } from '../stores/acceptance'
import type { OfflineSyncBatch, SyncFieldOp } from '../types/domain'

const store = useAcceptanceStore()
const toast = useToast()
const keyword = ref('')
const rows = computed(() => store.audit.filter((item) => !keyword.value || `${item.entityId} ${item.action} ${item.operator} ${item.detail} ${item.batchId ?? ''}`.includes(keyword.value)))

function sign() {
  const result = store.signOff()
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.ok ? '签署完成' : '完整性校验未通过', detail: result.message, life: 4500 })
}
function revise() {
  const result = store.createRevision()
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 4500 })
}
function exportPackage() {
  const payload = {
    currentRevisionNo: store.currentRevisionNo, batch: store.latestSignedBatch,
    plant: store.plant, equipment: store.equipment, defects: store.defects,
    invalidations: store.invalidations, nodeReviews: store.nodeReviews,
    conflicts: store.conflicts, preflight: store.preflight
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `并网验收交付包-R${store.currentRevisionNo || 'draft'}.json`; anchor.click(); URL.revokeObjectURL(url)
}

function viewRevision(revisionNo: number) { store.viewingRevisionNo = revisionNo }

/* ---------------- 现场离线同步包 ---------------- */

const packageText = ref('')
const simulateFailure = ref(true)

/** 依据当前中心数据构造一个演示离线包：2条快进、1条两边都改（双改）、1条证书续期 */
function buildDemoPackage() {
  const g1 = store.equipment.find((node) => node.id === 'EQ-GRID')?.items.find((item) => item.id === 'IT-G1')
  const i2 = store.equipment.find((node) => node.id === 'EQ-INV11')?.items.find((item) => item.id === 'IT-I2')
  const t1 = store.equipment.find((node) => node.id === 'EQ-TR1')?.items.find((item) => item.id === 'IT-T1')
  const cg1 = store.equipment.find((node) => node.id === 'EQ-GRID')?.certificates.find((item) => item.id === 'C-G1')
  const ops: SyncFieldOp[] = [
    { id: 'OP-01', entity: '验收项', entityId: 'IT-G1', nodeId: 'EQ-GRID', field: 'measured', fieldLabel: '实测结果', baseValue: g1?.measured ?? '', newValue: '18/18项一致（调度复核20项）' },
    { id: 'OP-02', entity: '验收项', entityId: 'IT-I2', nodeId: 'EQ-INV11', field: 'evidence', fieldLabel: '测试证据', baseValue: i2?.evidence ?? '', newValue: '效率测试曲线_现场复测.csv' },
    { id: 'OP-03', entity: '验收项', entityId: 'IT-T1', nodeId: 'EQ-TR1', field: 'measured', fieldLabel: '实测结果', baseValue: '高压对地 12.8GΩ（出厂基线）', newValue: '高压对地 13.1GΩ（现场干燥天气复测）' },
    { id: 'OP-04', entity: '证书', entityId: 'C-G1', nodeId: 'EQ-GRID', field: 'expiresAt', fieldLabel: '有效期至', baseValue: cg1?.expiresAt ?? '', newValue: '2028-09-20' }
  ]
  const batch: OfflineSyncBatch = {
    id: 'SYNC-FIELD-261004-01', siteName: '沙岭一期现场班组', exportedAt: new Date().toISOString(),
    baseRevisionNo: store.currentRevisionNo, ops, simulateFailure: simulateFailure.value
  }
  packageText.value = JSON.stringify(batch, null, 2)
  toast.add({ severity: 'info', summary: '已生成现场离线同步包', detail: simulateFailure.value ? '将在回连处理中途模拟一次中断' : '不模拟中断', life: 3000 })
}

function pushPackage() {
  let batch: OfflineSyncBatch
  try { batch = JSON.parse(packageText.value) } catch {
    toast.add({ severity: 'error', summary: '同步包JSON格式错误', life: 3000 }); return
  }
  batch.simulateFailure = simulateFailure.value
  const result = store.pushSyncBatch(batch)
  toast.add({
    severity: result.duplicated ? 'info' : result.interrupted ? 'warn' : 'success',
    summary: result.message, life: 4200
  })
}

function resolve(conflictId: string, choice: 'central' | 'site') {
  const result = store.resolveConflict(conflictId, choice)
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 3500 })
}
const conflictSeverity = { 待裁定: 'danger', 已采用中心版: 'secondary', 已采用现场版: 'success' } as const
</script>

<template>
  <section class="page">
    <div class="preflight-panel">
      <div><span>并网前完整性校验</span><strong>{{ store.preflight.allowed ? '全部条件满足' : `${store.preflight.blocking.length}项阻断` }}</strong><p v-for="item in store.preflight.blocking" :key="item">{{ item }}</p></div>
      <div class="preflight-actions">
        <Button label="导出交付包" outlined @click="exportPackage" />
        <Button v-if="!store.isDelivered" label="签署并冻结修订" @click="sign" />
        <Button v-else label="全部恢复，从旧快照生成新修订" :disabled="!store.revisionReady" @click="revise" />
      </div>
    </div>

    <div class="section-head"><div><h2>修订链与签署批次</h2><p>签署时冻结每个设备节点的依据版本；旧快照不可变，事后只能以新修订替代。</p></div></div>
    <DataTable :value="[...store.signBatches].reverse()" dataKey="id" size="small" stripedRows class="mb14">
      <Column field="id" header="签署批次" />
      <Column header="修订"><template #body="{ data }">R{{ data.revisionNo }}</template></Column>
      <Column header="签署时间"><template #body="{ data }">{{ data.signedAt.replace('T', ' ').slice(0, 16) }}</template></Column>
      <Column field="operator" header="负责人" />
      <Column field="note" header="说明" />
      <Column header="状态">
        <template #body="{ data }">
          <Tag v-if="data.supersededBy" value="已被新修订替代" severity="secondary" />
          <Tag v-else value="当前交付修订" severity="success" />
        </template>
      </Column>
      <Column header="快照">
        <template #body="{ data }">
          <Button label="查看不可变快照" text size="small" @click="viewRevision(data.revisionNo)" />
        </template>
      </Column>
    </DataTable>

    <div class="section-head"><div><h2>阻断节点与失效传播</h2><p>证书更新、验收项更正、缺陷重开和离线对账只让源头节点及上游失效；负责人逐项复核，全部恢复后才能生成新修订。</p></div></div>
    <div v-if="!store.invalidations.length" class="empty-panel">当前修订无失效记录，所有设备节点依据版本继续有效。</div>
    <DataTable v-else :value="store.invalidations" dataKey="id" size="small" class="mb14">
      <Column field="createdAt" header="时间"><template #body="{ data }">{{ data.createdAt.replace('T', ' ').slice(0, 16) }}</template></Column>
      <Column header="来源"><template #body="{ data }"><Tag :value="data.sourceType" severity="warn" /></template></Column>
      <Column field="sourceLabel" header="更正事项" />
      <Column header="失效链（源头→上游）">
        <template #body="{ data }"><span class="chain-text">{{ data.affectedNodeIds.map((id: string) => store.nodeName(id)).join(' → ') }}</span></template>
      </Column>
      <Column field="reason" header="原因" />
      <Column header="复核进度">
        <template #body="{ data }">
          {{ data.affectedNodeIds.filter((id: string) => store.nodeStates[id] === '已复核').length }} / {{ data.affectedNodeIds.length }}
        </template>
      </Column>
    </DataTable>

    <div class="sync-panel">
      <div class="section-head"><div><h2>现场离线同步包 · 字段对账</h2><p>回连后按字段对账：中心未改则快进现场版；同一字段两边都改则两版并存待裁定；中断从断点恢复，重复批次幂等。</p></div></div>
      <div class="sync-grid">
        <div class="sync-ops">
          <div class="toolbar">
            <Button label="生成演示离线包" outlined size="small" @click="buildDemoPackage" />
            <label class="fail-check"><Checkbox v-model="simulateFailure" binary /><span>首次回连中途模拟断网</span></label>
          </div>
          <Textarea v-model="packageText" rows="14" class="sync-json" placeholder="粘贴现场导出的同步包JSON，或点击生成演示包" />
          <div class="toolbar">
            <Button :label="store.syncCursor ? `从断点恢复（第${store.syncCursor.nextIndex + 1}/${store.syncCursor.total}条）` : '回连并推送对账'" @click="pushPackage" />
            <span v-if="store.syncCursor" class="cursor-hint"><i class="pi pi-step-backward" /> 断点：批次 {{ store.syncCursor.batchId }}，已保存 {{ store.syncCursor.nextIndex }}/{{ store.syncCursor.total }}</span>
          </div>
          <p class="sync-hint">已完成批次（重复推送将被忽略，审计不重复追加）：{{ store.syncedBatchIds.length ? store.syncedBatchIds.join('，') : '无' }}</p>
        </div>
        <div class="sync-conflicts">
          <h3>双改字段 · 两版并存（{{ store.conflicts.length }}）</h3>
          <p v-if="!store.conflicts.length" class="empty-hint">暂无对账冲突。</p>
          <article v-for="conflict in store.conflicts" :key="conflict.id" class="conflict-item">
            <div class="conflict-head"><Tag :value="conflict.entity" /><strong>{{ conflict.entityId }} · {{ conflict.fieldLabel }}</strong><Tag :value="conflict.status" :severity="conflictSeverity[conflict.status]" /></div>
            <div class="conflict-values"><span>中心版：{{ conflict.centralValue || '（空）' }}</span><span>现场版：{{ conflict.siteValue || '（空）' }}</span></div>
            <small>{{ conflict.batchId }} · {{ conflict.detectedAt.replace('T', ' ').slice(0, 16) }}</small>
            <div v-if="conflict.status === '待裁定'" class="conflict-actions">
              <Button label="保留中心版" size="small" severity="secondary" outlined @click="resolve(conflict.id, 'central')" />
              <Button label="采用现场版（按链失效）" size="small" @click="resolve(conflict.id, 'site')" />
            </div>
          </article>
        </div>
      </div>
    </div>

    <div class="section-head" style="margin-top:18px"><div><h2>验收审计</h2><p>当前工作修订 R{{ store.currentRevisionNo || '—' }}（{{ store.plant.status }}），每条审计记录归属修订与批次。</p></div><InputText v-model="keyword" placeholder="搜索实体、动作、操作人或批次" /></div>
    <DataTable :value="rows" dataKey="id" size="small">
      <Column field="createdAt" header="时间"><template #body="{ data }">{{ data.createdAt.replace('T', ' ').slice(0, 16) }}</template></Column>
      <Column header="修订"><template #body="{ data }">{{ data.revisionNo ? `R${data.revisionNo}` : '—' }}</template></Column>
      <Column field="entityId" header="实体" />
      <Column field="action" header="动作"><template #body="{ data }"><Tag :value="data.action" /></template></Column>
      <Column field="operator" header="操作人" />
      <Column field="detail" header="说明" />
      <Column header="批次"><template #body="{ data }">{{ data.batchId ?? '—' }}</template></Column>
    </DataTable>
  </section>
</template>
