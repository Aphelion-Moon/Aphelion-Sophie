import { DiscordSDK } from '../vendor/embedded-app-sdk/Discord.mjs';
import { Events } from '../vendor/embedded-app-sdk/schema/events.mjs';

/** Discord opens an Activity with these query parameters; without them the page is not in Discord's frame. */
export function insideDiscord(search) {
  const params = new URLSearchParams(search);
  return ['frame_id', 'instance_id', 'platform'].every(key => params.has(key));
}

/**
 * Connects to the Discord client that frames the Activity and signs the member in through core (P40). The OAuth code
 * goes to core, which checks the instance and issues the bearer token; the SDK is then authenticated so it can show
 * the presence line. Layout (picture-in-picture) and heat events pause animation. Only the commands below are used.
 * openLink reports whether Discord opened the link (false when declined or unavailable).
 */
// One SDK for the page: a link attempt that is tried again (it timed out, or sign-in failed) waits on the same SDK and its
// readiness rather than opening a second channel to Discord.
let shared = null;
export async function connectDiscord({ applicationId, guildId, api, onLayout = () => {}, onThermal = () => {} }) {
  shared ??= (() => { const sdk = new DiscordSDK(applicationId, { disableConsoleLogOverride: true }); return { sdk, ready: sdk.ready(), subscribed: false }; })();
  const { sdk } = shared;
  await shared.ready;
  const authorize = async () => (await sdk.commands.authorize({ client_id: applicationId, response_type: 'code', state: '', prompt: 'none',
    scope: ['identify', 'rpc.activities.write'] })).code;
  const signed = await api.signIn({ code: await authorize(), instanceId: sdk.instanceId });
  // An ended session (an hour away, a core restart) is renewed the same way, without a prompt.
  api.setRenewal?.(async () => { await api.signIn({ code: await authorize(), instanceId: sdk.instanceId }); });
  let presence = false, name = null;
  try {
    const auth = await sdk.commands.authenticate({ access_token: signed.accessToken });
    presence = signed.scopes.includes('rpc.activities.write');
    // The member's own username, for the title screen only: never sent anywhere, stored or logged.
    name = typeof auth?.user?.username === 'string' ? auth.user.username : null;
  } catch { presence = false; }
  if (!shared.subscribed) {
    shared.subscribed = true;
    await sdk.subscribe(Events.ACTIVITY_LAYOUT_MODE_UPDATE, ({ layout_mode: mode }) => onLayout(mode)).catch(() => {});
    await sdk.subscribe(Events.THERMAL_STATE_UPDATE, ({ thermal_state: state }) => onThermal(state)).catch(() => {});
  }
  return Object.freeze({
    platform: sdk.platform, guildId, name,
    async openLink(url) {
      try { return (await sdk.commands.openExternalLink({ url }))?.opened !== false; } catch { return false; }
    },
    async setPresence(activity) {
      if (!presence) return;
      try { await sdk.commands.setActivity({ activity: { type: 0, ...activity } }); } catch { presence = false; }
    },
  });
}
