// These versioned assets are generated locally at build time, never fetched from an avatar API.
export const AVATAR_COUNT = 128;
export const AVATAR_DIRECTORY = '/avatars/gaze-v1';
export const AVATAR_BACKGROUNDS = Object.freeze([
  '#fff5f7', '#fffaf2', '#f3f8ff', '#f7f4ff',
  '#f1faf6', '#fff5f0', '#f5f8fa', '#fcf9f2',
]);

function hash(value) {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.codePointAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

export function defaultAvatar(userId = 'guest') {
  const seed = String(userId || 'guest');
  const index = hash(`face:${seed}`) % AVATAR_COUNT;
  return {
    src: `${AVATAR_DIRECTORY}/${String(index).padStart(3, '0')}.svg`,
    background: AVATAR_BACKGROUNDS[hash(`background:${seed}`) % AVATAR_BACKGROUNDS.length],
  };
}
