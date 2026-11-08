import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { AVATAR_COUNT, AVATAR_DIRECTORY, AVATAR_BACKGROUNDS, defaultAvatar } from './public/avatars.js';

test('default avatars are stable, local, varied and use only very pale backgrounds', () => {
  const first = defaultAvatar('00000000-0000-4000-8000-000000000001');
  assert.deepEqual(defaultAvatar('00000000-0000-4000-8000-000000000001'), first);
  const faces = new Set(Array.from({ length: 32 }, (_, index) => defaultAvatar(`user-${index}`).src));
  assert.ok(faces.size > 16);
  for (const seed of ['../../../escape', '<script>', '', null, '김에이머']) {
    assert.match(defaultAvatar(seed).src, /^\/avatars\/gaze-v1\/\d{3}\.svg$/);
  }
  for (const background of AVATAR_BACKGROUNDS) {
    assert.ok(background.slice(1).match(/../g).every((channel) => parseInt(channel, 16) >= 240));
  }
});

test('the build includes every mapped Gaze SVG as a static, self-contained image', async () => {
  const directory = new URL(`./public${AVATAR_DIRECTORY}/`, import.meta.url);
  const files = await readdir(directory);
  assert.equal(files.filter((name) => name.endsWith('.svg')).length, AVATAR_COUNT);
  const dom = new JSDOM('');
  const parser = new dom.window.DOMParser();
  try {
    for (let index = 0; index < AVATAR_COUNT; index++) {
      const svg = await readFile(new URL(`${String(index).padStart(3, '0')}.svg`, directory), 'utf8');
      const document = parser.parseFromString(svg, 'image/svg+xml');
      assert.equal(document.documentElement.localName, 'svg');
      assert.equal(document.querySelector('parsererror'), null);
      assert.equal(document.querySelector('script, foreignObject, image, animate, style'), null);
      assert.ok([...document.querySelectorAll('[href]')].every((element) => element.getAttribute('href').startsWith('#')));
      assert.match(svg, /Gaze/);
      assert.match(svg, /CC0|creativecommons.org\/publicdomain\/zero/);
    }
  } finally { dom.window.close(); }
});
