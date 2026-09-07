<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { browser } from 'wxt/browser';
import {
  buildExport,
  DISABLED_DOMAINS_KEY,
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

const domains = ref<string[]>([]);
const stripMetadata = ref(true);
const input = ref('');
const fileInput = ref<HTMLInputElement>();
const status = ref('');
const failed = ref(false);

const empty = computed(() => domains.value.length === 0);

function notify(key: string, isError = false, substitution?: string): void {
  status.value = t(key, substitution);
  failed.value = isError;
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

async function save(next: string[]): Promise<void> {
  domains.value = await setDisabledDomains(next);
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
  await save([...domains.value, domain]);
  input.value = '';
  notify('optionsAdded', false, domain);
}

async function remove(domain: string): Promise<void> {
  await save(domains.value.filter((entry) => entry !== domain));
  notify('optionsRemoved', false, domain);
}

async function clear(): Promise<void> {
  await save([]);
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

  try {
    const imported = parseImport(await file.text());
    const before = domains.value.length;
    await save(sortDomains([...domains.value, ...imported]));
    notify('optionsImported', false, String(domains.value.length - before));
  } catch {
    notify('optionsImportFailed', true);
  }
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

onUnmounted(() => browser.storage.onChanged.removeListener(onStorageChanged));
</script>

<template>
  <main>
    <h1>{{ t('optionsTitle') }}</h1>
    <p class="lead">{{ t('optionsIntro') }}</p>

    <section class="card">
      <h2>{{ t('optionsListTitle') }}</h2>

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

      <p v-if="empty" class="muted">{{ t('optionsEmpty') }}</p>
      <ul v-else class="list">
        <li v-for="domain in domains" :key="domain">
          <span class="domain">{{ domain }}</span>
          <button type="button" class="btn ghost" @click="remove(domain)">
            {{ t('optionsRemove') }}
          </button>
        </li>
      </ul>
    </section>

    <section class="card">
      <h2>{{ t('optionsPrivacyTitle') }}</h2>
      <label class="switch">
        <input
          type="checkbox"
          :checked="stripMetadata"
          @change="toggleStripMetadata"
        />
        <span>
          <strong>{{ t('optionsStripMetadata') }}</strong>
          <span class="muted">{{ t('optionsStripMetadataHint') }}</span>
        </span>
      </label>
    </section>

    <section class="card">
      <h2>{{ t('optionsBackupTitle') }}</h2>
      <p class="muted">{{ t('optionsBackupHint') }}</p>
      <div class="row">
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
    </section>

    <p v-if="status" class="status" :class="{ error: failed }">{{ status }}</p>
  </main>
</template>

<style scoped>
main {
  max-width: 640px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

h1 {
  margin: 0;
  font-size: 22px;
}

h2 {
  margin: 0 0 4px;
  font-size: 15px;
}

.lead,
.muted {
  margin: 0;
  color: var(--muted);
}

.card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px;
  border-radius: 14px;
  background: var(--card);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.field {
  flex: 1;
  min-width: 180px;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--soft);
  color: inherit;
  font: inherit;
}

.field:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.btn {
  padding: 8px 14px;
  border: 0;
  border-radius: 9px;
  background: var(--soft);
  color: inherit;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  transition: filter 120ms ease;
}

.btn:hover:not(:disabled) {
  filter: brightness(1.08);
}

.btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.primary {
  background: var(--accent);
  color: var(--accent-fg);
}

.ghost {
  background: transparent;
  box-shadow: inset 0 0 0 1px var(--line);
}

.danger {
  color: var(--danger);
}

.list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 6px 6px 12px;
  border-radius: 10px;
  background: var(--soft);
}

.domain {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.switch {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  cursor: pointer;
}

.switch input {
  width: 18px;
  height: 18px;
  margin-top: 2px;
  flex: none;
  accent-color: var(--accent);
  cursor: pointer;
}

.switch span {
  display: flex;
  flex-direction: column;
}

.status {
  margin: 0;
  color: var(--muted);
}

.status.error {
  color: var(--danger);
}
</style>
