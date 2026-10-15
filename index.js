import { setTimeout as sleep } from 'node:timers/promises';
import { SHORTCUTS, resolveShortcut } from './lib/registry.js';
import { Local } from './lib/providers/system-one.js';
import { inputModalities, resolveMedia } from './lib/input.js';
import { normalizeAnswers } from './lib/answers.js';
import { JeversError, MissingApiKeyError, ProviderError, UnsupportedInputError } from './lib/errors.js';

const DEFAULT_CONFIG = {
    retry: { retries: 2, baseDelayMs: 500 },
    debug: false,
};

const resolveParts = parts => Promise.all(parts.map(p => (p.src === undefined ? p : resolveMedia(p))));

const isRetryable = err => err instanceof ProviderError && (err.status >= 500 || [408, 425, 429].includes(err.status));

export class Jevers {
    constructor({ config = {}, mix = {}, providers = {} } = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config, retry: { ...DEFAULT_CONFIG.retry, ...config.retry } };
        this.mix = mix;
        this.providers = providers;
        this.routes = [];
        this.parts = [];
        this.questions = {};
        this.plugins = [];
        this.lastRaw = null;
    }

    static new(options) {
        return new Jevers(options);
    }

    _attach(routes) {
        if (!routes.length) throw new JeversError('Model shortcut resolved to no routes; check your mix flags');
        const missing = routes.flatMap(({ provider }) =>
            provider.missingConfig().map(env => ({ provider: provider.id, env })));
        if (missing.length) throw new MissingApiKeyError(missing);
        for (const route of routes) {
            const duplicate = this.routes.some(r => r.provider.id === route.provider.id && r.model === route.model);
            if (!duplicate) this.routes.push(route);
        }
        return this;
    }

    /** Attach shortcuts in fallback order: chain('jev', 'd1') is .jev().d1(). */
    chain(...names) {
        if (!names.length) throw new JeversError('chain() needs at least one model shortcut');
        const routes = names.map(name => {
            if (!Object.hasOwn(SHORTCUTS, name)) throw new JeversError(`Unknown model shortcut "${String(name)}" in chain()`);
            const resolved = resolveShortcut(name, {}, this.mix, this.providers);
            if (!resolved.length) throw new JeversError(`Model shortcut "${name}" resolved to no routes; check your mix flags`);
            return resolved;
        });
        return this._attach(routes.flat());
    }

    /** plugin: { name, execute(context, next) }, run in registration order around decide(). */
    use(plugin) {
        if (typeof plugin?.name !== 'string' || !plugin.name) throw new JeversError('A plugin needs a name');
        if (typeof plugin.execute !== 'function') throw new JeversError(`Plugin "${plugin.name}" needs execute(context, next)`);
        if (this.plugins.some(p => p.name === plugin.name)) throw new JeversError(`Plugin "${plugin.name}" is already registered`);
        this.plugins.push(plugin);
        return this;
    }

    /** A local llama-server serving d1-3B or d1-omni. */
    local({ url, model, modalities = ['text'] } = {}) {
        return this._attach([{ provider: new Local({ url }), model, modalities }]);
    }

    addText(text) {
        this.parts.push({ kind: 'text', text: String(text) });
        return this;
    }

    addJSON(value) {
        this.parts.push({ kind: 'json', value });
        return this;
    }

    /** src: file path, Buffer, data URL or http(s) URL. */
    addImage(src) {
        this.parts.push({ kind: 'image', src });
        return this;
    }

    addAudio(src) {
        this.parts.push({ kind: 'audio', src });
        return this;
    }

    /** criteria: { option: description | null } or [option, …] */
    choice(name, instructions, criteria) {
        const map = Array.isArray(criteria) ? Object.fromEntries(criteria.map(o => [o, null])) : criteria;
        if (!map || !Object.keys(map).length) throw new JeversError(`choice "${name}" needs at least one option`);
        return this._question(name, { type: 'choice', instructions, criteria: map });
    }

    /** criteria (optional): { true: description, false: description } */
    noul(name, instructions, criteria) {
        return this._question(name, { type: 'noul', instructions, ...(criteria && { criteria }) });
    }

    /** levels: ordered from lowest to highest. */
    score(name, instructions, levels) {
        if (!Array.isArray(levels) || levels.length < 2) {
            throw new JeversError(`score "${name}" needs at least two levels`);
        }
        return this._question(name, { type: 'score', instructions, criteria: levels });
    }

    _question(name, question) {
        if (!name) throw new JeversError('Questions need a name');
        if (this.questions[name]) throw new JeversError(`Question "${name}" is already defined`);
        if (!question.instructions) throw new JeversError(`Question "${name}" needs instructions`);
        this.questions[name] = question;
        return this;
    }

    async decide(signal) {
        if (!Object.keys(this.questions).length) throw new JeversError('Ask at least one question');
        if (!this.parts.length) throw new JeversError('Add some input, e.g. .addText()');
        if (!this.plugins.length) return this._decide(this.parts, signal);

        const parts = await resolveParts(this.parts);
        const request = { parts, questions: this.questions };
        const fork = () => {
            const jevers = new Jevers({ config: this.config, mix: this.mix, providers: this.providers });
            jevers.parts = [...parts];
            jevers.questions = { ...this.questions };
            return jevers;
        };
        const dispatch = index => (index === this.plugins.length
            ? this._decide(parts, signal)
            : this.plugins[index].execute({ request, signal, fork }, () => dispatch(index + 1)));
        return dispatch(0);
    }

    async _decide(input, signal) {
        if (!this.routes.length) throw new JeversError('Attach at least one model, e.g. .jev()');
        const needed = inputModalities(input);
        const routes = this.routes.filter(r => needed.every(m => r.modalities.includes(m)));
        if (!routes.length) throw new UnsupportedInputError(needed, this.routes.map(r => ({ ...r, provider: r.provider.id })));
        for (const skipped of this.routes.filter(r => !routes.includes(r))) {
            this._debug(`skip ${skipped.provider.id}:${skipped.model} (accepts ${skipped.modalities.join(', ')})`);
        }

        const parts = await resolveParts(input);
        const errors = [];
        for (const route of routes) {
            try {
                const { raw, answers, usage } = await this._withRetry(route, { model: route.model, parts, questions: this.questions, signal });
                this.lastRaw = raw;
                return {
                    provider: route.provider.id,
                    model: route.model,
                    answers: normalizeAnswers(answers, this.questions),
                    usage: { input_tokens: usage?.input_tokens, output_tokens: usage?.output_tokens },
                };
            } catch (err) {
                if (signal?.aborted) throw err;
                this._debug(`fail ${route.provider.id}:${route.model} → ${err.message}`);
                errors.push(err);
            }
        }
        throw new AggregateError(errors, `All ${routes.length} decision models failed`);
    }

    async _withRetry(route, request) {
        const { retries, baseDelayMs } = this.config.retry;
        for (let attempt = 0; ; attempt++) {
            try {
                return await route.provider.decide(request);
            } catch (err) {
                if (attempt >= retries || !isRetryable(err)) throw err;
                const delay = err.retryAfterMs ?? baseDelayMs * 2 ** attempt;
                this._debug(`retry ${route.provider.id}:${route.model} in ${delay}ms (HTTP ${err.status})`);
                await sleep(delay, undefined, { signal: request.signal });
            }
        }
    }

    _debug(message) {
        if (this.config.debug) console.debug(`[Jevers] ${message}`);
    }
}

for (const name of Object.keys(SHORTCUTS)) {
    Jevers.prototype[name] = function (options) {
        return this._attach(resolveShortcut(name, options, this.mix, this.providers));
    };
}

export { JeversError, MissingApiKeyError, ProviderError, UnsupportedInputError };
