import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { decode } from 'fast-png';

test('production build processes all five modes and serves TIFF WASM from the Pages subpath',async({page})=>{
  const errors:string[]=[];
  const remote:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{ if(request.url().startsWith('http') && new URL(request.url()).hostname!=='127.0.0.1') remote.push(request.url()); });
  await page.goto('./');
  const cases = [
    { mode:'Channels', input:'Red Channel file', file:'rgba-2x2.png', size:[2,2] },
    { mode:'+ Alpha', input:'Base Texture (RGB) file', file:'rgba-2x2.png', size:[2,2] },
    { mode:'TIF 16→8', input:'Source 16-bit TIF file', file:'gray-alpha16.tif', size:[2,1] },
    { mode:'Atlas', input:'Slot 1 file', file:'opaque-3x1.png', size:[6,2] },
    { mode:'Gloss ⇄ Rough', input:'Source Texture Map (Gloss / Rough / Normal) file', file:'rgba-2x2.png', size:[2,2] },
  ];
  for(const item of cases) {
    await page.getByRole('button',{name:item.mode,exact:true}).click();
    if(item.mode==='Atlas') await page.getByRole('button',{name:'2x2',exact:true}).click();
    await page.getByLabel(item.input,{exact:true}).setInputFiles(path.resolve(process.cwd(),'../tests/fixtures',item.file));
    await expect(page.getByRole('button',{name:'Process textures',exact:true})).toBeEnabled({timeout:20000});
    await page.getByRole('button',{name:'Process textures',exact:true}).click();
    await expect(page.getByAltText('Processed texture')).toBeVisible({timeout:20000});
    const exported=page.waitForEvent('download');
    await page.getByRole('button',{name:'Download Output'}).click();
    const output=decode(await readFile((await (await exported).path())!));
    expect([output.width,output.height]).toEqual(item.size);
    expect(output.depth).toBe(8);
    expect(output.channels).toBe(4);
    if(item.mode==='TIF 16→8') expect(Array.from(output.data)).toEqual([2,2,2,128,254,254,254,1]);
  }
  expect(errors).toEqual([]);
  expect(remote).toEqual([]);
});
