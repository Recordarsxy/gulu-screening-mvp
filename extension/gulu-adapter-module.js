import './gulu-adapter.js';

const adapter=globalThis.__GULU_ADAPTER__;
export const SEMANTIC_OPERATIONS=adapter.SEMANTIC_OPERATIONS;
export const sanitizeSnapshot=adapter.sanitizeSnapshot;
export const inspectState=adapter.inspectState;
export const inspectCandidateScope=adapter.inspectCandidateScope;
export const ensureAllTalentScope=adapter.ensureAllTalentScope;
export const inspectForbiddenFilters=adapter.inspectForbiddenFilters;
export const inspectAppliedFilters=adapter.inspectAppliedFilters;
export const inspectListState=adapter.inspectListState;
export const resetFilters=adapter.resetFilters;
export const applyFilters=adapter.applyFilters;
export const applyFilterValue=adapter.applyFilterValue;
export const scanTaxonomyField=adapter.scanTaxonomyField;
export const submitSearch=adapter.submitSearch;
export const readList=adapter.readList;
export const readDetail=adapter.readDetail;
export const nextPage=adapter.nextPage;
