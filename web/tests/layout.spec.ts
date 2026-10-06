import { expect, test } from '@playwright/test';
import path from 'node:path';

test('restyled UI preserves the measured original layout in all five modes',async({page})=>{
  await page.setViewportSize({width:1360,height:840});
  await page.goto('./');
  const box=async(selector:string)=>{const result=await page.locator(selector).first().boundingBox();if(!result)throw new Error(`Missing ${selector}`);return result;};
  const matches=async(selector:string,expected:number[])=>{
    const actual=await box(selector);
    [actual.x,actual.y,actual.width,actual.height].forEach((value,index)=>expect(Math.abs(value-expected[index]),`${selector} coordinate ${index}`).toBeLessThan(.1));
  };
  await matches('.app-header',[0,0,1360,56]);
  await matches('.source-panel',[0,56,380,784]);
  await matches('.mode-tabs',[24,80,331,52]);
  await matches('.source-card',[24,156,331,234.5]);
  await matches('.file-picker',[37,197,305,152.5]);
  await matches('.preview-toolbar',[380,56,980,48]);
  await matches('.checker-preview',[709,311,322,322]);
  for(const item of [
    {name:'Channels',id:'channels',processY:1174},
    {name:'+ Alpha',id:'alpha',processY:673},
    {name:'TIF 16→8',id:'tiff',processY:422.5},
    {name:'Atlas',id:'atlas',processY:469},
    {name:'Gloss ⇄ Rough',id:'invert',processY:774.5},
  ]) {
    await page.getByRole('navigation',{name:'Texture tools'}).getByRole('button',{name:item.name,exact:true}).click();
    await matches('.primary-button',[24,item.processY,331,48]);
    if(item.id==='atlas') {
      await matches('.atlas-grid',[576,178,588,588]);
      await expect(page.locator('.checker-preview')).toHaveCSS('background-image','none');
    }
    if(item.id==='invert') await matches('.source-card',[24,508,331,234.5]);
    await page.screenshot({path:`test-results/restyled-1360x840-${item.id}-empty.png`,animations:'disabled'});
  }
});

test('loaded source cards retain the original thumbnail size and action placement',async({page})=>{
  await page.setViewportSize({width:1360,height:840});
  await page.goto('./');
  for(const item of [
    {name:'Channels',id:'channels',sourceY:156,processY:1062},
    {name:'+ Alpha',id:'alpha',sourceY:156,processY:617},
    {name:'TIF 16→8',id:'tiff',sourceY:156,processY:394.5},
    {name:'Gloss ⇄ Rough',id:'invert',sourceY:508,processY:746.5},
  ]) {
    await page.getByRole('navigation',{name:'Texture tools'}).getByRole('button',{name:item.name,exact:true}).click();
    const inputs=page.locator('.source-card input[type=file]');
    const count=await inputs.count();
    for(let i=0;i<count;i++) await inputs.nth(i).setInputFiles(path.resolve(process.cwd(),'../tests/fixtures',item.id==='tiff'?'gray16-8x1.tiff':'rgba-2x2.png'));
    await expect(page.locator('.source-card .file-picker img')).toHaveCount(count);
    const card=await page.locator('.source-card').first().boundingBox();
    const well=await page.locator('.file-picker').first().boundingBox();
    const action=await page.locator('.primary-button').boundingBox();
    expect(card).toEqual({x:24,y:item.sourceY,width:331,height:206.5});
    expect(well?.width).toBe(305);
    expect(well?.height).toBe(152.5);
    expect(action).toEqual({x:24,y:item.processY,width:331,height:48});
    await page.screenshot({path:`test-results/restyled-1360x840-${item.id}-loaded.png`,animations:'disabled'});
  }
});
