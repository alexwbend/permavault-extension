// Render the canonical vectors without adding a runtime extension dependency.
// Supply an existing Sharp installation, such as Codex's bundled image tools.
const fs = require('node:fs/promises');
const path = require('node:path');

async function main() {
  const sharpPathIndex = process.argv.indexOf('--sharp-module');
  const sharpPath = sharpPathIndex >= 0 ? process.argv[sharpPathIndex + 1] : 'sharp';
  if (!sharpPath) throw new Error('--sharp-module requires a module directory.');
  const sharp = require(sharpPath);
  const root = path.resolve(__dirname, '..');
  const production = await fs.readFile(path.join(root, 'assets/icon.svg'));
  const development = await fs.readFile(path.join(root, 'assets/icon-dev.svg'));
  const mark = await fs.readFile(path.join(root, 'assets/permavault-mark.svg'), 'utf8');

  const icon128 = await sharp(production).resize(128, 128).png().toBuffer();
  const icon32 = await sharp(production).resize(32, 32).png().toBuffer();
  const iconDev = await sharp(development).resize(128, 128).png().toBuffer();
  await fs.writeFile(path.join(root, 'assets/icon-128.png'), icon128);
  await fs.writeFile(path.join(root, 'assets/icon-32.png'), icon32);
  await fs.writeFile(path.join(root, 'static/icon.png'), icon128);
  await fs.writeFile(path.join(root, 'static/icon-dev.png'), iconDev);
  await fs.writeFile(path.join(root, 'store/icon.png'), icon128);
  await fs.writeFile(path.join(root, 'static/permavault-mark.svg'), mark.replace('fill="currentColor"', 'fill="#16352B"'));
  console.log('Generated production, development, Store and popup brand assets.');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
