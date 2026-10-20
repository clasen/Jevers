import { deflateSync } from 'node:zlib';

/** Synthetic driver's-view images for the vision scenarios, drawn as PNG without dependencies. */

/** Scenes are drawn in a 320×200 space and scaled into the PNG, which fits TypeSafe's 280–1568 px per side. */
const SCENE_WIDTH = 320;
const SCENE_HEIGHT = 200;
const WIDTH = 400;
const HEIGHT = 280;
const HORIZON = 80;

const SKY = [135, 190, 235];
const GRASS = [70, 140, 60];
const ASPHALT = [60, 60, 65];
const WHITE = [240, 240, 240];
const YELLOW = [235, 200, 40];

/** curve: -1 the road bends left, 0 straight, 1 right. */
export function road(curve) {
    return render((x, y) => roadPixel(curve, x, y));
}

/** lit: 'red', 'yellow' or 'green'. A traffic light seen above a straight road. */
export function trafficLight(lit) {
    const lamps = { red: [230, 30, 30], yellow: [240, 190, 20], green: [30, 210, 70] };
    const lampY = { red: 30, yellow: 58, green: 86 };
    return render((x, y) => {
        for (const [color, cy] of Object.entries(lampY)) {
            if ((x - 160) ** 2 + (y - cy) ** 2 <= 11 ** 2) {
                return color === lit ? lamps[color] : lamps[color].map(c => Math.round(c * 0.2));
            }
        }
        if (x >= 145 && x <= 175 && y >= 14 && y <= 102) return [25, 25, 25];
        if (x >= 157 && x <= 163 && y > 102 && y <= 130) return [90, 90, 90];
        return roadPixel(0, x, y);
    });
}

function render(pixel) {
    return encodePNG(WIDTH, HEIGHT, (x, y) => pixel(x * SCENE_WIDTH / WIDTH, y * SCENE_HEIGHT / HEIGHT));
}

function roadPixel(curve, x, y) {
    if (y < HORIZON) return SKY;
    const depth = (y - HORIZON) / (SCENE_HEIGHT - HORIZON);
    const center = SCENE_WIDTH / 2 + curve * (1 - depth) ** 2 * 140;
    const half = 4 + depth * 110;
    const offset = Math.abs(x - center);
    if (offset > half) return GRASS;
    const line = 1 + depth * 3;
    if (offset > half - line) return WHITE;
    if (offset < line / 2 && Math.floor(Math.sqrt(depth) * 14) % 2 === 0) return YELLOW;
    return ASPHALT;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function encodePNG(width, height, pixel) {
    const raw = Buffer.alloc((width * 3 + 1) * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            raw.set(pixel(x, y), y * (width * 3 + 1) + 1 + x * 3);
        }
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 2;
    return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function chunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});

function crc32(buffer) {
    let c = 0xffffffff;
    for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
