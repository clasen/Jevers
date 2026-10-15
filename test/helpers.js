import { mock } from 'node:test';

export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);
export const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')]);

export function setKeys() {
    Object.assign(process.env, {
        TYPESAFE_API_KEY: 'ts-key',
        OPENROUTER_API_KEY: 'or-key',
        LIQUID_API_KEY: 'lq-key',
        PPLX_API_KEY: 'px-key',
        FASTINO_API_KEY: 'fa-key',
        OPENAI_API_KEY: 'oa-key',
        AZURE_API_KEY: 'az-key',
        AZURE_ENDPOINT: 'https://my-foundry.services.ai.azure.com/',
        AZURE_DECISION_DEPLOYMENT: 'my-decision',
        CLOUDFLARE_API_TOKEN: 'cf-token',
        CLOUDFLARE_ACCOUNT_ID: 'cf-account',
    });
}

/**
 * Stub fetch with one handler per call, in order. Each handler gets
 * { url, headers, body } and returns { status, json, headers }.
 * Returns the list of captured requests.
 */
export function stubFetch(...handlers) {
    const calls = [];
    mock.method(globalThis, 'fetch', async (url, init) => {
        const request = { url, headers: init.headers, body: JSON.parse(init.body) };
        calls.push(request);
        const handler = handlers[calls.length - 1];
        if (!handler) throw new Error(`Unexpected fetch #${calls.length} to ${url}`);
        const { status = 200, json = {}, headers } = handler(request);
        return new Response(JSON.stringify(json), { status, headers });
    });
    return calls;
}

export const systemOneOk = answers => () => ({
    json: { model: 'm', answers, usage: { input_tokens: 10, output_tokens: 0 } },
});
