import assert from 'node:assert/strict';
import { intakeDeliveryWorkflow } from './case-intake-delivery.js';
import { syntheticCaseForm, syntheticCaseValues } from './case-intake.js';
import { PARTICIPANT, SECOND_PARTICIPANT } from './case-participants.js';
import { OTHER } from './domain.js';
import { CREW } from './discord.js';

export const contactEntryPayload = (f, action = 'contact', actorId = OTHER) => f.payload({ member: { user: { id: actorId } },
  data: { type: 1, name: 'ticket', options: [{ type: 1, name: action }] } });
export const contactSelectionPayload = (f, ids = [PARTICIPANT], actorId = OTHER) => f.payload({ type: 3, member: { user: { id: actorId } },
  message: { id: OTHER }, data: { component_type: 5, custom_id: 'sophie:contact:v1:select', values: ids,
    resolved: { users: {}, members: {} } } });
export const contactControlPayload = (f, action, token, actorId = OTHER) => f.payload({ type: 3, member: { user: { id: actorId } },
  message: { id: OTHER }, data: { component_type: 2, custom_id: `sophie:contact:v1:${action}:${token}` } });

/** Synthetic upgrade fixture only, with no Staff-contact records. */
export async function removeContactMigration(admin) {
  await admin.query(`ALTER TABLE sophie_core.case_form_slots DROP COLUMN contact_grants, DROP COLUMN contact_operator_grant,
    DROP COLUMN contact_confirmed, DROP COLUMN contact_cancelled;
    ALTER TABLE sophie_core.case_intakes DROP COLUMN contact_status;
    ALTER TABLE sophie_core.case_participant_actions DROP CONSTRAINT case_participant_action_recipient;
    ALTER TABLE sophie_core.case_participant_actions ADD UNIQUE (guild_id, interaction_id);
    DELETE FROM sophie_migrations.applied WHERE id = '028-staff-contact-intake.sql'`);
}

export async function contactWorkflow(cluster) {
  const f = await intakeDeliveryWorkflow(cluster);
  for (const id of [PARTICIPANT, SECOND_PARTICIPANT]) f.discord.state.members.set(id, [CREW]);
  async function selectContact(ids = [PARTICIPANT]) {
    const payload = contactSelectionPayload(f, ids), envelope = f.verified(payload);
    assert.equal(await f.commands.execute(envelope), 'case_contact');
    const review = await f.contacts.view(envelope); assert.equal(review.state, 'review');
    return { payload, envelope, token: review.token, review };
  }
  const confirmContact = (token, actorId = OTHER, isCurrent = () => true) => f.intake.prepare(f.verified(contactControlPayload(f, 'confirm', token, actorId)), { isCurrent });
  const submitContact = (token, values = syntheticCaseValues(), overrides = {}) => f.submit(token, values, { member: { user: { id: OTHER } }, ...overrides });
  async function openContact(ids = [PARTICIPANT]) {
    await f.publish(syntheticCaseForm('staff-contact')); const selected = await selectContact(ids);
    assert.equal((await confirmContact(selected.token)).status, 'modal');
    assert.equal(await submitContact(selected.token), 'ticket_recorded'); await f.drain(f.cases);
    return { ...selected, row: (await f.rows('case_reservations')).find(row => row.type === 'staff-contact') };
  }
  const contactView = (action, token, actorId = PARTICIPANT) => f.contacts.view(f.verified(contactControlPayload(f, action, token, actorId)));
  return { ...f, selectContact, confirmContact, submitContact, openContact, contactView };
}
