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
  acceptLabels,
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
const busy = ref(false);
const progress = ref<DownloadProgress | null>(null);
const dragDepth = ref(0);
const editing = ref<number | null>(null);
const draft = ref('');
const reordering = ref<number | null>(null);
const discarding = ref(false);
const keepButton = ref<HTMLButtonElement>();
const urlOpen = ref(false);
const urlField = ref<HTMLInputElement>();
const stripping = ref(true);
let nextId = 0;

const PASTE_KEY = /mac/i.test(navigator.userAgent) ? '⌘V' : 'Ctrl+V';
const ACCEPT_GROUPS: Record<string, string> = {
  'image/*': 'acceptGroupImage',
  'video/*': 'acceptGroupVideo',
  'audio/*': 'acceptGroupAudio',
  'text/*': 'acceptGroupText',
};
/** Paths on a 24×24 stroke grid. */
const ICONS = {
  upload:
    'M12 15.5V4m0 0L8.2 7.8M12 4l3.8 3.8M4 14v3.5A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V14',
  paste:
    'M9 3.5h6v3H9zM15 5h1.5A1.5 1.5 0 0 1 18 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 18.5v-12A1.5 1.5 0 0 1 7.5 5H9',
  browse:
    'M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z',
  camera:
    'M4 8.5A2.5 2.5 0 0 1 6.5 6H8l1.5-2h5L16 6h1.5A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5zM15.5 12.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z',
  url: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  discard:
    'M4.5 7h15M10 4h4M6.5 7l.8 11.2A2 2 0 0 0 9.3 20h5.4a2 2 0 0 0 2-1.8L17.5 7M10 11v5M14 11v5',
};

const accept = computed(() => props.accept.trim());
const dragging = computed(() => dragDepth.value > 0);
const canReorder = computed(() => items.value.length > 1);
const canConfirm = computed(() => items.value.length > 0 && !busy.value);
// Deliberately not gated on the scheme: an unusable URL earns an explanation,
// not a button that silently stays dead.
const canFetch = computed(() => !busy.value && url.value.trim().length > 0);
const title = computed(() =>
  t(props.multiple ? 'overlayTitleMany' : 'overlayTitle'),
);
/** Two labels at most, so an obscure list of twenty types stays one line. */
const acceptBadge = computed(() => {
  const labels = acceptLabels(accept.value).map((label) => {
    const group = ACCEPT_GROUPS[label];
    return group ? t(group) : label;
  });
  if (labels.length === 0) return null;
  const shown = labels.slice(0, 2).join(' · ');
  return labels.length > 2 ? `${shown} +${labels.length - 2}` : shown;
});
/** Counts what the list holds now, not what the last paste brought in. */
const notice = computed(() => {
  const converted = items.value.filter((item) => item.converted !== null).length;
  if (converted === 0) return '';
  return converted === 1
    ? t('noticeConvertedOne')
    : t('noticeConverted', String(converted));
});
const summary = computed(() => {
  const list = items.value;
  if (list.length === 0) return t('summaryEmpty');
  const size = formatSize(list.reduce((sum, item) => sum + item.file.size, 0));
  const base =
    list.length === 1
      ? t('summaryOne', size)
      : t('summaryMany', [String(list.length), size]);
  return stripping.value ? `${base} · ${t('summaryStripped')}` : base;
});
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

  if (accepted.length === 0) {
    error.value =
      rejected > 0 ? t('errorAcceptMismatch', pattern) : t('errorClipboardEmpty');
    return;
  }

  error.value =
    rejected === 0
      ? ''
      : rejected === 1
        ? t('errorSomeRejectedOne')
        : t('errorSomeRejected', String(rejected));
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
    // The field was disabled during the download and lost focus.
    if (urlOpen.value) void nextTick(() => urlField.value?.focus());
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

// A row only claims its own reorder drag; a file dragged in from outside
// bubbles on to the root, which counts it and takes the drop.
function onRowDragEnter(item: Item, event: DragEvent): void {
  if (reordering.value === null) return;
  event.preventDefault();
  event.stopPropagation();
  reorderOver(item);
}

function onRowDragOver(event: DragEvent): void {
  if (reordering.value === null) return;
  event.preventDefault();
  event.stopPropagation();
  onDragOver(event);
}

