<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef } from 'vue';
import {
  type DownloadProgress,
  downloadUrl,
  filesFromClipboardApi,
  filesFromDataTransfer,
  type PickResult,
} from '../../lib/clipboard';
import {
  formatSize,
  isDownloadableUrl,
  matchesAccept,
  sanitizeFileName,
  splitFileName,
} from '../../lib/files';
import { t } from '../../lib/i18n';
import type { Dimensions } from './canvas';
import Logo from './Logo.vue';
import Preview from './Preview.vue';
import Thumbnail from './Thumbnail.vue';

interface Item {
  id: number;
  file: File;
  name: string;
  dimensions: Dimensions | null;
}

const props = defineProps<{ accept: string; multiple: boolean }>();
const emit = defineEmits<{
  confirm: [files: File[]];
  cancel: [];
}>();

const root = ref<HTMLElement>();
const picker = ref<HTMLInputElement>();
const items = shallowRef<Item[]>([]);
const preview = shallowRef<Item | null>(null);
const url = ref('');
const error = ref('');
const busy = ref(false);
const progress = ref<DownloadProgress | null>(null);
const dragDepth = ref(0);
const editing = ref<number | null>(null);
const draft = ref('');
let nextId = 0;

const accept = computed(() => props.accept.trim());
const dragging = computed(() => dragDepth.value > 0);
const canConfirm = computed(() => items.value.length > 0 && !busy.value);
// Deliberately not gated on the scheme: an unusable URL earns an explanation,
// not a button that silently stays dead.
const canFetch = computed(() => !busy.value && url.value.trim().length > 0);
const pasteHint = computed(() =>
  t('dropHint', /mac/i.test(navigator.userAgent) ? '⌘V' : 'Ctrl+V'),
);
const confirmLabel = computed(() =>
  items.value.length > 1
    ? t('actionConfirmMany', String(items.value.length))
    : t('actionConfirm'),
);
const percent = computed(() => {
  const current = progress.value;
  if (!current?.total) return null;
  return Math.min(100, Math.round((current.loaded / current.total) * 100));
});
const progressLabel = computed(() => {
  const current = progress.value;
  if (!current) return '';
  return current.total
    ? `${formatSize(current.loaded)} / ${formatSize(current.total)}`
    : formatSize(current.loaded);
});

function addFiles(files: readonly File[]): void {
  const pattern = accept.value;
  const accepted = files.filter(
    (file) => !pattern || matchesAccept(file, pattern),
  );
  const rejected = files.length - accepted.length;

  if (accepted.length === 0) {
    error.value =
      rejected > 0 ? t('errorAcceptMismatch', pattern) : t('errorClipboardEmpty');
    return;
  }

  error.value = rejected > 0 ? t('errorSomeRejected', String(rejected)) : '';
  const mapped = accepted.map((file) => ({
    id: nextId++,
    file,
    name: file.name,
    dimensions: null,
  }));
  items.value = props.multiple ? [...items.value, ...mapped] : mapped.slice(-1);
}

function measured(id: number, dimensions: Dimensions): void {
  items.value = items.value.map((item) =>
    item.id === id ? { ...item, dimensions } : item,
  );
}

function apply(result: PickResult): void {
  if (result.files.length > 0) addFiles(result.files);
  else if (result.error) error.value = t(result.error);
}

async function run(
  task: (onProgress: (value: DownloadProgress) => void) => Promise<PickResult>,
): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  progress.value = null;
  try {
    apply(await task((value) => (progress.value = value)));
  } catch {
    error.value = t('errorUnexpected');
  } finally {
    busy.value = false;
    progress.value = null;
  }
}

function fetchUrl(): void {
  if (!canFetch.value) return;
  const target = url.value.trim();
  if (!isDownloadableUrl(target)) {
    error.value = t('errorInvalidUrl');
    return;
  }
  void run((onProgress) => downloadUrl(target, onProgress)).then(() => {
    if (!error.value) url.value = '';
  });
}

