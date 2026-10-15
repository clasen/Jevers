import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Jevers, JeversError, MissingApiKeyError } from '../index.js';
import { benchmark, summarize, scenarios } from '../plugins/benchmark/index.js';
import { PNG, setKeys, stubFetch, systemOneOk } from './helpers.js';

setKeys();
afterEach(() => mock.restoreAll());

const fast = { config: { retry: { retries: 0, baseDelayMs: 1 } } };
const spamCase = jevers => jevers
    .addText('You WON a gift card, click here')
    .noul('spam', 'Is this spam?')
    .choice('verdict', 'File as?', ['ham', 'spam', 'phishing']);

test('use() rejects malformed and duplicate plugins', () => {
    const plugin = { name: 'p', execute: (_, next) => next() };
    assert.throws(() => Jevers.new().use({ execute: () => {} }), JeversError);
    assert.throws(() => Jevers.new().use({ name: 'p' }), JeversError);
    assert.throws(() => Jevers.new().use(plugin).use(plugin), /already registered/);
});

test('plugins wrap decide in order and may answer without calling a model', async () => {
    const order = [];
    const calls = stubFetch(systemOneOk({ spam: { type: 'noul', noul: 0.9 } }));
    const result = await Jevers.new(fast).jev()
        .use({ name: 'outer', execute: async (_, next) => { order.push('outer'); return { ...(await next()), wrapped: true }; } })
        .use({ name: 'inner', execute: ({ request }, next) => { order.push(Object.keys(request.questions).join()); return next(); } })
        .addText('x')
        .noul('spam', 'Spam?')
        .decide();
    assert.deepEqual(order, ['outer', 'spam']);
    assert.equal(calls.length, 1);
    assert.equal(result.wrapped, true);

    const shortCircuit = await Jevers.new()
        .use({ name: 'cache', execute: () => ({ cached: true }) })
        .addText('x')
        .noul('spam', 'Spam?')
        .decide();
    assert.deepEqual(shortCircuit, { cached: true });
});

test('benchmark runs every model on the same request and grades the answers', async () => {
    const calls = stubFetch(
        systemOneOk({
            spam: { type: 'noul', noul: 0.8 },
            verdict: { type: 'choice', choice: 'spam', probabilities: { ham: 0.1, spam: 0.7, phishing: 0.2 }, confidence: 0.6 },
        }),
        systemOneOk({
            spam: { type: 'noul', noul: 0.3 },
            verdict: { type: 'choice', choice: 'phishing', probabilities: { ham: 0.1, spam: 0.4, phishing: 0.5 }, confidence: 0.2 },
        }),
    );
    const { benchmark: report } = await spamCase(Jevers.new(fast)
        .use(benchmark({ models: ['jev', 'glide'], expected: { spam: true, verdict: 'spam' } })))
        .decide();

    assert.deepEqual(calls.map(c => new URL(c.url).hostname), ['api.typesafe.ai', 'api.fastino.ai']);
    assert.deepEqual(calls[0].body.questions, calls[1].body.questions);
    const [jev, glide] = report.results;
    assert.equal(jev.provider, 'typesafe');
    assert.equal(jev.correct, 2);
    assert.equal(jev.grades.verdict.probability, 0.7);
    assert.equal(glide.correct, 0);
    assert.equal(glide.grades.spam.probability, 0.3);
    assert.equal(glide.grades.verdict.actual, 'phishing');
    assert.equal(typeof jev.latencyMs, 'number');
});

test('benchmark grades score questions by the rounded level', async () => {
    stubFetch(systemOneOk({ mood: { type: 'score', score: 0.4, probabilities: { 0: 0.6, 1: 0.3, 2: 0.1 }, confidence: 0.5 } }));
    const { benchmark: report } = await Jevers.new(fast)
        .use(benchmark({ models: ['jev'], expected: { mood: 'bad' } }))
        .addText('Awful')
        .score('mood', 'Mood?', ['bad', 'meh', 'good'])
        .decide();
    assert.deepEqual(report.results[0].grades.mood, { expected: 'bad', actual: 'bad', correct: true, probability: 0.6 });
});

