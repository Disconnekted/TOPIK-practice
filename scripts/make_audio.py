"""Creates the missing audio clips listed in scripts/audio_jobs.json using
edge-tts (Microsoft Edge's online neural voices, which include Korean).
Runs automatically in GitHub Actions; see README.md to run it yourself.
Any clip that fails is skipped, and the app reads that line with the
phone's own Korean voice instead."""
import asyncio, json, os, sys

import edge_tts

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIO = os.path.join(ROOT, "audio")
jobs = json.load(open(os.path.join(ROOT, "scripts", "audio_jobs.json"), encoding="utf-8"))
os.makedirs(AUDIO, exist_ok=True)


async def make(job):
    out = os.path.join(AUDIO, job["key"] + ".mp3")
    tmp = out + ".part"
    for attempt in range(3):
        try:
            await edge_tts.Communicate(job["text"], job["voice"], rate="-5%").save(tmp)
            if os.path.getsize(tmp) < 1000:
                raise RuntimeError("audio file is too small")
            os.replace(tmp, out)
            return True
        except Exception as e:  # network hiccups are common; retry, then skip
            err = e
            await asyncio.sleep(2 * (attempt + 1))
    if os.path.exists(tmp):
        os.remove(tmp)
    print(f"FAILED {job['key']}: {err}", file=sys.stderr, flush=True)
    return False


async def main():
    made = failed = 0
    for n, job in enumerate(jobs, 1):
        if os.path.exists(os.path.join(AUDIO, job["key"] + ".mp3")):
            continue
        if await make(job):
            made += 1
            print(f"[{n}/{len(jobs)}] {job['voice']}: {job['text'][:60]}", flush=True)
        else:
            failed += 1
    print(f"Created {made} clips, {failed} failed.")
    return made, failed


made, failed = asyncio.run(main())
if jobs and made == 0:
    sys.exit(1)
