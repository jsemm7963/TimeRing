# TimeRing · 时间环记

以入睡为一天的起点，用环形时间盘记录真实发生的时间。

## 使用

- 在线版：[时间环记](https://time-ring-journal.jsemm7963.chatgpt.site)
- Android 离线版：[下载最新 APK](https://github.com/jsemm7963/TimeRing/releases/latest)

Android 版不需要联网，记录只保存在手机本地。以后从本项目下载新版 APK 覆盖安装，可以保留原有数据；也可以随时在应用内导出 JSON 备份。

## 当前功能

- 以入睡时间开启一个记录日
- 环形时间记录与跨日显示
- 事件起止时间、文字和自选颜色
- 原色与柔和浅色两套配色
- 标准日程、每日复盘
- JSON 数据导入与导出
- Android 本地离线运行

## 本地运行

需要 Node.js 22.13 及以上版本和 pnpm 11.25.0。

```bash
pnpm install
pnpm dev
```

## 构建 Android 版

需要 JDK 21、Android SDK 36 和 Python 3。字体在构建时从作者的固定版本下载并校验，随后内置到安装包；手机使用时不联网。

```bash
python3 -m pip install 'fonttools[woff]==4.61.1'
pnpm build:mobile
cd android
./gradlew assembleRelease
```

APK 输出到 `android/app/build/outputs/apk/release/`。推送到 `main` 后，GitHub Actions 会自动构建并发布新的 Android 版本。

## 许可

程序源码采用 [MIT License](LICENSE)。寒蝉全圆体采用 SIL Open Font License 1.1，许可文件见 `public/fonts/chill-round/LICENSE.txt`。
