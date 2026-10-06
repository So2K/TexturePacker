import { expect, test, Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { AppMode, PackOptions } from '../types';
const fixtures = path.resolve(process.cwd(), '../tests/fixtures');
const rgba = [10,200,99,255,80,11,220,128,170,90,44,0,255,0,13,255];
async function pack(page: Page, mode: AppMode, inputs: { id: string; filename?: string; fallback?: 'white' | 'black' }[], options?: PackOptions) {
  const files = await Promise.all(inputs.map(async input => ({ ...input, bytes: input.filename ? Array.from(await readFile(path.join(fixtures,input.filename))) : null })));
  return page.evaluate(async ({ mode, files, options }) => {
    const moduleUrl = '/TexturePacker/utils/packer.ts';
    const { packTextures, decodeTexture } = await import(moduleUrl) as typeof import('../utils/packer');
    const channels = files.map(input => ({ id: input.id, file: input.bytes ? new File([new Uint8Array(input.bytes)], input.filename!) : null, previewUrl: null, fallback: input.fallback ?? 'black' as const, label: input.id, colorClass: '' }));
    const result = await packTextures(mode, channels, options);
    const bytes = await (await fetch(result.url)).arrayBuffer();
    if (new Uint8Array(bytes)[25] !== 6) throw new Error('Output must use PNG color type 6 (RGBA).');
    const image = await decodeTexture(new File([bytes], 'output.png'));
    URL.revokeObjectURL(result.url);
    return { width: image.width, height: image.height, data: Array.from(image.data.length > 64 ? image.data.slice(0,16) : image.data), pngDepth: new Uint8Array(bytes)[24] };
  }, { mode, files, options });
}
test.beforeEach(async ({ page }) => { await page.goto('./'); });
test('packs red source components with per-channel fallbacks and preserves zero-alpha data', async ({ page }) => {
  const output = await pack(page, AppMode.ChannelPacking, [{id:'R',filename:'rgba-2x2.png'},{id:'G',fallback:'white'},{id:'B',fallback:'black'},{id:'A',filename:'rgba-2x2.png'}]);
  expect(output).toEqual({width:2,height:2,pngDepth:8,data:[10,255,0,10,80,255,0,80,170,255,0,170,255,255,0,255]});
});
test('empty channels retain original 1024-pixel fallback texture', async ({ page }) => {
  const output = await pack(page,AppMode.ChannelPacking,[{id:'R',fallback:'white'},{id:'G',fallback:'white'},{id:'B',fallback:'black'},{id:'A',fallback:'white'}]);
  expect([output.width,output.height]).toEqual([1024,1024]);
  expect(output.data.slice(0,4)).toEqual([255,255,0,255]);
});
test('combines base RGB with mask red at base dimensions', async ({ page }) => {
  const output = await pack(page,AppMode.CombineAlpha,[{id:'base',filename:'rgba-2x2.png'},{id:'alpha',filename:'mask-1x2.png'}]);
  expect([output.width,output.height,output.pngDepth]).toEqual([2,2,8]);
  expect(output.data).toEqual([10,200,99,40,80,11,220,40,170,90,44,210,255,0,13,210]);
});
test('alpha-only mode uses mask dimensions and black RGB fallback', async ({ page }) => {
  const output = await pack(page,AppMode.CombineAlpha,[{id:'base',fallback:'black'},{id:'alpha',filename:'mask-1x2.png'}]);
  expect(output.data).toEqual([0,0,0,40,0,0,0,210]);
  expect([output.width,output.height]).toEqual([1,2]);
});
for (const [name,expected] of [
  ['gray16-8x1.tiff',[0,0,0,255,1,1,1,255,1,1,1,255,1,1,1,255,127,127,127,255,128,128,128,255,255,255,255,255,255,255,255,255]],
  ['rgba16-2x1.tiff',[2,255,18,255,128,127,254,1]],
  ['white16.tif',[255,255,255,255,0,0,0,255]],
  ['black4.tif',[0,0,0,255,255,255,255,255]],
  ['gray-alpha8.tif',[40,40,40,80,210,210,210,0]],
  ['gray-alpha16.tif',[2,2,2,128,254,254,254,1]],
  ['signed16.tif',[128,128,128,255,0,0,0,255]],
  ['float32.tif',[64,64,64,255,191,191,191,255]],
] as const) test(`TIFF16 uses ImageMagick normalized 8-bit conversion: ${name}`,async({page})=>{
  const output=await pack(page,AppMode.Convert16to8,[{id:'tif',filename:name}]);
  expect(output.data).toEqual(expected);
  expect(output.pngDepth).toBe(8);
});
test('atlas keeps empty cells and composites transparency over opaque black',async({page})=>{
  const output=await pack(page,AppMode.Atlas,[{id:'atlas_0'},{id:'atlas_1',filename:'half-alpha-1x1.png'},{id:'atlas_2'},{id:'atlas_3',filename:'opaque-3x1.png'}],{atlasCols:2,atlasRows:2});
  expect(output).toEqual({width:2,height:2,pngDepth:8,data:[0,0,0,255,100,50,25,255,0,0,0,255,20,45,100,255]});
});
test('channel packing uses independently smallest width and height',async({page})=>{
  const output=await pack(page,AppMode.ChannelPacking,[{id:'R',filename:'opaque-3x1.png'},{id:'G',filename:'mask-1x2.png'},{id:'B',fallback:'white'},{id:'A',fallback:'white'}]);
  expect([output.width,output.height]).toEqual([1,1]);
  expect(output.data[0]).toBe(20);
  expect(output.data.slice(2)).toEqual([255,255]);
});
test('inversion preserves unselected channels including hidden RGB',async({page})=>{
  const output=await pack(page,AppMode.InvertMap,[{id:'invert_src',filename:'rgba-2x2.png'}],{invertChannels:{r:false,g:true,b:false,a:false}});
  expect(output.data).toEqual(rgba.map((value,index)=>index%4===1?255-value:value));
});
test('transparent resizing matches the native alpha-weighted smoothing fixture',async({page})=>{
  const output=await pack(page,AppMode.ChannelPacking,[{id:'R',filename:'rgba-2x2.png'},{id:'G',filename:'mask-1x2.png'},{id:'B',filename:'rgba-2x2.png'},{id:'A',filename:'rgba-2x2.png'}]);
  expect([output.width,output.height]).toEqual([1,2]);
  const native=[33,40,33,33,255,210,255,255];
  output.data.forEach((value,index)=>expect(Math.abs(value-native[index])).toBeLessThanOrEqual(1));
});
test('alpha inversion keeps RGB after alpha becomes zero',async({page})=>{
  const output=await pack(page,AppMode.InvertMap,[{id:'invert_src',filename:'rgba-2x2.png'}],{invertChannels:{r:false,g:false,b:false,a:true}});
  expect(output.data).toEqual(rgba.map((value,index)=>index%4===3?255-value:value));
});
for(const extension of ['png','bmp','tga','webp','jpg']) test(`decodes shared ${extension} fixture`,async({page})=>{
  const output=await pack(page,AppMode.InvertMap,[{id:'invert_src',filename:`opaque-3x1.${extension}`}],{invertChannels:{r:false,g:false,b:false,a:false}});
  expect([output.width,output.height]).toEqual([3,1]);
  if(extension==='jpg'||extension==='webp') output.data.slice(0,3).forEach((value,index)=>expect(Math.abs(value-[20,45,100][index])).toBeLessThanOrEqual(3));
  else expect(output.data.slice(0,4)).toEqual([20,45,100,255]);
});
test('invalid files, oversized images and grid bounds produce actionable errors',async({page})=>{
  const messages=await page.evaluate(async()=>{
    const moduleUrl='/TexturePacker/utils/packer.ts';
    const {decodeTexture,packTextures,validateDimensions}=await import(moduleUrl) as typeof import('../utils/packer');
    const failures=[];
    for(const operation of [
      ()=>decodeTexture(new File(['bad'],'broken.tif')),
      ()=>decodeTexture(new File(['bad'],'broken.png')),
      ()=>validateDimensions(20000,1),
      ()=>packTextures('ATLAS' as AppMode,[],{atlasCols:21,atlasRows:1}),
      ()=>packTextures('INVERT_MAP' as AppMode,[]),
    ]) {try{await operation();failures.push('NO ERROR');}catch(error){failures.push((error as Error).message);}}
    return failures;
  });
  expect(messages).toHaveLength(5);
  expect(messages.every(message=>message!=='NO ERROR')).toBe(true);
  expect(messages[2]).toContain('too large');
  expect(messages[3]).toContain('1 to 20');
});
test('JPEG EXIF orientation matches standalone dimensions',async({page})=>{
  const output=await pack(page,AppMode.InvertMap,[{id:'invert_src',filename:'orientation6.jpg'}],{invertChannels:{r:false,g:false,b:false,a:false}});
  expect([output.width,output.height]).toEqual([2,3]);
});
test('16-bit PNG conversion matches standalone normalized rounding',async({page})=>{
  const output=await pack(page,AppMode.InvertMap,[{id:'invert_src',filename:'rgba16-2x1.png'}],{invertChannels:{r:false,g:false,b:false,a:false}});
  expect(output.data).toEqual([2,255,18,255,128,127,254,1]);
});
