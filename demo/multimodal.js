import { Jevers } from '../index.js';

try { process.loadEnvFile(); } catch {}

const image = process.argv[2];
if (!image) {
    console.error('Usage: node demo/multimodal.js <image path or URL>');
    process.exit(1);
}

// jev answers; d1, decider and luna are fallbacks.
const result = await Jevers.new({ config: { debug: true } })
    .jev()
    .d1()
    .decider()
    .luna()
    .addText('Product photo uploaded by a marketplace seller.')
    .addImage(image)
    .noul('safe', 'Is this image safe to show on a family-friendly marketplace?')
    .choice('category', 'Which category does the product belong to?', ['electronics', 'clothing', 'home', 'toys', 'other'])
    .decide();

console.dir(result, { depth: null });
