<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import Toast from 'primevue/toast'
import { useAcceptanceStore } from './stores/acceptance'

const route = useRoute()
const store = useAcceptanceStore()
const title = computed(() => route.path.startsWith('/equipment') ? '设备树与验收项' : route.path.startsWith('/defects') ? '缺陷闭环处置' : route.path.startsWith('/audit') ? '签署与审计' : '并网验收总览')
onMounted(() => store.hydrate())
</script>

<template>
  <div class="app-shell">
    <Toast position="top-right" />
    <aside>
      <div class="brand"><b>光</b><div><strong>并网验收工作台</strong><small>设备、测试、证书与缺陷闭环</small></div></div>
      <nav>
        <NuxtLink to="/"><span>验收总览</span><small>{{ store.stats.total }}项</small></NuxtLink>
        <NuxtLink to="/equipment"><span>设备与测试</span><small>修订链</small></NuxtLink>
        <NuxtLink to="/defects"><span>缺陷闭环</span><small>{{ store.stats.openDefects }}项未闭</small></NuxtLink>
        <NuxtLink to="/audit"><span>签署与审计</span><small>{{ store.revisionLabel }}</small></NuxtLink>
      </nav>
      <div class="aside-state">
        <span>当前修订</span>
        <strong>{{ store.revisionLabel }}</strong>
        <span>并网前完整性检查</span>
        <strong :class="{ blocked: !store.preflight.allowed }">{{ store.preflight.allowed ? '允许签署新修订' : `${store.stats.blocking}个阻断节点` }}</strong>
        <small v-if="store.stats.conflicts">离线字段冲突 {{ store.stats.conflicts }} 项待裁决</small>
        <small>{{ store.plant.name }}</small>
      </div>
    </aside>
    <main>
      <header class="top"><div><span>电站工程中心 / 验收与交付</span><h1>{{ title }}</h1></div><div class="top-user"><small>验收负责人</small><strong>陆川</strong></div></header>
      <NuxtPage />
    </main>
  </div>
</template>
