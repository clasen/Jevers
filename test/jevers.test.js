import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Jevers, JeversError, MissingApiKeyError, UnsupportedInputError } from '../index.js';
import { PNG, setKeys, stubFetch, systemOneOk } from './helpers.js';

setKeys();
afterEach(() => mock.restoreAll());

const fast = { config: { retry: { retries: 2, baseDelayMs: 1 } } };
const choiceOk = systemOneOk({
    department: { type: 'choice', choice: 'billing', probabilities: { billing: 0.88, technical: 0.12 }, confidence: 0.81 },
});
const ask = mix => mix
    .addText('Payouts failing')
    .choice('department', 'Which team?', { billing: 'Payments', technical: 'Bugs' });

test('decide returns normalized answers from the first model', async () => {
    const calls = stubFetch(systemOneOk({
        department: { type: 'choice', choice: 'billing', probabilities: { billing: 0.88, technical: 0.12 }, confidence: 0.81 },
        urgent: { type: 'noul', noul: 0.9 },
        severity: { type: 'score', score: 1.7, legend: { 0: 'x' }, probabilities: { 0: 0.1, 1: 0.1, 2: 0.8 }, confidence: 0.6 },
    }));
    const result = await ask(Jevers.new(fast).jev())
        .addJSON({ plan: 'pro' })
        .noul('urgent', 'Urgent?')
        .score('severity', 'How bad?', ['cosmetic', 'degraded', 'blocked'])
        .decide();

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].body.state, ['Payouts failing', { plan: 'pro' }]);
    assert.equal(result.provider, 'typesafe');
    assert.equal(result.model, 'jev-latest');
    assert.equal(result.answers.department.choice, 'billing');
    assert.equal(result.answers.urgent.confidence.toFixed(2), '0.80');
    assert.deepEqual(result.answers.severity.legend, { 0: 'cosmetic', 1: 'degraded', 2: 'blocked' });
    assert.equal(result.usage.input_tokens, 10);
});

test('falls back to the next model when one fails', async () => {
    const calls = stubFetch(() => ({ status: 400, json: { error: 'bad' } }), choiceOk);
    const result = await ask(Jevers.new(fast).jev().glide()).decide();
    assert.equal(calls.length, 2);
    assert.equal(calls[1].url, 'https://api.fastino.ai/v1/systemone');
    assert.equal(result.provider, 'fastino');
});

test('falls back when a provider omits an answer', async () => {
    stubFetch(systemOneOk({}), choiceOk);
    const result = await ask(Jevers.new(fast).jev().glide()).decide();
    assert.equal(result.provider, 'fastino');
});

test('retries retryable statuses on the same model before falling back', async () => {
    const calls = stubFetch(
        () => ({ status: 429, headers: { 'retry-after': '0' } }),
        () => ({ status: 503 }),
        choiceOk,
    );
    const result = await ask(Jevers.new(fast).jev().glide()).decide();
    assert.equal(calls.length, 3);
    assert.ok(calls.every(c => c.url.includes('typesafe')));
    assert.equal(result.provider, 'typesafe');
});

test('throws AggregateError when every model fails', async () => {
    stubFetch(() => ({ status: 400 }), () => ({ status: 401 }));
    await assert.rejects(ask(Jevers.new(fast).jev().glide()).decide(), err =>
        err instanceof AggregateError && err.errors.map(e => e.status).join() === '400,401');
});

test('skips models that cannot take the input modality', async () => {
    const calls = stubFetch(choiceOk);
    const result = await ask(Jevers.new(fast).glide().d1()).addImage(PNG).decide();
    assert.equal(calls.length, 1);
    assert.equal(result.provider, 'liquid');
    assert.deepEqual(calls[0].body.images, [`data:image/png;base64,${PNG.toString('base64')}`]);
});

test('throws UnsupportedInputError when no model takes the input', async () => {
    await assert.rejects(ask(Jevers.new(fast).glide().decision1()).addImage(PNG).decide(), UnsupportedInputError);
});

