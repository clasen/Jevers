import { JeversError } from './errors.js';

/** Map raw System One answers onto the common shape, one per asked question. */
export function normalizeAnswers(raw, questions) {
    const answers = {};
    for (const [name, question] of Object.entries(questions)) {
        const answer = raw?.[name];
        if (!answer) throw new JeversError(`Provider returned no answer for "${name}"`, { raw });
        answers[name] = normalizeAnswer(answer, question);
    }
    return answers;
}

function normalizeAnswer(answer, question) {
    switch (answer.type) {
        case 'noul':
            return {
                type: 'noul',
                noul: answer.noul,
                confidence: answer.confidence ?? Math.abs(2 * answer.noul - 1),
            };
        case 'choice':
            return {
                type: 'choice',
                choice: answer.choice,
                probabilities: answer.probabilities,
                confidence: answer.confidence,
            };
        case 'score':
            return {
                type: 'score',
                score: answer.score,
                legend: Object.fromEntries(question.criteria.map((level, i) => [i, level])),
                probabilities: answer.probabilities,
                confidence: answer.confidence,
            };
        case 'refusal':
            return { type: 'refusal' };
        default:
            throw new JeversError(`Unknown answer type "${answer.type}"`, { answer });
    }
}
