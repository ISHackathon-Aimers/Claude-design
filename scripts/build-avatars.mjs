import { Style, Avatar } from '@dicebear/core';
import gaze from '@dicebear/styles/gaze.json' with { type: 'json' };
import { mkdir, writeFile } from 'node:fs/promises';
import { AVATAR_COUNT, AVATAR_DIRECTORY } from '../public/avatars.js';

export async function buildAvatars() {
  const directory = new URL(`../public${AVATAR_DIRECTORY}/`, import.meta.url);
  await mkdir(directory, { recursive: true });
  const style = new Style(gaze);
  await Promise.all(Array.from({ length: AVATAR_COUNT }, async (_, index) => {
    const avatar = new Avatar(style, { seed: `aimers-gaze-v1-${index}`, scale: 0.88 });
    await writeFile(new URL(`${String(index).padStart(3, '0')}.svg`, directory), avatar.toString());
  }));
}
