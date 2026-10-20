---
name: jevers
description: Instructions for using the Jevers Node.js library to call decision models (TypeSafe Jev, Liquid d1, Perplexity pplx-decider, Fastino GLiDE, Microsoft Decision-1, OpenAI Decisions gpt-6-luna, Cloudflare Clef, Kev, local llama-server) through one chainable builder. Use when writing code that classifies, routes, screens or scores input with a fixed set of outcomes and needs probabilities, such as routing support tickets, yes/no checks, prompt-injection screening, severity scoring, context compaction triage, or image moderation, with fallback between providers. Also use when the user mentions "jevers", "Jevers", "decision model", "System One", "noul", or any of the models above.
metadata:
  tags: [decision-models, classification, routing, probabilities, fallback, multimodal, jev, d1, glide, openai-decisions]
---

# Jevers Library Skill

## Overview

Jevers is a zero-dependency Node.js (20+, ESM) client for decision models: models that take context plus questions with fixed options and return a probability per option, not generated text. You attach one or more models, add text, JSON, images or audio, ask questions, and get answers back in one shape whichever provider replied.

Use this skill when:
- The app must pick from a known set of outcomes: route, label, filter, approve, escalate.
- The caller needs a probability to threshold on, not only a label.
- A decision should survive one provider being down or rate limited.
- Images or audio must be judged by the models that accept them.

Do NOT use for:
- Open-ended text generation, summaries or extraction (use a generative LLM).
- Python or non-Node projects.

## Installation

Check `package.json` for `jevers` first. Otherwise install with the project's package manager:

```bash
pnpm add jevers
```

## Basic request

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

`decide()` returns:

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

## Questions

| Method | Criteria | Answer fields |
|---|---|---|
| `.noul(name, instructions, criteria?)` | optional `{ true: '…', false: '…' }` describing each side | `noul` (probability of yes, 0–1), `confidence` |
| `.choice(name, instructions, criteria)` | array of options, or `{ option: description }` | `choice`, `probabilities` (option → p), `confidence` |
| `.score(name, instructions, levels)` | array of at least 2 levels, lowest to highest | `score` (probability-weighted index, 0…n−1), `legend` (index → level), `probabilities` (index → p), `confidence` |

An answer of `{ type: 'refusal' }` means the model declined that question (OpenAI only). Every question needs a unique name and non-empty instructions.

## Input

- `.addText(text)`, `.addJSON(value)`: the state being judged. Parts are sent in the order added.
- `.addImage(src)`: file path, Buffer, data URL or http(s) URL. Always sent as base64. PNG, JPEG, WebP, GIF.
- `.addAudio(src)`: WAV, local d1-omni only.

Models that cannot take the input's modalities are skipped. If none can, `decide()` throws `UnsupportedInputError`. TypeSafe images take only PNG or JPEG, 280–1568 px per side; anything else fails that model and moves to the next.

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

Pin a version on the native route: `.jev({ model: 'jev-1.13.0' })`. `model` is optional for a local server that loads one model.

`mix` flags add or swap routes for the same model:

```js
Jevers.new({ mix: { openrouter: true } }).jev();                   // TypeSafe, then OpenRouter
Jevers.new().jev({ mix: { typesafe: false, openrouter: true } });  // OpenRouter only
```

## Fallback and chain()

Models are tried in attach order. Statuses 408, 425, 429 and 5xx are retried on the same model with exponential backoff, honoring `Retry-After`; any other failure moves to the next model. If all fail, `decide()` throws an `AggregateError` whose `errors` are `ProviderError`s (`provider`, `model`, `status`, `body`).

`chain()` attaches shortcuts by name, useful when the list comes from configuration:

```js
Jevers.new().chain('jev', 'd1', 'glide');                       // same as .jev().d1().glide()
Jevers.new().chain(...process.env.DECISION_MODELS.split(','));
```

Unknown names throw before anything is attached. Use the fluent methods when a model needs options (`model`, per-call `mix`) and `.local()` for a local server.

## Configuration

API keys come from the environment or `providers`. Jevers does not load `.env`; the app must (e.g. `process.loadEnvFile()`).

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

Missing keys throw `MissingApiKeyError` when the model is attached, listing every missing variable at once.

## Time limits and errors

```js
import { Jevers, UnsupportedInputError } from 'jevers';

try {
    const result = await Jevers.new()
        .jev()
        .glide()
        .addText(ticket.body)
        .noul('urgent', 'Does this need a reply within one hour?')
        .decide(AbortSignal.timeout(3000));
} catch (err) {
    if (err instanceof AggregateError) {
        for (const e of err.errors) console.error(`${e.provider}:${e.model} HTTP ${e.status}`);
    } else if (err instanceof UnsupportedInputError) {
        console.error(err.message);
    } else {
        throw err;   // includes the abort
    }
}
```

The signal covers the whole chain, retries included; on abort `decide()` rethrows and stops. Exports: `Jevers`, `JeversError`, `ProviderError`, `MissingApiKeyError`, `UnsupportedInputError`. The raw provider response of the last call is in `.lastRaw`.

## Plugins

`use({ name, execute(context, next) })` wraps `decide()`. Plugins run in registration order; `next()` continues to the next plugin and then to the models. `context` has `request` (`parts` with media loaded, `questions`), `signal`, and `fork()`, which returns a new `Jevers` with the same input, questions, config, `mix` and `providers` but no models or plugins.

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
```

To compare models on labeled data, use the `jevers-benchmark` skill.

## Agent usage rules

- Use `Jevers.new()`, and build one instance per decision: an instance holds its input and questions, and redefining a question name throws. For many inputs, wrap the builder in a function and call it per item.
- Threshold on `probabilities` (or `noul`), not on `choice`. A 0.55/0.45 split still returns the top option as `choice`. Pick the threshold from what a wrong answer costs.
- Write criteria descriptions for `choice` and `noul` when the option names alone are ambiguous; they are part of what the model judges.
- Order `score` levels from lowest to highest. `probabilities` is keyed by level index, not by level name.
- Attach at least one image-capable model (`jev`, `d1`, `decider`, `luna`, `clef`, `clefFlash`) before `addImage()`; text-only models are skipped, not failed.
- Attach a fallback from a different provider when availability matters.
- Handle `{ type: 'refusal' }` when `luna` is in the chain.
- Keep keys in the environment. Never hardcode them.
