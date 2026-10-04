<script setup lang="ts">
import { computed, reactive } from 'vue'
import { useRoute } from 'vue-router'
import Button from 'primevue/button'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import Tag from 'primevue/tag'
import Textarea from 'primevue/textarea'
import { useToast } from 'primevue/usetoast'
import { useAcceptanceStore } from '../../stores/acceptance'
import type { AcceptanceItem, Certificate } from '../../types/domain'

const route = useRoute()
const store = useAcceptanceStore()
const toast = useToast()
const node = computed(() => store.activeEquipment.find((item) => item.id === route.params.id))
const nodeState = computed(() => (node.value && !store.isViewing ? store.nodeStates[node.value.id] ?? '有效' : '有效'))
const frozenBasis = computed(() => (node.value ? store.viewSnapshot?.basis[node.value.id] ?? store.currentSnapshot?.basis[node.value.id] : undefined))
const frozenCount = computed(() => {
  const basis = frozenBasis.value
  if (!basis) return 0
  return Object.keys(basis.items).length + Object.keys(basis.certificates).length + Object.keys(basis.defects).length
})
const reasons = computed(() => (node.value && !store.isViewing ? store.invalidationsOf(node.value.id) : []))
const pathNodes = computed(() => node.value ? store.activeEquipment.filter((value) => value.parentId === node.value!.parentId || value.id === node.value!.id) : [])

const visible = ref(false)
const certVisible = ref(false)
const reviewVisible = ref(false)
const editable = reactive<Partial<AcceptanceItem>>({})
const certEditable = reactive<Partial<Certificate>>({})
const reviewNote = ref('')

function openItem(item: AcceptanceItem) { Object.assign(editable, structuredClone(item)); visible.value = true }
function save() {
  if (!node.value || !editable.id) return
  store.updateItem(node.value.id, editable.id, editable)
  toast.add({ severity: 'success', summary: '验收项已更新', detail: nodeState.value === '有效' && store.isDelivered ? '依赖链上游节点已按修订链失效' : '版本已递增', life: 3000 })
  visible.value = false
}
function openCertificate(cert: Certificate) { Object.assign(certEditable, structuredClone(cert)); certVisible.value = true }
function saveCertificate() {
  if (!node.value || !certEditable.id) return
  const result = store.updateCertificate(node.value.id, certEditable.id, certEditable)
  toast.add({ severity: result.ok ? 'warn' : 'error', summary: result.message, life: 3200 })
  certVisible.value = false
}
const diffs = computed(() => (node.value ? store.basisDiffs(node.value.id) : []))
function openReview() { reviewNote.value = ''; reviewVisible.value = true }
function submitReview() {
  if (!node.value) return
  const result = store.reviewNode(node.value.id, reviewNote.value)
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 3000 })
  if (result.ok) reviewVisible.value = false
}
const stateSeverity = { 有效: 'success', 阻断: 'danger', 已复核: 'info' } as const
</script>