function onDrop(event: DragEvent): void {
  dragDepth.value = 0;
  const transfer = event.dataTransfer;
  void run((onProgress) => filesFromDataTransfer(transfer, onProgress));
}

function onDragOver(event: DragEvent): void {
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
}

/**
 * Our own picker inside the shadow root: the native dialog still opens, but its
 * result lands in the queue instead of ending the overlay.
 */
function browse(): void {
  picker.value?.click();
}

function onPicked(event: Event): void {
  const input = event.target as HTMLInputElement;
  const picked = Array.from(input.files ?? []);
  input.value = '';
  if (picked.length > 0) {
    error.value = '';
    addFiles(picked);
  }
}

function remove(id: number): void {
  if (editing.value === id) editing.value = null;
  items.value = items.value.filter((item) => item.id !== id);
}

function startRename(item: Item): void {
  editing.value = item.id;
  draft.value = item.name;
  void nextTick(() => {
    const field = root.value?.querySelector<HTMLInputElement>('.fio-item-field');
    if (!field) return;
    field.focus();
    // Finder behaviour: the extension stays out of the selection.
    field.setSelectionRange(0, splitFileName(item.name)[0].length);
  });
}

function stopRename(): void {
  editing.value = null;
}

function commitRename(): void {
  const id = editing.value;
  editing.value = null;
  if (id === null) return;
  items.value = items.value.map((item) =>
    item.id === id ? { ...item, name: renameTo(draft.value, item.name) } : item,
  );
}

/** An input without an extension keeps the previous one - the page's `accept`
 * usually rides on it. */
function renameTo(input: string, previous: string): string {
  const cleaned = sanitizeFileName(input);
  if (!cleaned) return previous;
  return splitFileName(cleaned)[1]
    ? cleaned
    : cleaned + splitFileName(previous)[1];
}

/** The bytes stay untouched; only the name the page receives changes. */
function fileOf(item: Item): File {
  if (item.name === item.file.name) return item.file;
  return new File([item.file], item.name, {
    type: item.file.type,
    lastModified: item.file.lastModified,
  });
}

function show(item: Item): void {
  if (item.file.type.startsWith('image/')) preview.value = item;
}

function confirm(): void {
  if (!canConfirm.value) return;
  emit('confirm', items.value.map(fileOf));
}

// Fed by the capture listeners that were installed at document_start.
defineExpose({
  pasteFrom: (transfer: DataTransfer | null) =>
    void run((onProgress) => filesFromDataTransfer(transfer, onProgress)),
  fail: (messageKey: string) => {
    error.value = t(messageKey);
  },
  /** True when the overlay handled Escape itself. */
  dismiss: (): boolean => {
    if (preview.value) {
      preview.value = null;
      return true;
    }
    if (editing.value !== null) {
      stopRename();
      return true;
    }
    return false;
  },
  submit: (): void => {
    if (preview.value) {
      preview.value = null;
      return;
    }
    confirm();
  },
});

onMounted(() => root.value?.focus({ preventScroll: true }));
</script>

