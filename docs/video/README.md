# Chisel demo video handoff

## Produced

- `chisel-demo.mp4` — a clearly labelled fallback still-image cut using the two supplied Chisel screenshots, timed chapter cards, and full AI narration.
- `narration.wav` — the complete narration master, generated locally with macOS `say` using the Australian English voice `Karen` and padded to the shot-list boundaries.
- `narration-sections/*.aiff` — one generated voiceover file per scripted section.
- `narration-sections/*.txt` — clean speech input for each section.
- `overlays/*` — editable SVG chapter frames and their rendered PNGs.
- `qa/*.jpg` — sampled frames used to visually verify the fallback encode.
- `../NARRATION.txt` — the complete spoken script with per-section timings.

Both `chisel-demo.mp4` and `narration.wav` run **2:30 (150.000 seconds)**, under the requested 2:50 narration ceiling and the public-video rule's 3:00 limit. The MP4 is 1920×1080 at 30 fps with H.264 video and stereo 48 kHz AAC audio.

## Could not produce

A live screen recording could not be captured in this process. The required probe

```sh
screencapture -v -V 3 /tmp/tccprobe.mov
```

failed with `dispatch_source_create returned NULL, invalid parameters passed to dispatch_source_create` and created no file. This indicates that the current parent process does not have usable macOS Screen Recording access. In accordance with the shot-list instructions, no further screen-video capture was attempted.

The fallback cut therefore does **not** visibly prove the live agent interaction. In particular, the supplied stills do not show the confirmation dialog, `affectedCount: 4`, the returned `[80, 40, 5]` bounding box, the reload action, the STEP download landing, or the repository honesty table. The fallback uses chapter labels for these beats and must not be mistaken for the preferred live demo.

## Precise remaining manual steps

1. In **System Settings → Privacy & Security → Screen & System Audio Recording**, enable capture for the app that launches the recording process (for example Terminal or Codex), then fully quit and relaunch that app.
2. Run the three-second `screencapture` probe above again and confirm `/tmp/tccprobe.mov` is non-empty and playable.
3. In Chrome 152, enable `chrome://flags/#enable-webmcp-testing`, open `https://chisel-webmcp.helenkwok.workers.dev`, warm the OCCT WASM cache, hard-reload, and clear the document.
4. Record a silent 150-second 1080p visual pass following `docs/DEMO_SCRIPT.md` exactly. Keep the completed bracket on screen within the first 10 seconds, and visibly capture the confirmation dialog, `affectedCount: 4`, `[80, 40, 5]`, browser reload, STEP download, and repository table.
5. Save that visual recording as `docs/video/screen.mov`, then replace the fallback visuals while retaining the verified narration:

   ```sh
   ffmpeg -y -i docs/video/screen.mov -i docs/video/narration.wav \
     -map 0:v:0 -map 1:a:0 \
     -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2" \
     -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p \
     -c:a aac -b:a 192k -ar 48000 -movflags +faststart -shortest \
     docs/video/chisel-demo-final.mp4
   ```

6. Watch the entire final MP4 with sound. Confirm speech starts immediately, all visual actions align with the narration, every checklist item in `docs/DEMO_SCRIPT.md` is legible, and runtime remains under 3:00. Verify with:

   ```sh
   ffprobe -v error -show_entries format=duration \
     -show_entries stream=codec_type,codec_name,width,height,sample_rate,channels \
     -of default=noprint_wrappers=1 docs/video/chisel-demo-final.mp4
   ```

7. Upload the verified final MP4 to YouTube, set visibility to **Public** (not unlisted), wait for processing, replay the public page with sound, and paste the public URL into the hackathon submission before the deadline.

No file was uploaded to YouTube or any other external service during this production pass.
