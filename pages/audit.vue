<script setup lang="ts">
import { computed, ref } from 'vue'
import Button from 'primevue/button'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import InputText from 'primevue/inputtext'
import Tag from 'primevue/tag'
import Textarea from 'primevue/textarea'
import Dialog from 'primevue/dialog'
import Select from 'primevue/select'
import { useToast } from 'primevue/usetoast'
import RevisionBanner from '../components/RevisionBanner.vue'
import { useAcceptanceStore } from '../stores/acceptance'
import { offlinePackages } from '../data/offline-packages'
import type { FieldConflict, SignOffBatch } from '../types/domain'

const store = useAcceptanceStore()
const toast = useToast()
const keyword = ref('')
const signNote = ref('')
const rows = computed(() => store.audit.filter((item) => !keyword.value || `${item.entityId} ${item.action} ${item.operator} ${item.detail} ${item.batchId ?? ''} ${item.syncKey ?? ''}`.includes(keyword.value)))

function sign() {
  const result = store.signOff(signNote.value)
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.ok ? '新修订版已冻结' : '完整性校验未通过', detail: result.message, life: 5000 })
  if (result.ok) signNote.value = ''
}
function exportPackage() {
  const payload = { current: { plant: store.plant, equipment: store.equipment, defects: store.defects }, revisionChain: store.batches.map((b) => ({ id: b.id, revision: b.revision, signedAt: b.signedAt, basis: b.basis })), conflicts: store.conflicts, ledger: store.ledger, audit: store.audit, preflight: store.preflight }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `光伏并网验收交付包_V${store.plant.version}.json`; anchor.click(); URL.revokeObjectURL(url)
}

/* ---------- 修订链与历史快照 ---------- */
const viewedRevision = ref<number | null>(null)
const viewedBatch = computed<SignOffBatch | null>(() => store.batches.find((item) => item.revision === viewedRevision.value) ?? null)
function fmt(iso: string) { return iso.replace('T', ' ').slice(0, 16) }

/* ---------- 离线同步 ---------- */
function applyPkg(pkgId: string) {
  const pkg = offlinePackages.find((item) => item.batchId === pkgId)
  if (!pkg) return
  const result = store.applyOfflinePackage(structuredClone(pkg))
  toast.add({ severity: result.duplicate ? 'info' : result.ok ? 'success' : 'warn', summary: result.duplicate ? '重复批次已忽略' : result.ok ? (result.resumed ? '断点恢复成功' : '同步对账完成') : '同步中断（进度已保存）', detail: result.message, life: 5600 })
}
const conflictTarget = ref<FieldConflict | null>(null)
const conflictVisible = ref(false)
const resolution = ref<'已保留本地' | '已采用现场' | '已合并两版'>('已合并两版')
const mergedValue = ref('')
function openConflict(conflict: FieldConflict) {
  conflictTarget.value = conflict
  resolution.value = '已合并两版'
  mergedValue.value = `${conflict.localValue} / ${conflict.remoteValue}`
  conflictVisible.value = true
}
function submitConflict() {
  if (!conflictTarget.value) return
  const result = store.resolveConflict(conflictTarget.value.id, resolution.value, mergedValue.value)
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 4000 })
  if (result.ok) conflictVisible.value = false
}
const ledgerStatusSeverity: Record<string, 'success' | 'warn' | 'info'> = { 已完成: 'success', 失败: 'warn', 进行中: 'info' }
const conflictSeverity: Record<string, 'danger' | 'success' | 'info'> = { 待裁决: 'danger', 已保留本地: 'info', 已采用现场: 'success', 已合并两版: 'success' }
</script>

