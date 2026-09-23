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
  convertImage,
  editOutputType,
  type EncodableType,
  formatLabel,
  targetTypeFor,
} from '../../lib/convert';
import {
  extensionForMime,
  formatSize,
  isDownloadableUrl,
  matchesAccept,
  sanitizeFileName,
  splitFileName,
} from '../../lib/files';
import { t } from '../../lib/i18n';
import { stripMetadata } from '../../lib/metadata';
import { canRehash, rehashFile } from '../../lib/rehash';
import { getStripMetadata } from '../../lib/settings';
import Camera from './Camera.vue';
import type { Dimensions } from './canvas';
import Editor from './Editor.vue';
import Logo from './Logo.vue';
import Preview from './Preview.vue';
import Thumbnail from './Thumbnail.vue';

interface Item {
  id: number;
  file: File;
  name: string;
  dimensions: Dimensions | null;
  /** `WEBP → PNG` once the file was re-encoded for the field. */
  converted: string | null;
  /** The file goes to the page with the current time as its modified date. */
  resetDate: boolean;
  /** The file is written again with changed pixels, so its hash differs. */
  rehash: boolean;
}

const props = defineProps<{
  accept: string;
  multiple: boolean;
  capture: string | null;
}>();
const emit = defineEmits<{
  confirm: [files: File[]];
  cancel: [];
}>();

const root = ref<HTMLElement>();
const picker = ref<HTMLInputElement>();
const items = shallowRef<Item[]>([]);
const preview = shallowRef<Item | null>(null);
const editor = shallowRef<Item | null>(null);
const camera = ref(false);
const url = ref('');
const error = ref('');
const notice = ref('');
const busy = ref(false);
const progress = ref<DownloadProgress | null>(null);
const dragDepth = ref(0);
const editing = ref<number | null>(null);
const draft = ref('');
const reordering = ref<number | null>(null);
const discarding = ref(false);
const keepButton = ref<HTMLButtonElement>();
let nextId = 0;

const accept = computed(() => props.accept.trim());
const dragging = computed(() => dragDepth.value > 0);
const canReorder = computed(() => items.value.length > 1);
const canConfirm = computed(() => items.value.length > 0 && !busy.value);
// Deliberately not gated on the scheme: an unusable URL earns an explanation,
// not a button that silently stays dead.
const canFetch = computed(() => !busy.value && url.value.trim().length > 0);
const pasteHint = computed(() =>
  t('dropHint', /mac/i.test(navigator.userAgent) ? '⌘V' : 'Ctrl+V'),
);
const discardText = computed(() =>
  items.value.length > 1
    ? t('discardTextMany', String(items.value.length))
    : t('discardTextOne'),
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

/**
 * Takes a file the field would refuse and re-encodes it into a type it accepts,
 * e.g. a pasted WebP into PNG. Null when that is impossible.
 */
async function convertForField(file: File): Promise<Item | null> {
  const type = targetTypeFor(file, accept.value);
  if (!type) return null;
  try {
    const encoded = await convertImage(file, type);
    return {
      id: nextId++,
      file: encoded,
      name: encoded.name,
      dimensions: null,
      converted: `${formatLabel(file.type)} → ${formatLabel(type)}`,
      resetDate: false,
      rehash: false,
    };
  } catch {
    return null;
  }
}

async function addFiles(files: readonly File[]): Promise<void> {
  const pattern = accept.value;
  const results = await Promise.all(
    files.map(
      (file): Promise<Item | null> | Item =>
        !pattern || matchesAccept(file, pattern)
          ? {
              id: nextId++,
              file,
              name: file.name,
              dimensions: null,
              converted: null,
              resetDate: false,
              rehash: false,
            }
          : convertForField(file),
    ),
  );
  const accepted = results.filter((item): item is Item => item !== null);
  const rejected = results.length - accepted.length;
  const converted = accepted.filter((item) => item.converted !== null).length;

  if (accepted.length === 0) {
    error.value =
      rejected > 0 ? t('errorAcceptMismatch', pattern) : t('errorClipboardEmpty');
    return;
  }

  error.value = rejected > 0 ? t('errorSomeRejected', String(rejected)) : '';
  notice.value = converted > 0 ? t('noticeConverted', String(converted)) : '';
  items.value = props.multiple
    ? [...items.value, ...accepted]
    : accepted.slice(-1);
}

function measured(id: number, dimensions: Dimensions): void {
  items.value = items.value.map((item) =>
    item.id === id ? { ...item, dimensions } : item,
  );
}

async function apply(result: PickResult): Promise<void> {
  if (result.files.length > 0) await addFiles(result.files);
  else if (result.error) error.value = t(result.error);
}

async function run(
  task: (onProgress: (value: DownloadProgress) => void) => Promise<PickResult>,
): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  progress.value = null;
  try {
    await apply(await task((value) => (progress.value = value)));
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
  if (reordering.value !== null) return;
  const transfer = event.dataTransfer;
  void run((onProgress) => filesFromDataTransfer(transfer, onProgress));
}

function onDragOver(event: DragEvent): void {
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = reordering.value === null ? 'copy' : 'move';
  }
}

