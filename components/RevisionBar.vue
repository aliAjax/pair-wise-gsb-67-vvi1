<script setup lang="ts">
import { computed } from 'vue'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import { useToast } from 'primevue/usetoast'
import { useAcceptanceStore } from '../stores/acceptance'

const store = useAcceptanceStore()
const toast = useToast()

const revisionLabel = computed(() =>
  store.isDelivered ? `R${store.currentRevisionNo}（${store.latestSignedBatch?.id}）` : '工作区 · 尚未签署'
)
const invalidatedCount = computed(() => store.invalidatedNodeIds.size)

function backToLive() { store.viewingRevisionNo = null }
function createRevision() {
  const result = store.createRevision()
  toast.add({ severity: result.ok ? 'success' : 'error', summary: result.message, life: 4000 })
}
</script>

<template>
  <div class="revision-bar" :class="{ viewing: store.isViewing }">
    <template v-if="store.isViewing && store.viewSnapshot">
      <i class="pi pi-history" />
      <div class="rb-main">
        <strong>正在查看历史修订 R{{ store.viewSnapshot.revisionNo }} 的不可变交付快照</strong>
        <small>{{ store.viewSnapshot.signBatchId }} · {{ store.viewSnapshot.createdAt.replace('T', ' ').slice(0, 16) }} 冻结 · 只读，任何更正不回写此快照</small>
      </div>
      <Button label="返回当前工作区" size="small" outlined @click="backToLive" />
    </template>
    <template v-else>
      <i class="pi pi-sitemap" />
      <div class="rb-main">
        <strong>当前修订：{{ revisionLabel }}</strong>
        <small>
          电站版本 V{{ store.plant.version }} · {{ store.plant.status }}
          <template v-if="store.isDelivered"> · 已交付 {{ store.signBatches.length }} 个修订</template>
        </small>
      </div>
      <div class="rb-tags">
        <Tag v-if="invalidatedCount" :value="`失效 ${invalidatedCount} 节点`" severity="warn" />
        <Tag v-if="store.blockingNodes.length" :value="`阻断 ${store.blockingNodes.length}`" severity="danger" />
        <Tag v-if="store.reviewedNodes.length" :value="`已复核 ${store.reviewedNodes.length}`" severity="info" />
        <Tag v-if="store.unresolvedConflicts.length" :value="`待裁定字段 ${store.unresolvedConflicts.length}`" severity="danger" />
        <Tag v-if="store.isDelivered && !invalidatedCount" value="全部节点有效" severity="success" />
      </div>
      <div v-if="store.blockingNodes.length" class="rb-nodes">
        <span v-for="node in store.blockingNodes" :key="node.id" class="rb-chip blocker">
          <i class="pi pi-ban" />{{ node.name }}
        </span>
      </div>
      <Button v-if="store.revisionReady" label="全部恢复，生成新修订" size="small" @click="createRevision" />
      <Tag v-else-if="store.isDelivered && invalidatedCount" value="待全部阻断节点复核" severity="warn" />
    </template>
  </div>
</template>
