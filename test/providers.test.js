import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { TypeSafe, Liquid, Perplexity, Fastino, Azure, Cloudflare, Local } from '../lib/providers/system-one.js';
import { OpenAIDecisions } from '../lib/providers/openai.js';
import { PNG, WAV, setKeys, stubFetch, systemOneOk } from './helpers.js';

setKeys();
afterEach(() => mock.restoreAll());

const text = [{ kind: 'text', text: 'Payouts failing for 3 days' }];
const image = { kind: 'image', mime: 'image/png', base64: PNG.toString('base64'), dataUrl: `data:image/png;base64,${PNG.toString('base64')}` };
const questions = {
    department: { type: 'choice', instructions: 'Which team?', criteria: { billing: 'Payments', technical: null } },
    urgent: { type: 'noul', instructions: 'Urgent?' },
    severity: { type: 'score', instructions: 'How bad?', criteria: ['low', 'mid', 'high'] },
};

test('TypeSafe posts System One with a bearer token', async () => {
    const calls = stubFetch(systemOneOk({ urgent: { type: 'noul', noul: 0.9 } }));
    const { answers, usage } = await new TypeSafe().decide({ model: 'jev-latest', parts: text, questions });
    assert.equal(calls[0].url, 'https://api.typesafe.ai/v1/systemone');
    assert.equal(calls[0].headers.Authorization, 'Bearer ts-key');
    assert.equal(calls[0].headers['TypeSafe-Danger-Zone-Images'], undefined);
    assert.deepEqual(calls[0].body, { model: 'jev-latest', state: 'Payouts failing for 3 days', questions });
    assert.equal(answers.urgent.noul, 0.9);
    assert.equal(usage.input_tokens, 10);
});

test('TypeSafe sends images as assets referenced in the state, with the images header', async () => {
    const calls = stubFetch(systemOneOk({}));
    const json = { kind: 'json', value: { plan: 'pro' } };
    const jpeg = { kind: 'image', mime: 'image/jpeg', base64: '/9j/', dataUrl: 'data:image/jpeg;base64,/9j/' };
    await new TypeSafe().decide({ model: 'jev-latest', parts: [image, json, jpeg], questions });

    const { headers, body } = calls[0];
    assert.equal(headers['TypeSafe-Danger-Zone-Images'], 'true');
    assert.equal(headers.Authorization, 'Bearer ts-key');
    const [pngRef, plan, jpegRef] = body.state;
    assert.deepEqual(plan, { plan: 'pro' });
    assert.notEqual(pngRef, jpegRef);
    assert.deepEqual(body.assets, {
        [pngRef]: { type: 'image', format: 'png', data_base64: image.base64 },
        [jpegRef]: { type: 'image', format: 'jpeg', data_base64: '/9j/' },
    });
});

test('TypeSafe places the image reference in the text state where the image was added', async () => {
    const calls = stubFetch(systemOneOk({}));
    await new TypeSafe().decide({ model: 'jev-latest', parts: [...text, image], questions });
    const [reference] = Object.keys(calls[0].body.assets);
    assert.equal(calls[0].body.state, `Payouts failing for 3 days\n\n${reference}`);
});

test('TypeSafe rejects image formats other than PNG and JPEG', async () => {
    const calls = stubFetch();
    const webp = { kind: 'image', mime: 'image/webp', base64: 'UklGRg==', dataUrl: 'data:image/webp;base64,UklGRg==' };
    await assert.rejects(
        new TypeSafe().decide({ model: 'jev-latest', parts: [...text, webp], questions }),
        /TypeSafe accepts PNG or JPEG images, not image\/webp/,
    );
    assert.equal(calls.length, 0);
});

test('Liquid sends images as a top-level array', async () => {
    const calls = stubFetch(systemOneOk({}));
    await new Liquid().decide({ model: 'd1', parts: [...text, image], questions });
    assert.equal(calls[0].url, 'https://api.liquid.ai/decisions/v1/systemone');
    assert.deepEqual(calls[0].body.images, [image.dataUrl]);
    assert.equal(calls[0].body.state, 'Payouts failing for 3 days');
});

test('Perplexity appends images to the state as image_url parts', async () => {
    const calls = stubFetch(systemOneOk({}));
    await new Perplexity().decide({ model: 'pplx', parts: [...text, image], questions });
    assert.deepEqual(calls[0].body.state, [
        'Payouts failing for 3 days',
        { type: 'image_url', image_url: { url: image.dataUrl } },
    ]);
    assert.equal(calls[0].body.images, undefined);
});

test('Fastino uses X-API-Key, stringifies instructions and remaps score', async () => {
    const calls = stubFetch(systemOneOk({
        severity: { type: 'score', score: 2, expected_level: 1.6, probabilities: { 0: 0.1, 1: 0.2, 2: 0.7 }, confidence: 0.5 },
    }));
    const objectQuestions = { severity: { ...questions.severity, instructions: { ask: 'How bad?' } } };
    const { answers } = await new Fastino().decide({ model: 'fastino/GLiDE', parts: text, questions: objectQuestions });
    assert.equal(calls[0].headers['X-API-Key'], 'fa-key');
    assert.equal(calls[0].body.questions.severity.instructions, '{"ask":"How bad?"}');
    assert.equal(answers.severity.score, 1.6);
});

test('Azure targets the Foundry endpoint with the deployment as model', async () => {
    const calls = stubFetch(systemOneOk({}));
    await new Azure().decide({ model: 'microsoft-decision-1', parts: text, questions });
    assert.equal(calls[0].url, 'https://my-foundry.services.ai.azure.com/providers/microsoft/v1/systemone');
    assert.equal(calls[0].headers['api-key'], 'az-key');
    assert.equal(calls[0].body.model, 'my-decision');
});

