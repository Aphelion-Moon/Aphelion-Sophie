import { ContractError } from '../../../contracts/validation.js';

/** Persist Discord barriers even when the reporting worker no longer owns its lease. */
export async function settleDeliveryFailure({ outbox, claim, error, possiblyAttempted, parkedCodes, noteUncertain }) {
  try {
    if (error.code === 'RATE_LIMITED') await outbox.deferDiscordDelivery(error.retryAfterMs);
    if (error.code === 'DISCORD_RATE_LIMIT_INVALID') await outbox.pauseDiscordDelivery();
    if (noteUncertain) await noteUncertain();
  } catch { throw new ContractError('DELIVERY_STATE_UNAVAILABLE'); }
  if (error.code === 'OUTBOX_LEASE_LOST') return { status: 'lease_lost' };
  try {
    if (error.code === 'DISCORD_RATE_LIMIT_INVALID' || parkedCodes.includes(error.code)) {
      await outbox.park(claim, error.code);
      return { status: 'operator_required', code: error.code };
    }
    const code = error.code === 'RATE_LIMITED' ? 'RATE_LIMITED' : possiblyAttempted ? 'DELIVERY_UNCERTAIN' : 'DISCORD_UNAVAILABLE';
    await outbox.retry(claim, code, Number.isSafeInteger(error.retryAfterMs) ? error.retryAfterMs : 0);
    return { status: 'retry_scheduled', code };
  } catch (failure) {
    if (failure.code === 'OUTBOX_LEASE_LOST') return { status: 'lease_lost' };
    throw new ContractError('DELIVERY_STATE_UNAVAILABLE');
  }
}
