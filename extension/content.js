const adapter = globalThis.__GULU_ADAPTER__;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (!adapter) return { ok:false, error:'adapter_unavailable' };
    try {
      if (!adapter.SEMANTIC_OPERATIONS.includes(message?.operation)) return { ok:false, error:'unsupported_operation' };
      const args = message.args ?? {};
      let result;
      if (message.operation === 'inspectState') result = adapter.inspectState();
      if (message.operation === 'inspectCandidateScope') result = adapter.inspectCandidateScope();
      if (message.operation === 'ensureAllTalentScope') result = adapter.ensureAllTalentScope();
      if (message.operation === 'inspectForbiddenFilters') result = adapter.inspectForbiddenFilters();
      if (message.operation === 'inspectAppliedFilters') result = adapter.inspectAppliedFilters(args.filters ?? {});
      if (message.operation === 'inspectListState') result = adapter.inspectListState();
      if (message.operation === 'resetFilters') result = await adapter.resetFilters();
      if (message.operation === 'applyFilters') result = await adapter.applyFilters(args.filters ?? {}, { submit:Boolean(args.submit), reset:args.reset !== false });
      if (message.operation === 'applyFilterValue') result = await adapter.applyFilterValue(String(args.field), String(args.value));
      if (message.operation === 'scanTaxonomyField') result = await adapter.scanTaxonomyField(String(args.field));
      if (message.operation === 'submitSearch') result = adapter.submitSearch();
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
