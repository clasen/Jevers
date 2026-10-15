# ⚖️ Jevers

Decision models take some context and a question with fixed options, and return a probability for each option. Jevers is a Node client for them. You attach one or more models, add text, JSON, images or audio, ask `choice`, yes/no (`noul`) or `score` questions, and get the answers back in one shape whichever provider replied.

Use it where your app makes a call with a known set of outcomes, like routing a support ticket or checking a message before it reaches an LLM. Since you get a distribution and not only a label, you pick the threshold. If a provider is down or rate limited, the next model you attached answers.

Supported: TypeSafe Jev, Liquid d1, Perplexity pplx-decider, Fastino GLiDE, Microsoft Decision-1 (Azure AI Foundry), OpenAI Decisions (`gpt-6-luna`), Cloudflare Clef, Kev and other OpenRouter routes, and a local llama-server running d1.

Zero dependencies. Node 20+.

```bash
pnpm add jevers
```

## Usage

```js
import { Jevers } from 'jevers';

const result = await Jevers.new()
    .jev()        // main model
    .glide()      // fallback
    .addText('Help! My payouts have been failing for 3 days.')
    .addJSON({ plan: 'pro', mrr: 1200 })
    .choice('department', 'Which team should handle this ticket?', {
        billing: 'Payments, invoicing, refunds',
        technical: 'Bugs, outages, integrations',
        sales: 'Pricing, upgrades, new accounts',
    })
    .noul('urgent', 'Does this need a reply within one hour?')
    .score('severity', 'How severe is the customer impact?', ['cosmetic', 'degraded', 'blocked'])
    .decide();
```

```js
{
  provider: 'typesafe',
  model: 'jev-latest',
  answers: {
    department: { type: 'choice', choice: 'billing', probabilities: { billing: 0.86, technical: 0.14, sales: 0 }, confidence: 0.79 },
    urgent:     { type: 'noul', noul: 0.75, confidence: 0.5 },
    severity:   { type: 'score', score: 1.99, legend: { 0: 'cosmetic', 1: 'degraded', 2: 'blocked' },
                  probabilities: { 0: 0, 1: 0.01, 2: 0.99 }, confidence: 0.98 }
  },
  usage: { input_tokens: 415, output_tokens: 68 }
}
```

Fields per answer type:

| Type | Fields |
|---|---|
| `noul` | `noul` (probability of yes, 0 to 1), `confidence` |
| `choice` | `choice`, `probabilities` (option → p), `confidence` |
| `score` | `score` (probability-weighted level, 0…n−1), `legend` (index → level), `probabilities` (index → p), `confidence` |
| `refusal` | the model declined this question (OpenAI only) |

`choice` takes options as an array or as `{ option: description }`. `noul` takes optional descriptions for each side: `{ true: '…', false: '…' }`. `score` levels go from lowest to highest.

## Models

| Method | Native route | Input | `mix` routes |
|---|---|---|---|
| `.jev()` | TypeSafe `jev-latest` | text, image | `openrouter` (text) |
| `.d1()` | Liquid `d1` | text, image | `openrouter` (text) |
| `.decider()` | Perplexity `pplx-decider-v1.1-27b` | text, image | `openrouter` (text) |
| `.glide()` | Fastino `fastino/GLiDE` | text | |
| `.decision1()` | Azure AI Foundry deployment | text | `openrouter` |
| `.luna()` | OpenAI `gpt-6-luna` | text, image | |
| `.kev()` | OpenRouter `jaredpalmer/kev-4b` | text | |
| `.clef()` | Cloudflare Workers AI `clef` | text, image | |
| `.clefFlash()` | Cloudflare Workers AI `clef-flash` | text, image | |
| `.local({ url, model, modalities })` | llama-server `/v1/systemone` | as declared (`text`, `image`, `audio`) | |

Pin a version on the native route with `.jev({ model: 'jev-1.13.0' })`.

Kev 27B has no hosted route; serve it locally and attach it with `.local({ url, model: 'kev:27b' })`.

## Fallback