<template>
  <section class="page">
    <RevisionBanner />

    <!-- 历史快照只读查看 -->
    <template v-if="viewedBatch">
      <div class="snapshot-viewer">
        <div class="section-head">
          <div><h2>交付快照 V{{ viewedBatch.revision }}</h2><p>{{ viewedBatch.id }} · {{ fmt(viewedBatch.signedAt) }} · {{ viewedBatch.operator }} 签署 · {{ viewedBatch.note }}</p></div>
          <Button label="返回当前修订" severity="secondary" outlined @click="viewedRevision = null" />
        </div>
        <div class="snapshot-notice"><span class="pi pi-locked"></span> 不可变快照：后续证书换版、验收项更正与缺陷重开不会修改本快照内容。</div>
        <DataTable :value="viewedBatch.snapshot.equipment" dataKey="id" size="small" stripedRows class="mt12">
          <Column field="id" header="设备节点" />
          <Column field="name" header="名称" />
          <Column header="冻结依据版本"><template #body="{ data }">项V{{ data.itemBasis }} / 证V{{ data.certBasis }} / 陷V{{ data.defectBasis }}</template></Column>
          <Column header="验收项">
            <template #body="{ data }">
              <span v-for="item in data.items" :key="item.id" class="snap-item"><Tag :value="item.status" severity="success" /><small>{{ item.id }} {{ item.measured }} V{{ item.version }}</small></span>
            </template>
          </Column>
          <Column header="证书"><template #body="{ data }"><span v-for="cert in data.certificates" :key="cert.id" class="snap-item"><small>{{ cert.name }} V{{ cert.version }} 至{{ cert.expiresAt }}</small></span></template></Column>
        </DataTable>
        <DataTable :value="viewedBatch.snapshot.defects" dataKey="id" size="small" class="mt12">
          <Column field="id" header="缺陷编号" />
          <Column field="title" header="缺陷" />
          <Column field="status" header="快照内状态" />
          <Column field="version" header="冻结版本" />
          <Column field="decisionNote" header="关闭说明" />
        </DataTable>
      </div>
    </template>

    <template v-else>
      <div class="preflight-panel">
        <div><span>并网前完整性校验（当前修订 V{{ store.plant.version }}）</span><strong>{{ store.preflight.allowed ? '全部条件满足，可生成新修订版' : `${store.preflight.blocking.length}项阻断` }}</strong><p v-for="item in store.preflight.blocking" :key="item">{{ item }}</p></div>
        <div class="preflight-actions">
          <Textarea v-model="signNote" rows="2" placeholder="新修订版签署说明（可留空）" />
          <div><Button label="导出交付包" outlined @click="exportPackage" /><Button label="签署并冻结新修订" :disabled="!store.preflight.allowed" @click="sign" /></div>
        </div>
      </div>

      <!-- 修订链 -->
      <div class="section-head"><div><h2>修订链（签署批次）</h2><p>签署时冻结每个设备节点的依据版本；新修订从旧快照生成，原快照仍可查看。</p></div></div>
      <div class="revision-chain">
        <div v-for="batch in [...store.batches].reverse()" :key="batch.id" class="chain-card" :class="{ current: batch.id === store.latestBatch?.id && !store.revisionOpen }">
          <div class="chain-dot"><span class="pi pi-lock"></span></div>
          <div class="chain-body">
            <strong>V{{ batch.revision }} {{ batch.basedOnRevision ? `（基于 V${batch.basedOnRevision}）` : '（首次交付）' }}</strong>
            <small>{{ fmt(batch.signedAt) }} · {{ batch.operator }}</small>
            <p>{{ batch.note }}</p>
            <small class="basis-line">冻结依据：{{ Object.keys(batch.basis).length }}个设备节点 · {{ batch.snapshot.defects.length }}项缺陷</small>
          </div>
          <Button label="查看快照" text @click="viewedRevision = batch.revision" />
        </div>
        <div v-if="store.revisionOpen" class="chain-card draft">
          <div class="chain-dot"><span class="pi pi-pencil"></span></div>
          <div class="chain-body">
            <strong>V{{ store.plant.version }} 工作修订（未签署）</strong>
            <small>{{ store.plant.revisedAt ? fmt(store.plant.revisedAt) : '' }} 开立 · 基于 V{{ store.plant.basedOnRevision }} 快照</small>
            <p>{{ store.plant.revisionNote }}</p>
            <small class="basis-line">阻断节点 {{ store.stats.blocking }} 个 · 待裁决冲突 {{ store.stats.conflicts }} 项，全部恢复后方可签署</small>
          </div>
        </div>
      </div>

      <!-- 离线同步 -->
      <div class="section-head mt20"><div><h2>现场离线同步</h2><p>回连后按字段对账：仅现场改→快进；同字段两边都改→保留两版待裁决；同步中断从断点恢复，重复批次不重复追加审计。</p></div></div>
      <div class="offline-panel">
        <div class="offline-packages">
          <article v-for="pkg in offlinePackages" :key="pkg.batchId">
            <Tag :value="pkg.failAfter != null ? '含中断点' : '完整包'" :severity="pkg.failAfter != null ? 'warn' : 'info'" />
            <strong>{{ pkg.batchId }}</strong>
            <small>{{ pkg.siteName }}</small>
            <small>导出 {{ fmt(pkg.exportedAt) }} · 基于V{{ pkg.basedOnRevision }} · {{ pkg.changes.length }}条字段变更</small>
            <Button label="回连导入对账" size="small" @click="applyPkg(pkg.batchId)" />
          </article>
        </div>
        <DataTable :value="store.ledger" dataKey="batchId" size="small">
          <Column field="batchId" header="同步批次" />
          <Column header="进度"><template #body="{ data }">{{ data.appliedKeys.length }} / {{ data.total }} 字段已对账</template></Column>
          <Column header="状态"><template #body="{ data }"><Tag :value="data.status" :severity="ledgerStatusSeverity[data.status]" /></template></Column>
          <Column field="lastError" header="中断原因" />
          <Column header="操作"><template #body="{ data }"><Button v-if="data.status !== '已完成'" label="从断点恢复" size="small" @click="applyPkg(data.batchId)" /></template></Column>
        </DataTable>
      </div>

      <div v-if="store.conflicts.length" class="conflict-panel">
        <h3>字段对账冲突（两版均保留，负责人裁决）</h3>
        <DataTable :value="store.conflicts" dataKey="id" size="small">
          <Column field="batchId" header="批次" />
          <Column field="entityId" header="对象" />
          <Column field="fieldLabel" header="字段" />
          <Column header="本地版（当前修订）"><template #body="{ data }"><span class="conflict-local">{{ data.localValue || '空' }}</span></template></Column>
          <Column header="现场版（离线包）"><template #body="{ data }"><span class="conflict-remote">{{ data.remoteValue || '空' }}</span></template></Column>
          <Column header="基线值"><template #body="{ data }"><small>{{ data.baseValue || '空' }}</small></template></Column>
          <Column header="状态"><template #body="{ data }"><Tag :value="data.status" :severity="conflictSeverity[data.status]" /><small v-if="data.resolvedValue"> → {{ data.resolvedValue }}</small></template></Column>
          <Column header=""><template #body="{ data }"><Button v-if="data.status === '待裁决'" label="裁决" text size="small" @click="openConflict(data)" /></template></Column>
        </DataTable>
      </div>

      <!-- 审计 -->
      <div class="section-head mt20"><div><h2>验收审计</h2><p>当前工作修订 V{{ store.plant.version }} · {{ store.plant.status }} · 审计按 syncKey 幂等，重复同步不重复追加</p></div><InputText v-model="keyword" placeholder="搜索实体、动作、批次或操作人" /></div>
      <DataTable :value="rows" dataKey="id" size="small">
        <Column field="createdAt" header="时间"><template #body="{ data }">{{ fmt(data.createdAt) }}</template></Column>
        <Column field="entityId" header="实体" />
        <Column field="action" header="动作"><template #body="{ data }"><Tag :value="data.action" /></template></Column>
        <Column field="operator" header="操作人" />
        <Column field="detail" header="说明" />
        <Column header="批次"><template #body="{ data }"><small>{{ data.batchId || '—' }}{{ data.syncKey ? ` · ${data.syncKey}` : '' }}</small></template></Column>
      </DataTable>
    </template>

    <Dialog v-model:visible="conflictVisible" header="字段冲突裁决（两版已保留）" modal :style="{ width: '640px' }">
      <div v-if="conflictTarget" class="conflict-dialog">
        <p>{{ conflictTarget.entityId }} · {{ conflictTarget.fieldLabel }}（{{ conflictTarget.batchId }}）</p>
        <div class="conflict-versions">
          <label class="v-local"><span>本地版</span><strong>{{ conflictTarget.localValue || '空' }}</strong></label>
          <label class="v-remote"><span>现场版</span><strong>{{ conflictTarget.remoteValue || '空' }}</strong></label>
          <label class="v-base"><span>离线基线</span><strong>{{ conflictTarget.baseValue || '空' }}</strong></label>
        </div>
        <label class="decision-select">裁决方式
          <Select v-model="resolution" :options="['已保留本地', '已采用现场', '已合并两版']" />
        </label>
        <label v-if="resolution === '已合并两版'" class="decision-select">合并后的取值（两版都保留痕迹，此处为最终落账值）
          <Textarea v-model="mergedValue" rows="3" />
        </label>
      </div>
      <template #footer><Button label="取消" text severity="secondary" @click="conflictVisible = false" /><Button label="确认裁决并转复核" @click="submitConflict" /></template>
    </Dialog>
  </section>
</template>
