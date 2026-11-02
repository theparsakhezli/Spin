/*
 * End-to-end smoke test. Runs the real app on the current OS against generated audio.
 *
 *   npm test                      runs from source
 *   SPIN_EXE=/path/to/spin npm test   runs a packaged build
 *
 * On Linux without a display: xvfb-run -a npm test
 */
const { _electron } = require('playwright-core');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}

function wav(seconds, frequency) {
  const rate = 22050, samples = rate * seconds, b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const t = i / rate;
    b.writeInt16LE((.6 * Math.sin(2 * Math.PI * frequency * t) + .3 * Math.sin(2 * Math.PI * 70 * t)) * 30000, 44 + i * 2);
  }
  return b;
}

function launch(profile) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; // VS Code terminals set this, and it turns Electron into plain Node.
  const flags = [`--user-data-dir=${profile}`];
  // Containers and CI machines commonly lack the user namespaces Chromium's sandbox needs.
  if (process.platform === 'linux') flags.push('--no-sandbox');
  if (process.env.SPIN_EXE) return _electron.launch({ executablePath: process.env.SPIN_EXE, args: flags, env });
  return _electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), ...flags], env });
}

async function main() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'spin-test-'));
  const music = path.join(work, 'Music Folder');
  const profile = path.join(work, 'profile');
  fs.mkdirSync(path.join(music, 'Album ماه'), { recursive: true });
  fs.writeFileSync(path.join(music, '01 - Test Artist - First Song.wav'), wav(30, 220));
  fs.writeFileSync(path.join(music, 'Album ماه', '02 ستاره.wav'), wav(30, 330));
  fs.writeFileSync(path.join(music, '._01 - Test Artist - First Song.wav'), 'macOS resource fork, not audio');
  fs.writeFileSync(path.join(music, 'notes.txt'), 'ignored');
  if (process.platform !== 'win32') {
    fs.symlinkSync(path.join(music, '01 - Test Artist - First Song.wav'), path.join(music, '03 linked.wav'));
    fs.symlinkSync(music, path.join(music, 'loop')); // Must not recurse forever.
  }
  const expected = process.platform === 'win32' ? 2 : 3;

  const errors = [];
  let app = await launch(profile);
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, music);
  let page = await app.firstWindow();
  page.on('pageerror', e => errors.push(e.message));
  await sleep(800);
  const bounds = () => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return { ...w.getBounds(), top: w.isAlwaysOnTop() };
  });

  let b = await bounds();
  check('opens as a small always-on-top widget', b.width < 400 && b.height < 160 && b.top, JSON.stringify(b));
  check('page cannot reach Node', await page.evaluate(() => typeof require === 'undefined' && typeof process === 'undefined'));

  await page.keyboard.press('o');
  await page.waitForFunction(() => state.tracks.length > 0 && audio.currentTime > 0, null, { timeout: 15000 }).catch(() => {});
  const scanned = await page.evaluate(() => state.tracks.map(t => t.path));
  check('scan finds audio, skips hidden files, survives symlink loops', scanned.length === expected, JSON.stringify(scanned));
  await sleep(1200);
  const playing = await page.evaluate(() => {
    analyser.getByteFrequencyData(freq);
    return { t: audio.currentTime, paused: audio.paused, energy: freq.reduce((a, v) => a + v, 0) };
  });
  check('audio plays and reaches the visualizer', playing.t > .3 && !playing.paused && playing.energy > 500, JSON.stringify(playing));
  const blocked = await page.evaluate(async file => {
    try { await spinNative.readRange(file, 0, 10); return false; } catch { return true; }
  }, path.join(work, 'outside.txt'));
  const streamBlocked = await page.evaluate(async file => {
    const response = await fetch('spin-media://track/' + encodeURIComponent(file)).catch(() => null);
    return !response || response.status === 403;
  }, path.join(work, 'outside.txt'));
  check('files outside the open folder cannot be read', blocked && streamBlocked);

  const disc = await page.evaluate(() => ({ cx: geo.cx, cy: geo.cy, r: geo.disc * .7 }));
  const at = a => [disc.cx + Math.cos(a) * disc.r, disc.cy + Math.sin(a) * disc.r];
  await page.evaluate(() => { audio.currentTime = 2; });
  await sleep(100);
  await page.mouse.move(...at(0));
  await page.mouse.down();
  for (let i = 1; i <= 30; i++) {
    await page.mouse.move(...at(i / 30 * Math.PI));
    await sleep(8);
  }
  await sleep(150);
  await page.mouse.up();
  await sleep(200);
  const spun = await page.evaluate(() => ({ t: audio.currentTime, paused: audio.paused }));
  check('spinning the record seeks and resumes', spun.t > 9 && !spun.paused, JSON.stringify(spun));

  await page.keyboard.press('e');
  await sleep(500);
  b = await bounds();
  check('e switches to the full view, not on top', b.width > 400 && !b.top, JSON.stringify(b));
  await page.keyboard.press('e');
  await sleep(500);

  await page.keyboard.press('t');
  await sleep(600);
  check('style panel opens', await page.evaluate(() => document.body.classList.contains('styling')));
  const styles = await page.evaluate(() => {
    const seen = new Set();
    for (const style of Object.keys(DISC_STYLES)) {
      const c = document.createElement('canvas');
      c.width = c.height = 120;
      paintDisc(c.getContext('2d'), 60, 60, 54, .5, { ...discOptions('rgb(255,80,40)'), style, cover: null, sticker: null, text: 'A', time: 1, bars: null });
      seen.add(c.toDataURL());
    }
    return { total: Object.keys(DISC_STYLES).length, unique: seen.size };
  });
  check('every record style draws something distinct', styles.total >= 37 && styles.unique === styles.total, JSON.stringify(styles));
  const fonts = await page.evaluate(async () => (await listFonts()).length);
  check('font list is available', fonts > 0, String(fonts));
  if (process.env.SPIN_SHOTS) await page.screenshot({ path: path.join(process.env.SPIN_SHOTS, `panel-${process.platform}.png`) });
  await page.locator('#style .chip', { hasText: /^Paper$/ }).click();
  await sleep(150);
  check('a preset restyles the app', await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()) === '#f3efe6');
  await page.keyboard.press('Escape');
  await sleep(500);

  await page.evaluate(() => { audio.currentTime = 11; });
  await page.keyboard.press('b');
  await sleep(100);
  await page.evaluate(() => { savePosition(); });
  check('no page errors', errors.length === 0, errors.join(' | '));

  await page.click('#w-close');
  await sleep(1200);

  app = await launch(profile);
  page = await app.firstWindow();
  await page.waitForFunction(() => state.tracks.length > 0 && audio.currentTime > 0, null, { timeout: 15000 }).catch(() => {});
  const back = await page.evaluate(() => ({
    tracks: state.tracks.length,
    t: audio.currentTime,
    paused: audio.paused,
    marks: state.tracks.flatMap(t => (peek(t) ? peek(t).marks : [])).length,
    bg: theme.bg,
  }));
  check('restart restores folder, place, marks and style, paused', back.tracks === expected && back.t > 10 && back.paused && back.marks === 1 && back.bg === '#f3efe6', JSON.stringify(back));
  await app.close();

  fs.rmSync(work, { recursive: true, force: true, maxRetries: 5 });
  console.log(failures ? `\n${failures} failed` : '\nall passed');
  process.exit(failures ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
