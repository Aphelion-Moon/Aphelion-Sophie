import { requireCondition, requireKeys } from './validation.js';

// These are the selected reference masters, not a registry of arbitrary upload paths.
const selected = Object.freeze({
  avatar: { width: 1254, height: 1254, bytes: 2328246, sha256: '3d79dde5215683c2ba6183e98d06b21a66523318a3a20e20c20ca9b579f12a65', has_transparency: false },
  banner: { width: 1672, height: 941, bytes: 2595452, sha256: '84a86f2c8847e05446db361367545021b14eee37e561fc64aae4e1b4869bf4aa', has_transparency: false },
  character: { width: 1254, height: 1254, bytes: 1585100, sha256: 'fe5234160e5b5934671743cfa2dde1d7f690a34ad2e82bf07c80d21d0930e805', has_transparency: true },
  wordmark: { width: 2172, height: 724, bytes: 1326399, sha256: '301f77676be0a3c722becc0d44cb3ee6f6c330f50f0edaa9492704235f3b65d2', has_transparency: true },
});
const roles = Object.keys(selected), code = 'BRAND_PROFILE_INVALID';
const text = (value, limit = 1000) => requireCondition(typeof value === 'string' && value.trim().length > 0 && value.length <= limit &&
  value.isWellFormed() && !/[\u0000-\u001f\u007f]/u.test(value), code);
function list(value, maximum, limit) {
  requireCondition(Array.isArray(value) && value.length > 0 && value.length <= maximum, code);
  value.forEach(item => text(item, limit));
}

/** Fixed owner identity and local references only. This contract grants no runtime capability or publication approval. */
export function canonicalBrandProfile(profile, manifest) {
  requireKeys(profile, ['schema_version', 'plan_version', 'identity', 'assets', 'manifest', 'proposed_editorial_guidance', 'boundaries', 'rendering'], code);
  requireCondition(profile.schema_version === 1 && profile.plan_version === '1.1' && profile.manifest === 'asset-manifest.json', code);
  const identity = { display_name: 'Sophie', designation: 'Community Services', accessible_full_name: 'Sophie — Aphelion Community Services',
    community: 'Aphelion / Meridian Rift', character_form: 'neon chibi protogen', visual_generation: 'neon-chibi-v1', product_id: 'aphelion-bot', force_acronym: false };
  requireKeys(profile.identity, [...Object.keys(identity), 'pronouns', 'lore_status'], code);
  for (const [key, value] of Object.entries(identity)) requireCondition(profile.identity[key] === value, code);
  requireCondition(Array.isArray(profile.identity.pronouns) && profile.identity.pronouns.length === 2 &&
    profile.identity.pronouns[0] === 'she' && profile.identity.pronouns[1] === 'her', code);
  text(profile.identity.lore_status, 500);
  requireKeys(profile.assets, roles, code);
  for (const role of roles) requireCondition(profile.assets[role] === `sophie.${role}.neon-chibi-v1`, code);

  const guidance = profile.proposed_editorial_guidance;
  requireKeys(guidance, ['tone', 'official_messages', 'avoid', 'approval'], code);
  list(guidance.tone, 8, 120); list(guidance.avoid, 12, 200); text(guidance.official_messages); text(guidance.approval, 500);
  const boundaries = ['tickets', 'shuttle', 'knowledge', 'truthful_actions', 'generated_output_label'];
  requireKeys(profile.boundaries, ['brand_is_not_ai', ...boundaries], code);
  requireCondition(profile.boundaries.brand_is_not_ai === true, code);
  boundaries.forEach(key => text(profile.boundaries[key]));
  const enabled = ['static_assets_only_at_launch', 'quiet_mode', 'respect_reduced_motion', 'neutral_case_surfaces', 'system_fonts_only_until_approved'];
  const disabled = ['runtime_image_generation', 'runtime_animation', 'dynamic_avatar_status', 'live_meridian_css_verified'];
  requireKeys(profile.rendering, [...enabled, ...disabled, 'note'], code);
  for (const key of enabled) requireCondition(profile.rendering[key] === true, code);
  for (const key of disabled) requireCondition(profile.rendering[key] === false, code);
  text(profile.rendering.note);

  requireKeys(manifest, ['schema_version', 'plan_version', 'asset_set', 'path_base', 'source_basis', 'selection', 'software_licence_policy', 'verification', 'assets'], code);
  requireCondition(manifest.schema_version === 1 && manifest.plan_version === profile.plan_version && manifest.asset_set === 'sophie-neon-chibi-v1', code);
  for (const key of ['path_base', 'source_basis', 'selection', 'software_licence_policy', 'verification']) text(manifest[key]);
  requireCondition(Array.isArray(manifest.assets) && manifest.assets.length === roles.length, code);
  const seen = new Set();
  for (const asset of manifest.assets) {
    requireKeys(asset, ['id', 'role', 'title', 'path', 'format', 'width', 'height', 'colour_mode', 'has_transparency', 'bytes', 'sha256',
      'source', 'transformation', 'alt_text', 'decorative_alt_text', 'intended_uses', 'placement_notes', 'status'], code);
    requireCondition(Object.hasOwn(selected, asset.role) && !seen.has(asset.role), code); seen.add(asset.role);
    requireCondition(asset.id === profile.assets[asset.role] && asset.path === `assets/sophie/neon-chibi-v1/sophie-${asset.role}.png` &&
      asset.format === 'PNG' && asset.status === 'active_static_identity' && asset.transformation === 'Original generated PNG.', code);
    for (const [key, value] of Object.entries(selected[asset.role])) requireCondition(asset[key] === value, code);
    requireCondition(asset.colour_mode === (asset.has_transparency ? 'RGBA' : 'RGB') && asset.decorative_alt_text === '', code);
    requireKeys(asset.source, ['kind', 'tool'], code);
    requireCondition(asset.source.kind === 'generated_static_artwork' && asset.source.tool === 'built-in image generation', code);
    for (const key of ['title', 'alt_text', 'placement_notes']) text(asset[key]);
    list(asset.intended_uses, 8, 200);
  }
  return structuredClone(profile);
}
