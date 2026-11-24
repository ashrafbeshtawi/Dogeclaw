// Telegram delivers an album (several photos/videos sent together) as one
// `message` event per item, all sharing a `media_group_id`. Without grouping,
// every image would trigger its own agent run. This buffers the parts of a
// group for a short quiet period and flushes them as a single merged turn.

export const MEDIA_GROUP_DELAY_MS = 1500;

// Debounced per-key buffer: each add() resets the key's timer; when no new
// part arrives for `delayMs`, onFlush(parts) is called once with every part
// in arrival order.
// A part may be a promise (e.g. a part whose media is still downloading), so
// it can be registered as soon as its event arrives. A flush waits for all
// of them; parts that resolve to null (failed download) are left out.
export function createMediaGroupBuffer({ delayMs = MEDIA_GROUP_DELAY_MS, onFlush }) {
  const groups = new Map(); // key -> { parts, timer }

  const runFlush = pending => Promise.all(pending)
    .then(parts => parts.filter(part => part != null))
    .then(parts => parts.length > 0 && onFlush(parts))
    .catch(err => console.error(`[media-group] flush failed: ${err.message}`));

  return {
    add(key, part) {
      let group = groups.get(key);
      if (!group) {
        group = { parts: [], timer: null };
        groups.set(key, group);
      }
      group.parts.push(part);
      clearTimeout(group.timer);
      group.timer = setTimeout(() => {
        groups.delete(key);
        runFlush(group.parts);
      }, delayMs);
    },
    // Flushes every pending group whose key starts with `prefix` right away,
    // without waiting for the quiet period, and resolves once their parts are
    // ready and their onFlush calls are done. Used so a plain message sent
    // after an album does not overtake the album.
    async flushPrefix(prefix) {
      const due = [];
      for (const [key, group] of groups) {
        if (!key.startsWith(prefix)) continue;
        clearTimeout(group.timer);
        groups.delete(key);
        due.push(group.parts);
      }
      for (const parts of due) await runFlush(parts);
    },
    get size() {
      return groups.size;
    },
    clear() {
      for (const g of groups.values()) clearTimeout(g.timer);
      groups.clear();
    },
  };
}

// Merges parsed album parts ({ text, media, mediaHints, messageId }) into one.
// Images are concatenated. Audio/video slots hold a single item, so the first
// one wins and any extra becomes an [Attached: <type>] hint. Captions (usually
// only on the first item) are joined with newlines.
export function mergeMediaParts(parts) {
  const media = { images: null, audio: null, audioMime: null, video: null, videoMime: null };
  const mediaHints = [];
  const texts = [];

  for (const part of parts) {
    if (part.text) texts.push(part.text);
    const m = part.media || {};
    if (m.images?.length) media.images = [...(media.images || []), ...m.images];
    if (m.audio) {
      if (media.audio) mediaHints.push('audio');
      else { media.audio = m.audio; media.audioMime = m.audioMime; }
    }
    if (m.video) {
      if (media.video) mediaHints.push('video');
      else { media.video = m.video; media.videoMime = m.videoMime; }
    }
    for (const hint of part.mediaHints || []) mediaHints.push(hint);
  }

  return {
    text: texts.join('\n'),
    media,
    mediaHints: [...new Set(mediaHints)],
    messageId: parts[0]?.messageId,
  };
}
