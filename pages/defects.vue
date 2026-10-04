<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import Button from 'primevue/button'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import Tag from 'primevue/tag'
import Textarea from 'primevue/textarea'
import { useToast } from 'primevue/usetoast'
import { useAcceptanceStore } from '../stores/acceptance'
import type { AcceptanceDefect, PartyReply } from '../types/domain'

const store = useAcceptanceStore()
const toast = useToast()
const selected = ref<AcceptanceDefect | null>(null)
const replyVisible = ref(false)
const retestVisible = ref(false)
const reopenVisible = ref(false)
const reopenNote = ref('')
const reply = reactive<PartyReply>({ party: '设备厂家', owner: '', content: '', evidence: '', repliedAt: new Date().toISOString() })
const retest = reactive({ result: '', passed: true, note: '' })
const rows = computed(() => store.activeDefects.filter((item) => !store.keyword || `${item.id} ${item.title} ${item.owner} ${item.status}`.includes(store.keyword)))
function open(defect: AcceptanceDefect) { selected.value = defect }
function submitReply() {
  if (!selected.value) return
  const result = store.addReply(selected.value.id, { ...reply, repliedAt: new Date().toISOString() })
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 2500 })
  if (result.ok) replyVisible.value = false
}
function submitRetest() {
  if (!selected.value || !retest.result) return
  store.addRetest(selected.value.id, retest.result, retest.passed)
  toast.add({ severity: retest.passed ? 'success' : 'warn', summary: retest.passed ? '复验通过，缺陷已关闭' : '复验未通过，返回整改', life: 2500 })
  retestVisible.value = false
}
function decide(status: '已关闭' | '带条件通过' | '整改中') {
  if (!selected.value) return
  const result = store.decideDefect(selected.value.id, status, retest.note)
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 3000 })
}
function submitReopen() {
  if (!selected.value) return
  const result = store.reopenDefect(selected.value.id, reopenNote.value)
  toast.add({ severity: result.ok ? 'warn' : 'error', summary: result.message, life: 3200 })
  if (result.ok) reopenVisible.value = false
}
function nodeState(id: string) { return store.nodeStates[id] ?? '有效' }
const stateSeverity = { 有效: 'success', 阻断: 'danger', 已复核: 'info' } as const
</script>

<template>
  <section class="page">
    <div class="section-head">
      <div><h2>缺陷闭环处置</h2>
        <p>建设、设备厂家与运维单位分别提交说明，验收负责人决定通过、退回或带条件接受；交付后重开按设备依赖链失效。</p>
      </div>
      <InputText v-model="store.keyword" placeholder="搜索缺陷、责任方或状态" />
    </div>
    <DataTable :value="rows" dataKey="id" size="small" selectionMode="single" @rowSelect="(event: any) => open(event.data)">
      <Column field="id" header="编号" />
      <Column field="title" header="缺陷" />
      <Column field="equipmentId" header="设备" />
      <Column header="节点修订状态">
        <template #body="{ data }">
          <Tag v-if="store.isViewing" value="快照只读" severity="secondary" />
          <Tag v-else :value="nodeState(data.equipmentId)" :severity="stateSeverity[nodeState(data.equipmentId)]" />
        </template>
      </Column>
      <Column field="severity" header="严重度"><template #body="{ data }"><Tag :value="data.severity" :severity="data.severity === '重大' ? 'danger' : 'warn'" /></template></Column>
      <Column field="owner" header="责任方" />
      <Column field="dueDate" header="截止" />
      <Column header="状态"><template #body="{ data }"><Tag :value="data.status" :severity="data.status === '已关闭' ? 'success' : data.status === '带条件通过' ? 'info' : 'warn'" /></template></Column>
      <Column header="版本"><template #body="{ data }">V{{ data.version }}</template></Column>
    </DataTable>
    <div v-if="selected" class="detail-panel">
      <div class="detail-title">
        <div><span>{{ selected.id }} · {{ selected.equipmentId }}（{{ store.nodeName(selected.equipmentId) }}）</span><h3>{{ selected.title }}</h3></div>
        <div v-if="!store.isViewing">
          <Button label="多方回复" outlined @click="replyVisible = true" />
          <Button label="联合复验" @click="retestVisible = true" />
          <Button v-if="['已关闭', '带条件通过'].includes(selected.status)" label="缺陷重开" severity="danger" outlined @click="reopenVisible = true" />
        </div>
      </div>
      <div class="reply-list"><article v-for="item in selected.replies" :key="item.repliedAt"><Tag :value="item.party" /><strong>{{ item.owner }}</strong><p>{{ item.content }}</p><span>{{ item.evidence }} · {{ item.repliedAt.replace('T', ' ').slice(0, 16) }}</span></article></div>
      <div v-if="!store.isViewing" class="decision-band"><Textarea v-model="retest.note" rows="2" placeholder="验收决定说明，带条件接受时必须填写限制条件" /><Button label="通过并关闭" @click="decide('已关闭')" /><Button label="带条件接受" severity="secondary" outlined @click="decide('带条件通过')" /><Button label="退回整改" severity="danger" outlined @click="decide('整改中')" /></div>
    </div>
    <Dialog v-model:visible="replyVisible" header="提交多方处理说明" modal :style="{ width: '580px' }">
      <div class="edit-grid">
        <label>责任方<Select v-model="reply.party" :options="['建设单位', '设备厂家', '运维单位']" /></label>
        <label>回复人<InputText v-model="reply.owner" /></label>
        <label>处理说明<Textarea v-model="reply.content" rows="4" /></label>
        <label>证据附件<InputText v-model="reply.evidence" placeholder="整改记录或报告名称" /></label>
      </div>
      <template #footer><Button label="取消" text severity="secondary" @click="replyVisible = false" /><Button label="提交并进入复验" @click="submitReply" /></template>
    </Dialog>
    <Dialog v-model:visible="retestVisible" header="登记联合复验" modal :style="{ width: '520px' }">
      <div class="edit-grid"><label>复验结果<Textarea v-model="retest.result" rows="4" /></label><label>结论<Select v-model="retest.passed" :options="[{ label: '通过', value: true }, { label: '不通过', value: false }]" /></label></div>
      <template #footer><Button label="取消" text severity="secondary" @click="retestVisible = false" /><Button label="提交复验轮次" @click="submitRetest" /></template>
    </Dialog>
    <Dialog v-model:visible="reopenVisible" header="缺陷重开（按设备依赖链失效）" modal :style="{ width: '520px' }">
      <div class="edit-grid"><label class="full">重开原因（必填，将记录为失效依据）<Textarea v-model="reopenNote" rows="4" placeholder="如：交付后现场复现同类问题，需重新整改" /></label></div>
      <template #footer><Button label="取消" text severity="secondary" @click="reopenVisible = false" /><Button label="确认重开并失效上游" severity="danger" @click="submitReopen" /></template>
    </Dialog>
  </section>
</template>
