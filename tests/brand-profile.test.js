import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canonicalBrandProfile } from '../contracts/brand-profile.js';

async function source(root = 'Sophie-Visual-Assets-v1') {
  const read = name => readFile(new URL(`../${root}/${name}.json`, import.meta.url), 'utf8').then(JSON.parse);
  const [profile, manifest] = await Promise.all([read('brand-profile'), read('asset-manifest')]);
  return { profile, manifest };
}
test('P36 T49 both preserved packs resolve the same fixed identity and four selected masters', async () => {
  const visual = await source(), reference = await source('Sophie-Implementation-Plans-v1.1');
  assert.deepEqual(canonicalBrandProfile(visual.profile, visual.manifest), canonicalBrandProfile(reference.profile, reference.manifest));
  assert.equal(visual.profile.identity.product_id, 'aphelion-bot');
  assert.deepEqual(Object.keys(visual.profile.assets).sort(), ['avatar', 'banner', 'character', 'wordmark']);
});
test('P36 T49 legacy substitutions cannot become approved by changing both profile and manifest', async () => {
  const { profile, manifest } = await source();
  profile.assets.avatar = manifest.assets[0].id = 'sophie.avatar.human-v1';
  manifest.assets[0].path = 'assets/sophie/human-v1/sophie-avatar.png';
  assert.throws(() => canonicalBrandProfile(profile, manifest), /BRAND_PROFILE_INVALID/);
});
test('P36 T49 changed bytes, dimensions, transparency, reference roles and paths reject', async () => {
  const original = await source();
  for (const change of [
    asset => { asset.sha256 = 'a'.repeat(64); }, asset => { asset.bytes++; }, asset => { asset.width = 100; },
    asset => { asset.has_transparency = true; asset.colour_mode = 'RGBA'; },
    asset => { asset.path = '../sophie-avatar.png'; }, asset => { asset.path = 'https://example.test/avatar.png'; },
    asset => { asset.role = 'banner'; },
  ]) {
    const { profile, manifest } = structuredClone(original); change(manifest.assets[0]);
    assert.throws(() => canonicalBrandProfile(profile, manifest), /BRAND_PROFILE_INVALID/);
  }
  const duplicate = structuredClone(original); duplicate.manifest.assets[1] = duplicate.manifest.assets[0];
  assert.throws(() => canonicalBrandProfile(duplicate.profile, duplicate.manifest), /BRAND_PROFILE_INVALID/);
});
test('P36 T51 presentation data cannot opt into generation, status avatars or case AI', async () => {
  const original = await source();
  for (const change of [
    profile => { profile.boundaries.brand_is_not_ai = false; }, profile => { profile.boundaries.case_ai = true; },
    profile => { profile.rendering.runtime_image_generation = true; }, profile => { profile.rendering.runtime_animation = true; },
    profile => { profile.rendering.dynamic_avatar_status = true; }, profile => { profile.rendering.quiet_mode = false; },
    profile => { profile.identity.product_id = 'renamed-service'; }, profile => { profile.manifest = 'https://example.test/assets.json'; },
  ]) {
    const { profile, manifest } = structuredClone(original); change(profile);
    assert.throws(() => canonicalBrandProfile(profile, manifest), /BRAND_PROFILE_INVALID/);
  }
});
