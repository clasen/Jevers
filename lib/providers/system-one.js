import { randomUUID } from 'node:crypto';
import { buildState } from '../input.js';
import { JeversError, ProviderError } from '../errors.js';

/**
 * A provider speaking the System One protocol:
 * POST { model, state, questions } → { model, answers, usage }.
 * Subclasses override only what differs: endpoint, auth, media placement, answer quirks.
 */
export class SystemOne {
    static id = 'systemone';
    static url = null;
    static apiKeyEnv = null;

    constructor({ apiKey } = {}) {
        const { apiKeyEnv } = this.constructor;
        this.apiKey = apiKeyEnv ? apiKey ?? process.env[apiKeyEnv] : undefined;
    }

    get id() {
        return this.constructor.id;
    }

    /** Environment variables this provider still needs. */
    missingConfig() {
        const { apiKeyEnv } = this.constructor;
        return apiKeyEnv && !this.apiKey ? [apiKeyEnv] : [];
    }

    endpoint() {
        return this.constructor.url;
    }

    headers() {
        return { Authorization: `Bearer ${this.apiKey}` };
    }

    buildBody({ model, parts, questions }) {
        return { model, state: buildState(parts), questions };
    }

    /** → { answers (System One map), usage } */
    parseResponse(json) {
        return { answers: json.answers, usage: json.usage };
    }

    async decide({ model, parts, questions, signal }) {
        const response = await fetch(this.endpoint({ model, parts, questions }), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...this.headers({ model, parts, questions }) },
            body: JSON.stringify(this.buildBody({ model, parts, questions })),
            signal,
        });
        const text = await response.text();
        if (!response.ok) {
            throw new ProviderError(`${this.id} responded HTTP ${response.status}`, {
                provider: this.id,
                model,
                status: response.status,
                body: text,
                retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
            });
        }
        const raw = JSON.parse(text);
        return { raw, ...this.parseResponse(raw) };
    }
}

