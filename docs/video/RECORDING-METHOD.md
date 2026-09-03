# Recording method investigation and Chisel demo capture

Date: 2026-09-03 (Australia/Adelaide)

## Result

The previous project did **not** use Playwright video recording. Its repeatable,
TCC-free production path was browser-driven capture: launch headless Google
Chrome, connect with Chrome DevTools Protocol (CDP), capture browser-rendered
frames, and assemble them with FFmpeg. I used the same browser-rendered/CDP
approach for Chisel. It does not call macOS `screencapture` and does not require
Screen Recording permission.

The live Chisel footage is:

- `screen.mp4` — silent, browser-rendered 1920×1080 visual pass;
- `chisel-demo.mp4` — the same visual pass muxed with `narration.wav`;
- `downloads/mounting-bracket.step` — the real STEP file downloaded during the
  recorded gated export.

Nothing was uploaded.

## What the previous project actually did

Project searched:

`/Users/helen/Documents/202607-openai-build`

The requested locations (`docs/`, `scripts/`, `.planning/`, `local-planning/`,
`README.md`, `package.json`) plus the rest of the project (excluding dependency
trees) were searched for `screencapture`, FFmpeg/avfoundation, Playwright video,
Puppeteer video, QuickTime automation, asciinema, VHS, ttyd, screencast APIs,
movie extensions, and Screen Recording/TCC notes.

### Deterministic browser capture

The main evidence is:

`/Users/helen/Documents/202607-openai-build/local-planning/veritylane/submission-pack/video/capture-report.mjs`

That script:

1. launched `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` with
   these literal arguments:

   ```text
   --headless=new
   --remote-debugging-port=${PORT}
   --user-data-dir=${PROFILE}
   --no-first-run
   --disable-default-apps
   --disable-extensions
   --allow-file-access-from-files
   --hide-scrollbars
   --force-device-scale-factor=1
   --window-size=1920,1080
   about:blank
   ```

2. used Node's built-in `WebSocket` to connect to Chrome's remote-debugging
   endpoint;
3. called CDP `Page.captureScreenshot` with this request shape:

   ```js
   cdp.send("Page.captureScreenshot", {
     format: "png",
     fromSurface: true,
     captureBeyondViewport: true,
     clip: { x: 0, y: Math.max(0, pageY), width: 1920, height: 1080, scale: 1 },
   });
   ```

4. wrote real, sanitized browser captures to `video/captures/*.png`;
5. removed its temporary Chrome profile after capture.

The documented command line in
`local-planning/veritylane/submission-pack/VIDEO-PRODUCTION.md` and
`local-planning/veritylane/submission-pack/video/README.md` is:

```sh
cd /Users/helen/Documents/202607-openai-build
npm run demo:raw

cd /Users/helen/Documents/202607-openai-build/local-planning/veritylane/submission-pack/video
node capture-report.mjs
./generate-voiceover.sh
./build-storyboard.sh
cd hyperframes
npm run build
```

`build-storyboard.sh` converted each captured PNG into a timed H.264 segment
with this command inside its loop:

```sh
ffmpeg -hide_banner -loglevel error -y \
  -loop 1 -framerate "$FPS" -t "$duration" -i "$source" \
  -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xf3f0e8,setsar=1,format=yuv420p" \
  -an -c:v libx264 -preset medium -crf 16 -r "$FPS" \
  "$segment"
```

It concatenated the segments and added narration with:

```sh
ffmpeg -hide_banner -loglevel error -y \
  -f concat -safe 0 -i "$concat_file" -c copy \
  "$RENDERS/veritylane-storyboard.mp4"

ffmpeg -hide_banner -loglevel error -y \
  -i "$RENDERS/veritylane-storyboard.mp4" -i "$VOICEOVER" \
  -filter_complex "[1:a]aresample=48000,apad=whole_dur=$TOTAL_SECONDS,atrim=duration=$TOTAL_SECONDS[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -ar 48000 \
  -t "$TOTAL_SECONDS" \
  "$RENDERS/veritylane-demo.mp4"
```

