// Generates responsive WebP renditions of every photo used on the site.
// Originals in assets/ are left untouched; output goes to assets/img/.
// Usage: npm run images
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'assets');
const OUT = path.join(SRC, 'img');
const WIDTHS = [480, 960, 1600];
const SKIP = new Set(['aralikatte-logo.jpg']); // logo is tiny; served as-is

fs.mkdirSync(OUT, { recursive: true });
const manifest = {};
for (const file of fs.readdirSync(SRC)) {
  if (!/\.(png|jpe?g)$/i.test(file) || SKIP.has(file)) continue;
  const base = file.replace(/\.[^.]+$/, '');
  const meta = await sharp(path.join(SRC, file)).metadata();
  const widths = WIDTHS.filter((w) => w < meta.width);
  if (!widths.length || meta.width <= WIDTHS[WIDTHS.length - 1]) widths.push(Math.min(meta.width, WIDTHS[WIDTHS.length - 1]));
  const uniq = [...new Set(widths)].sort((a, b) => a - b);
  manifest[base] = { width: meta.width, height: meta.height, variants: uniq };
  for (const w of uniq) {
    await sharp(path.join(SRC, file)).resize({ width: w, withoutEnlargement: true })
      .webp({ quality: 78, effort: 5 }).toFile(path.join(OUT, `${base}-${w}.webp`));
  }
}
// logo: rendered at <=76 CSS px, so a 160px WebP covers 2x displays
await sharp(path.join(SRC, 'aralikatte-logo.jpg')).resize({ width: 160 }).webp({ quality: 85 }).toFile(path.join(OUT, 'aralikatte-logo-160.webp'));
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log('optimised', Object.keys(manifest).length, 'images');
