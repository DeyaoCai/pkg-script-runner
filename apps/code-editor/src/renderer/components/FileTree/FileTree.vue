<template>
  <!-- 6 / 13 共用目录：code=全量文件，docs=文档过滤 -->
  <DirTree :ctrl="ctrl" :variant="ctrl.zone" />
</template>

<script setup lang="ts">
import DirTree from './DirTree.vue';
import type { FileTreeCtrl } from './FileTreeCtrl.ts';

defineProps<{ ctrl: FileTreeCtrl }>();
</script>
