import { buildState } from '../input.js';
import { SystemOne } from './system-one.js';

const asText = value => (typeof value === 'string' ? value : JSON.stringify(value));

/**
 * OpenAI Decisions: same idea as System One, different wire format
 * (questions/answers as arrays, `predicate` instead of `noul`, `input` instead of `state`).
 */
export class OpenAIDecisions extends SystemOne {
    static id = 'openai';
    static url = 'https://api.openai.com/v1/decisions';
    static apiKeyEnv = 'OPENAI_API_KEY';

    buildBody({ model, parts, questions }) {
        return { model, input: toInput(parts), questions: Object.entries(questions).map(toQuestion) };
    }

    parseResponse(json) {
        return {
            answers: Object.fromEntries(json.answers.map(a => [a.name, fromAnswer(a)])),
            usage: json.usage,
        };
    }
}

function toInput(parts) {
    const text = asText(buildState(parts));
    const images = parts.filter(p => p.kind === 'image');
    if (!images.length) return text;
    return [{
        role: 'user',
        content: [
            ...(text && [{ type: 'input_text', text }]),
            ...images.map(i => ({ type: 'input_image', image_url: i.dataUrl })),
        ],
    }];
}

function toQuestion([name, { type, instructions, criteria }]) {
    const base = { name, instructions: asText(instructions) };
    switch (type) {
        case 'noul': {
            const hints = criteria ? `\nTrue: ${criteria.true ?? ''}\nFalse: ${criteria.false ?? ''}` : '';
            return { type: 'predicate', ...base, instructions: base.instructions + hints };
        }
        case 'choice':
            return {
                type: 'choice',
                ...base,
                choices: Object.entries(criteria).map(([value, description]) =>
                    description == null ? { value } : { value, description }),
            };
        case 'score':
            return { type: 'score', ...base, levels: criteria.map(level => ({ label: asText(level) })) };
    }
}

function fromAnswer(answer) {
    switch (answer.type) {
        case 'predicate':
            return { type: 'noul', noul: answer.probability };
        case 'choice':
            return {
                type: 'choice',
                choice: answer.choice,
                probabilities: Object.fromEntries(answer.probabilities.map(p => [p.value, p.probability])),
                confidence: answer.confidence,
            };
        case 'score':
            return {
                type: 'score',
                score: answer.score,
                probabilities: Object.fromEntries(answer.probabilities.map((p, i) => [i, p.probability])),
                confidence: answer.confidence,
            };
        default:
            return { type: answer.type };
    }
}
