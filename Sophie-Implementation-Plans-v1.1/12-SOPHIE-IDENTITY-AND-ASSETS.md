# 12 · Sophie — identity, artwork, and implementation guide

**Plan revision:** 1.1 · **Asset set:** `sophie-neon-chibi-v1`  
**Basis:** The user's chosen name, latest neon chibi protogen direction, four generated reference assets, and request to incorporate them into the plans.

## What is decided

The bot is **Sophie**, uses **she/her**, and carries the designation **Community Services**. The expanded accessible label is **Sophie — Aphelion Community Services**. Her name is not an acronym.

Her current form is a **neon chibi protogen**. The earlier human station-officer design is superseded for active use. The current four-file set is the source for consistent future work; use the actual images rather than an approximate reconstruction from prose.

Sophie is the shared identity of the administrative application, not a separate person, a staff rank, or a second bot. The name and imagery do not confer moderation authority, unlock access, add features or change the current release gates. Her optional AI chat/knowledge function remains separate from human-operated tickets and deterministic Shuttle onboarding.

## Visual reference observed in the supplied artwork

The character has a glossy black digital visor with cyan-and-magenta eyes, a small illuminated smile and magenta cheek marks. Dark charcoal fur, oversized pointed ears and compact chibi proportions make the silhouette distinctive. The visible inner-ear accents are magenta on the viewer's left and cyan on the viewer's right; do not mirror the art casually.

She wears a worn magenta scarf with pale stripes and a star/compass-like motif. Weathered dark and pale-metal plating, circular headset details, glowing paw pads, and cyan/magenta highlights retain the restored-station character. A small ringed-planet/star charm and orbital scenery connect the design to space.

These are descriptions of the selected drawings, not a species guide or lore canon. The pictured motifs are not verified official Aphelion/Meridian insignia. No age, origin story, personal memories, station ownership or in-game rank is established here. Future designs should preserve the identity cues while allowing ordinary pose/expression changes after review.

## The four source assets

Paths below are relative to the planning-pack root. They also appear in `asset-manifest.json`, with full SHA-256, source attachment/generation identifiers, byte counts and usage notes. The PNGs are copied **byte-for-byte**, not regenerated, upscaled, recoloured or flattened.

| Asset ID | File | Actual source dimensions | Transparency | Intended role |
|---|---|---|---|---|
| `sophie.avatar.neon-chibi-v1` | `assets/sophie/neon-chibi-v1/sophie-avatar.png` | 1254 × 1254 | Opaque RGB | Bot profile picture; compact identity |
| `sophie.banner.neon-chibi-v1` | `assets/sophie/neon-chibi-v1/sophie-banner.png` | 1672 × 941 | Opaque RGB | Wide service-desk hero / introduction |
| `sophie.character.neon-chibi-v1` | `assets/sophie/neon-chibi-v1/sophie-character.png` | 1254 × 1254 | RGBA with real alpha | Welcoming character cutout |
| `sophie.wordmark.neon-chibi-v1` | `assets/sophie/neon-chibi-v1/sophie-wordmark.png` | 2172 × 724 | RGBA with real alpha | SOPHIE / Community Services badge |

The banner is approximately 16:9; the wordmark is exactly 3:1. These are source-image dimensions, not a statement about current Discord upload limits. The wordmark is raster artwork, not an editable vector or a bundled font.

### Avatar

