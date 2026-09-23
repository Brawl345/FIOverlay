<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef } from 'vue';
import { type EncodableType, encodeCanvas, paint } from '../../lib/convert';
import { generatedName } from '../../lib/files';
import { t } from '../../lib/i18n';

const props = defineProps<{ facing: string; type: EncodableType }>();
const emit = defineEmits<{ shot: [file: File]; close: [] }>();

const video = ref<HTMLVideoElement>();
const stream = shallowRef<MediaStream | null>(null);
const ready = ref(false);
const failed = ref(false);
const busy = ref(false);

function stop(): void {
  for (const track of stream.value?.getTracks() ?? []) track.stop();
  stream.value = null;
}

async function shoot(): Promise<void> {
  const element = video.value;
  if (!element || !ready.value || busy.value) return;
  busy.value = true;
  try {
    const canvas = paint(
      element,
      element.videoWidth,
      element.videoHeight,
      props.type,
    );
    const blob = await encodeCanvas(canvas, props.type);
    emit(
      'shot',
      new File([blob], generatedName(props.type, 'camera'), {
        type: props.type,
        lastModified: Date.now(),
      }),
    );
  } catch {
    failed.value = true;
  } finally {
    busy.value = false;
  }
}

let unmounted = false;

onMounted(async () => {
  try {
    // `ideal` keeps a machine with only one camera working.
    stream.value = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: props.facing } },
      audio: false,
    });
    // Closed while the permission prompt was still up.
    if (unmounted) {
      stop();
      return;
    }
    const element = video.value;
    if (!element) return;
    element.srcObject = stream.value;
    await element.play();
    ready.value = true;
  } catch {
    failed.value = true;
  }
});

onUnmounted(() => {
  unmounted = true;
  stop();
});
</script>

<template>
  <div class="fio-camera">
    <p v-if="failed" class="fio-camera-failed">{{ t('errorCameraFailed') }}</p>
    <video
      v-show="!failed"
      ref="video"
      class="fio-camera-view"
      autoplay
      muted
      playsinline
    />

    <div class="fio-camera-bar">
      <button type="button" class="fio-btn fio-btn-ghost" @click="emit('close')">
        {{ t('actionCancel') }}
      </button>
      <button
        type="button"
        class="fio-btn fio-btn-primary"
        :disabled="!ready || busy"
        @click="shoot"
      >
        {{ t('actionShutter') }}
      </button>
    </div>
  </div>
</template>
