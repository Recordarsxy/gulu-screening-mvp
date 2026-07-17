export const guluAdapter = Object.freeze({
  enabled: false,
  domain: null,
  selectors: Object.freeze({}),
  readVisiblePage() {
    throw new Error('adapter_not_configured');
  },
});
