import { Jevers } from '../index.js';

try { process.loadEnvFile(); } catch {}

// Jev on TypeSafe, then Jev through OpenRouter, then Microsoft-Decision-1 through OpenRouter.
const result = await Jevers.new({ mix: { openrouter: true }, config: { debug: true } })
    .jev()
    .decision1({ mix: { azure: false, openrouter: true } })
    .addText('I was charged twice for my subscription this month.')
    .choice('intent', 'What does the customer want?', {
        refund: 'Money back for a charge',
        cancel: 'Stop the subscription',
        question: 'Just asking for information',
    })
    .decide();

console.dir(result, { depth: null });