test('benchmark skips models that cannot see the input and records failures', async () => {
    const calls = stubFetch(() => ({ status: 500 }), systemOneOk({ stop: { type: 'noul', noul: 0.95 } }));
    const { benchmark: report } = await Jevers.new(fast)
        .use(benchmark({ models: ['glide', 'decider', 'd1'], expected: { stop: true } }))
        .addImage(PNG)
        .noul('stop', 'Stop?')
        .decide();

    assert.equal(calls.length, 2);
    const [glide, decider, d1] = report.results;
    assert.match(glide.skipped, /No attached model accepts input/);
    assert.match(decider.error.causes[0], /HTTP 500/);
    assert.equal(d1.correct, 1);
});

test('benchmark validates models, keys and expected answers before calling any model', async () => {
    const calls = stubFetch();
    assert.throws(() => benchmark({ models: ['nope'], expected: { spam: true } }), /Unknown model shortcut/);
    assert.throws(() => benchmark({ models: ['toString'], expected: { spam: true } }), /Unknown model shortcut/);
    assert.throws(() => benchmark({ models: ['jev'] }), /expected answers/);
    await assert.rejects(spamCase(Jevers.new().use(benchmark({ models: ['jev'], expected: { verdict: 'junk' } }))).decide(), /not valid for choice/);
    await assert.rejects(spamCase(Jevers.new().use(benchmark({ models: ['jev'], expected: { other: true } }))).decide(), /unknown question/);

    const saved = process.env.FASTINO_API_KEY;
    delete process.env.FASTINO_API_KEY;
    try {
        await assert.rejects(spamCase(Jevers.new().use(benchmark({ models: ['jev', 'glide'], expected: { spam: true } }))).decide(), MissingApiKeyError);
    } finally {
        process.env.FASTINO_API_KEY = saved;
    }
    assert.equal(calls.length, 0);
});

test('summarize ranks models overall and per category', () => {
    const entry = (model, correct, probability, extra = {}) => ({
        model, latencyMs: 100, usage: { input_tokens: 10, output_tokens: 1 },
        grades: { q: { correct, probability } }, ...extra,
    });
    const summary = summarize([
        { category: 'spam', benchmark: { results: [entry('jev', true, 0.9), entry('d1', false, 0.2)] } },
        { category: 'driving', benchmark: { results: [{ model: 'jev', grades: null, skipped: 'text only' }, entry('d1', true, 0.6)] } },
    ]);

    assert.deepEqual(summary.models.map(m => [m.model, m.accuracy, m.skipped]), [['jev', 1, 1], ['d1', 0.5, 0]]);
    assert.equal(summary.models[1].meanProbability, 0.4);
    assert.deepEqual(summary.models[1].tokens, { input: 20, output: 2 });
    assert.deepEqual(summary.categories.driving.map(m => [m.model, m.accuracy]), [['d1', 1], ['jev', null]]);
});

test('every scenario is answerable and a perfect model scores 100%', async () => {
    const perfect = expected => ({ body }) => ({
        json: {
            answers: Object.fromEntries(Object.entries(expected).map(([name, answer]) => {
                const { type, criteria } = body.questions[name];
                if (type === 'noul') return [name, { type, noul: answer ? 0.9 : 0.1 }];
                const key = type === 'score' ? criteria.indexOf(answer) : answer;
                return [name, { type, [type]: key, probabilities: { [key]: 0.9 }, confidence: 0.8 }];
            })),
        },
    });
    const calls = stubFetch(...scenarios.map(s => perfect(s.expected)));
    const cases = [];
    for (const s of scenarios) {
        const { benchmark: report } = await s.build(Jevers.new(fast).use(benchmark({ models: ['d1'], expected: s.expected }))).decide();
        cases.push({ category: s.category, benchmark: report });
    }

    assert.equal(calls.length, scenarios.length);
    assert.equal(new Set(scenarios.map(s => s.id)).size, scenarios.length);
    const [d1] = summarize(cases).models;
    assert.equal(d1.accuracy, 1);
    assert.equal(d1.questions, scenarios.reduce((n, s) => n + Object.keys(s.expected).length, 0));
});
