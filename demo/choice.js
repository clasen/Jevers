import { Jevers } from '../index.js';

try { process.loadEnvFile(); } catch {}

const result = await Jevers.new({ config: { debug: true } })
    .jev()
    .luna()
    .addText('Help! My payouts have been failing for 3 days and my customers are angry.')
    .addJSON({ plan: 'pro', mrr: 1200 })
    .choice('department', 'Which team should handle this ticket?', {
        billing: 'Payments, invoicing, refunds',
        technical: 'Bugs, outages, integrations',
        sales: 'Pricing, upgrades, new accounts',
    })
    .noul('urgent', 'Does this need a reply within one hour?')
    .score('severity', 'How severe is the customer impact?', ['cosmetic', 'degraded', 'blocked'])
    .decide();

console.dir(result, { depth: null });
