<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
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
import RevisionBanner from '../../components/RevisionBanner.vue'
import { useAcceptanceStore } from '../../stores/acceptance'
import type { AcceptanceItem, Certificate } from '../../types/domain'

const route = useRoute()
const store = useAcceptanceStore()
const toast = useToast()
const node = computed(() => store.equipment.find((item) => item.id === route.params.id))
const state = computed(() => node.value ? store.stateOf(node.value) : null)
const reasons = computed(() => node.value ? store.openReasons(node.value) : [])
const cleared = computed(() => node.value?.invalidations.filter((item) => item.clearedAt) ?? [])
const nodeConflicts = computed(() => node.value ? store.unresolvedConflictsOf(node.value.id) : [])

const itemVisible = ref(false)
const editable = reactive<Partial<AcceptanceItem>>({})
function openItem(item: AcceptanceItem) { Object.assign(editable, structuredClone(item)); itemVisible.value = true }
function save() {
  if (!node.value || !editable.id) return
  const creatingRevision = store.delivered && store.plant.status === '已签署'
  store.updateItem(node.value.id, editable.id, editable)
  toast.add({ severity: 'success', summary: creatingRevision ? '验收项已更正，修订已开立' : '验收项已保存', detail: creatingRevision ? '本节点及上游依据已按依赖链标记失效' : '依据版本已递增', life: 3200 })
  itemVisible.value = false
}

const certVisible = ref(false)
const certEdit = reactive<Partial<Certificate>>({})
function openCert(cert: Certificate) { Object.assign(certEdit, structuredClone(cert)); certVisible.value = true }
function saveCert() {
  if (!node.value || !certEdit.id) return
  const result = store.updateCertificate(node.value.id, certEdit.id, certEdit)
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 3200 })
  if (result.ok) certVisible.value = false
}
function review() {
  if (!node.value) return
  const result = store.reviewNode(node.value.id)
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 3600 })
}
const sourceSeverity: Record<string, 'warn' | 'danger' | 'info'> = { 验收项更正: 'warn', 证书更新: 'info', 缺陷重开: 'danger', 离线同步: 'info', 离线冲突: 'danger' }
</script>

