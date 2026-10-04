<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import Tag from 'primevue/tag'
import { useAcceptanceStore } from './stores/acceptance'

const route = useRoute()
const store = useAcceptanceStore()
const title = computed(() => route.path.startsWith('/equipment') ? '设备树与验收项' : route.path.startsWith('/defects') ? '缺陷闭环处置' : route.path.startsWith('/audit') ? '签署、修订与审计' : '并网验收总览')
onMounted(() => store.hydrate())
</script>

<template>
  <div class="app-shell">
    <aside>
      <div class="brand"><b>光</b><div><strong>并网验收工作台</strong><small>设备、测试、证书与缺陷闭环</small></div></div>
      <nav>
        <NuxtLink to="/"><span>验收总览</span><small>{{ store.stats.total }}项</small></NuxtLink>
        <NuxtLink to="/equipment"><span>设备与测试</span><small>设备树</small></NuxtLink>
        <NuxtLink to="/defects"><span>缺陷闭环</span><small>{{ store.stats.openDefects }}项</small></NuxtLink>
        <NuxtLink to="/audit"><span>签署与审计</span><small>{{ store.isDelivered ? `R${store.currentRevisionNo}` : `V${store.plant.version}` }}</small></NuxtLink>
      </nav>
      <div class="aside-state">
        <span>当前修订 / 完整性</span>
        <strong>{{ store.isDelivered ? `R${store.currentRevisionNo} 已交付` : '未签署（工作区）' }}</strong>
        <Tag v-if="store.blockingNodes.length" :value="`阻断节点 ${store.blockingNodes.length}`" severity="danger" />
        <Tag v-else-if="store.isDelivered && store.invalidatedNodeIds.size" value="存在失效节点" severity="warn" />
        <Tag v-else-if="store.isDelivered" value="快照有效" severity="success" />
        <Tag v-else :value="store.preflight.allowed ? '允许申请复核' : `${store.preflight.blocking.length}项阻断`" :severity="store.preflight.allowed ? 'success' : 'danger'" />
        <small>{{ store.plant.name }}</small>
      </div>
    </aside>
    <main>
      <header class="top">
        <div><span>电站工程中心 / 验收与交付</span><h1>{{ title }}</h1></div>
        <div class="top-user"><small>验收负责人</small><strong>陆川</strong></div>
      </header>
      <RevisionBar />
      <NuxtPage />
    </main>
  </div>
</template>
