<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue';
import {
  editOutputType,
  encodeCanvas,
  renameToType,
} from '../../lib/convert';
import { t } from '../../lib/i18n';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Corner = 'nw' | 'ne' | 'sw' | 'se';
type Grab =
  | { kind: 'move' }
  | { kind: 'draw' }
  | { kind: 'corner'; corner: Corner };

const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se'];
const MIN_CROP = 16;

const props = defineProps<{ file: File; name: string; accept: string }>();
const emit = defineEmits<{ apply: [file: File]; close: [] }>();

const canvas = ref<HTMLCanvasElement>();
const frame = ref<HTMLElement>();
const bitmap = shallowRef<ImageBitmap | null>(null);
const failed = ref(false);
const busy = ref(false);
const rotation = ref(0);
const crop = ref<Rect>({ x: 0, y: 0, width: 0, height: 0 });
const percent = ref(100);
const display = ref({ width: 0, height: 0 });

let grab: Grab | null = null;
let origin = { x: 0, y: 0 };
let before: Rect = { x: 0, y: 0, width: 0, height: 0 };

/** Size of the image in its current rotation. */
const rotated = computed(() => {
  const source = bitmap.value;
  if (!source) return { width: 0, height: 0 };
  return rotation.value % 180 === 0
    ? { width: source.width, height: source.height }
    : { width: source.height, height: source.width };
});

const scale = computed(() =>
  rotated.value.width ? display.value.width / rotated.value.width : 1,
);

const output = computed(() => ({
  width: Math.max(1, Math.round((crop.value.width * percent.value) / 100)),
  height: Math.max(1, Math.round((crop.value.height * percent.value) / 100)),
}));

/** With nothing cropped away a drag inside the rectangle starts a new crop. */
const full = computed(
  () =>
    crop.value.width >= rotated.value.width &&
    crop.value.height >= rotated.value.height,
);

const type = computed(() => editOutputType(props.file, props.accept));
const outputName = computed(() => renameToType(props.name, type.value));

const frameStyle = computed(() => ({
  width: `${display.value.width}px`,
  height: `${display.value.height}px`,
}));

const cropStyle = computed(() => ({
  left: `${crop.value.x * scale.value}px`,
  top: `${crop.value.y * scale.value}px`,
  width: `${crop.value.width * scale.value}px`,
  height: `${crop.value.height * scale.value}px`,
}));

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function resetCrop(): void {
  crop.value = {
    x: 0,
    y: 0,
    width: rotated.value.width,
    height: rotated.value.height,
  };
}

function fit(): void {
  const box = {
    width: Math.max(200, window.innerWidth - 80),
    height: Math.max(160, window.innerHeight - 220),
  };
  const size = rotated.value;
  if (!size.width || !size.height) return;
  const factor = Math.min(box.width / size.width, box.height / size.height, 1);
  display.value = {
    width: Math.round(size.width * factor),
    height: Math.round(size.height * factor),
  };
}

/**
 * Maps the source onto the canvas in the current rotation. The matrix does the
 * turning, so the bitmap is only ever drawn at its own origin.
 */
function transformFor(unit: number): DOMMatrix2DInit {
  const source = bitmap.value;
  const width = (source?.width ?? 0) * unit;
  const height = (source?.height ?? 0) * unit;
  switch (rotation.value) {
    case 90:
      return { a: 0, b: unit, c: -unit, d: 0, e: height, f: 0 };
    case 180:
      return { a: -unit, b: 0, c: 0, d: -unit, e: width, f: height };
    case 270:
      return { a: 0, b: -unit, c: unit, d: 0, e: 0, f: width };
    default:
      return { a: unit, b: 0, c: 0, d: unit, e: 0, f: 0 };
  }
}

function render(): void {
  const element = canvas.value;
  const source = bitmap.value;
  if (!element || !source) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  element.width = Math.max(1, Math.round(display.value.width * ratio));
  element.height = Math.max(1, Math.round(display.value.height * ratio));
  element.style.width = `${display.value.width}px`;
  element.style.height = `${display.value.height}px`;

  const context = element.getContext('2d');
  if (!context) return;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, element.width, element.height);
  context.imageSmoothingQuality = 'high';
  context.setTransform(transformFor(scale.value * ratio));
  context.drawImage(source, 0, 0);
}

/** Turns the crop with the image so the same pixels stay selected. */
function rotate(step: 90 | -90): void {
  const size = rotated.value;
  const area = crop.value;
  crop.value =
    step === 90
      ? {
          x: size.height - (area.y + area.height),
          y: area.x,
          width: area.height,
          height: area.width,
        }
      : {
          x: area.y,
          y: size.width - (area.x + area.width),
          width: area.height,
          height: area.width,
        };
  rotation.value = (rotation.value + step + 360) % 360;
  fit();
  render();
}

function pointIn(event: PointerEvent): { x: number; y: number } {
  const box = frame.value?.getBoundingClientRect();
  if (!box) return { x: 0, y: 0 };
  return {
    x: clamp((event.clientX - box.left) / scale.value, 0, rotated.value.width),
    y: clamp((event.clientY - box.top) / scale.value, 0, rotated.value.height),
  };
}

function start(event: PointerEvent, kind: Grab): void {
  grab = kind;
  origin = pointIn(event);
  before = { ...crop.value };
  if (kind.kind === 'draw') {
    crop.value = { x: origin.x, y: origin.y, width: 0, height: 0 };
  }
  capture(event, true);
}

/** Keeps the drag alive outside the frame; a stale pointer id must not throw. */
function capture(event: PointerEvent, hold: boolean): void {
  try {
    if (hold) frame.value?.setPointerCapture(event.pointerId);
    else frame.value?.releasePointerCapture(event.pointerId);
  } catch {
    // The pointer is already gone.
  }
}

