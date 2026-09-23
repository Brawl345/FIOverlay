<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { browser } from 'wxt/browser';
import {
  buildExport,
  DISABLED_DOMAINS_KEY,
  DomainQuotaError,
  getDisabledDomains,
  normalizeDomain,
  parseImport,
  setDisabledDomains,
  sortDomains,
} from '../../lib/domains';
import { t } from '../../lib/i18n';
import {
  getStripMetadata,
  setStripMetadata,
  STRIP_METADATA_KEY,
} from '../../lib/settings';
import Logo from '../content/Logo.vue';

const domains = ref<string[]>([]);
const stripMetadata = ref(true);
const input = ref('');
const fileInput = ref<HTMLInputElement>();
const status = ref('');
const failed = ref(false);
const toastVisible = ref(false);
let toastTimer: ReturnType<typeof setTimeout> | undefined;

const empty = computed(() => domains.value.length === 0);

const TOAST_MS = 3200;

function notify(key: string, isError = false, substitution?: string): void {
  status.value = t(key, substitution);
  failed.value = isError;
  toastVisible.value = true;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastVisible.value = false;
  }, TOAST_MS);
}

async function load(): Promise<void> {
  domains.value = await getDisabledDomains();
  stripMetadata.value = await getStripMetadata();
}

async function toggleStripMetadata(event: Event): Promise<void> {
  const enabled = (event.target as HTMLInputElement).checked;
  stripMetadata.value = enabled;
  await setStripMetadata(enabled);
  notify(enabled ? 'optionsPrivacyOn' : 'optionsPrivacyOff');
}

/** Reports a failed write itself and returns whether the list was stored. */
async function save(next: string[]): Promise<boolean> {
  try {
    domains.value = await setDisabledDomains(next);
    return true;
  } catch (error) {
    notify(
      error instanceof DomainQuotaError ? 'optionsQuotaExceeded' : 'optionsSaveFailed',
      true,
    );
    return false;
  }
}

async function add(): Promise<void> {
  const domain = normalizeDomain(input.value);
  if (!domain) {
    notify('optionsInvalidDomain', true);
    return;
  }
  if (domains.value.includes(domain)) {
    notify('optionsAlreadyListed', true);
    return;
  }
  if (!(await save([...domains.value, domain]))) return;
  input.value = '';
  notify('optionsAdded', false, domain);
}

async function remove(domain: string): Promise<void> {
  if (!(await save(domains.value.filter((entry) => entry !== domain)))) return;
  notify('optionsRemoved', false, domain);
}

async function clear(): Promise<void> {
  if (!(await save([]))) return;
  notify('optionsCleared');
}

