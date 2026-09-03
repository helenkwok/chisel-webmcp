# Thread: recording a browser demo without Screen Recording permission

**Status: solved, verified, and generalised.** The reusable write-up now lives at
`~/.claude/rules/screen-recording.md`, which is auto-loaded into every Claude session on this
machine, so no future session has to rediscover it. This thread keeps the reasoning.

## The problem

The WebMCP Challenge requires a public YouTube demo under three minutes **with audio**. A silent
screencast with background music explicitly fails. So the video was the one deliverable that could
not be skipped, and the only one no amount of code quality could substitute for.

## The dead end, and why it looked fatal

Every obvious capture route on macOS needs **Screen Recording (TCC) permission granted to the
parent process**. An agent CLI does not have it. The failure is quiet and misleading:

```
$ screencapture -v -V 3 /tmp/probe.mov
dispatch_source_create returned NULL, invalid parameters passed to dispatch_source_create
```

No file, no obvious fatal error. The first agent to hit this reported — correctly and honestly —
that it could not record, and produced a still-image fallback cut instead. That was the right call
given what it knew, and it stated the limitation plainly rather than shipping something misleading.

But "we cannot record" was **not** actually true. It was true of one family of methods.

## What broke it open

The user pointed at a previous hackathon project on the same machine that *had* produced a demo
video, and asked how. That reframed the question from "can this machine record?" to "what did the
thing that worked actually do?" — a much better question.

The answer: it never captured the screen at all. It launched **headless Chrome**, drove it over
the **Chrome DevTools Protocol**, and pulled frames with `Page.captureScreenshot`. Chrome renders
the frames itself, so nothing is capturing a display and TCC never enters the picture. `ffmpeg`
assembled the frames and laid `say`-generated narration over them.

## The lesson worth keeping

A permission wall in front of one approach is not a wall in front of the goal. The probe that
"proved" recording was impossible only proved that *`screencapture`* was unavailable — and the
successful method was already sitting on the same disk, in a project from two months earlier.

Two cheap habits would have found it sooner:
- When a capability appears blocked, ask what has *already worked here before*, not just whether
  the blocked path can be unblocked.
- Distinguish "this specific mechanism is denied" from "this outcome is unreachable". They look
  identical in an error message and are not remotely the same claim.

## Verification standard applied

A produced file is not a produced video. All four were checked:

- `ffprobe` — 150.000s, 1920x1080, h264 + aac, 30fps
- audio non-silence — `volumedetect` gave mean −20.4 dB / max −5.2 dB (silence reads about −91 dB)
- **frames extracted and looked at** — a 150s recording of a blank page passes every automated
  check above
- the artefacts the demo claims to produce — the recorded gated export really wrote
  `downloads/mounting-bracket.step`, 22,777 bytes of valid ISO-10303

## Debris to watch for

The capture profile must live in `mktemp -d`. A throwaway Chrome profile (~29MB of cookies,
history and `Login Data` databases) was created inside the repo and committed to a **public**
repository before anyone noticed. Removed from HEAD; gitignore the pattern regardless of intent.