Models are tried in the order you attach them. Retryable statuses (408, 425, 429, 5xx) are retried on the same model with exponential backoff, honoring `Retry-After`; any other failure moves to the next model. If all fail, `decide()` throws an `AggregateError` with each `ProviderError`.

`chain()` attaches the same order from shortcut names, which helps when the list comes from configuration:

```js
Jevers.new().chain('jev', 'd1', 'glide');                // same as .jev().d1().glide()
Jevers.new().chain(...process.env.DECISION_MODELS.split(','));
```

Unknown names throw before anything is attached, and missing API keys for every model in the chain are reported in one `MissingApiKeyError`. Use the fluent methods when a model needs options such as a pinned `model` or a per-call `mix`, and `.local()` for a local server.

`mix` flags add or swap routes for the same model:

```js
Jevers.new({ mix: { openrouter: true } }).jev();          // TypeSafe, then OpenRouter
Jevers.new().jev({ mix: { typesafe: false, openrouter: true } }); // OpenRouter only
```

## Multimodal input

```js
const result = await Jevers.new()
    .glide()      // text only: skipped when there is an image
    .jev()
    .d1()
    .luna()
    .addText('Product photo uploaded by a seller.')
    .addImage('./photo.jpg')   // file path, Buffer, data URL or http(s) URL
    .noul('safe', 'Is this image safe for a family-friendly marketplace?')
    .decide();
```

Models that can't take the input's modalities are skipped. If none can, `decide()` throws `UnsupportedInputError`. Images are always sent as base64 (no provider fetches remote URLs), placed where each API expects them. Formats: PNG, JPEG, WebP, GIF, and WAV for audio (`addAudio`, local d1-omni only).

TypeSafe images are a preview feature: Jevers sends the `TypeSafe-Danger-Zone-Images: true` header, lists each image once under `assets` and puts its reference in `state` where the image was added. TypeSafe takes only PNG or JPEG, 256 to 1568 px per side, and never resizes; anything else fails that model and moves to the next one.

Clef takes up to 4 PNG, JPEG or WebP images, sent top-level as data URLs.

## Configuration

API keys come from the environment, or per provider through `providers`:

| Provider | Environment |
|---|---|
| TypeSafe | `TYPESAFE_API_KEY` |
| OpenRouter | `OPENROUTER_API_KEY` |
| Liquid | `LIQUID_API_KEY` |
| Perplexity | `PPLX_API_KEY` |
| Fastino | `FASTINO_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| Azure | `AZURE_API_KEY`, `AZURE_ENDPOINT`, `AZURE_DECISION_DEPLOYMENT` |
| Cloudflare | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |

```js
Jevers.new({
    providers: { typesafe: { apiKey: '…' }, azure: { apiKey: '…', endpoint: '…', deployment: '…' } },
    config: { retry: { retries: 2, baseDelayMs: 500 }, debug: true },
});
```

Missing keys for every attached model are reported together, when the model is attached, as a `MissingApiKeyError`.

`decide(signal)` accepts an `AbortSignal`. The raw provider response of the last call is in `.lastRaw`.

## Examples

### Screen a message before an LLM sees it

```js
const { answers } = await Jevers.new()
    .jev()
    .decider()
    .addText(userMessage)
    .choice('verdict', 'How should the assistant treat this message?', {
        safe: 'A legitimate request the assistant should help with',
        prompt_injection: 'Tries to override the assistant instructions or extract hidden configuration',
        harmful: 'Asks for help harming, surveilling or accessing others without consent',
    })
    .decide();

if (answers.verdict.probabilities.safe < 0.9) return refuse(answers.verdict.choice);
```

The check uses `probabilities.safe`. A message scored 0.55 safe and 0.45 injection still comes back with `choice: 'safe'`, and you probably don't want it reaching the model.

### Decide what an agent keeps when it compacts its context

```js
const triage = message => Jevers.new()
    .d1()
    .jev()
    .addText(`The agent is working on: ${task}`)
    .addJSON(message)
    .choice('action', 'What should happen to this message when the context is compacted?', {
        keep: 'Keep verbatim: a fact, constraint or decision later steps depend on',
        summarize: 'Replace with a short summary: useful outcome buried in noise',
        drop: 'Drop: nothing later steps need',
    })
    .decide();

