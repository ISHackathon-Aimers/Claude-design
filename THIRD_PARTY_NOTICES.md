# Third-party artwork

Default profile characters use the Gaze avatar style by DiceBear.

- Style: https://www.dicebear.com/styles/gaze/
- Artwork license: CC0 1.0, https://creativecommons.org/publicdomain/zero/1.0/
- Definition package: @dicebear/styles 10.6.0
- Generator: @dicebear/core 10.7.0, MIT license
- The original package licenses are included in node_modules when dependencies are installed.

The build generates 128 static SVGs using fixed seeds and a scale of 0.88. The app adds its own pale background palette and selects a character and background deterministically from the account ID. Character assets are served from the app itself. Uploaded user photos take precedence over these defaults.