test('Azure reports every missing setting', () => {
    const azure = new Azure({ apiKey: 'k' });
    azure.baseUrl = undefined;
    azure.deployment = undefined;
    assert.deepEqual(azure.missingConfig(), ['AZURE_ENDPOINT', 'AZURE_DECISION_DEPLOYMENT']);
});

test('Cloudflare runs the model on Workers AI and unwraps the result envelope', async () => {
    const calls = stubFetch(() => ({
        json: {
            result: { model: 'clef-flash', answers: { urgent: { type: 'noul', noul: 0.8 } }, usage: { input_tokens: 12, output_tokens: 0 } },
            success: true,
            errors: [],
            messages: [],
        },
    }));
    const { answers, usage } = await new Cloudflare().decide({ model: 'clef-flash', parts: [...text, image], questions });
    assert.equal(calls[0].url, 'https://api.cloudflare.com/client/v4/accounts/cf-account/ai/run/@cf/cloudflare/clef-flash');
    assert.equal(calls[0].headers.Authorization, 'Bearer cf-token');
    assert.deepEqual(calls[0].body, { model: 'clef-flash', state: 'Payouts failing for 3 days', questions, images: [image.dataUrl] });
    assert.equal(answers.urgent.noul, 0.8);
    assert.equal(usage.input_tokens, 12);
});

test('Cloudflare rejects image formats other than PNG, JPEG and WebP', async () => {
    const calls = stubFetch();
    const gif = { kind: 'image', mime: 'image/gif', base64: 'R0lG', dataUrl: 'data:image/gif;base64,R0lG' };
    await assert.rejects(
        new Cloudflare().decide({ model: 'clef', parts: [...text, gif], questions }),
        /Cloudflare accepts PNG, JPEG or WebP images, not image\/gif/,
    );
    assert.equal(calls.length, 0);
});

test('Cloudflare reports every missing setting', () => {
    const cloudflare = new Cloudflare();
    cloudflare.apiKey = undefined;
    cloudflare.accountId = undefined;
    assert.deepEqual(cloudflare.missingConfig(), ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']);
});

test('Local sends images and a single audio clip top-level, without auth', async () => {
    const calls = stubFetch(systemOneOk({}));
    const audio = { kind: 'audio', dataUrl: `data:audio/wav;base64,${WAV.toString('base64')}` };
    await new Local({ url: 'http://127.0.0.1:8080/' }).decide({ parts: [...text, image, audio], questions });
    assert.equal(calls[0].url, 'http://127.0.0.1:8080/v1/systemone');
    assert.equal(calls[0].headers.Authorization, undefined);
    assert.equal(calls[0].body.model, undefined);
    assert.deepEqual(calls[0].body.images, [image.dataUrl]);
    assert.equal(calls[0].body.audio, audio.dataUrl);
});

test('OpenAI converts questions to arrays and answers back to maps', async () => {
    const calls = stubFetch(() => ({
        json: {
            answers: [
                { type: 'choice', name: 'department', choice: 'billing', probabilities: [{ value: 'billing', probability: 0.9 }, { value: 'technical', probability: 0.1 }], confidence: 0.8 },
                { type: 'predicate', name: 'urgent', probability: 0.2 },
                { type: 'score', name: 'severity', score: 0.4, probabilities: [{ value: 0, label: 'low', probability: 0.6 }, { value: 1, label: 'mid', probability: 0.4 }, { value: 2, label: 'high', probability: 0 }], confidence: 0.3 },
            ],
        },
    }));
    const { answers } = await new OpenAIDecisions().decide({ model: 'gpt-6-luna', parts: [...text, image], questions });

    assert.equal(calls[0].url, 'https://api.openai.com/v1/decisions');
    assert.deepEqual(calls[0].body.input, [{
        role: 'user',
        content: [
            { type: 'input_text', text: 'Payouts failing for 3 days' },
            { type: 'input_image', image_url: image.dataUrl },
        ],
    }]);
    assert.deepEqual(calls[0].body.questions, [
        { type: 'choice', name: 'department', instructions: 'Which team?', choices: [{ value: 'billing', description: 'Payments' }, { value: 'technical' }] },
        { type: 'predicate', name: 'urgent', instructions: 'Urgent?' },
        { type: 'score', name: 'severity', instructions: 'How bad?', levels: [{ label: 'low' }, { label: 'mid' }, { label: 'high' }] },
    ]);
    assert.deepEqual(answers.department.probabilities, { billing: 0.9, technical: 0.1 });
    assert.deepEqual(answers.urgent, { type: 'noul', noul: 0.2 });
    assert.deepEqual(answers.severity.probabilities, { 0: 0.6, 1: 0.4, 2: 0 });
});

test('OpenAI sends plain text input when there are no images and keeps refusals', async () => {
    const calls = stubFetch(() => ({ json: { answers: [{ type: 'refusal', name: 'urgent' }] } }));
    const { answers } = await new OpenAIDecisions().decide({ model: 'gpt-6-luna', parts: text, questions: { urgent: questions.urgent } });
    assert.equal(calls[0].body.input, 'Payouts failing for 3 days');
    assert.deepEqual(answers.urgent, { type: 'refusal' });
});

test('HTTP errors become ProviderError with status, body and Retry-After', async () => {
    stubFetch(() => ({ status: 429, json: { error: 'slow down' }, headers: { 'retry-after': '2' } }));
    await assert.rejects(
        new TypeSafe().decide({ model: 'jev-latest', parts: text, questions }),
        err => err.name === 'ProviderError' && err.status === 429 && err.retryAfterMs === 2000 && err.body.includes('slow down'),
    );
});
