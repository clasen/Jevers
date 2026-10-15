import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { Jevers, MissingApiKeyError } from '../index.js';
import { SHORTCUTS } from '../lib/registry.js';
import { benchmark, summarize, scenarios } from '../plugins/benchmark/index.js';

try { process.loadEnvFile(); } catch {}

// node demo/benchmark.js [model …] [--category chess,spam] [--out report.json]
const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { category: { type: 'string' }, out: { type: 'string' } },
});

const hasKeys = name => {
    try {
        Jevers.new()[name]();
        return true;
    } catch (err) {
        if (err instanceof MissingApiKeyError) return false;
        throw err;
    }
};
const models = positionals.length ? positionals : Object.keys(SHORTCUTS).filter(hasKeys);
const categories = values.category?.split(',');
const selected = scenarios.filter(s => !categories || categories.includes(s.category));
if (!models.length || !selected.length) {
    console.error('Nothing to run: no models with API keys, or no scenario in those categories.');
    process.exit(1);
}

console.log(`Benchmarking ${models.join(', ')} on ${selected.length} scenarios\n`);
const cases = [];
for (const [index, scenario] of selected.entries()) {
    const { benchmark: report } = await scenario
        .build(Jevers.new().use(benchmark({ models, expected: scenario.expected })))
        .decide();
    cases.push({ id: scenario.id, category: scenario.category, benchmark: report });
    const marks = report.results.map(r => `${r.model} ${r.skipped ? '–' : r.error ? '!' : Object.values(r.grades).map(g => (g.correct ? '✓' : '✗')).join('')}`);
    console.log(`[${index + 1}/${selected.length}] ${scenario.id.padEnd(28)} ${marks.join('  ')}`);
}

const summary = summarize(cases);
const pct = value => (value === null ? '–' : `${Math.round(value * 100)}%`);

console.log('\nOverall');
console.table(Object.fromEntries(summary.models.map(m => [m.model, {
    accuracy: pct(m.accuracy),
    'p(correct)': pct(m.meanProbability),
    answered: `${m.answered}/${m.cases}`,
    skipped: m.skipped,
    errors: m.errors,
    'avg ms': m.meanLatencyMs ?? '–',
}])));

console.log('Accuracy by category');
console.table(Object.fromEntries(Object.entries(summary.categories).map(([category, rows]) => [
    category,
    Object.fromEntries(models.map(model => [model, pct(rows.find(r => r.model === model)?.accuracy ?? null)])),
])));

const failures = cases.flatMap(c => c.benchmark.results.filter(r => r.error).map(r => `${c.id} ${r.model}: ${r.error.causes?.join('; ') ?? r.error.message}`));
if (failures.length) console.log(`Errors\n${failures.join('\n')}`);

if (values.out) {
    await writeFile(values.out, JSON.stringify({ models, summary, cases }, null, 2));
    console.log(`\nFull report saved to ${values.out}`);
}
