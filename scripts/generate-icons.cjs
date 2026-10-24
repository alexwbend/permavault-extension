// Render the canonical vectors without adding a runtime extension dependency.
// Supply an existing Sharp installation, such as Codex's bundled image tools.
// Each toolbar size has its own vector: the mark sits closer to the edge at
// 16 and 32 px so it stays legible. The Store icon (store/icon.png) is drawn
// with its own clear space by the design source and is not generated here.
const fs = require('node:fs/promises');
const path = require('node:path');

async function main() {
  const sharpPathIndex = process.argv.indexOf('--sharp-module');
  const sharpPath = sharpPathIndex >= 0 ? process.argv[sharpPathIndex + 1] : 'sharp';
  if (!sharpPath) throw new Error('--sharp-module requires a module directory.');
  const sharp = require(sharpPath);
  const root = path.resolve(__dirname, '..');
  const render = async (name, size) => {
    const svg = await fs.readFile(path.join(root, 'assets', name));
    return sharp(svg, { density: Math.round(72 * (512 / size)) }).resize(size, size).png().toBuffer();
  };

  const icon16 = await render('icon-16.svg', 16);
  const icon32 = await render('icon-32.svg', 32);
  const icon48 = await render('icon-48.svg', 48);
  const icon128 = await render('icon.svg', 128);
  const iconDev = await render('icon-dev.svg', 128);
  const mark = await fs.readFile(path.join(root, 'assets/permavault-mark.svg'), 'utf8');
  const logo = await fs.readFile(path.join(root, 'assets/permavault-logo.svg'), 'utf8');

  await fs.writeFile(path.join(root, 'assets/icon-128.png'), icon128);
  await fs.writeFile(path.join(root, 'assets/icon-32.png'), icon32);
  await fs.writeFile(path.join(root, 'static/icon-16.png'), icon16);
  await fs.writeFile(path.join(root, 'static/icon-32.png'), icon32);
  await fs.writeFile(path.join(root, 'static/icon-48.png'), icon48);
  await fs.writeFile(path.join(root, 'static/icon.png'), icon128);
  await fs.writeFile(path.join(root, 'static/icon-dev.png'), iconDev);
  await fs.writeFile(path.join(root, 'static/permavault-mark.svg'), mark.replace('fill="currentColor"', 'fill="#1D1D1F"'));
  await fs.writeFile(path.join(root, 'static/permavault-logo.svg'), logo.replace('fill="currentColor"', 'fill="#1D1D1F"'));
  console.log('Generated toolbar, development and popup brand assets.');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