The optional finishing layer's exact browser-render command is in
`local-planning/veritylane/submission-pack/video/hyperframes/package.json`:

```sh
hyperframes render . -o renders/veritylane-visuals.mp4 --fps 30 --workers 1 --experimental-fast-capture=false --video-frame-format png --quality high
```

### The one live `.mov` clip

The previous project also contains:

`local-planning/veritylane/submission-pack/video/captures/03-codex-processing-clean.mov`

FFprobe reports a QuickTime container with the metadata tag:

```text
com.apple.quicktime.author=ReplayKitRecording
```

That 60-second, 3456×2234 H.264 clip was therefore captured through Apple's
ReplayKit recording path. The project contains **no command or automation that
created it**, so it would be inaccurate to claim it came from `screencapture`
or QuickTime Player specifically. `prepare-codex-clip.sh` only post-processed
that already-existing `.mov`:

```sh
ffmpeg -hide_banner -loglevel error -y \
  -i "$RAW" -ss 59 -frames:v 1 "$FINAL_FRAME"

ffmpeg -hide_banner -loglevel error -y \
  -i "$RAW" -loop 1 -framerate 30 -t 4 -i "$FINAL_FRAME" \
  -filter_complex \
  "[0:v]trim=start=7.5:end=59,setpts=(PTS-STARTPTS)/1.4305555556,crop=2880:1620:0:0,scale=1920:1080,setsar=1,fps=30,format=yuv420p[run];[1:v]crop=2880:1620:0:614,scale=1920:1080,setsar=1,fps=30,trim=duration=4,setpts=PTS-STARTPTS,format=yuv420p[hold];[run][hold]concat=n=2:v=1:a=0[out]" \
  -map "[out]" -t 40 -an -c:v libx264 -preset medium -crf 18 -r 30 \
  "$OUTPUT"
```

### Negative findings and git history

No previous-project file contained:

- a `screencapture` recording command;
- FFmpeg `avfoundation` input;
- Playwright `video:` or `recordVideo` configuration;
- Puppeteer/Chrome `Page.startScreencast` recording;
- QuickTime automation;
- asciinema, VHS, or ttyd capture;
- a note about granting macOS Screen Recording permission.

The video workspace is untracked. In fact, almost the whole checked-out project
is currently untracked; `git ls-files` found only two tracked files among the
requested search locations. `git log --all -G` for the recording terms returned
no commits. Consequently, git history supplies no missing recording command.

## Playwright availability check

The requested project-local check was run verbatim:

```sh
ls /Users/helen/Documents/202607-openai-build/node_modules/.bin/playwright
```

Result:

```text
ls: /Users/helen/Documents/202607-openai-build/node_modules/.bin/playwright: No such file or directory
```

The requested command was also run verbatim:

```sh
npx playwright --version
```

It produced no output while trying to resolve the package and was interrupted
after waiting. The explicit offline check made the cause visible:

```sh
npx --offline playwright --version
```

```text
npm error code ENOTCACHED
npm error request to https://registry.npmjs.org/playwright failed: cache mode is 'only-if-cached' but no cached response is available.
```

There are nevertheless cached `npx` Playwright packages on this Mac. The stable
cached binary used for automation reports:

```sh
/Users/helen/.npm/_npx/705bc6b22212b352/node_modules/.bin/playwright --version
```

```text
Version 1.61.0
```

It was proven usable by running the real Chisel tool flow in installed Chrome.
No Playwright package was installed into either project.

## Current Chisel recording method

Installed Chrome is `Google Chrome 152.0.7977.65`. Its existing Local State has
`enable-webmcp-testing@1`. The recorder created an isolated profile inside this
`docs/video` workspace with the same flag, then verified on the deployed page:

```text
typeof document.modelContext === "object"
typeof document.modelContext.executeTool === "function"
Chisel · WebMCP ready — 15 tools registered (capture build)
```

