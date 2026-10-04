<script setup lang="ts">
import { computed } from 'vue'
import Tag from 'primevue/tag'
import { useAcceptanceStore } from '../stores/acceptance'
import type { DeliverySnapshot } from '../types/domain'

const props = defineProps<{ snapshot?: DeliverySnapshot | null; snapshotRevision?: number | null }>()
const store = useAcceptanceStore()

const isSnapshot = computed(() => !!props.snapshot)
const blocking = computed(() => store.blockingNodes)
const stateSeverity = { 有效: 'success', 已复核待签署: 'info', 失效待复核: 'danger' } as const
</script>

<template>
  <!-- 历史快照只读模式 -->
  <div v-if="isSnapshot" class="revision-banner snapshot">
    <div class="rev-main">
      <span class="rev-icon pi pi-locked"></span>
      <div>
        <strong>历史交付快照 V{{ snapshotRevision }}（只读）</strong>
        <small>签署于 {{ snapshot?.plant ? (store.batches.find((b) => b.revision === snapshotRevision)?.signedAt ?? '').replace('T', ' ').slice(0, 16) : '' }} · {{ snapshot?.plant.name }} · 当前工作修订为 {{ store.revisionLabel }}，本快照不随后续更正变化</small>
      </div>
    </div>
    <Tag value="冻结不可变" severity="secondary" />
  </div>

  <!-- 当前工作修订 -->
  <div v-else class="revision-banner" :class="{ open: store.revisionOpen, clean: store.delivered && !store.revisionOpen }">
    <div class="rev-main">
      <span class="rev-icon" :class="store.revisionOpen ? 'pi pi-sync' : 'pi pi-check-circle'"></span>
      <div>
        <strong>{{ store.revisionLabel }}</strong>
        <small v-if="store.revisionOpen">基于已签署 V{{ store.plant.basedOnRevision }} 快照开立 · {{ store.plant.revisionNote }}</small>
        <small v-else-if="store.delivered">V{{ store.plant.version }} 已签署冻结，交付后的更正将自动开立下一修订，旧快照保持可查</small>
        <small v-else>交付前工作版，验收通过后签署首个交付修订</small>
      </div>
    </div>
    <div class="rev-blockers">
      <template v-if="blocking.length">
        <NuxtLink v-for="item in blocking" :key="item.node.id" :to="`/equipment/${item.node.id}`" class="blocker-chip" :class="item.state === '失效待复核' ? 'bad' : 'review'">
          <b>{{ item.node.name }}</b>
          <Tag :value="item.state" :severity="item.state === '失效待复核' ? 'danger' : 'info'" />
          <small v-if="item.reasons.length">{{ item.reasons.length }}项依据待复核</small>
          <small v-else>{{ item.conflictList.length }}项字段冲突待裁决</small>
        </NuxtLink>
      </template>
      <Tag v-else :value="store.delivered ? '全部节点依据有效' : '尚未交付'" :severity="store.delivered ? 'success' : 'warn'" />
    </div>
  </div>
</template>
