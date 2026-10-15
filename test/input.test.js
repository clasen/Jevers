import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectMime, buildState, resolveMedia, inputModalities } from '../lib/input.js';
import { JeversError } from '../lib/errors.js';
import { PNG, WAV } from './helpers.js';

test('detectMime reads magic bytes before the extension', () => {
    assert.equal(detectMime(PNG, 'photo.jpg'), 'image/png');
    assert.equal(detectMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
    assert.equal(detectMime(Buffer.from('GIF89a')), 'image/gif');
    assert.equal(detectMime(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])), 'image/webp');
    assert.equal(detectMime(WAV), 'audio/wav');
    assert.equal(detectMime(Buffer.from('????'), 'x.webp'), 'image/webp');
    assert.equal(detectMime(Buffer.from('????')), undefined);
});

test('buildState: text joins, single JSON stays an object, a mix becomes an array', () => {
    assert.equal(buildState([{ kind: 'text', text: 'a' }, { kind: 'text', text: 'b' }]), 'a\n\nb');
    assert.deepEqual(buildState([{ kind: 'json', value: { a: 1 } }]), { a: 1 });
    assert.deepEqual(
        buildState([{ kind: 'text', text: 'a' }, { kind: 'json', value: { a: 1 } }, { kind: 'image' }]),
        ['a', { a: 1 }],
    );
});

test('inputModalities treats JSON as text', () => {
    assert.deepEqual(inputModalities([{ kind: 'json' }, { kind: 'text' }, { kind: 'image' }]), ['text', 'image']);
});

test('resolveMedia accepts Buffers and data URLs and rejects the wrong kind', async () => {
    const fromBuffer = await resolveMedia({ kind: 'image', src: PNG });
    assert.equal(fromBuffer.dataUrl, `data:image/png;base64,${PNG.toString('base64')}`);

    const fromDataUrl = await resolveMedia({ kind: 'audio', src: `data:audio/wav;base64,${WAV.toString('base64')}` });
    assert.equal(fromDataUrl.mime, 'audio/wav');

    await assert.rejects(resolveMedia({ kind: 'audio', src: PNG }), JeversError);
});