function onDragEnter(): void {
  if (reordering.value === null) dragDepth.value++;
}

function onDragLeave(): void {
  if (reordering.value === null) dragDepth.value--;
}

function startReorder(item: Item, event: DragEvent): void {
  reordering.value = item.id;
  dragDepth.value = 0;
  // Firefox only starts a drag once the transfer carries something.
  event.dataTransfer?.setData('text/plain', item.name);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
}

/** Live reorder: the row moves as soon as the pointer reaches its neighbour. */
function reorderOver(target: Item): void {
  const held = reordering.value;
  if (held === null || held === target.id) return;
  const list = [...items.value];
  const from = list.findIndex((item) => item.id === held);
  const to = list.findIndex((item) => item.id === target.id);
  const moved = list[from];
  if (from < 0 || to < 0 || !moved) return;
  list.splice(from, 1);
  list.splice(to, 0, moved);
  items.value = list;
}

function endReorder(): void {
  reordering.value = null;
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
    notice.value = '';
    void addFiles(picked);
  }
}

function remove(id: number): void {
  if (editing.value === id) editing.value = null;
  if (editor.value?.id === id) editor.value = null;
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

/** The bytes stay untouched; only the name and the date the page reads change. */
function fileOf(item: Item): File {
  if (item.name === item.file.name && !item.resetDate) return item.file;
  return new File([item.file], item.name, {
    type: item.file.type,
    lastModified: item.resetDate ? Date.now() : item.file.lastModified,
  });
}

function toggleDate(id: number): void {
  items.value = items.value.map((item) =>
    item.id === id ? { ...item, resetDate: !item.resetDate } : item,
  );
}

function toggleRehash(id: number): void {
  items.value = items.value.map((item) =>
    item.id === id ? { ...item, rehash: !item.rehash } : item,
  );
}

function show(item: Item): void {
  if (item.file.type.startsWith('image/')) preview.value = item;
}

/** The camera writes a still image, so the field has to take one. */
const cameraType = computed<EncodableType | null>(() => {
  if (props.capture === null) return null;
  if (!navigator.mediaDevices?.getUserMedia) return null;
  const type = editOutputType({ name: 'camera.jpg', type: 'image/jpeg' }, accept.value);
  return matchesAccept({ name: `camera.${extensionForMime(type)}`, type }, accept.value || '*/*')
    ? type
    : null;
});

function onShot(file: File): void {
  camera.value = false;
  void addFiles([file]);
}

/** Vector and animated sources have no meaningful canvas round trip. */
function isEditable(item: Item): boolean {
  return (
    item.file.type.startsWith('image/') && item.file.type !== 'image/svg+xml'
  );
}

/**
 * The edited file takes the old one's place. A fresh id remounts the row, so
 * the thumbnail and the pixel size are read from the new bytes.
 */
function applyEdit(file: File): void {
  const edited = editor.value;
  editor.value = null;
  if (!edited) return;
  items.value = items.value.map((item) =>
    item.id === edited.id
      ? {
          id: nextId++,
          file,
          name: file.name,
          dimensions: null,
          converted: item.converted,
          resetDate: item.resetDate,
          rehash: item.rehash && canRehash(file),
        }
      : item,
  );
}

async function confirm(): Promise<void> {
  if (!canConfirm.value) return;
  busy.value = true;
  try {
    const strip = await getStripMetadata();
    // The pixels are touched last: a strip that runs afterwards could take the
    // change with it.
    const files = await Promise.all(
      items.value.map(async (item) => {
        const file = fileOf(item);
        const clean = strip ? await stripMetadata(file) : file;
        return item.rehash ? await rehashFile(clean) : clean;
      }),
    );
    emit('confirm', files);
  } catch {
    error.value = t('errorRehashFailed');
  } finally {
    busy.value = false;
  }
}

/** An empty overlay closes right away; picked files are only dropped on request. */
function requestCancel(): void {
  if (items.value.length === 0) {
    emit('cancel');
    return;
  }
  discarding.value = true;
  // Enter or Space on the focused default keeps the files.
  void nextTick(() => keepButton.value?.focus());
}

function keepFiles(): void {
  discarding.value = false;
  root.value?.focus({ preventScroll: true });
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
    if (discarding.value) {
      keepFiles();
      return true;
    }
    if (preview.value) {
      preview.value = null;
      return true;
    }
    if (camera.value) {
      camera.value = false;
      return true;
    }
    if (editor.value) {
      editor.value = null;
      return true;
    }
    if (editing.value !== null) {
      stopRename();
      return true;
    }
    if (items.value.length > 0) {
      requestCancel();
      return true;
    }
    return false;
  },
  submit: (): void => {
    if (discarding.value) return;
    if (preview.value) {
      preview.value = null;
      return;
    }
    // The editor and the camera have their own confirm button; Enter must not
    // skip past it.
    if (editor.value || camera.value) return;
    void confirm();
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
    @dragenter.prevent.stop="onDragEnter"
    @dragleave.prevent.stop="onDragLeave"
    @dragover.prevent.stop="onDragOver"
    @drop.prevent.stop="onDrop"
  >
    <div class="fio-backdrop" @click="requestCancel" />

    <div
      class="fio-card"
      :inert="discarding"
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
          @click="requestCancel"
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
          <button type="button" class="fio-btn fio-btn-ghost" @click="browse">
            {{ t('actionBrowse') }}
          </button>
          <button
            type="button"
            class="fio-btn"
            :disabled="busy"
            @click="run(filesFromClipboardApi)"
          >
            {{ t('actionPaste') }}
          </button>
          <button
            v-if="cameraType"
            type="button"
            class="fio-btn"
            :disabled="busy"
            @click="camera = true"
          >
            {{ t('actionCamera') }}
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
      <p v-if="notice" class="fio-notice">{{ notice }}</p>

      <ul v-if="items.length" class="fio-list">
        <li
          v-for="item in items"
          :key="item.id"
          class="fio-item"
          :class="{
            'is-movable': canReorder && editing !== item.id,
            'is-moving': reordering === item.id,
          }"
          :draggable="canReorder && editing !== item.id"
          :title="canReorder && editing !== item.id ? t('hintReorder') : undefined"
          @dragstart.stop="startReorder(item, $event)"
          @dragenter.prevent.stop="reorderOver(item)"
          @dragover.prevent.stop="onDragOver"
          @drop.prevent.stop="endReorder"
          @dragend.stop="endReorder"
        >
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
              <span
                v-if="item.converted"
                class="fio-tag"
                :title="t('itemConvertedHint')"
              >
                {{ item.converted }}
              </span>
            </span>
          </span>
          <button
            type="button"
            class="fio-icon-btn"
            :class="{ 'is-on': item.resetDate }"
            :aria-pressed="item.resetDate"
            :aria-label="t('actionResetDate')"
            :title="t('actionResetDate')"
            @click="toggleDate(item.id)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M3 12a9 9 0 1 0 2.6-6.4L3 8M3 3v5h5M12 7.5V12l3.5 2"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
          <button
            v-if="canRehash(item.file)"
            type="button"
            class="fio-icon-btn"
            :class="{ 'is-on': item.rehash }"
            :aria-pressed="item.rehash"
            :aria-label="t('actionRehash')"
            :title="t('actionRehashHint')"
            @click="toggleRehash(item.id)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M9.5 4 7.5 20m9-16-2 16M4.5 9h15m-16 6h15"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
              />
            </svg>
          </button>
          <button
            v-if="isEditable(item)"
            type="button"
            class="fio-icon-btn"
            :aria-label="t('actionEdit')"
            :title="t('actionEdit')"
            @click="editor = item"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Zm10.5-12.5 3 3"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
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
        <button type="button" class="fio-btn fio-btn-ghost" @click="requestCancel">
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

    <Camera
      v-if="camera && cameraType"
      :facing="capture === 'user' ? 'user' : 'environment'"
      :type="cameraType"
      @shot="onShot"
      @close="camera = false"
    />

    <Editor
      v-if="editor"
      :key="editor.id"
      :file="editor.file"
      :name="editor.name"
      :accept="accept"
      @apply="applyEdit"
      @close="editor = null"
    />

    <Preview
      v-if="preview"
      :file="preview.file"
      :name="preview.name"
      :dimensions="preview.dimensions"
      @close="preview = null"
    />

    <div v-if="discarding" class="fio-discard" @click.self="keepFiles">
      <div
        class="fio-discard-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="fio-discard-title"
        aria-describedby="fio-discard-text"
      >
        <p id="fio-discard-title" class="fio-discard-title">
          {{ t('discardTitle') }}
        </p>
        <p id="fio-discard-text" class="fio-discard-text">{{ discardText }}</p>
        <div class="fio-discard-actions">
          <button
            ref="keepButton"
            type="button"
            class="fio-btn fio-btn-ghost"
            @click="keepFiles"
          >
            {{ t('actionKeep') }}
          </button>
          <button
            type="button"
            class="fio-btn fio-btn-danger"
            @click="emit('cancel')"
          >
            {{ t('actionDiscard') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