test('mix flags add OpenRouter routes or replace the native one', () => {
    const both = Jevers.new({ mix: { openrouter: true } }).jev();
    assert.deepEqual(both.routes.map(r => `${r.provider.id}:${r.model}`), ['typesafe:jev-latest', 'openrouter:~typesafe/jev-latest']);

    const onlyRouter = Jevers.new().jev({ mix: { typesafe: false, openrouter: true } });
    assert.deepEqual(onlyRouter.routes.map(r => r.provider.id), ['openrouter']);

    const pinned = Jevers.new().jev({ model: 'jev-1.13.0' });
    assert.equal(pinned.routes[0].model, 'jev-1.13.0');
});

test('chain attaches shortcuts in fallback order, like the fluent methods', () => {
    const routes = jevers => jevers.routes.map(r => `${r.provider.id}:${r.model}`);
    const chained = Jevers.new({ mix: { openrouter: true } }).chain('jev', 'd1', 'glide');
    const fluent = Jevers.new({ mix: { openrouter: true } }).jev().d1().glide();
    assert.deepEqual(routes(chained), routes(fluent));
    assert.equal(chained.routes[0].provider.id, 'typesafe');
});

test('chain rejects anything but known shortcut names', () => {
    assert.throws(() => Jevers.new().chain(), /at least one model shortcut/);
    for (const name of ['gpt', 'toString', 42, { name: 'jev' }]) {
        assert.throws(() => Jevers.new().chain('jev', name), JeversError);
    }
});

test('chain reports every missing API key at once and attaches nothing', () => {
    const saved = { typesafe: process.env.TYPESAFE_API_KEY, liquid: process.env.LIQUID_API_KEY };
    delete process.env.TYPESAFE_API_KEY;
    delete process.env.LIQUID_API_KEY;
    const jevers = Jevers.new();
    try {
        assert.throws(() => jevers.chain('glide', 'jev', 'd1'), err =>
            err instanceof MissingApiKeyError
            && err.missing.map(m => m.env).join() === 'TYPESAFE_API_KEY,LIQUID_API_KEY');
        assert.equal(jevers.routes.length, 0);
    } finally {
        process.env.TYPESAFE_API_KEY = saved.typesafe;
        process.env.LIQUID_API_KEY = saved.liquid;
    }
});

test('chain rejects a shortcut that mix flags leave without routes', () => {
    assert.throws(() => Jevers.new({ mix: { fastino: false } }).chain('jev', 'glide'), /"glide" resolved to no routes/);
});

test('provider options override environment keys', async () => {
    const calls = stubFetch(choiceOk);
    await ask(Jevers.new({ providers: { typesafe: { apiKey: 'explicit' } } }).jev()).decide();
    assert.equal(calls[0].headers.Authorization, 'Bearer explicit');
});

test('reports every missing API key at once', () => {
    const saved = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    try {
        assert.throws(() => Jevers.new({ mix: { openrouter: true } }).jev({ mix: { openrouter: false } }), err =>
            err instanceof MissingApiKeyError && err.missing[0].env === 'TYPESAFE_API_KEY');
    } finally {
        process.env.TYPESAFE_API_KEY = saved;
    }
});

test('validates questions and input before calling any provider', async () => {
    assert.throws(() => Jevers.new().choice('a', 'Pick', {}), JeversError);
    assert.throws(() => Jevers.new().score('a', 'Rate', ['only']), JeversError);
    assert.throws(() => Jevers.new().noul('a', 'Yes?').noul('a', 'Again?'), JeversError);
    assert.throws(() => Jevers.new().noul('a', ''), JeversError);
    await assert.rejects(Jevers.new().addText('x').noul('a', 'Yes?').decide(), /Attach at least one model/);
    await assert.rejects(Jevers.new().jev().addText('x').decide(), /Ask at least one question/);
    await assert.rejects(Jevers.new().jev().noul('a', 'Yes?').decide(), /Add some input/);
});

test('choice accepts an array of options', () => {
    const mix = Jevers.new().choice('color', 'Which color?', ['red', 'blue']);
    assert.deepEqual(mix.questions.color.criteria, { red: null, blue: null });
});

test('an aborted signal stops the chain instead of falling back', async () => {
    const controller = new AbortController();
    stubFetch(() => {
        controller.abort();
        return { status: 503 };
    });
    await assert.rejects(ask(Jevers.new(fast).jev().glide()).decide(controller.signal), { name: 'AbortError' });
});
