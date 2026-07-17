export const SEMANTIC_OPERATIONS: readonly string[];
export function sanitizeSnapshot(input: Record<string,unknown>): Record<string,unknown>;
export function inspectState(doc?:Document,loc?:Location):{state:string};
export function inspectListState(options?:{doc?:Document;loc?:{href?:string}}):{loading:boolean;page:number;count:number;queryReady:boolean;signature:string};
export function applyFilters(filters:Record<string,string[]>,options?:{submit?:boolean;doc?:Document;loc?:{href?:string}}):Promise<unknown>;
export function readList(options?:{doc?:Document;page?:number;baseUrl?:string}):Array<Record<string,unknown>>;
export function readDetail(seed:Record<string,unknown>,options?:{doc?:Document;sourceRound?:string;page?:number}):Record<string,unknown>;
export function nextPage(options?:{doc?:Document}):boolean;