![Sophie's selected neon chibi protogen avatar.](assets/sophie/neon-chibi-v1/sophie-avatar.png)

Use the expressive visor as the focal point. Test a circular crop and small preview before setting the live bot image: the ears already reach the source's upper edge, so a round crop cannot be assumed to preserve every tip. Do not crop away the face merely to include the whole orbital ring. A later padded/cropped export should have its own manifest entry rather than overwrite the original.

### Banner

![Sophie at a neon-lit orbital service desk.](assets/sophie/neon-chibi-v1/sophie-banner.png)

Use for a welcome/about area or a public introduction, not behind ticket transcripts. Preserve Sophie on the left and the space view on the right. Although the composition has more open space on the right, it is detailed artwork; place readable live text and controls on an opaque surface. For mobile, use a separate image block or avatar rather than a destructive centre crop.

### Character cutout

![Sophie's transparent welcoming character cutout.](assets/sophie/neon-chibi-v1/sophie-character.png)

Use sparingly for a welcome/help illustration or non-sensitive empty state. Keep ears, paws, scarf and tail within the layout. Inspect alpha edges on both light and dark surfaces. It is not a conversational widget, a new AI workflow, or an already validated Discord sticker upload. Any later sticker/emote exports require their own technical review.

### Wordmark

![Sophie — Community Services.](assets/sophie/neon-chibi-v1/sophie-wordmark.png)

Use at a size where both SOPHIE and Community Services remain readable. Preserve the full aspect ratio with contain-style sizing. At narrow widths, substitute the avatar and live text rather than compressing the subtitle. Keep an accessible text name even when the badge is the visible header. Do not stretch, recolour, remove its subtitle or re-render the lettering to imitate a different logo without approval.

## Proposed interface placement

| Surface | Presentation | Behaviour boundary |
|---|---|---|
| Discord bot identity | Selected avatar and Sophie display name | One production bot; live profile changes are explicit release operations |
| Public help / welcome | Banner or wordmark, concise live introduction | No claim that all messages are AI or that Sophie is human staff |
| Dashboard header | Compact avatar plus live Sophie / Community Services text | Normal capability checks; images carry no permissions |
| Dashboard welcome/about | Banner or cutout on a contained non-sensitive area | No external image fetch, model call or runtime generation |
| Ticket/report workspace | Neutral working panels; normal bot avatar for deterministic notices | No AI assistance, interpretation, drafting, summaries or ingestion |
| Shuttle | Optional static identity art with approved finite-step text | Existing workflow state, acknowledgements and staff help remain authoritative |
| AI/knowledge area | Sophie identity and clearly identified generated answers | Only permitted non-ticket requests and evidence |
| Errors / health / audit | Plain state labels and clear recovery actions | Mascot expression is never evidence of success, health or authorisation |

The bright mascot and the restrained dashboard shell serve different purposes. Cyan and magenta identify the art direction, not the website's exact colour tokens. Keep panel contrast, body text, focus, validation and status clear. The live Meridian CSS, fonts and official brand assets remain unverified in this pack.

## Proposed voice and message guidance

Carry forward the welcoming station-service idea: warm, composed and capable, with occasional dry or gentle humour in appropriate public contexts. This is an editorial recommendation, not additional user-approved lore. Do not force an acronym, catchphrase, baby-talk, flirtation or a roleplay voice into routine administration.

In sensitive or administrative contexts, prefer plain language. Refer to human staff explicitly. Do not imply she is reading a ticket with AI, making a moderation decision, assessing a member's values or verifying age. The no-AI-in-tickets rule applies even when the static avatar looks like a robot.

Sample wording below is draft copy for owner review, not a replacement for the user's final Shuttle text:

| Context | Draft wording | Required condition |
|---|---|---|
| Public introduction | “I'm Sophie, Aphelion's community-services bot. I keep the desk running and help you find your way around.” | General identity statement; do not imply unavailable tools |
| Confirmed ticket opening | “Your ticket is open. This channel is handled by human staff.” | Case/channel/permissions are confirmed |
| Shuttle introduction | “Welcome aboard. Take each section at your own pace, and use Ask staff whenever you need a person.” | Published workflow actually provides that action |
| Saved progress, pending role | “Your progress is saved. Your access role is still pending.” | Saved state and pending delivery are confirmed |
| Lookup with insufficient evidence | “I couldn't verify that in the approved sources. Here are the closest matches.” | Return only actual authorised matches; otherwise state that none were found |
| AI disabled or busy | “AI replies are unavailable right now. Direct lookup and staff support are still available.” | Only advertise services that are actually ready |

Do not promise response times, confidentiality beyond the real permission model, completed grants or staff notifications that have not succeeded. Knowledge answers must still cite evidence, admit uncertainty and distinguish policy from casual conversation. Styling is subordinate to the existing security and evidence rules.

## Backend and configuration integration

Keep two separate versioned documents: `brand-profile.json` for the name/designation/style guidance, and `asset-manifest.json` for image references and provenance. The existing configuration sketch points to them. Its production asset-approval field remains unset until placement/publication review; supplied references are not the same as a deployed profile.

The Identity and appearance screen previews approved local asset IDs and static templates. It must work with inference absent. It must not accept arbitrary network URLs, turn a case into a preview prompt, add a model-driven mascot, or expose a hidden AI-in-tickets toggle. Brand-editing permission does not grant case-read, AI-tool or connector-credential access.

Draft, validate, review, publish and roll back presentation changes. Preview circle crops, narrow layouts and quiet mode. Record the selected set/version in the release ledger. Keep `aphelion-bot` and other technical IDs stable; branding alone does not authorise renaming service accounts, paths, databases, routes or OAuth callbacks.

No animated asset set, voice/audio system, Live2D/3D rig, image-generation endpoint, new inference model or expanded memory feature is supplied or required. These are static illustrations. Future enhancements require a separate request and review.

## Accessibility, performance and fallback

Use decorative empty alt text when artwork repeats adjacent identity text; use the manifest's meaningful alt text when the image conveys the identity by itself. The wordmark's text should also be available as real text. Do not encode status through glow/colour alone.

Quiet mode removes optional hero art, cutouts and decorative neon without removing focus outlines, identity labels, operation status or controls. Respect the existing reduced-motion requirement; there is no new animation at launch. A failed image load produces a text fallback, not an unusable page or a model call.

Serve reviewed raster exports locally. Source PNGs are reference masters; later responsive/optimised derivatives must preserve originals, retain parent IDs/hashes and be visually checked. Do not claim an export is production-ready solely from its dimensions or file extension. No font files are bundled.

## Provenance and review status

The source files originate from image generation in this conversation. Their actual dimensions, modes, transparency and hashes were measured during packaging. The earlier human images and the private WUFF diagnostic export are not included. This pack preserves the supplied source art; it does not commission further artwork or recover editable layers.

The user's MIT requirement still governs directly reused FOSS application projects. No software licence, copyright holder, exclusive ownership or species-related permission is assigned to the illustrations by implication. Record any publication/redistribution decision separately. Do not assume the star/compass or orbital motifs are official logos copied from the website.

Packaging verification checks the files, references and reader. Application integration, Discord upload compatibility, UI accessibility, owner copy approval and production publication remain implementation/release checks. T49–T52 specify that work; they are not passed application tests.

## Handoff order

P36 imports the exact files and shared identity contracts. P37 applies them to the dashboard, Discord identity and deterministic templates. P38 independently reviews placement and the no-ticket-AI boundary before P29 brand sign-off. T52 adds persona/factuality checks to the separately gated non-ticket AI release.

The WUFF hardware addendum remains an unchanged deployment overlay. This identity work neither changes the local CPU model nor permits it to consume ticket data or harm the shared game host.
