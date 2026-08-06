import { defineConfig } from 'wxt';

const UPDATE_BASE =
  'https://raw.githubusercontent.com/Brawl345/FIOverlay/master';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  srcDir: '.',
  manifestVersion: 3,
  manifest: ({ browser, mode }) => {
    // Self-hosted update endpoints only matter for production GitHub builds.
    const selfHosted = mode === 'production';
    return {
      name: '__MSG_extensionName__',
      description: '__MSG_extensionDescription__',
      default_locale: 'en',
      action: {
        default_title: '__MSG_extensionName__',
        default_icon: {
          16: '/icons/16.png',
          32: '/icons/32.png',
          48: '/icons/48.png',
          128: '/icons/128.png',
        },
      },
      ...(selfHosted && browser === 'chrome'
        ? { update_url: `${UPDATE_BASE}/updates.xml` }
        : {}),
      options_ui: {
        page: 'options.html',
        open_in_tab: true,
      },
      permissions: ['storage', 'clipboardRead'],
      host_permissions: ['http://*/*', 'https://*/*'],
      browser_specific_settings: {
        gecko: {
          id: 'fioverlay@brawl345.github.com',
          strict_min_version: '140.0',
          data_collection_permissions: {
            required: ['none'],
          },
          ...(selfHosted && browser === 'firefox'
            ? { update_url: `${UPDATE_BASE}/updates.json` }
            : {}),
        },
        // `data_collection_permissions` only exists on Android from 142 on,
        // while desktop has it since 140.
        gecko_android: {
          strict_min_version: '142.0',
        },
      },
    };
  },
});