<template>
  <section v-if="node" class="page">
    <RevisionBanner />
    <div class="section-head">
      <div><span>{{ node.id }} · {{ node.code }}</span><h2>{{ node.name }}</h2>
        <p>{{ node.type }} · 签署冻结依据 项V{{ node.itemBasis }}/证V{{ node.certBasis }}/陷V{{ node.defectBasis }} · 当前 项V{{ node.itemVersion }}/证V{{ node.certVersion }}/陷V{{ node.defectVersion }}</p>
      </div>
      <div class="head-actions">
        <Tag v-if="state" :value="state" :severity="state === '有效' ? 'success' : state === '已复核待签署' ? 'info' : 'danger'" />
        <Button v-if="state === '失效待复核'" label="负责人逐项复核恢复" @click="review" />
      </div>
    </div>

    <div v-if="reasons.length || nodeConflicts.length" class="invalidation-panel">
      <h3>阻断本节点的失效依据（{{ reasons.length + nodeConflicts.length }}）</h3>
      <div v-for="reason in reasons" :key="reason.id" class="invalidation-item">
        <Tag :value="reason.source" :severity="sourceSeverity[reason.source] ?? 'warn'" />
        <div><strong>{{ reason.label }}</strong><small>{{ reason.entityId }} · {{ reason.createdAt.replace('T', ' ').slice(0, 16) }} 产生，沿设备依赖链传播到本节点</small></div>
      </div>
      <div v-for="conflict in nodeConflicts" :key="conflict.id" class="invalidation-item conflict">
        <Tag value="离线冲突" severity="danger" />
        <div><strong>{{ conflict.fieldLabel }}两版并存待裁决</strong>
          <small>本地「{{ conflict.localValue }}」 vs 现场「{{ conflict.remoteValue }}」（基线：{{ conflict.baseValue || '空' }}） · {{ conflict.batchId }}</small>
        </div>
        <NuxtLink to="/audit"><Button label="去审计页裁决" text size="small" /></NuxtLink>
      </div>
    </div>

    <div class="equipment-path"><span v-for="item in store.equipment.filter((value) => value.parentId === node?.parentId || value.id === node?.id)" :key="item.id" :class="{ active: item.id === node.id }" @click="navigateTo(`/equipment/${item.id}`)">{{ item.name }}</span></div>
    <DataTable :value="node.items" dataKey="id" size="small">
      <Column field="id" header="编号" style="width:100px" />
      <Column field="standard" header="验收标准" />
      <Column field="method" header="测试方法" />
      <Column field="condition" header="测试条件" />
      <Column field="measured" header="实测结果" />
      <Column field="evidence" header="测试证据" />
      <Column header="状态"><template #body="{ data }"><Tag :value="data.status" :severity="data.status === '合格' ? 'success' : data.status === '不合格' ? 'danger' : 'warn'" /></template></Column>
      <Column header="版本"><template #body="{ data }">V{{ data.version }}</template></Column>
      <Column header=""><template #body="{ data }"><Button label="录入/复核" text @click="openItem(data)" /></template></Column>
    </DataTable>
    <div class="certificate-panel">
      <h3>证书与测试附件</h3>
      <div v-for="certificate in node.certificates" :key="certificate.id" class="certificate-item">
        <Tag :value="certificate.verified ? '已核验' : '待核验'" :severity="certificate.verified ? 'success' : 'danger'" />
        <strong>{{ certificate.name }}</strong><span>{{ certificate.issuer }}</span><span>有效期至 {{ certificate.expiresAt }}</span><small>V{{ certificate.version }}</small>
        <Button label="更新证书" text size="small" @click="openCert(certificate)" />
      </div>
      <p v-if="!node.certificates.length">当前设备节点暂无证书附件。</p>
    </div>
    <div v-if="cleared.length" class="cleared-panel">
      <h3>本修订已复核恢复的依据（{{ cleared.length }}）</h3>
      <small v-for="reason in cleared" :key="reason.id">[{{ reason.source }}] {{ reason.label }} — {{ reason.reviewer }} 于 {{ reason.clearedAt!.replace('T', ' ').slice(0, 16) }} 复核通过</small>
    </div>
    <Dialog v-model:visible="itemVisible" header="录入验收项（交付后更正将开立修订并使依赖链失效）" modal :style="{ width: '620px' }">
      <div class="edit-grid">
        <label>状态<Select v-model="editable.status" :options="['待检查', '合格', '不合格', '待复验']" /></label>
        <label>实测结果<InputText v-model="editable.measured" /></label>
        <label>测试证据<InputText v-model="editable.evidence" /></label>
        <label>测试条件<Textarea v-model="editable.condition" rows="3" /></label>
      </div>
      <template #footer><Button label="取消" severity="secondary" text @click="itemVisible = false" /><Button label="保存并递增版本" @click="save" /></template>
    </Dialog>
    <Dialog v-model:visible="certVisible" header="证书更新（仅依赖链上游节点失效）" modal :style="{ width: '560px' }">
      <div class="edit-grid">
        <label>证书名称<InputText v-model="certEdit.name" /></label>
        <label>签发机构<InputText v-model="certEdit.issuer" /></label>
        <label>有效期至<InputText v-model="certEdit.expiresAt" type="date" /></label>
        <label>核验状态<Select v-model="certEdit.verified" :options="[{ label: '已核验', value: true }, { label: '待核验', value: false }]" optionLabel="label" optionValue="value" /></label>
      </div>
      <template #footer><Button label="取消" severity="secondary" text @click="certVisible = false" /><Button label="保存换版" @click="saveCert" /></template>
    </Dialog>
  </section>
  <section v-else class="page">未找到设备节点</section>
</template>
