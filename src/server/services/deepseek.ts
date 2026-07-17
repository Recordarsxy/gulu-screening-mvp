import { assertNoSensitiveText } from './redaction.js';

export type DeepSeekUsage = { inputTokens: number; outputTokens: number };
export type DeepSeekResult<T> = { data: T; usage: DeepSeekUsage; model: string };
export type ConnectionResult = { ok: boolean; keyPresent: boolean; latencyMs: number; model: string; inputTokens: number; outputTokens: number; errorType?: string };

export class DeepSeekError extends Error {
  constructor(public readonly code: string, message = code, public readonly status?: number) { super(message); }
}

type Options = { apiKey?: string; baseUrl?: string; model?: string; fetcher?: typeof fetch };

export class DeepSeekProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetcher: typeof fetch;

  constructor(options: Options = {}) {
    this.apiKey = options.apiKey ?? process.env.DEEPSEEK_API_KEY ?? '';
    this.baseUrl = (options.baseUrl ?? process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/$/, '');
    this.model = options.model ?? process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash';
    this.fetcher = options.fetcher ?? fetch;
  }

  async generateJson<T = unknown>(instruction: string, payload: unknown): Promise<DeepSeekResult<T>> {
    if (!this.apiKey) throw new DeepSeekError('missing_api_key');
    assertNoSensitiveText(payload);
    const response = await this.fetcher(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: `${instruction}\n只输出合法 json，不要输出 markdown。` },
          { role: 'user', content: JSON.stringify(payload) },
        ],
        response_format: { type: 'json_object' },
        stream: false,
        max_tokens: 1800,
      }),
    });
    if (!response.ok) {
      const text = (await response.text()).slice(0, 300);
      throw new DeepSeekError(response.status === 401 ? 'unauthorized' : response.status === 429 ? 'rate_limited' : 'api_error', text, response.status);
    }
    const raw = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number }; model?: string };
    const content = raw.choices?.[0]?.message?.content?.trim();
    if (!content) throw new DeepSeekError('empty_response');
    let data: T;
    try { data = JSON.parse(content) as T; } catch { throw new DeepSeekError('invalid_json'); }
    return {
      data,
      usage: { inputTokens: raw.usage?.prompt_tokens ?? 0, outputTokens: raw.usage?.completion_tokens ?? 0 },
      model: raw.model ?? this.model,
    };
  }

  async testConnection(): Promise<ConnectionResult> {
    const start = Date.now();
    if (!this.apiKey) return { ok: false, keyPresent: false, latencyMs: 0, model: this.model, inputTokens: 0, outputTokens: 0, errorType: 'missing_api_key' };
    try {
      const result = await this.generateJson<{ ok: boolean }>('输出 json：{"ok":true}', { test: 'connection' });
      return { ok: true, keyPresent: true, latencyMs: Date.now() - start, model: result.model, ...result.usage };
    } catch (error) {
      const errorType = error instanceof DeepSeekError ? error.code : error instanceof TypeError ? 'network_error' : 'unknown_error';
      return { ok: false, keyPresent: true, latencyMs: Date.now() - start, model: this.model, inputTokens: 0, outputTokens: 0, errorType };
    }
  }
}
