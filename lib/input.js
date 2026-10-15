import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { JeversError } from './errors.js';

const SIGNATURES = [
    { mime: 'image/png', test: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
    { mime: 'image/jpeg', test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
    { mime: 'image/gif', test: b => b.subarray(0, 4).toString('latin1') === 'GIF8' },
    { mime: 'image/webp', test: b => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
    { mime: 'audio/wav', test: b => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WAVE' },
];

const EXTENSIONS = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.wav': 'audio/wav',
};

export function detectMime(buffer, filename) {
    const match = SIGNATURES.find(s => s.test(buffer));
    if (match) return match.mime;
    return filename ? EXTENSIONS[path.extname(filename).toLowerCase()] : undefined;
}

/** Input modality of a part: text and JSON both travel as text. */
export function modalityOf(part) {
    return part.kind === 'json' ? 'text' : part.kind;
}

export function inputModalities(parts) {
    return [...new Set(parts.map(modalityOf))];
}

async function loadSource(src) {
    if (Buffer.isBuffer(src)) return { buffer: src };
    if (typeof src !== 'string') {
        throw new JeversError('Media source must be a file path, Buffer, data URL or http(s) URL', { src });
    }
    const dataUrl = src.match(/^data:([^;,]+);base64,(.*)$/s);
    if (dataUrl) return { buffer: Buffer.from(dataUrl[2], 'base64'), mime: dataUrl[1] };
    if (/^https?:\/\//i.test(src)) {
        const response = await fetch(src);
        if (!response.ok) {
            throw new JeversError(`Failed to download media: HTTP ${response.status}`, { src });
        }
        return {
            buffer: Buffer.from(await response.arrayBuffer()),
            mime: response.headers.get('content-type')?.split(';')[0],
            filename: new URL(src).pathname,
        };
    }
    return { buffer: await readFile(src), filename: src };
}

/** Turn a media part ({ kind, src }) into { kind, mime, base64, dataUrl }. */
export async function resolveMedia(part) {
    const { buffer, mime: declared, filename } = await loadSource(part.src);
    const mime = detectMime(buffer, filename) || declared;
    if (!mime?.startsWith(`${part.kind}/`)) {
        throw new JeversError(`Unsupported ${part.kind} format: ${mime || 'unknown'}`, { mime });
    }
    const base64 = buffer.toString('base64');
    return { kind: part.kind, mime, base64, dataUrl: `data:${mime};base64,${base64}` };
}

/**
 * The System One `state` built from the text and JSON parts:
 * only text → one string; a single JSON value → that value; a mix → an array.
 */
export function buildState(parts) {
    const content = parts.filter(p => p.kind === 'text' || p.kind === 'json');
    if (content.every(p => p.kind === 'text')) return content.map(p => p.text).join('\n\n');
    if (content.length === 1) return content[0].value;
    return content.map(p => (p.kind === 'text' ? p.text : p.value));
}