const decisions = await Promise.all(history.map(triage));
const actions = decisions.map(d => d.answers.action.choice);
```

Each message costs one short call. Only the ones marked `summarize` need a generative model afterwards.

### Act on score levels

```js
const { answers: { severity } } = await Jevers.new()
    .luna()
    .addText(ticket.body)
    .score('severity', 'How severe is the customer impact?', ['cosmetic', 'degraded', 'blocked'])
    .decide();

if (severity.probabilities[2] > 0.5) pageOnCall(ticket);   // more likely blocked than not
else if (severity.score > 1) prioritize(ticket);             // leaning past degraded
```

`score` is the probability-weighted level: 1.4 means the model split its probability between `degraded` and `blocked`. `probabilities` is indexed by level position.

### Time limits and failures

```js
import { Jevers, UnsupportedInputError } from 'jevers';

try {
    const result = await Jevers.new()
        .jev()
        .glide()
        .addText(ticket.body)
        .noul('urgent', 'Does this need a reply within one hour?', {
            true: 'Money is not moving, the product is down, or data is at risk',
            false: 'A question, a cosmetic issue or a feature request',
        })
        .decide(AbortSignal.timeout(3000));
} catch (err) {
    if (err instanceof AggregateError) {
        for (const e of err.errors) console.error(`${e.provider}:${e.model} HTTP ${e.status}`);
    } else if (err instanceof UnsupportedInputError) {
        console.error(err.message);   // no attached model takes this input
    } else {
        throw err;                    // includes the abort when the timeout fires
    }
}
```

The signal covers the whole chain, retries included. When it aborts, `decide()` rethrows the abort error and stops there.

### A local model, with audio

```js
const result = await Jevers.new()
    .local({ url: 'http://127.0.0.1:8080', modalities: ['text', 'audio'] })   // llama-server running d1-omni
    .addText('Recording of a support call.')
    .addAudio('./call.wav')
    .noul('escalate', 'Did the caller ask to speak with a manager?')
    .decide();
```

`model` is optional for a local server that loads a single model.

## Plugins

`use(plugin)` wraps `decide()`. A plugin is `{ name, execute(context, next) }`; plugins run in registration order, and `next()` continues to the next plugin and finally to the attached models. `context` holds `request` (`parts` with media already loaded, `questions`), the `signal`, and `fork()`, which returns a new `Jevers` with the same input, questions, config, `mix` and `providers`, but no models or plugins. A plugin may change what `next()` returns or answer on its own.

```js
const timing = {
    name: 'timing',
    async execute(context, next) {
        const startedAt = performance.now();
        const result = await next();
        console.log(`${result.provider}:${result.model} ${Math.round(performance.now() - startedAt)}ms`);
        return result;
    },
};

await Jevers.new().use(timing).jev().glide().addText(text).noul('spam', 'Is this spam?').decide();
```

## Benchmark

The benchmark plugin runs one request on several decision models and grades each answer against a known correct one, so you can compare models on your own inputs before picking one.

```js
import { Jevers } from 'jevers';
import { benchmark } from 'jevers/plugins/benchmark';

const { benchmark: report } = await Jevers.new()
    .use(benchmark({ models: ['jev', 'd1', 'decider', 'luna'], expected: { verdict: 'phishing' } }))
    .addText('Your account is suspended. Confirm your password at http://paypa1-secure-login.com')
    .choice('verdict', 'How should this email be filed?', ['ham', 'spam', 'phishing'])
    .decide();