<template>
  <div
    ref="root"
    class="fio-root"
    tabindex="-1"
    @click.stop
    @mousedown.stop
    @keydown.stop
    @dragenter.prevent.stop="dragDepth++"
    @dragleave.prevent.stop="dragDepth--"
    @dragover.prevent.stop="onDragOver"
    @drop.prevent.stop="onDrop"
  >
    <div class="fio-backdrop" @click="emit('cancel')" />

    <div
      class="fio-card"
      role="dialog"
      aria-modal="true"
      :aria-label="t('overlayTitle')"
    >
      <header class="fio-head">
        <Logo />
        <h1 class="fio-title">{{ t('overlayTitle') }}</h1>
        <button
          type="button"
          class="fio-icon-btn"
          :aria-label="t('actionCancel')"
          @click="emit('cancel')"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="m6 6 12 12M18 6 6 18"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </header>

      <div class="fio-zone" :class="{ 'is-dragging': dragging }">
        <svg class="fio-zone-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 15.5V4m0 0L8.2 7.8M12 4l3.8 3.8M4 14v3.5A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V14"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <p class="fio-zone-title">{{ t('dropTitle') }}</p>
        <p class="fio-zone-hint">{{ pasteHint }}</p>
        <div class="fio-zone-actions">
          <button
            type="button"
            class="fio-btn"
            :disabled="busy"
            @click="run(filesFromClipboardApi)"
          >
            {{ t('actionPaste') }}
          </button>
          <button type="button" class="fio-btn fio-btn-ghost" @click="browse">
            {{ t('actionBrowse') }}
          </button>
        </div>
        <input
          ref="picker"
          type="file"
          class="fio-hidden"
          :accept="accept"
          :multiple="multiple"
          tabindex="-1"
          aria-hidden="true"
          @change="onPicked"
        />
      </div>

      <form class="fio-url" @submit.prevent="fetchUrl">
        <input
          v-model="url"
          type="text"
          class="fio-field"
          :placeholder="t('urlPlaceholder')"
          :disabled="busy"
          spellcheck="false"
          autocomplete="off"
        />
        <button type="submit" class="fio-btn" :disabled="!canFetch">
          {{ t('actionFetch') }}
        </button>
      </form>

      <div v-if="busy" class="fio-progress">
        <div class="fio-progress-track">
          <div
            class="fio-progress-bar"
            :class="{ 'is-indeterminate': percent === null }"
            :style="percent === null ? undefined : { width: `${percent}%` }"
          />
        </div>
        <span class="fio-progress-label">{{ progressLabel }}</span>
      </div>

      <p v-if="accept" class="fio-meta">{{ t('acceptHint', accept) }}</p>
      <p v-if="error" class="fio-error">{{ error }}</p>

      <ul v-if="items.length" class="fio-list">
        <li v-for="item in items" :key="item.id" class="fio-item">
          <button
            type="button"
            class="fio-thumb-btn"
            :aria-label="t('actionPreview')"
            @click="show(item)"
          >
            <Thumbnail
              :file="item.file"
              :name="item.name"
              @measured="(dimensions) => measured(item.id, dimensions)"
            />
          </button>
          <span class="fio-item-text">
            <input
              v-if="editing === item.id"
              v-model="draft"
              type="text"
              class="fio-field fio-item-field"
              :aria-label="t('actionRename')"
              spellcheck="false"
              autocomplete="off"
              @keydown.enter.prevent.stop="commitRename"
              @blur="commitRename"
            />
            <button
              v-else
              type="button"
              class="fio-item-name"
              :title="t('actionRename')"
              @click="startRename(item)"
            >
              {{ item.name }}
            </button>
            <span class="fio-item-size">
              {{ formatSize(item.file.size) }}
              <template v-if="item.dimensions">
                · {{ item.dimensions.width }} × {{ item.dimensions.height }} px
              </template>
            </span>
          </span>
          <button
            type="button"
            class="fio-icon-btn"
            :aria-label="t('actionRemove')"
            @click="remove(item.id)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="m6 6 12 12M18 6 6 18"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </li>
      </ul>

      <footer class="fio-foot">
        <button type="button" class="fio-btn fio-btn-ghost" @click="emit('cancel')">
          {{ t('actionCancel') }}
        </button>
        <button
          type="button"
          class="fio-btn fio-btn-primary"
          aria-keyshortcuts="Enter"
          :disabled="!canConfirm"
          @click="confirm"
        >
          {{ confirmLabel }}
        </button>
      </footer>
    </div>

    <Preview
      v-if="preview"
      :file="preview.file"
      :name="preview.name"
      :dimensions="preview.dimensions"
      @close="preview = null"
    />
  </div>
</template>
