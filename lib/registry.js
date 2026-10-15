import { TypeSafe, OpenRouter, Liquid, Perplexity, Fastino, Azure, Cloudflare } from './providers/system-one.js';
import { OpenAIDecisions } from './providers/openai.js';
import { JeversError } from './errors.js';

export const PROVIDERS = {
    typesafe: TypeSafe,
    openrouter: OpenRouter,
    liquid: Liquid,
    perplexity: Perplexity,
    fastino: Fastino,
    azure: Azure,
    cloudflare: Cloudflare,
    openai: OpenAIDecisions,
};

/**
 * Model shortcuts: the single source for the fluent model methods.
 * Each one lists its routes in fallback order, keyed by provider id.
 * The first route is the native one and is on by default; the rest
 * are switched on with `mix` flags, e.g. { openrouter: true }.
 */
export const SHORTCUTS = {
    jev: {
        typesafe: { model: 'jev-latest', modalities: ['text', 'image'] },
        openrouter: { model: '~typesafe/jev-latest', modalities: ['text'] },
    },
    d1: {
        liquid: { model: 'd1', modalities: ['text', 'image'] },
        openrouter: { model: 'liquid/d1', modalities: ['text'] },
    },
    decider: {
        perplexity: { model: 'pplx-decider-v1.1-27b', modalities: ['text', 'image'] },
        openrouter: { model: 'perplexity/pplx-decider-v1.1-27b', modalities: ['text'] },
    },
    glide: {
        fastino: { model: 'fastino/GLiDE', modalities: ['text'] },
    },
    decision1: {
        azure: { model: 'microsoft-decision-1', modalities: ['text'] },
        openrouter: { model: 'microsoft/microsoft-decision-1', modalities: ['text'] },
    },
    luna: {
        openai: { model: 'gpt-6-luna', modalities: ['text', 'image'] },
    },
    kev: {
        openrouter: { model: 'jaredpalmer/kev-4b', modalities: ['text'] },
    },
    clef: {
        cloudflare: { model: 'clef', modalities: ['text', 'image'] },
    },
    clefFlash: {
        cloudflare: { model: 'clef-flash', modalities: ['text', 'image'] },
    },
};

/**
 * The routes a shortcut attaches: { provider, model, modalities }.
 * Flag precedence: native default < instance `mix` < call `mix`.
 * A call-level `model` replaces the native route's model.
 */
export function resolveShortcut(name, { model, mix } = {}, instanceMix = {}, providerOptions = {}) {
    const spec = SHORTCUTS[name];
    if (!spec) throw new JeversError(`Unknown model shortcut "${name}"`);
    const [native] = Object.keys(spec);
    const flags = { [native]: true, ...instanceMix, ...mix };
    return Object.entries(spec)
        .filter(([provider]) => flags[provider])
        .map(([provider, route]) => ({
            provider: new PROVIDERS[provider](providerOptions[provider]),
            model: provider === native && model ? model : route.model,
            modalities: route.modalities,
        }));
}