<template>
  <section v-if="node" class="page">
    <div class="section-head">
      <div><span>{{ node.id }} · {{ node.code }}</span><h2>{{ node.name }}</h2>
        <p>{{ node.type }} · 交付状态 {{ node.status }}<template v-if="frozenBasis && store.isDelivered"> · 签署时冻结依据 {{ frozenCount }} 项版本</template></p>
      </div>
      <div class="head-actions">
        <Tag v-if="store.isViewing" value="历史快照只读" severity="secondary" />
        <Tag v-else :value="nodeState" :severity="stateSeverity[nodeState]" />
        <Button v-if="nodeState === '阻断'" label="逐项复核并恢复" @click="openReview" />
      </div>
    </div>

    <div v-if="reasons.length" class="invalidation-panel">
      <h3><i class="pi pi-link" /> 修订链失效依据（{{ reasons.length }}）— 负责人逐项复核后方可恢复</h3>
      <article v-for="reason in reasons" :key="reason.id">
        <Tag :value="reason.sourceType" severity="warn" />
        <strong>{{ reason.sourceLabel }}</strong>
        <p>{{ reason.reason }}</p>
        <small>{{ reason.operator }} · {{ reason.createdAt.replace('T', ' ').slice(0, 16) }} · 失效链 {{ reason.affectedNodeIds.map((id) => store.nodeName(id)).join(' → ') }}</small>
      </article>
    </div>

    <div class="equipment-path"><span v-for="item in pathNodes" :key="item.id" :class="{ active: item.id === node.id }" @click="navigateTo(`/equipment/${item.id}`)">{{ item.name }}</span></div>
    <DataTable :value="node.items" dataKey="id" size="small">
      <Column field="id" header="编号" style="width:100px" />
      <Column field="standard" header="验收标准" />
      <Column field="method" header="测试方法" />
      <Column field="condition" header="测试条件" />
      <Column field="measured" header="实测结果" />
      <Column field="evidence" header="测试证据" />
      <Column header="状态"><template #body="{ data }"><Tag :value="data.status" :severity="data.status === '合格' ? 'success' : data.status === '不合格' ? 'danger' : 'warn'" /></template></Column>
      <Column header="依据/当前版本">
        <template #body="{ data }">
          <span v-if="frozenBasis && frozenBasis.items[data.id] !== undefined && frozenBasis.items[data.id] !== data.version" class="version-shift">R{{ store.viewingRevisionNo ?? store.currentRevisionNo }}冻结 V{{ frozenBasis.items[data.id] }} → V{{ data.version }}</span>
          <span v-else>V{{ data.version }}</span>
        </template>
      </Column>
      <Column header=""><template #body="{ data }"><Button v-if="!store.isViewing" label="录入/复核" text @click="openItem(data)" /></template></Column>
    </DataTable>
    <div class="certificate-panel">
      <h3>证书与测试附件</h3>
      <div v-for="certificate in node.certificates" :key="certificate.id" class="certificate-item">
        <Tag :value="certificate.verified ? '已核验' : '待核验'" :severity="certificate.verified ? 'success' : 'danger'" />
        <strong>{{ certificate.name }}</strong><span>{{ certificate.issuer }}</span><span>有效期至 {{ certificate.expiresAt }}</span>
        <small v-if="frozenBasis && frozenBasis.certificates[certificate.id] !== undefined && frozenBasis.certificates[certificate.id] !== certificate.version" class="version-shift">冻结V{{ frozenBasis.certificates[certificate.id] }} → V{{ certificate.version }}</small>
        <small v-else>V{{ certificate.version }}</small>
        <Button v-if="!store.isViewing" label="证书更新" text size="small" @click="openCertificate(certificate)" />
      </div>
      <p v-if="!node.certificates.length">当前设备节点暂无证书附件。</p>
    </div>

    <Dialog v-model:visible="visible" header="录入验收项（保存后版本递增；已交付时按依赖链失效上游）" modal :style="{ width: '620px' }">
      <div class="edit-grid">
        <label>状态<Select v-model="editable.status" :options="['待检查', '合格', '不合格', '待复验']" /></label>
        <label>实测结果<InputText v-model="editable.measured" /></label>
        <label>测试证据<InputText v-model="editable.evidence" /></label>
        <label>测试条件<Textarea v-model="editable.condition" rows="3" /></label>
      </div>
      <template #footer><Button label="取消" severity="secondary" text @click="visible = false" /><Button label="保存并递增版本" @click="save" /></template>
    </Dialog>

    <Dialog v-model:visible="certVisible" header="证书更新（只让依赖它的上游节点失效）" modal :style="{ width: '560px' }">
      <div class="edit-grid">
        <label>证书名称<InputText v-model="certEditable.name" /></label>
        <label>签发机构<InputText v-model="certEditable.issuer" /></label>
        <label>有效期至<InputText v-model="certEditable.expiresAt" type="date" /></label>
        <label>核验状态<Select v-model="certEditable.verified" :options="[{ label: '已核验', value: true }, { label: '待核验', value: false }]" /></label>
      </div>
      <template #footer><Button label="取消" severity="secondary" text @click="certVisible = false" /><Button label="更新证书并失效上游" @click="saveCertificate" /></template>
    </Dialog>

    <Dialog v-model:visible="reviewVisible" header="阻断节点逐项复核" modal :style="{ width: '700px' }">
      <p class="review-tip">依据签署快照 R{{ store.currentRevisionNo }} 逐项核对以下差异，全部确认后该节点恢复有效。</p>
      <DataTable :value="diffs" dataKey="label" size="small" v-if="diffs.length">
        <Column field="kind" header="类型" style="width:80px" />
        <Column field="label" header="对象" />
        <Column field="frozen" header="签署冻结依据" />
        <Column field="current" header="当前版本/状态" />
      </DataTable>
      <p v-else class="review-tip">该节点被上游更正波及，本节点自身依据版本无变化，确认上游更正有效即可恢复。</p>
      <div class="edit-grid" style="margin-top:12px"><label class="full">复核意见<Textarea v-model="reviewNote" rows="3" placeholder="逐项核对结论及证据" /></label></div>
      <template #footer><Button label="取消" severity="secondary" text @click="reviewVisible = false" /><Button label="确认复核，恢复节点有效" @click="submitReview" /></template>
    </Dialog>
  </section>
  <section v-else class="page">未找到设备节点</section>
</template>
