import { expect, test } from '@playwright/test';
import path from 'node:path';
const fixture = (name: string) => path.resolve(process.cwd(), '../tests/fixtures', name);
test('all five modes are reachable and output invalidates after settings change',async({page})=>{
  await page.goto('./');
  for(const name of ['+ Alpha','TIF 16→8','Atlas','Gloss ⇄ Rough','Channels']) {
    await page.getByRole('button',{name,exact:true}).click();
    await expect(page.getByRole('navigation',{name:'Texture tools'}).getByRole('button',{name,exact:true})).toHaveAttribute('aria-pressed','true');
  }
  await page.getByRole('button',{name:'Gloss ⇄ Rough',exact:true}).click();
  await page.getByLabel('Source Texture Map (Gloss / Rough / Normal) file', {exact:true}).setInputFiles(fixture('rgba-2x2.png'));
  await expect(page.getByRole('button',{name:'Process textures',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Process textures',exact:true}).click();
  await expect(page.getByAltText('Processed texture')).toBeVisible();
  const exported = page.waitForEvent('download');
  await page.getByRole('button',{name:'Download Output'}).click();
  const download = await exported;
  expect(download.suggestedFilename()).toBe('inverted_texture_2x2.png');
  await page.getByRole('checkbox',{name:'Green',exact:true}).uncheck();
  await expect(page.getByRole('button',{name:'Download Output'})).toHaveCount(0);
  await expect(page.getByAltText('Processed texture')).toHaveCount(0);
});
test('invalid TIFF is rejected, grid clamps to 20 and file state follows grid coordinates',async({page})=>{
  await page.goto('./');
  await page.getByRole('button',{name:'TIF 16→8',exact:true}).click();
  await page.getByLabel('Source 16-bit TIF file',{exact:true}).setInputFiles({name:'broken.tiff',mimeType:'image/tiff',buffer:Buffer.from('broken')});
  await expect(page.getByRole('alert')).toContainText('broken.tiff');
  await page.getByRole('button',{name:'Atlas',exact:true}).click();
  await page.getByRole('button',{name:'2x2',exact:true}).click();
  await page.getByLabel('Slot 3 file',{exact:true}).setInputFiles(fixture('opaque-3x1.png'));
  await expect(page.getByAltText('Slot 3',{exact:true})).toBeVisible();
  await page.getByLabel('Columns',{exact:true}).fill('3');
  await page.getByLabel('Columns',{exact:true}).press('Enter');
  await expect(page.getByAltText('Slot 4',{exact:true})).toBeVisible();
  await page.getByLabel('Rows',{exact:true}).fill('999');
  await page.getByLabel('Rows',{exact:true}).press('Enter');
  await expect(page.getByLabel('Rows',{exact:true})).toHaveValue('20');
  await page.getByRole('button',{name:'Clear All Slots',exact:true}).click();
  await expect(page.getByAltText('Slot 4',{exact:true})).toHaveCount(0);
});
test('Fluent desktop and mobile layouts have no horizontal overflow or runtime errors',async({page})=>{
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:1440,height:900});
  await page.goto('./');
  await expect(page.getByRole('heading',{name:'Texture Packer Pro',exact:true})).toBeVisible();
  await page.screenshot({path:'test-results/web-desktop.png',fullPage:true,animations:'disabled'});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByLabel('Red Channel file',{exact:true}).setInputFiles(fixture('rgba-2x2.png'));
  await expect(page.getByRole('button',{name:'Process textures',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Process textures',exact:true}).click();
  await expect(page.getByRole('button',{name:'Download Output',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/web-mobile.png',fullPage:true,animations:'disabled'});
  expect(errors).toEqual([]);
});
test('keyboard shortcuts open, process and export; preview supports pixel zoom',async({page})=>{
  await page.goto('./');
  const chooser=page.waitForEvent('filechooser');
  await page.keyboard.press('Control+o');
  await (await chooser).setFiles(fixture('rgba-2x2.png'));
  await expect(page.getByRole('button',{name:'Process textures',exact:true})).toBeEnabled();
  await page.keyboard.press('Control+Enter');
  await expect(page.getByAltText('Processed texture')).toBeVisible();
  await page.keyboard.press('Control+=');
  await page.keyboard.press('Control+=');
  await page.keyboard.press('Control+=');
  await expect(page.getByAltText('Processed texture')).toHaveCSS('width','8px');
  const exported=page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  expect((await exported).suggestedFilename()).toBe('packed_rgba_2x2.png');
});
test('cancel terminates processing and the next operation remains usable',async({page})=>{
  await page.goto('./');
  await page.getByRole('button',{name:'Process textures',exact:true}).click();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(page.getByRole('button',{name:'Process textures',exact:true})).toBeEnabled();
  await expect(page.getByAltText('Processed texture')).toHaveCount(0);
  await page.getByRole('button',{name:'Process textures',exact:true}).click();
  await expect(page.getByAltText('Processed texture')).toBeVisible();
});
test('clearing blocked active and queued imports enables fallback processing immediately',async({page})=>{
  let releaseWorkers!: () => void;
  const blocked = new Promise<void>(resolve => { releaseWorkers = resolve; });
  const route = '**/utils/packer.worker.ts*';
  await page.route(route, async request => { await blocked; await request.continue().catch(() => {}); });
  await page.goto('./');
  for(const channel of ['Red Channel','Green Channel','Blue Channel','Alpha Channel']) {
    await page.getByLabel(`${channel} file`,{exact:true}).setInputFiles(fixture('rgba-2x2.png'));
  }
  await expect(page.getByText('Loading sources…',{exact:true})).toHaveCount(1);
  await page.getByRole('button',{name:'Clear sources',exact:true}).click();
  // The blocked preview workers still cannot finish. Clear must cancel the queue itself.
  await expect(page.getByRole('button',{name:'Process textures',exact:true})).toBeEnabled();
  await expect(page.getByText('0 sources loaded',{exact:true})).toHaveCount(1);
  await page.unroute(route);
  releaseWorkers();
  await page.getByRole('button',{name:'Process textures',exact:true}).click();
  await expect(page.getByAltText('Processed texture')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
test('preview and processing work when OffscreenCanvas is unavailable',async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(globalThis,'OffscreenCanvas',{value:undefined,configurable:true}));
  await page.goto('./');
  await page.getByLabel('Red Channel file',{exact:true}).setInputFiles(fixture('rgba-2x2.png'));
  await expect(page.getByRole('button',{name:'Process textures',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Process textures',exact:true}).click();
  await expect(page.getByAltText('Processed texture')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
