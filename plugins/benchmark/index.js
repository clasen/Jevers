import { SHORTCUTS } from '../../lib/registry.js';
import { JeversError, UnsupportedInputError } from '../../lib/errors.js';

export { scenarios } from './scenarios.js';

/**
 * Runs the request on every model instead of the fallback chain and grades
 * each answer against `expected` ({ question: answer }).
 * models: shortcut names ('jev', 'd1', …) or { name, attach(jevers) }.
 * decide() then returns { benchmark: { expected, results } }.
 */
export function benchmark({ models, expected } = {}) {
    if (!Array.isArray(models) || !models.length) throw new JeversError('benchmark() needs at least one model');
    if (!expected || typeof expected !== 'object' || !Object.keys(expected).length) {
        throw new JeversError('benchmark() needs the expected answers, e.g. { spam: true }');
    }
    const participants = models.map(toParticipant);

    return {
        name: 'benchmark',
        async execute({ request, signal, fork }) {
            checkExpected(expected, request.questions);
            const runs = participants.map(({ name, attach }) => ({ name, jevers: attach(fork()) }));
            const results = [];
            for (const run of runs) results.push(await measure(run, request.questions, expected, signal));
            return { benchmark: { expected, results } };
        },
    };
}

function toParticipant(model) {
    if (typeof model === 'string') {
        if (!SHORTCUTS[model]) throw new JeversError(`Unknown model shortcut "${model}"`);
        return { name: model, attach: jevers => jevers[model]() };
    }
    if (typeof model?.name !== 'string' || typeof model.attach !== 'function') {
        throw new JeversError('A benchmark model is a shortcut name or { name, attach(jevers) }');
    }
    return model;
}

function checkExpected(expected, questions) {
    for (const [name, answer] of Object.entries(expected)) {
        const question = questions[name];
        if (!question) throw new JeversError(`Expected answer for unknown question "${name}"`);
        const valid = {
            noul: () => typeof answer === 'boolean',
            choice: () => Object.hasOwn(question.criteria, answer),
            score: () => question.criteria.includes(answer),
        }[question.type]();
        if (!valid) throw new JeversError(`Expected answer ${JSON.stringify(answer)} is not valid for ${question.type} "${name}"`);
    }
}

async function measure({ name, jevers }, questions, expected, signal) {
    const startedAt = performance.now();
    const entry = { model: name, provider: null, modelId: null, grades: null, correct: 0, graded: 0, latencyMs: null, usage: null, skipped: null, error: null };
    try {
        const result = await jevers.decide(signal);
        entry.latencyMs = Math.round(performance.now() - startedAt);
        entry.provider = result.provider;
        entry.modelId = result.model;
        entry.usage = result.usage;
        entry.grades = Object.fromEntries(Object.entries(expected).map(([q, answer]) =>
            [q, grade(result.answers[q], questions[q], answer)]));
        const grades = Object.values(entry.grades);
        entry.graded = grades.length;
        entry.correct = grades.filter(g => g.correct).length;
    } catch (err) {
        if (signal?.aborted) throw err;
        if (err instanceof UnsupportedInputError) {
            entry.skipped = err.message;
        } else {
            entry.latencyMs = Math.round(performance.now() - startedAt);
            entry.error = { name: err.name, message: err.message, causes: err.errors?.map(e => e.message) };
        }
    }
    return entry;
}

/** probability: what the model gave to the expected answer (null when it did not say). */
function grade(answer, question, expected) {
    if (answer.type === 'refusal') return { expected, actual: 'refusal', correct: false, probability: null };
    switch (question.type) {
        case 'noul': {
            const actual = answer.noul >= 0.5;
            return { expected, actual, correct: actual === expected, probability: expected ? answer.noul : 1 - answer.noul };
        }
        case 'choice':
            return {
                expected,
                actual: answer.choice,
                correct: answer.choice === expected,
                probability: answer.probabilities?.[expected] ?? null,
            };
        case 'score': {
            const index = question.criteria.indexOf(expected);
            const actual = question.criteria[Math.round(answer.score)];
            return { expected, actual, correct: actual === expected, probability: answer.probabilities?.[index] ?? null };
        }
    }
}

/**
 * Aggregate benchmark results per model, overall and per category.
 * cases: [{ category?, benchmark }], as returned by decide() plus an optional category.
 */
export function summarize(cases) {
    const byCategory = {};
    for (const { category = 'all', benchmark: { results } } of cases) {
        (byCategory[category] ??= []).push(...results);
    }
    return {
        models: rank(Object.values(byCategory).flat()),
        categories: Object.fromEntries(Object.entries(byCategory).map(([category, results]) => [category, rank(results)])),
    };
}

function rank(results) {
    const byModel = new Map();
    for (const result of results) byModel.set(result.model, [...(byModel.get(result.model) ?? []), result]);
    return [...byModel].map(([model, entries]) => {
        const answered = entries.filter(e => e.grades);
        const grades = answered.flatMap(e => Object.values(e.grades));
        const probabilities = grades.map(g => g.probability).filter(p => p !== null);
        const correct = grades.filter(g => g.correct).length;
        return {
            model,
            cases: entries.length,
            answered: answered.length,
            skipped: entries.filter(e => e.skipped).length,
            errors: entries.filter(e => e.error).length,
            questions: grades.length,
            correct,
            accuracy: grades.length ? correct / grades.length : null,
            meanProbability: probabilities.length ? mean(probabilities) : null,
            meanLatencyMs: answered.length ? Math.round(mean(answered.map(e => e.latencyMs))) : null,
            tokens: {
                input: sum(answered.map(e => e.usage.input_tokens)),
                output: sum(answered.map(e => e.usage.output_tokens)),
            },
        };
    }).sort((a, b) => (b.accuracy ?? -1) - (a.accuracy ?? -1) || (b.meanProbability ?? -1) - (a.meanProbability ?? -1));
}

const sum = values => values.reduce((total, v) => total + (v ?? 0), 0);
const mean = values => sum(values) / values.length;
