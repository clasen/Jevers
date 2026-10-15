export class JeversError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'JeversError';
        this.details = details;
    }
}

export class ProviderError extends JeversError {
    constructor(message, { provider, model, status, body, retryAfterMs } = {}) {
        super(message, { provider, model, status, body });
        this.name = 'ProviderError';
        this.provider = provider;
        this.model = model;
        this.status = status;
        this.body = body;
        this.retryAfterMs = retryAfterMs;
    }
}

export class MissingApiKeyError extends JeversError {
    constructor(missing) {
        const list = missing.map(({ provider, env }) => `${provider} (${env})`).join(', ');
        super(`Missing API keys: ${list}`, { missing });
        this.name = 'MissingApiKeyError';
        this.missing = missing;
    }
}

export class UnsupportedInputError extends JeversError {
    constructor(needed, routes) {
        const list = routes.map(r => `${r.provider}:${r.model} [${r.modalities.join(', ')}]`).join('; ');
        super(`No attached model accepts input [${needed.join(', ')}]. Attached: ${list}`, { needed, routes });
        this.name = 'UnsupportedInputError';
    }
}