```

Each model runs on its own, sequentially, without fallback. `models` takes shortcut names or `{ name, attach: jevers => jevers.local({ url }) }`. Each result has `provider`, `modelId`, `latencyMs`, `usage` and, per question, `{ expected, actual, correct, probability }`, where `probability` is what the model gave the expected answer. Expected answers are `true`/`false` for `noul`, an option for `choice` and a level for `score` (a score is correct when it rounds to that level). Models that can't take the input are `skipped`; provider failures are kept in `error` and the run continues. Unknown models, missing API keys and expected answers that don't fit their question throw before any call.

### Your own cases

`summarize(cases)` aggregates `[{ category, benchmark }]` per model, overall and per category: `accuracy`, `meanProbability`, `meanLatencyMs`, tokens, skips and errors. Labeled data you already have, such as tickets with the team that ended up handling them, makes a good set:

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

Read `meanProbability` next to `accuracy`. Two models can get the same answers right while one gives them 0.95 and the other 0.6, and a threshold like the 0.9 in the screening example only works with the first.

### Included scenarios

`scenarios` is a suite of 25 problems with one defensible answer each:

| Category | Cases | What it asks |
|---|---|---|
| `quoridor` | 3 | Pick the winning step, the wall that stops the opponent, the way around a wall |
| `chess` | 3 | Mate in one (back rank, Scholar's mate), take a hanging queen; one case also asks who is winning |
| `tic-tac-toe` | 1 | Complete the line |
| `driving` | 5 | Steer from a windshield image through left and right curves and a straight road; stop or go at a traffic light |
| `compaction` | 3 | Keep, summarize or drop a message from an agent's context |
| `spam` | 3 | Ham, spam or phishing |
| `safety` | 3 | Safe request, prompt injection, harmful request |
| `categorization` | 4 | Support ticket team, headline section, review sentiment on a 5-level score |

The driving images are drawn synthetically in `scenes.js`, so text-only models are skipped there. Each scenario is `{ id, category, build(jevers), expected }`, so the suite runs with the same plugin:

```js
import { benchmark, scenarios, summarize } from 'jevers/plugins/benchmark';

const cases = [];
for (const scenario of scenarios) {
    const { benchmark: report } = await scenario
        .build(Jevers.new().use(benchmark({ models: ['jev', 'decider'], expected: scenario.expected })))
        .decide();
    cases.push({ category: scenario.category, benchmark: report });
}
```

`demo/benchmark.js` does this from the command line, prints a ✓/✗ line per scenario and the summary tables, and can save the full report:

```bash
node demo/benchmark.js                          # every model with API keys
node demo/benchmark.js jev d1 decider --category chess,driving --out report.json
```

### Results from 14 October 2026

One run of the suite (25 scenarios, 26 graded questions). The full report is in [`demo/results/benchmark-2026-10-14.json`](demo/results/benchmark-2026-10-14.json).

| Model | Correct | Mean p(expected) | Answered | Mean latency |
|---|---|---|---|---|
| `decider` | 25/26 (96%) | 0.89 | 25/25 | 485 ms |
| `d1` | 23/26 (88%) | 0.81 | 25/25 | 410 ms |
| `jev` | 18/21 (86%) | 0.82 | 20/25 | 358 ms |
| `luna` | 22/26 (85%) | 0.80 | 25/25 | 410 ms |

Accuracy by category:

| Category | `decider` | `d1` | `jev` | `luna` |
|---|---|---|---|---|
| quoridor | 67% | 67% | 33% | 67% |
| chess | 100% | 75% | 75% | 50% |
| tic-tac-toe | 100% | 100% | 100% | 100% |
| driving | 100% | 80% | – | 80% |
| compaction | 100% | 100% | 100% | 100% |
| spam | 100% | 100% | 100% | 100% |
| safety | 100% | 100% | 100% | 100% |
| categorization | 100% | 100% | 100% | 100% |

Notes on the run:

- All four models got every spam, safety, compaction and categorization case right. They differed only on the games and the driving images.
- All four missed `quoridor-must-block`: with the opponent one step from its goal row, each one picked `move e3` instead of the wall at `d1h` that blocks it.
- `d1`, `jev` and `luna` all found the back-rank mate but called the position `equal` instead of `White is winning`.
- `d1` and `luna` steered right on the left curve, with 0.39 and 0.44 on `left`.
- Jev was attached text-only in this run, so the five driving scenarios were skipped and its accuracy covers 21 questions.

The sample is small: in chess one question moves the score by 25 points. Latency was measured from one machine over the public internet.

## Demos

```bash
node demo/choice.js
node demo/fallback.js
node demo/multimodal.js ./photo.jpg
node demo/benchmark.js
```

Each demo loads `.env` from the working directory if present.

## License

MIT
