/*
 * 全ファイルを 1 枚の HTML にまとめる (テストプレイ用の Artifact に載せるため)。
 *   node pack.js [出力先]              既定: dist/calendar-puzzle.html (そのまま開ける 1 枚)
 *   node pack.js --artifact [出力先]    Artifact 用。外側の <html> などは公開時に付くので書かない。
 *                                      既定: dist/calendar-puzzle.artifact.html
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const artifact = process.argv.includes('--artifact');
const arg = process.argv.slice(2).filter((a) => a !== '--artifact')[0];
const out = arg || path.join(ROOT, 'dist', artifact ? 'calendar-puzzle.artifact.html' : 'calendar-puzzle.html');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const css = read('styles.css');
const coreJs = read('core.js');
const appJs = read('app.js');
let html = read('index.html');

if (!artifact) {
  const icon = 'data:image/svg+xml;base64,' + Buffer.from(read('icon.svg')).toString('base64');
  html = html
    .replace('<link rel="icon" href="./icon.svg" type="image/svg+xml">', `<link rel="icon" href="${icon}" type="image/svg+xml">`)
    .replace('<link rel="stylesheet" href="./styles.css">', () => `<style>\n${css}\n</style>`)
    .replace('<script src="./core.js"></script>', () => `<script>\n${coreJs}\n</script>`)
    .replace('<script src="./app.js"></script>', () => `<script>\n${appJs}\n</script>`);
} else {
  const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
  const body = html.match(/<body>([\s\S]*)<\/body>/)[1]
    .replace('<script src="./core.js"></script>', () => `<script>\n${coreJs}\n</script>`)
    .replace('<script src="./app.js"></script>', () => `<script>\n${appJs}\n</script>`);
  // 公開時の外枠が、安全域ぶんの余白と高さの基準を持つ。二重にならないよう、こちらの安全域は 0 にする。
  const override = ':root { --sat: 0px; --sab: 0px; --sal: 0px; --sar: 0px; }\nhtml, body { height: 100%; }';
  html = `${title}\n<style>\n${css}\n${override}\n</style>\n${body}`;
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`${out}  (${(html.length / 1024).toFixed(1)} KB)`);