function onRowDrop(event: DragEvent): void {
  if (reordering.value === null) return;
  event.preventDefault();
  event.stopPropagation();
  endReorder();
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

interface Source {
  id: keyof typeof ICONS;
  label: string;
  title: string;
  key: string;
  run: () => void;
}

/** Paste, browse, camera and URL, in that order; a single-letter key is a shortcut. */
const sources = computed<Source[]>(() => {
  const list: Source[] = [
    {
      id: 'paste',
      label: t('sourcePaste'),
      title: t('actionPaste'),
      key: PASTE_KEY,
      run: () => void run(filesFromClipboardApi),
    },
    {
      id: 'browse',
      label: t('sourceBrowse'),
      title: t('actionBrowse'),
      key: t('keyBrowse'),
      run: browse,
    },
  ];
  if (cameraType.value) {
    list.push({
      id: 'camera',
      label: t('sourceCamera'),
      title: t('actionCamera'),
      key: t('keyCamera'),
      run: () => {
        camera.value = true;
      },
    });
  }
  list.push({
    id: 'url',
    label: t('sourceUrl'),
    title: t('urlPlaceholder'),
    key: t('keyUrl'),
    run: toggleUrl,
  });
  return list;
});

function openUrl(): void {
  urlOpen.value = true;
  void nextTick(() => urlField.value?.focus());
}

function closeUrl(): void {
  urlOpen.value = false;
  url.value = '';
  root.value?.focus({ preventScroll: true });
}

function toggleUrl(): void {
  if (urlOpen.value) closeUrl();
  else openUrl();
}

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
    if (urlOpen.value) {
      closeUrl();
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
  /** True when `key` belongs to a source and ran it. */
  shortcut: (key: string): boolean => {
    const layered =
      discarding.value ||
      preview.value ||
      editor.value ||
      camera.value ||
      editing.value !== null;
    if (layered) return false;
    const pressed = key.toLowerCase();
    const source = sources.value.find(
      (entry) => entry.key.length === 1 && entry.key.toLowerCase() === pressed,
    );
    if (!source || (busy.value && source.id !== 'browse')) return false;
    source.run();
    return true;
  },
});

onMounted(() => {
  root.value?.focus({ preventScroll: true });
  void getStripMetadata().then((enabled) => {
    stripping.value = enabled;
  });
});
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
      :class="{ 'is-dragging': dragging }"
      :inert="discarding"
      role="dialog"
      aria-modal="true"
      :aria-label="title"
    >
      <header class="fio-head">
        <Logo />
        <h1 class="fio-title">{{ title }}</h1>
        <span
          v-if="acceptBadge"
          class="fio-accept"
          :title="t('acceptHint', accept)"
        >
          {{ acceptBadge }}
        </span>
        <button
          type="button"
          class="fio-close"
          :aria-label="t('actionCancel')"
          @click="requestCancel"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="m6 6 12 12M18 6 6 18"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </header>

      <div :class="items.length ? 'fio-bar' : 'fio-zone'">
        <template v-if="!items.length">
          <span class="fio-zone-badge">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path :d="ICONS.upload" />
            </svg>
          </span>
          <p class="fio-zone-title">{{ t('dropTitle') }}</p>
          <p class="fio-zone-hint">{{ t('dropHint', PASTE_KEY) }}</p>
        </template>
        <div class="fio-sources">
          <button
            v-for="source in sources"
            :key="source.id"
            type="button"
            class="fio-source"
            :class="{ 'is-on': source.id === 'url' && urlOpen }"
            :title="source.title"
            :aria-keyshortcuts="source.key.length === 1 ? source.key : undefined"
            :aria-expanded="source.id === 'url' ? urlOpen : undefined"
            :disabled="busy && source.id !== 'browse'"
            @click="source.run"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path :d="ICONS[source.id]" />
            </svg>
            <span class="fio-source-label">{{ source.label }}</span>
            <kbd class="fio-kbd">{{ source.key }}</kbd>
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

      <form v-if="urlOpen" class="fio-url" @submit.prevent="fetchUrl">
        <label class="fio-url-field">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path :d="ICONS.url" />
          </svg>
          <input
            ref="urlField"
            v-model="url"
            type="text"
            class="fio-url-input"
            :placeholder="t('urlPlaceholder')"
            :disabled="busy"
            spellcheck="false"
            autocomplete="off"
          />
        </label>
        <button type="submit" class="fio-btn fio-btn-primary" :disabled="!canFetch">
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
          @dragenter="onRowDragEnter(item, $event)"
          @dragover="onRowDragOver"
          @drop="onRowDrop"
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
        <span class="fio-summary">{{ summary }}</span>
        <button type="button" class="fio-btn" @click="requestCancel">
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

      <div v-if="dragging" class="fio-drop-layer" aria-hidden="true">
        <span class="fio-zone-badge">
          <svg viewBox="0 0 24 24"><path :d="ICONS.upload" /></svg>
        </span>
        <span>{{ t('dropRelease') }}</span>
      </div>
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
        <span class="fio-zone-badge is-danger" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path :d="ICONS.discard" /></svg>
        </span>
        <p id="fio-discard-title" class="fio-discard-title">
          {{ t('discardTitle') }}
        </p>
        <p id="fio-discard-text" class="fio-discard-text">{{ discardText }}</p>
        <div class="fio-discard-actions">
          <button
            ref="keepButton"
            type="button"
            class="fio-btn"
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
