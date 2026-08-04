<template>
  <img
    v-if="active && src"
    class="lazy-thumb"
    :src="src"
    :alt="alt"
    decoding="async"
    draggable="false"
    @error="onError"
  />
  <span
    v-else
    ref="sentinel"
    class="lazy-thumb-ph"
    aria-hidden="true"
  />
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    src: string;
    alt?: string;
    /** Extra margin around viewport before load (px or CSS). */
    rootMargin?: string;
  }>(),
  {
    alt: '',
    rootMargin: '120px',
  },
);

const sentinel = ref<HTMLElement | null>(null);
const active = ref(false);
const failed = ref(false);
let io: IntersectionObserver | null = null;

function disconnect(): void {
  io?.disconnect();
  io = null;
}

function onError(): void {
  failed.value = true;
  active.value = false;
}

async function observe(): Promise<void> {
  disconnect();
  failed.value = false;
  active.value = false;
  await nextTick();

  const node = sentinel.value;
  if (!node || !props.src) return;

  if (typeof IntersectionObserver === 'undefined') {
    active.value = true;
    return;
  }

  io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        if (!failed.value) active.value = true;
        disconnect();
        break;
      }
    },
    { root: null, rootMargin: props.rootMargin, threshold: 0.01 },
  );
  io.observe(node);
}

onMounted(() => {
  void observe();
});

watch(
  () => props.src,
  () => {
    void observe();
  },
);

onBeforeUnmount(() => {
  disconnect();
});
</script>

<style scoped>
.lazy-thumb,
.lazy-thumb-ph {
  display: block;
  width: 100%;
  height: 100%;
}

.lazy-thumb {
  object-fit: cover;
}
</style>
