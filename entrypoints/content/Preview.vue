<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { formatSize } from '../../lib/files';
import { t } from '../../lib/i18n';
import { type Dimensions, drawContain } from './canvas';

const props = defineProps<{ file: File; dimensions: Dimensions | null }>();
const emit = defineEmits<{ close: [] }>();

const canvas = ref<HTMLCanvasElement>();
const size = ref<Dimensions | null>(props.dimensions);
const ready = ref(false);
const failed = ref(false);

onMounted(async () => {
  const element = canvas.value;
  if (!element) return;
  // Nearly the whole frame minus the padding and the caption line.
  const measured = await drawContain(
    props.file,
    element,
    {
      width: Math.max(240, window.innerWidth - 48),
      height: Math.max(180, window.innerHeight - 116),
    },
    props.dimensions,
  );
  size.value = measured;
  ready.value = measured !== null;
  failed.value = measured === null;
});
</script>

<template>
  <div class="fio-preview" @click="emit('close')">
    <canvas
      ref="canvas"
      class="fio-preview-canvas"
      :class="{ 'is-ready': ready }"
    />
    <p v-if="failed" class="fio-preview-failed">{{ t('errorPreviewFailed') }}</p>
    <p class="fio-preview-meta">
      {{ props.file.name }} · {{ formatSize(props.file.size) }}
      <template v-if="size"> · {{ size.width }} × {{ size.height }} px</template>
    </p>
  </div>
</template>