function parseRetryAfter(value) {
    if (value === null) return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return seconds * 1000;
    const date = Date.parse(value);
    return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

const media = (parts, kind) => parts.filter(p => p.kind === kind);

const TYPESAFE_IMAGE_FORMATS = { 'image/png': 'png', 'image/jpeg': 'jpeg' };

/**
 * Images go once in a top-level `assets` map, keyed by a unique reference;
 * the reference sits in `state` where the image was added. Images are a
 * preview feature, enabled per request with a header.
 */
export class TypeSafe extends SystemOne {
    static id = 'typesafe';
    static url = 'https://api.typesafe.ai/v1/systemone';
    static apiKeyEnv = 'TYPESAFE_API_KEY';

    headers(request) {
        const headers = super.headers();
        return media(request.parts, 'image').length ? { ...headers, 'TypeSafe-Danger-Zone-Images': 'true' } : headers;
    }

    buildBody(request) {
        if (!media(request.parts, 'image').length) return super.buildBody(request);
        const assets = {};
        const parts = request.parts.map(part => {
            if (part.kind !== 'image') return part;
            const format = TYPESAFE_IMAGE_FORMATS[part.mime];
            if (!format) throw new JeversError(`TypeSafe accepts PNG or JPEG images, not ${part.mime}`, { mime: part.mime });
            const reference = randomUUID();
            assets[reference] = { type: 'image', format, data_base64: part.base64 };
            return { kind: 'text', text: reference };
        });
        return { ...super.buildBody({ ...request, parts }), assets };
    }
}

export class OpenRouter extends SystemOne {
    static id = 'openrouter';
    static url = 'https://openrouter.ai/api/v1/systemone';
    static apiKeyEnv = 'OPENROUTER_API_KEY';
}

export class Liquid extends SystemOne {
    static id = 'liquid';
    static url = 'https://api.liquid.ai/decisions/v1/systemone';
    static apiKeyEnv = 'LIQUID_API_KEY';

    buildBody(request) {
        const body = super.buildBody(request);
        const images = media(request.parts, 'image');
        return images.length ? { ...body, images: images.map(i => i.dataUrl) } : body;
    }
}

export class Perplexity extends SystemOne {
    static id = 'perplexity';
    static url = 'https://api.perplexity.ai/v1/decisions';
    static apiKeyEnv = 'PPLX_API_KEY';

    buildBody(request) {
        const body = super.buildBody(request);
        const images = media(request.parts, 'image');
        if (!images.length) return body;
        const state = Array.isArray(body.state) ? body.state : [body.state];
        return {
            ...body,
            state: [...state, ...images.map(i => ({ type: 'image_url', image_url: { url: i.dataUrl } }))],
        };
    }
}

export class Fastino extends SystemOne {
    static id = 'fastino';
    static url = 'https://api.fastino.ai/v1/systemone';
    static apiKeyEnv = 'FASTINO_API_KEY';

    headers() {
        return { 'X-API-Key': this.apiKey };
    }

    /** GLiDE only accepts string instructions. */
    buildBody(request) {
        const body = super.buildBody(request);
        const questions = Object.fromEntries(Object.entries(body.questions).map(([name, q]) => [
            name,
            { ...q, instructions: typeof q.instructions === 'string' ? q.instructions : JSON.stringify(q.instructions) },
        ]));
        return { ...body, questions };
    }

    /** GLiDE's `score` is the winning level index; the weighted score is `expected_level`. */
    parseResponse(json) {
        const answers = Object.fromEntries(Object.entries(json.answers).map(([name, a]) => [
            name,
            a.type === 'score' ? { ...a, score: a.expected_level } : a,
        ]));
        return { answers, usage: json.usage };
    }
}

/** Microsoft-Decision-1 on Azure AI Foundry; `model` is the deployment name. */
export class Azure extends SystemOne {
    static id = 'azure';
    static apiKeyEnv = 'AZURE_API_KEY';

    constructor({ apiKey, endpoint, deployment } = {}) {
        super({ apiKey });
        this.baseUrl = endpoint ?? process.env.AZURE_ENDPOINT;
        this.deployment = deployment ?? process.env.AZURE_DECISION_DEPLOYMENT;
    }

    missingConfig() {
        return [
            ...super.missingConfig(),
            ...(this.baseUrl ? [] : ['AZURE_ENDPOINT']),
            ...(this.deployment ? [] : ['AZURE_DECISION_DEPLOYMENT']),
        ];
    }

    endpoint() {
        return `${this.baseUrl.replace(/\/+$/, '')}/providers/microsoft/v1/systemone`;
    }

    headers() {
        return { 'api-key': this.apiKey };
    }

    buildBody(request) {
        return super.buildBody({ ...request, model: this.deployment });
    }
}

const CLOUDFLARE_IMAGE_FORMATS = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * Clef on Workers AI: the model id goes in the URL, images go top-level as
 * data URLs, and the System One response comes wrapped in `result`.
 */
export class Cloudflare extends SystemOne {
    static id = 'cloudflare';
    static apiKeyEnv = 'CLOUDFLARE_API_TOKEN';

    constructor({ apiKey, accountId } = {}) {
        super({ apiKey });
        this.accountId = accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID;
    }

    missingConfig() {
        return [...super.missingConfig(), ...(this.accountId ? [] : ['CLOUDFLARE_ACCOUNT_ID'])];
    }

    endpoint({ model }) {
        return `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/run/@cf/cloudflare/${model}`;
    }

    buildBody(request) {
        const body = super.buildBody(request);
        const images = media(request.parts, 'image');
        const unsupported = images.find(i => !CLOUDFLARE_IMAGE_FORMATS.includes(i.mime));
        if (unsupported) {
            throw new JeversError(`Cloudflare accepts PNG, JPEG or WebP images, not ${unsupported.mime}`, { mime: unsupported.mime });
        }
        return images.length ? { ...body, images: images.map(i => i.dataUrl) } : body;
    }

    parseResponse(json) {
        return super.parseResponse(json.result);
    }
}

/** A local llama-server running d1-3B or d1-omni; images and audio go top-level. */
export class Local extends SystemOne {
    static id = 'local';

    constructor({ url } = {}) {
        super();
        if (!url) throw new JeversError('local() requires a url, e.g. http://127.0.0.1:8080');
        this.baseUrl = url;
    }

    endpoint() {
        return `${this.baseUrl.replace(/\/+$/, '')}/v1/systemone`;
    }

    headers() {
        return {};
    }

    buildBody(request) {
        const body = super.buildBody(request);
        if (!body.model) delete body.model;
        const images = media(request.parts, 'image');
        const audio = media(request.parts, 'audio');
        if (audio.length > 1) throw new JeversError('local() accepts a single audio clip');
        return {
            ...body,
            ...(images.length && { images: images.map(i => i.dataUrl) }),
            ...(audio.length && { audio: audio[0].dataUrl }),
        };
    }
}
