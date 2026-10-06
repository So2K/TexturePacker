# Third-party software

Texture Packer's own desktop and web source is distributed under the MIT license in `LICENSE`.

The Windows app uses Microsoft's .NET/WPF Fluent theme and Magick.NET Q16. Their original notices are included in the portable ZIP under `licenses/`:

- Magick.NET 14.17.2: Apache-2.0; copyright Dirk Lemstra. `licenses/Apache-2.0.txt` and `licenses/Magick.NET-Notice.txt` include the library, ImageMagick and codec notices.
- Microsoft .NET runtime: MIT and component-specific notices; `licenses/DotNet-MIT.txt` and `licenses/DotNet-ThirdPartyNotices.txt`.
- Microsoft WPF/Fluent: MIT and component-specific notices; `licenses/WPF-MIT.txt` and `licenses/WPF-ThirdPartyNotices.txt`.

The web app uses React, React DOM, ImageMagick WebAssembly, PNG codecs and the Luna Paint TGA codec. The production site's `THIRD-PARTY-NOTICES.txt` contains their copyright and license texts. ImageMagick WebAssembly is Apache-2.0 licensed. Development tooling and transitive dependencies retain their upstream licenses.

Upstream sources:
- https://github.com/dlemstra/Magick.NET
- https://github.com/dlemstra/magick-wasm
- https://github.com/dotnet/wpf
- https://github.com/dotnet/runtime
- https://github.com/facebook/react
- https://github.com/photopea/UTIF.js
- https://github.com/photopea/UPNG.js
- https://github.com/nodeca/pako
- https://github.com/lunapaint/tga-codec
