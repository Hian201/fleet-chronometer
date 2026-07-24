# Fleet Chronometer app icon

`chronometer.svg` 是 48／96／128px 使用的原創航海天文鐘來源；
`chronometer-small.svg` 是 16／32px 的簡化版本。兩者皆以黃銅萬向環、暖色鐘面與
精密指針表達歷史海軍航海天文鐘，不含第三方素材或品牌鐘面。

在 macOS 上以 Chrome 無頭模式渲染 SVG，再用系統影像工具輸出 PNG：

```bash
mkdir -p /private/tmp/fleet-chronometer-icon
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu --hide-scrollbars --default-background-color=00000000 \
  --screenshot=/private/tmp/fleet-chronometer-icon/full.png --window-size=128,128 "file://$PWD/chronometer.svg"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu --hide-scrollbars --default-background-color=00000000 \
  --screenshot=/private/tmp/fleet-chronometer-icon/small.png --window-size=128,128 "file://$PWD/chronometer-small.svg"
sips -z 16 16 /private/tmp/fleet-chronometer-icon/small.png --out ../../public/icon/16.png
sips -z 32 32 /private/tmp/fleet-chronometer-icon/small.png --out ../../public/icon/32.png
sips -z 48 48 /private/tmp/fleet-chronometer-icon/full.png --out ../../public/icon/48.png
sips -z 96 96 /private/tmp/fleet-chronometer-icon/full.png --out ../../public/icon/96.png
sips -z 128 128 /private/tmp/fleet-chronometer-icon/full.png --out ../../public/icon/128.png
```
