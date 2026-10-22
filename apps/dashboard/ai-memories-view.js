/** What Sophie remembers about the signed-in member: they can edit or delete each memory. Memory follows their Yes or No. */
export function createMemoryList({ api, document, perform, identity, saved = () => {} }) {
  const el = id => document.getElementById(id); let current = null;
  const node = (tag, text = '') => { const result = document.createElement(tag); result.textContent = text; return result; };
  const button = (text, action, className = '') => { const result = node('button', text); result.type = 'button'; if (className) result.className = className;
    result.addEventListener('click', () => perform(action)); return result; };
  function clear() {
    current = null; el('memories').replaceChildren(); el('memories-state').textContent = '';
  }
  function render(value) {
    const actor = identity();
    if (!actor || value.actorId !== actor.userId || value.guildId !== actor.guildId || typeof value.available !== 'boolean' ||
      !Array.isArray(value.memories)) { clear(); throw Error('AI_MEMORY_RESULT_INVALID'); }
    current = value; el('memories').replaceChildren();
    el('memories-state').textContent = !value.available ? 'Sophie’s memories are unavailable right now.' : value.active !== true
      ? 'Sophie is not keeping memories at the moment. Anything listed here was kept earlier.'
      : `Sophie remembers ${value.memories.length} thing${value.memories.length === 1 ? '' : 's'} that mention you.`;
    if (value.available && value.memories.length === 0) el('memories').append(node('li', 'Nothing yet.'));
    for (const memory of value.memories) {
      const item = node('li'), text = node('span', memory.text);
      const where = memory.scope === 'member' ? 'About you' : `A moment in channel ${memory.channelId}${memory.others ? `, with ${memory.others} other member${memory.others === 1 ? '' : 's'}` : ''}`;
      item.append(text, node('small', ` · ${where}${memory.edited ? ' · edited by you' : ''} · until ${new Date(memory.expiresAt).toLocaleDateString()}`));
      if (memory.editable) item.append(button('Edit', async () => {
        const field = node('input'); field.maxLength = 200; field.value = memory.text; field.setAttribute('aria-label', 'Edit this memory');
        item.replaceChildren(field, button('Save', async () => { render(await api.aiEditMemory({ id: memory.id, text: field.value, confirmed: true })); saved(); }, 'primary'),
          button('Cancel', async () => render(current)));
        field.focus();
      }));
      item.append(button('Forget', async () => { render(await api.aiForgetMemory({ id: memory.id, confirmed: true })); saved(); }, 'danger'));
      el('memories').append(item);
    }
  }
  async function load() { render(await api.aiMemories()); }
  clear(); return Object.freeze({ load, clear });
}

/** Owner audit (ai.memory.audit): every memory with its subjects; any one can be deleted. */
export function createMemoryAudit({ api, document, perform }) {
  const el = id => document.getElementById(id); let before = null;
  const node = (tag, text = '') => { const result = document.createElement(tag); result.textContent = text; return result; };
  function render(value) {
    el('memory-audit-list').replaceChildren();
    if (!value.memories.length) el('memory-audit-list').append(node('li', 'Sophie has no memories yet.'));
    for (const memory of value.memories) {
      const item = node('li'), remove = node('button', 'Delete'); remove.type = 'button'; remove.className = 'danger';
      remove.addEventListener('click', () => perform(async () => render(await api.aiRemoveMemory({ id: memory.id, confirmed: true }))));
      item.append(node('span', memory.text), node('small', ` · ${memory.scope === 'member' ? 'member' : `channel ${memory.channelId}`} · subjects ${memory.subjects.join(', ') || 'none'}` +
        `${memory.edited ? ' · edited by the member' : ''} · last used ${new Date(memory.usedAt).toLocaleDateString()}`), remove);
      el('memory-audit-list').append(item);
    }
    before = value.nextBefore; el('memory-audit-more').hidden = before === null;
  }
  async function load(next = null) {
    try { render(await api.aiMemoryAudit(next)); el('memory-audit').hidden = false; }
    catch (error) { if (error?.kind === 'denied') { el('memory-audit').hidden = true; return; } throw error; }
  }
  el('memory-audit-more').addEventListener('click', () => perform(() => load(before)));
  el('memory-audit-refresh').addEventListener('click', () => perform(() => load(null)));
  return Object.freeze({ load });
}
