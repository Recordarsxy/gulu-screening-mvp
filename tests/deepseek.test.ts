import { describe, expect, it } from 'vitest';
import { DeepSeekError, DeepSeekProvider } from '../src/server/services/deepseek.js';

describe('DeepSeek provider', () => {
  it('requests JSON output with configurable model and parses usage', async () => {
    let body: Record<string, unknown> = {};
    const fetcher: typeof fetch = async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"label":"review","reasonCode":"MISSING_INFORMATION","evidence":["经历描述不足"]}' } }], usage: { prompt_tokens: 12, completion_tokens: 8 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const provider = new DeepSeekProvider({ apiKey: 'test-key', model: 'deepseek-v4-flash', fetcher });
    const result = await provider.generateJson<{label:string}>('输出 json', { candidate: { company: '甲公司' } });
    expect(body.model).toBe('deepseek-v4-flash');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(result.data.label).toBe('review');
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 8 });
  });

  it('classifies an empty model response as a diagnostic error', async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), { status: 200 });
    const provider = new DeepSeekProvider({ apiKey: 'test-key', fetcher });
    await expect(provider.generateJson('输出 json', {})).rejects.toMatchObject({ code: 'empty_response' });
  });

  it('reports a missing API key without making a request', async () => {
    const provider = new DeepSeekProvider({ apiKey: '', fetcher: async () => { throw new Error('should not fetch'); } });
    const result = await provider.testConnection();
    expect(result).toMatchObject({ ok: false, keyPresent: false, errorType: 'missing_api_key' });
    expect(DeepSeekError).toBeDefined();
  });
});
