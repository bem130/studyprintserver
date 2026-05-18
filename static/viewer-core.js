export const FIT_MODES = {
    WIDTH: "width",
    HEIGHT: "height",
    BOTH: "both",
};
export const TONE_MODES = {
    AUTO: "auto",
    INVERTED: "inverted",
    ORIGINAL: "original",
};
export function normalizeFitMode(mode) {
    return mode === FIT_MODES.WIDTH || mode === FIT_MODES.HEIGHT
        ? mode
        : FIT_MODES.BOTH;
}
export function normalizeToneMode(mode) {
    return mode === TONE_MODES.INVERTED || mode === TONE_MODES.ORIGINAL
        ? mode
        : TONE_MODES.AUTO;
}
export function nextToneMode(mode) {
    if (mode === TONE_MODES.AUTO)
        return TONE_MODES.INVERTED;
    if (mode === TONE_MODES.INVERTED)
        return TONE_MODES.ORIGINAL;
    return TONE_MODES.AUTO;
}
export function toneIsInverted(mode, theme) {
    return mode === TONE_MODES.INVERTED || (mode === TONE_MODES.AUTO && theme === "dark");
}
export function fitScale(mode, box, bounds) {
    const safeBoxW = Math.max(1, box.width);
    const safeBoxH = Math.max(1, box.height);
    const safeBoundW = Math.max(1, bounds.width);
    const safeBoundH = Math.max(1, bounds.height);
    if (mode === FIT_MODES.WIDTH)
        return safeBoxW / safeBoundW;
    if (mode === FIT_MODES.HEIGHT)
        return safeBoxH / safeBoundH;
    return Math.min(safeBoxW / safeBoundW, safeBoxH / safeBoundH);
}
export function rotatedBounds(width, height, rotation) {
    return Math.abs(rotation) % 180 === 90
        ? { width: height, height: width }
        : { width, height };
}
export function mediaLayout(source, viewport, options) {
    const bounds = rotatedBounds(source.width, source.height, options.rotation);
    const scale = fitScale(options.fitMode, viewport, bounds) * options.zoom;
    const mediaWidth = Math.max(1, Math.round(source.width * scale));
    const mediaHeight = Math.max(1, Math.round(source.height * scale));
    const stage = rotatedBounds(mediaWidth, mediaHeight, options.rotation);
    return {
        mediaWidth,
        mediaHeight,
        stageWidth: stage.width,
        stageHeight: stage.height,
        overflowX: stage.width > viewport.width + 1,
        overflowY: stage.height > viewport.height + 1,
    };
}
export function sourceLightness(lightness, inverted) {
    return inverted ? 1 - lightness : lightness;
}
export function adjustedLightness(lightness, options, range = { low: 0, high: 1 }) {
    let next = lightness;
    if (options.autoNormalize && range.high - range.low > 0.025) {
        next = (next - range.low) / (range.high - range.low);
    }
    const contrast = 1 + options.contrast / 100;
    const brightness = options.brightness / 100;
    return clamp((next - 0.5) * contrast + 0.5 + brightness, 0, 1);
}
export function percentileLightness(histogram, totalPixels, percentile) {
    if (totalPixels <= 0 || histogram.length === 0)
        return 0;
    const threshold = Math.max(1, Math.ceil(totalPixels * percentile));
    let cumulative = 0;
    for (let i = 0; i < histogram.length; i += 1) {
        cumulative += histogram[i] ?? 0;
        if (cumulative >= threshold) {
            return i / Math.max(1, histogram.length - 1);
        }
    }
    return 1;
}
export function lightnessRangeFromHistogram(histogram, totalPixels, lowPercentile, highPercentile) {
    return {
        low: percentileLightness(histogram, totalPixels, lowPercentile),
        high: percentileLightness(histogram, totalPixels, highPercentile),
    };
}
export function srgbToOklab(r8, g8, b8) {
    const r = srgbToLinear(r8 / 255);
    const g = srgbToLinear(g8 / 255);
    const b = srgbToLinear(b8 / 255);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return {
        l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    };
}
export function oklabToDisplaySrgb(l, a, b) {
    let chroma = 1;
    for (let attempt = 0; attempt < 10; attempt += 1) {
        const rgb = oklabToLinearSrgb(l, a * chroma, b * chroma);
        if (inGamut(rgb)) {
            return {
                r: linearToByte(rgb.r),
                g: linearToByte(rgb.g),
                b: linearToByte(rgb.b),
            };
        }
        chroma *= 0.82;
    }
    const rgb = oklabToLinearSrgb(l, a * chroma, b * chroma);
    return {
        r: linearToByte(clamp(rgb.r, 0, 1)),
        g: linearToByte(clamp(rgb.g, 0, 1)),
        b: linearToByte(clamp(rgb.b, 0, 1)),
    };
}
export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
function oklabToLinearSrgb(l, a, b) {
    const lPrime = l + 0.3963377774 * a + 0.2158037573 * b;
    const mPrime = l - 0.1055613458 * a - 0.0638541728 * b;
    const sPrime = l - 0.0894841775 * a - 1.291485548 * b;
    const l3 = lPrime * lPrime * lPrime;
    const m3 = mPrime * mPrime * mPrime;
    const s3 = sPrime * sPrime * sPrime;
    return {
        r: 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
        g: -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
        b: -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
    };
}
function inGamut(rgb) {
    return (rgb.r >= 0 &&
        rgb.r <= 1 &&
        rgb.g >= 0 &&
        rgb.g <= 1 &&
        rgb.b >= 0 &&
        rgb.b <= 1);
}
function srgbToLinear(value) {
    return value <= 0.04045
        ? value / 12.92
        : Math.pow((value + 0.055) / 1.055, 2.4);
}
function linearToByte(value) {
    const encoded = value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
    return Math.round(clamp(encoded, 0, 1) * 255);
}
