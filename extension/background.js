import { guluAdapter } from './gulu-adapter.js';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'status') {
    sendResponse({ enabled: guluAdapter.enabled, reason: 'adapter_not_configured' });
    return false;
  }
  sendResponse({ ok: false, error: 'adapter_not_configured' });
  return false;
});
