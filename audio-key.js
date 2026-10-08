// Shared by the app and the audio build script: the file name for a clip is
// a hash of the speaker number and the exact text, so audio always matches.
function audioKey(s, t) {
  const str = `${s || 0}|${String(t).trim()}`;
  let h = 0x811c9dc5;
  for (const ch of str) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
