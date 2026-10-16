---
name: jevers-benchmark
description: Guides comparing decision models with the Jevers benchmark plugin (`jevers/plugins/benchmark`), grading each model's answers against known correct ones and aggregating accuracy, mean probability, latency and tokens with `summarize()`. Use when the user wants to pick between Jev, d1, pplx-decider, GLiDE, Decision-1, gpt-6-luna, Clef, Kev or a local model, evaluate them on labeled data, run the included scenario suite, or says "benchmark jevers", "compare decision models", "which decision model is best", or "evaluate models on my tickets". Do not use for plain Jevers integration; use the `jevers` skill for that.
metadata:
  tags: [jevers, benchmark, evaluation, decision-models, accuracy, calibration]
---

# Jevers Benchmark

The benchmark plugin runs one Jevers request on several decision models and grades each answer against an expected one. Use it to choose models, and their fallback order, on the user's own inputs before wiring them into the app.

## One case

```js
import { Jevers } from 'jevers';
import { benchmark } from 'jevers/plugins/benchmark';

const { benchmark: report } = await Jevers.new()
    .use(benchmark({ models: ['jev', 'd1', 'decider', 'luna'], expected: { verdict: 'phishing' } }))
    .addText('Your account is suspended. Confirm your password at http://paypa1-secure-login.com')
    .choice('verdict', 'How should this email be filed?', ['ham', 'spam', 'phishing'])
    .decide();
```

No model is attached to the outer builder; the plugin attaches each one to a fork of the request.

- `models`: shortcut names (`jev`, `d1`, `decider`, `glide`, `decision1`, `luna`, `kev`, `clef`, `clefFlash`) or `{ name, attach: jevers => jevers.local({ url }) }` for anything needing options.
- `expected`: `{ question: answer }`. `true`/`false` for `noul`, an option for `choice`, a level for `score`. Not every question needs an expected answer; only listed ones are graded.

Each model runs on its own, sequentially, without fallback. `report` is `{ expected, results }`, one result per model:

```js
{
  model: 'jev', provider: 'typesafe', modelId: 'jev-latest',
  grades: { verdict: { expected: 'phishing', actual: 'phishing', correct: true, probability: 0.93 } },
  correct: 1, graded: 1, latencyMs: 358, usage: { input_tokens: 120, output_tokens: 12 },
  skipped: null, error: null
}
```

`probability` is what the model gave the expected answer. A `noul` is correct when `noul >= 0.5` matches; a `score` is correct when it rounds to the expected level; a refusal is incorrect with `probability: null`.

Models that can't take the input (e.g. text-only models on an image) get `skipped`. Provider failures go to `error` and the run continues. Unknown models, missing API keys and expected answers that don't fit their question throw before any call.

## Many cases

`summarize(cases)` aggregates `[{ category, benchmark }]` per model, overall (`models`) and per category (`categories`), sorted by accuracy then mean probability. Each row has `cases`, `answered`, `skipped`, `errors`, `questions`, `correct`, `accuracy`, `meanProbability`, `meanLatencyMs` and `tokens`.

```js
import { benchmark, summarize } from 'jevers/plugins/benchmark';

const cases = [];
for (const ticket of labeledTickets) {
    const { benchmark: report } = await Jevers.new()
        .use(benchmark({ models: ['jev', 'd1', 'glide'], expected: { team: ticket.team } }))
        .addText(ticket.body)
        .choice('team', 'Which team should handle this ticket?', ['billing', 'technical', 'account', 'sales'])
        .decide();
    cases.push({ category: ticket.channel, benchmark: report });
}

const { models, categories } = summarize(cases);
console.table(models);
```

Labeled data the user already has (tickets with the team that handled them, moderated messages, reviewed transactions) makes the best set.

## Included scenarios

`scenarios` is a suite of 39 problems with one defensible answer each, in categories `quoridor`, `chess`, `tic-tac-toe`, `driving` (synthetic images), `compaction`, `spam`, `safety` and `categorization`. Each is `{ id, category, build(jevers), expected }`:

```js
import { benchmark, scenarios, summarize } from 'jevers/plugins/benchmark';

const cases = [];
for (const scenario of scenarios) {
    const { benchmark: report } = await scenario
        .build(Jevers.new().use(benchmark({ models: ['jev', 'decider'], expected: scenario.expected })))
        .decide();
    cases.push({ category: scenario.category, benchmark: report });
}
console.table(summarize(cases).models);
```

Inside the Jevers repository, `demo/benchmark.js` does this from the command line:

```bash
node demo/benchmark.js                          # every model with API keys
node demo/benchmark.js jev d1 decider --category chess,driving --out report.json
```

## Agent usage rules

- Build the benchmark on the same input shape and questions the app will send. A model that wins on the generic scenarios can lose on the user's data.
- Read `meanProbability` next to `accuracy`. If the app thresholds (e.g. `probabilities.safe >= 0.9`), a model that is right at 0.6 is not usable even with the same accuracy.
- Report skipped and errored models separately; they lower `answered`, not `accuracy`.
- Treat small sets with care: with 4 questions in a category, one miss moves accuracy by 25 points. Say how many cases each number rests on.
- Calls are sequential and billed per model per case. Estimate the call count (`cases × models`) before running a large set and ask before spending heavily.
- Use the ranking to choose the fallback order for the app: the most accurate and best-calibrated model first, a model from a different provider next.
- Pass an `AbortSignal` to `decide()` to bound a run; an abort stops the whole benchmark.
