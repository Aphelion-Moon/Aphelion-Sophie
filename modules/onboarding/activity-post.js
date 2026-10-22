import { defaultSystemText } from '../../contracts/system-messages.js';

/** Static routing only. The button launches the Activity; it never establishes membership, progress or access. */
export const ACTIVITY_LAUNCH_ID = 'sophie:shuttle:activity:1';

/**
 * The rules post banner (P44), made by the coding agent at owner direction (decision of 21 October 2026); provenance
 * in content/shuttle-activity/rules-post-banner.json. A departures sign, 32 columns so it fits a phone's code block.
 */
export const ACTIVITY_POST_BANNER = Object.freeze([
  '╔══════════════════════════════╗',
  '║ A P H E L I O N              ║',
  '║ ░▒▓ SHUTTLE  SERVICE ▓▒░     ║',
  '╟──────────────────────────────╢',
  '║ » DEPARTS   this server      ║',
  '║ » ARRIVES   Aphelion         ║',
  '║ » GATE      the button below ║',
  '╚══════════════════════════════╝',
]);
const AMBER = 0xffb84d;

/** The post for the rules channel: banner, fixed wording and one launch button. No mentions, member data or AI. */
export function activityLaunchPost(text = defaultSystemText) {
  return {
    embeds: [{ title: text('activity.post.title'), color: AMBER,
      description: `\`\`\`\n${ACTIVITY_POST_BANNER.join('\n')}\n\`\`\`\n${text('activity.post.body')}` }],
    components: [{ type: 1, components: [{ type: 2, style: 1, label: text('activity.post.button'), custom_id: ACTIVITY_LAUNCH_ID }] }],
    allowed_mentions: { parse: [], users: [], roles: [], replied_user: false },
  };
}