function exportDomains(): void {
  const blob = new Blob([`${JSON.stringify(buildExport(domains.value), null, 2)}\n`], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `fioverlay-domains-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  notify('optionsExported');
}

async function importDomains(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  target.value = '';
  if (!file) return;

  let imported: string[];
  try {
    imported = parseImport(await file.text());
  } catch {
    notify('optionsImportFailed', true);
    return;
  }
  const before = domains.value.length;
  if (!(await save(sortDomains([...domains.value, ...imported])))) return;
  const added = domains.value.length - before;
  if (added === 0) notify('optionsImportedNone');
  else if (added === 1) notify('optionsImportedOne');
  else notify('optionsImported', false, String(added));
}

function onStorageChanged(changes: Record<string, unknown>, area: string): void {
  if (area !== 'sync') return;
  if (DISABLED_DOMAINS_KEY in changes || STRIP_METADATA_KEY in changes) {
    void load();
  }
}

onMounted(() => {
  void load();
  browser.storage.onChanged.addListener(onStorageChanged);
});

onUnmounted(() => {
  browser.storage.onChanged.removeListener(onStorageChanged);
  clearTimeout(toastTimer);
});
</script>

<template>
  <main>
    <header class="head">
      <span class="app-icon"><Logo class="logo" /></span>
      <div>
        <h1>{{ t('optionsTitle') }}</h1>
        <p class="lead">{{ t('optionsIntro') }}</p>
      </div>
    </header>

    <section>
      <h2>{{ t('optionsPrivacyTitle') }}</h2>
      <div class="card">
        <label class="row">
          <span class="text">
            <span class="label">{{ t('optionsStripMetadata') }}</span>
            <span class="muted">{{ t('optionsStripMetadataHint') }}</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            class="switch"
            :checked="stripMetadata"
            @change="toggleStripMetadata"
          />
        </label>
      </div>
    </section>

    <section>
      <h2>
        {{ t('optionsListTitle') }}
        <span v-if="!empty" class="count">{{ domains.length }}</span>
      </h2>
      <div class="card">
        <form class="row" @submit.prevent="add">
          <input
            v-model="input"
            type="text"
            class="field"
            :placeholder="t('optionsPlaceholder')"
            spellcheck="false"
            autocomplete="off"
          />
          <button type="submit" class="btn primary">{{ t('optionsAdd') }}</button>
        </form>
        <p v-if="empty" class="row muted empty">{{ t('optionsEmpty') }}</p>
        <ul v-else class="list">
          <li v-for="domain in domains" :key="domain" class="row">
            <span class="domain">{{ domain }}</span>
            <button
              type="button"
              class="remove"
              :aria-label="`${t('optionsRemove')}: ${domain}`"
              :title="t('optionsRemove')"
              @click="remove(domain)"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M8 12h8" />
              </svg>
            </button>
          </li>
        </ul>
      </div>
    </section>

    <section>
      <h2>{{ t('optionsBackupTitle') }}</h2>
      <div class="card">
        <p class="row muted">{{ t('optionsBackupHint') }}</p>
        <div class="row actions">
          <button type="button" class="btn" :disabled="empty" @click="exportDomains">
            {{ t('optionsExport') }}
          </button>
          <button type="button" class="btn" @click="fileInput?.click()">
            {{ t('optionsImport') }}
          </button>
          <button type="button" class="btn danger" :disabled="empty" @click="clear">
            {{ t('optionsClear') }}
          </button>
          <input
            ref="fileInput"
            type="file"
            accept="application/json,.json"
            hidden
            @change="importDomains"
          />
        </div>
      </div>
    </section>

    <p
      class="toast"
      :class="{ show: toastVisible, error: failed }"
      role="status"
      aria-live="polite"
    >
      {{ status }}
    </p>
  </main>
</template>

<style scoped>
main {
  display: flex;
  flex-direction: column;
  gap: 28px;
  max-width: 640px;
  margin: 0 auto;
}

.head {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.app-icon {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  flex: none;
  border-radius: 14px;
  background: var(--card);
  box-shadow:
    0 0 0 0.5px var(--line),
    0 4px 14px rgba(0, 0, 0, 0.08);
}

.logo {
  width: 34px;
  height: 34px;
}

h1 {
  margin: 2px 0 4px;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.lead {
  margin: 0;
  color: var(--muted);
}

section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 0 14px;
  color: var(--muted);
  font-size: 13px;
  font-weight: 600;
}

.count {
  padding: 0 7px;
  border-radius: 999px;
  background: var(--soft);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}

.card {
  overflow: hidden;
  border-radius: 14px;
  background: var(--card);
  box-shadow:
    0 0 0 0.5px var(--line),
    0 1px 2px rgba(0, 0, 0, 0.04);
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  padding: 12px 14px;
}

.card > .row + .row,
.card > .row + .list,
.list .row + .row {
  border-top: 0.5px solid var(--line);
}

label.row {
  cursor: pointer;
}

.text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 1px;
}

.label {
  font-weight: 500;
}

.muted {
  color: var(--muted);
  font-size: 13px;
}

.empty {
  justify-content: center;
  padding: 18px 14px;
}

/* An iOS-style switch drawn on the native checkbox, so it keeps its semantics. */
.switch {
  position: relative;
  width: 42px;
  height: 26px;
  flex: none;
  margin: 0;
  border-radius: 999px;
  background: var(--soft-strong);
  appearance: none;
  cursor: pointer;
  transition: background 160ms ease;
}

.switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow:
    0 2px 4px rgba(0, 0, 0, 0.2),
    0 0 0 0.5px rgba(0, 0, 0, 0.06);
  transition: transform 160ms ease;
}

.switch:checked {
  background: var(--ok);
}

.switch:checked::after {
  transform: translateX(16px);
}

.switch:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.field {
  flex: 1;
  min-width: 160px;
  height: 34px;
  padding: 0 12px;
  border: 0;
  border-radius: 9px;
  background: var(--soft);
  color: inherit;
  font: inherit;
}

.field::placeholder {
  color: var(--muted);
}

.field:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 0;
}

.btn {
  height: 34px;
  padding: 0 16px;
  border: 0;
  border-radius: 9px;
  background: var(--soft);
  color: inherit;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: filter 120ms ease;
}

.btn:hover:not(:disabled) {
  filter: brightness(1.06);
}

.btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.primary {
  background: var(--accent);
  box-shadow: 0 2px 8px color-mix(in srgb, var(--accent) 30%, transparent);
  color: var(--accent-fg);
}

.danger {
  margin-left: auto;
  color: var(--danger);
}

.actions {
  flex-wrap: wrap;
  padding-top: 0;
}

.card > .row.actions {
  border-top: 0;
}

.list {
  max-height: 420px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.list .row {
  padding-block: 8px;
}

.domain {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.remove {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  flex: none;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: none;
  color: var(--muted);
  cursor: pointer;
  transition: color 120ms ease;
}

.remove svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
}

.remove:hover {
  color: var(--danger);
}

.remove:focus-visible {
  outline: 2px solid var(--accent);
}

.toast {
  position: fixed;
  left: 50%;
  bottom: 28px;
  max-width: calc(100% - 40px);
  margin: 0;
  padding: 10px 16px;
  border-radius: 12px;
  background: var(--toast);
  backdrop-filter: blur(20px) saturate(1.8);
  box-shadow:
    0 10px 30px rgba(0, 0, 0, 0.2),
    0 0 0 0.5px var(--line);
  color: var(--fg);
  font-size: 13px;
  font-weight: 500;
  opacity: 0;
  transform: translate(-50%, 8px);
  transition:
    opacity 180ms ease,
    transform 180ms ease;
  pointer-events: none;
}

.toast.show {
  opacity: 1;
  transform: translate(-50%, 0);
}

.toast.error {
  color: var(--danger);
}

@media (prefers-reduced-motion: reduce) {
  .toast,
  .switch,
  .switch::after {
    transition: none;
  }
}
</style>
