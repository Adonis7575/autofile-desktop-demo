// End-to-end: launches the real Electron app against a throwaway home folder.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { makeHome } = require('./helpers');

(async () => {
  const h = makeHome();
  let app;
  try {
    const notes = h.write('Downloads\\notes for CSCI 4425.txt', 'week 3 notes');
    const mystery = h.write('Downloads\\mystery.bin', 'zzz');
    const school = path.join(h.home, 'Creations', '03 School', 'CSCI 4425 Deep Learning');

    app = await electron.launch({
      args: [path.join(__dirname, '..')],
      env: { ...process.env, AUTOFILE_HOME: h.home, AUTOFILE_EROOT: h.eRoot, AUTOFILE_DATA: h.dataDir },
    });
    const page = await app.firstWindow();
    await page.waitForSelector('#dropzone');
    assert.equal(await page.locator('#dropOverlay').isVisible(), false, 'drop overlay hidden until something is dragged');

    await page.evaluate((paths) => window.autofile.addPaths(paths), [notes, mystery]);
    await page.waitForSelector('.row[data-status="pending"] >> nth=1', { timeout: 20000 });

    const notesRow = page.locator('.row[data-name="notes for CSCI 4425.txt"]');
    assert.match(await notesRow.locator('.dest').innerText(), /CSCI 4425 Deep Learning/);
    await notesRow.locator('button.approve').click();
    await notesRow.locator('text=Moved').waitFor();
    assert.ok(fs.readdirSync(school).length === 1, 'notes moved into the course folder');

    const mysteryRow = page.locator('.row[data-name="mystery.bin"]');
    await mysteryRow.locator('button.option', { hasText: 'Reference' }).click();
    await mysteryRow.locator('button.approve').click();
    await mysteryRow.locator('text=Moved').waitFor();
    assert.ok(fs.existsSync(path.join(h.home, 'Creations', '06 Reference', 'mystery.bin')));

    await notesRow.locator('button.undo').click();
    await notesRow.locator('button.approve').waitFor();
    assert.ok(fs.existsSync(notes), 'undo put the notes back');

    // The real ways people add files: the "Choose files…" button and drag-and-drop.
    const picked = h.write('Downloads\\picked.txt', 'picked via button');
    await page.setInputFiles('#filePicker', [picked]);
    await page.locator('.row[data-name="picked.txt"]').waitFor({ timeout: 15000 });

    const dragged = h.write('Downloads\\dragged.txt', 'dropped from Explorer');
    const cdp = await page.context().newCDPSession(page);
    const data = { items: [], files: [dragged], dragOperationsMask: 1 };
    for (const type of ['dragEnter', 'dragOver', 'drop']) {
      await cdp.send('Input.dispatchDragEvent', { type, x: 400, y: 400, data });
    }
    await page.locator('.row[data-name="dragged.txt"]').waitFor({ timeout: 15000 });
    assert.equal(await page.locator('#dropOverlay').isVisible(), false, 'overlay goes away after a drop');

    console.log('E2E PASS');
  } catch (e) {
    console.error('E2E FAIL', e);
    process.exitCode = 1;
  } finally {
    if (app) await app.close();
    h.cleanup();
  }
})();