The actual WebMCP invocation used the registered tool handle and a JSON string:

```js
const tools = await document.modelContext.getTools();
const tool = tools.find((item) => item.name === toolName);
await document.modelContext.executeTool(tool, JSON.stringify(args));
```

`record-demo.mjs` used Playwright only for page coordination. Frames came from
CDP `Page.startScreencast`, were acknowledged with
`Page.screencastFrameAck`, sampled at 15 fps, and piped into FFmpeg for a
1920×1080, 30 fps H.264 file. The command that produced the visual pass was:

```sh
cd /Users/helen/workspace/chisel-webmcp
node docs/video/record-demo.mjs
```

The recording exercised the deployed application, not a local mock:

- `chisel_create_box` plus two `chisel_create_cylinder` calls;
- `chisel_boolean_cut`, which returned `affectedCount: 4`;
- `chisel_get_object`, which returned `boundingBox.size: [80, 40, 5]`;
- `chisel_export`, which downloaded a 22,777-byte STEP file reporting valid
  ISO-10303, six analytic planes, and two analytic cylindrical surfaces;
- the in-page `[data-chisel-confirm]` approval dialog for every write;
- the real `[data-chisel-activity]` log and `[data-chisel-badge]` badge.

The dark "WebMCP agent" card in the video is a display-only transcript overlay
added by the recorder so viewers can read the exact prompt and returned values.
It does not replace or fake the tool execution: the calls go through the
browser's registered `document.modelContext` tools and the deployed page's own
gate.

### Persistence caveat

The shot list says a plain reload should reopen the bracket automatically. That
did not reproduce. Two clean test runs—one immediately and one after an
eight-second wait—both returned `objectCount: 0` after `page.reload()`.

The document *can* be saved to Chili3d's IndexedDB and reopened by its id. The
recording therefore labels the actual sequence: save the active document,
reload, observe that the app opened a fresh document, explicitly reopen the
saved IndexedDB document, and verify `objectCount: 1`. This avoids presenting
automatic reopen as proven behavior.

### Narration and version note

The capture was recorded against the 15-tool build that first included gated
`chisel_export`. The final live build later added `chisel_fillet` and
`chisel_chamfer`, bringing the CAD app to 17 tools and the shell to 19. The
recorded badge remains visible as an honest record of the capture build.

The last 40 seconds were remuxed after review. The persistence narration now
states the demonstrated save, reload, and explicit reopen sequence, and the
closing is tool-count-neutral so it does not contradict either the capture
badge or the final live catalogue.

## Mux command

The requested mux command was run:

```sh
ffmpeg -y -i docs/video/screen.mp4 -i docs/video/narration.wav \
  -map 0:v:0 -map 1:a:0 \
  -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2" \
  -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p \
  -c:a aac -b:a 192k -ar 48000 -movflags +faststart -shortest \
  docs/video/chisel-demo.mp4
```

## Verification

`ls -la` and FFprobe were run after capture and after muxing.

| File | Size | Verified media properties |
|---|---:|---|
| `screen.mp4` | 3,487,369 bytes | 150.000 s; H.264 High; 1920×1080; 30 fps; silent |
| `narration.wav` | 28,800,078 bytes | 150.000 s; PCM 16-bit; stereo; 48 kHz |
| `chisel-demo.mp4` | 6,483,037 bytes | 150.000 s; H.264 High; 1920×1080; 30 fps; AAC-LC stereo; 48 kHz |
| `downloads/mounting-bracket.step` | 22,777 bytes | Begins `ISO-10303-21;` and ends `END-ISO-10303-21;` |

Both MP4s completed a full FFmpeg decode with no reported media errors. The
final audio measured −16.8 LUFS integrated, 4.0 LU loudness range, and −5.1
dBFS true peak. Representative frames are retained under `qa-live/`; the visual
verdict is `qa-live/verdict.json` with score 93/pass.

No upload or other external publication was performed.
