import type { VisualRecipe } from '@the-pocket/shared';

export const neutralRecipe: VisualRecipe = {
  exposure: 0, warmth: 0, contrast: 0, saturation: 0, highlights: 0, shadows: 0, sharpness: 0, crop: 'original',
};
export const presets = [
  { name: 'The Signature', edits: { warmth: 0.12, contrast: 0.03, saturation: -0.06, sharpness: 0.08 } },
  { name: 'Evening at The Pocket', edits: { exposure: 0.15, warmth: 0.08, highlights: -0.22, shadows: 0.16 } },
  { name: 'Carmel Daylight', edits: { warmth: -0.05, exposure: 0.07, highlights: -0.2, saturation: -0.04 } },
  { name: 'Behind the Experience', edits: { contrast: 0.13, saturation: -0.09, shadows: 0.08, sharpness: 0.15 } },
];

const ratios = { square: 1, portrait: 4 / 5, landscape: 3 / 2 };
const clamp = (value: number) => Math.max(0, Math.min(255, value));

export function renderPhoto(canvas: HTMLCanvasElement, image: HTMLImageElement, recipe: VisualRecipe, limit: number) {
  const { naturalWidth, naturalHeight } = image;
  const ratio = recipe.crop === 'original' ? naturalWidth / naturalHeight : ratios[recipe.crop];
  const sw = Math.min(naturalWidth, naturalHeight * ratio);
  const sh = Math.min(naturalHeight, naturalWidth / ratio);
  const scale = Math.min(1, limit / Math.max(sw, sh));
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser does not support canvas editing.');
  ctx.drawImage(image, (naturalWidth - sw) / 2, (naturalHeight - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
  if (Object.entries(recipe).every(([key, value]) => key === 'crop' || value === 0)) return;
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = frame.data;
  const exposure = 2 ** recipe.exposure;
  const contrast = 1 + recipe.contrast * 0.65;
  const saturation = 1 + recipe.saturation * 0.75;
  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index]!;
    const green = pixels[index + 1]!;
    const blue = pixels[index + 2]!;
    const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    const light = luma / 255;
    const tone = 55 * (recipe.shadows * (1 - light) ** 3 + recipe.highlights * light ** 3);
    const value = (channel: number, warmth: number) =>
      clamp(((luma + (channel - luma) * saturation + warmth) * exposure - 128) * contrast + 128 + tone);
    pixels[index] = value(red, 22 * recipe.warmth);
    pixels[index + 1] = value(green, 4 * recipe.warmth);
    pixels[index + 2] = value(blue, -22 * recipe.warmth);
  }
  if (recipe.sharpness > 0 && frame.width > 2 && frame.height > 2) {
    const copy = pixels.slice();
    const row = frame.width * 4;
    for (let y = 1; y < frame.height - 1; y++) {
      for (let x = 1; x < frame.width - 1; x++) {
        const index = y * row + x * 4;
        for (let component = 0; component < 3; component++) {
          const pixel = index + component;
          const nearby = (copy[pixel - 4]! + copy[pixel + 4]! + copy[pixel - row]! + copy[pixel + row]!) / 4;
          pixels[pixel] = clamp(copy[pixel]! + (copy[pixel]! - nearby) * recipe.sharpness);
        }
      }
    }
  }
  ctx.putImageData(frame, 0, 0);
}

export function exportPhoto(image: HTMLImageElement, recipe: VisualRecipe): Promise<Blob> {
  const canvas = document.createElement('canvas');
  renderPhoto(canvas, image, recipe, Math.max(image.naturalWidth, image.naturalHeight));
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Image export failed.')), 'image/png');
  });
}
