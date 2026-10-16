/**
 * storage.js — thin wrapper around chrome.storage.local. Nothing ever leaves the browser.
 */
(() => {
  const WDA = (globalThis.WDA = globalThis.WDA || {});

  WDA.storage = {
    async getProfile() {
      const { profile } = await chrome.storage.local.get('profile');
      return WDA.normalizeProfile(profile);
    },

    async saveProfile(profile) {
      await chrome.storage.local.set({ profile: WDA.normalizeProfile(profile) });
    },

    async getSettings() {
      const { settings } = await chrome.storage.local.get('settings');
      return { ...WDA.defaultSettings(), ...(settings || {}) };
    },

    async saveSettings(patch) {
      const next = { ...(await this.getSettings()), ...patch };
      await chrome.storage.local.set({ settings: next });
      return next;
    },
  };
})();
