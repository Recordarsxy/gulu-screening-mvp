let adapterError = null;
const adapterPromise = import(chrome.runtime.getURL('gulu-adapter.js')).catch((error) => {
  adapterError = String(error?.message ?? error).slice(0, 160);
  return null;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    const adapter = await adapterPromise;
    if (!adapter) return { ok:false, error:`adapter_import_failed:${adapterError ?? 'unknown'}` };
    try {
      if (!adapter.SEMANTIC_OPERATIONS.includes(message?.operation)) return { ok:false, error:'unsupported_operation' };
      const args = message.args ?? {};
      let result;
      if (message.operation === 'inspectState') result = adapter.inspectState();
      if (message.operation === 'inspectListState') result = adapter.inspectListState();
      if (message.operation === 'applyFilters') result = await adapter.applyFilters(args.filters ?? {}, { submit:Boolean(args.submit) });
      if (message.operation === 'readList') result = adapter.readList({ page:Number(args.page) || 1 });
      if (message.operation === 'readDetail') result = adapter.readDetail(args.seed ?? {}, { sourceRound:args.sourceRound, page:Number(args.page) || 1 });
      if (message.operation === 'nextPage') result = adapter.nextPage();
      if (message.operation === 'openDetail') {
        location.assign(String(args.detailUrl));
        result = { ok:true };
      }
      return { ok:true, result };
    } catch (error) {
      return { ok:false, error:String(error?.message ?? error).slice(0, 200) };
    }
  })().then(sendResponse).catch((error) => sendResponse({ ok:false, error:String(error?.message ?? error).slice(0, 200) }));
  return true;
});
