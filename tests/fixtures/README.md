Tiny shared pixel fixtures. Coordinates are row-major, RGBA channels are decimal 8-bit values.

- rgba-2x2.png: (10,200,99,255), (80,11,220,128), (170,90,44,0), (255,0,13,255). The third pixel has intentionally nonzero RGB at zero alpha.
- mask-1x2.png: (40,200,250,255), (210,10,11,255). Scalar masks must use red, not luminance or alpha.
- half-alpha-1x1.png: (200,100,50,128). Over opaque black it becomes (100,50,25,255).
- opaque-3x1.png/.jpg/.bmp/.tga/.webp: three identical (20,45,100,255) pixels; JPEG is subject to codec rounding.
- gray16-8x1.tiff: grayscale unsigned 16-bit samples 0,255,256,257,32767,32768,65534,65535. Standard ImageMagick scaling rounds sample/257 and produces 0,1,1,1,127,128,255,255.
- rgba16-2x1.tiff: RGBA unsigned 16-bit samples (0x01FF,0xFFFF,0x1234,0xFFFF), (0x80FF,0x7FFF,0xFF00,0x00FF). Conversion yields (2,255,18,255), (128,127,254,1).
- rgba16-2x1.png: the same RGBA16 values and expected 8-bit scaling as the TIFF fixture; source PNG IHDR bit depth is 16.
- white16.tif: WhiteIsZero 16-bit unsigned samples 0,65535 -> (255,255,255,255), (0,0,0,255).
- black4.tif: BlackIsZero 4-bit samples 0,15 -> (0,0,0,255), (255,255,255,255).
- gray-alpha8.tif: grayscale 8-bit samples (40,80),(210,0) -> (40,40,40,80),(210,210,210,0).
- gray-alpha16.tif: grayscale 16-bit samples (0x01FF,0x80FF),(0xFF00,0x00FF) -> (2,2,2,128),(254,254,254,1).
- signed16.tif: signed 16-bit samples -32768,0 -> (128,128,128,255),(0,0,0,255), matching both ImageMagick builds without auto-levels.
- float32.tif: IEEE floating-point samples 0.25,0.75 -> (64,64,64,255),(191,191,191,255).
- orientation6.jpg: raw 3x2 red JPEG with EXIF Orientation=6; displayed and processed dimensions are 2x3.

Regenerate the original PNG/RGBA TIFF fixtures intentionally with `dotnet run --project tests/TexturePacker.Core.Tests -c Release -- --generate-fixtures tests/fixtures`; the additional photometric and EXIF fixtures remain committed.
Run pixel and error-path regressions with `dotnet run --project tests/TexturePacker.Core.Tests -c Release`.