function onMove(event: PointerEvent): void {
  if (!grab) return;
  const point = pointIn(event);
  const size = rotated.value;

  if (grab.kind === 'move') {
    crop.value = {
      ...before,
      x: clamp(before.x + point.x - origin.x, 0, size.width - before.width),
      y: clamp(before.y + point.y - origin.y, 0, size.height - before.height),
    };
    return;
  }

  const anchor =
    grab.kind === 'draw'
      ? origin
      : {
          x: grab.corner.includes('w') ? before.x + before.width : before.x,
          y: grab.corner.startsWith('n') ? before.y + before.height : before.y,
        };
  crop.value = {
    x: Math.min(anchor.x, point.x),
    y: Math.min(anchor.y, point.y),
    width: Math.abs(point.x - anchor.x),
    height: Math.abs(point.y - anchor.y),
  };
}

function onUp(event: PointerEvent): void {
  if (!grab) return;
  grab = null;
  capture(event, false);
  const size = rotated.value;
  const area = crop.value;
  if (area.width < MIN_CROP || area.height < MIN_CROP) {
    crop.value = { ...before };
    return;
  }
  crop.value = {
    x: clamp(area.x, 0, size.width - MIN_CROP),
    y: clamp(area.y, 0, size.height - MIN_CROP),
    width: Math.min(area.width, size.width - area.x),
    height: Math.min(area.height, size.height - area.y),
  };
}

function reset(): void {
  rotation.value = 0;
  percent.value = 100;
  resetCrop();
  fit();
  render();
}

/**
 * Rotation, crop and scale are one matrix, so the bitmap is drawn straight
 * into a canvas of the output size.
 */
async function save(): Promise<void> {
  const source = bitmap.value;
  if (!source || busy.value) return;
  busy.value = true;
  try {
    const target = document.createElement('canvas');
    target.width = output.value.width;
    target.height = output.value.height;
    const out = target.getContext('2d');
    if (!out) throw new Error('no 2d context');
    if (type.value === 'image/jpeg') {
      out.fillStyle = '#ffffff';
      out.fillRect(0, 0, target.width, target.height);
    }
    out.imageSmoothingQuality = 'high';
    const area = crop.value;
    const scaleX = target.width / area.width;
    const scaleY = target.height / area.height;
    out.setTransform(
      new DOMMatrix([scaleX, 0, 0, scaleY, -area.x * scaleX, -area.y * scaleY])
        .multiply(DOMMatrix.fromMatrix(transformFor(1))),
    );
    out.drawImage(source, 0, 0);

    const blob = await encodeCanvas(target, type.value);
    emit(
      'apply',
      new File([blob], outputName.value, {
        type: type.value,
        lastModified: Date.now(),
      }),
    );
  } catch {
    failed.value = true;
  } finally {
    busy.value = false;
  }
}

function onResize(): void {
  fit();
  render();
}

let unmounted = false;

onMounted(async () => {
  let decoded: ImageBitmap;
  try {
    decoded = await createImageBitmap(props.file);
  } catch {
    failed.value = true;
    return;
  }
  if (unmounted) {
    decoded.close();
    return;
  }
  bitmap.value = decoded;
  resetCrop();
  fit();
  render();
  window.addEventListener('resize', onResize);
});

onUnmounted(() => {
  unmounted = true;
  window.removeEventListener('resize', onResize);
  bitmap.value?.close();
});
</script>

<template>
  <div class="fio-editor">
    <p v-if="failed" class="fio-editor-failed">{{ t('errorPreviewFailed') }}</p>

    <div
      v-else
      ref="frame"
      class="fio-editor-frame"
      :style="frameStyle"
      @pointerdown.stop="start($event, { kind: 'draw' })"
      @pointermove.stop="onMove"
      @pointerup.stop="onUp"
      @pointercancel.stop="onUp"
    >
      <canvas ref="canvas" class="fio-editor-canvas" />
      <div
        class="fio-crop"
        :style="cropStyle"
        @pointerdown.stop="start($event, { kind: full ? 'draw' : 'move' })"
      >
        <span
          v-for="corner in CORNERS"
          :key="corner"
          class="fio-crop-handle"
          :class="`is-${corner}`"
          @pointerdown.stop="start($event, { kind: 'corner', corner })"
        />
      </div>
    </div>

    <div class="fio-editor-bar">
      <div class="fio-editor-tools">
        <button
          type="button"
          class="fio-icon-btn"
          :aria-label="t('actionRotateLeft')"
          :title="t('actionRotateLeft')"
          @click="rotate(-90)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          class="fio-icon-btn"
          :aria-label="t('actionRotateRight')"
          :title="t('actionRotateRight')"
          @click="rotate(90)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8M21 3v5h-5"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <label class="fio-editor-scale">
          <span>{{ t('labelScale') }}</span>
          <input
            v-model.number="percent"
            type="range"
            min="5"
            max="100"
            step="1"
            class="fio-range"
          />
          <span class="fio-editor-value">{{ percent }} %</span>
        </label>
      </div>

      <p class="fio-editor-meta">
        {{ outputName }} · {{ output.width }} × {{ output.height }} px
      </p>

      <div class="fio-editor-actions">
        <button type="button" class="fio-btn fio-btn-ghost" @click="reset">
          {{ t('actionReset') }}
        </button>
        <button
          type="button"
          class="fio-btn fio-btn-ghost"
          @click="emit('close')"
        >
          {{ t('actionCancel') }}
        </button>
        <button
          type="button"
          class="fio-btn fio-btn-primary"
          :disabled="busy || failed"
          @click="save"
        >
          {{ t('actionApplyEdit') }}
        </button>
      </div>
    </div>
  </div>
</template>
