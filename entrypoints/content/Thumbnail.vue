<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { type Dimensions, drawCover } from './canvas';

const props = defineProps<{ file: File }>();
const emit = defineEmits<{ measured: [dimensions: Dimensions] }>();

const canvas = ref<HTMLCanvasElement>();
const rendered = ref(false);
const SIZE = 56;

// createImageBitmap takes the Blob directly, so no blob: URL has to survive the
// page's img-src policy. This first decode is also what yields the pixel size.
onMounted(async () => {
  const element = canvas.value;
  if (!element || !props.file.type.startsWith('image/')) return;
  const dimensions = await drawCover(props.file, element, SIZE);
  if (!dimensions) return;
  rendered.value = true;
  emit('measured', dimensions);
});

const label = props.file.name.split('.').pop()?.slice(0, 4).toUpperCase() ?? '?';
</script>

<template>
  <div class="fio-thumb">
    <canvas
      ref="canvas"
      class="fio-thumb-canvas"
      :class="{ 'is-ready': rendered }"
    />
    <span v-if="!rendered" class="fio-thumb-ext">{{ label }}</span>
  </div>
</template>
