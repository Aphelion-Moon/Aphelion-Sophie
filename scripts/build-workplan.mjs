import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export function renderWorkplan(plan) {
  const lines = [
    '# Current implementation workplan', '',
    `Revision: ${plan.revision}. ${plan.schedule}`, '',
    plan.release_status, '',
    'Source requirements remain in the preserved v1.1 pack. Current owner decisions override conflicting source recommendations. No sub-agent delegation is authorised.', '',
    '## Implementation checkpoint', '',
    plan.checkpoint.summary, '',
    `Recorded baseline: ${plan.checkpoint.recorded_baseline}`, '',
    `Current work: ${plan.checkpoint.current_work}`, '',
    plan.checkpoint.evidence_note, '',
    '## Implemented milestones and remaining scope', '',
    '| Milestone | Implemented and verified offline | Evidence | Still required |', '|---|---|---|---|',
    ...plan.milestones.map(item => `| ${item.title} (${item.tasks.join(', ')}) | ${item.implemented} | ${item.evidence} | ${item.remaining} |`), '',
    '## Next implementation sequence', '',
    'These are bounded next steps within the task dependencies below. An unresolved live or operational input stops only work that needs that input.', '',
    ...plan.next_steps.map((item, index) => `${index + 1}. **${item.title}** (${item.tasks.join(', ')}). ${item.work} Exit evidence: ${item.exit_evidence}`), '',
    '## Inputs and release gates still open', '',
    '| Input or gate | Affected work | Work that can continue now |', '|---|---|---|',
    ...plan.release_inputs.map(item => `| ${item.input} | ${item.affected_work} | ${item.independent_work} |`), '',
    '## Task status', '',
    `Status counts: ${plan.tasks.filter(task => task.status === 'complete').length} complete; ${plan.tasks.filter(task => task.status === 'in_progress').length} in progress; ${plan.tasks.filter(task => task.status === 'planned_not_started').length} planned, not started. These are full-task statuses, not a percentage of code or release readiness.`, '',
    'An in-progress task can contain several verified milestones and still have unfinished implementation or acceptance. Acceptance IDs below link requirements to tasks; they do not assert that those specifications have passed.', '',
    '| Task | Status | Depends on |', '|---|---|---|',
    ...plan.tasks.map(task => `| ${task.id} — ${task.title} | ${task.status} | ${task.depends_on.join(', ') || 'None'} |`), '',
  ];
  for (const task of plan.tasks) {
    lines.push(`## ${task.id} — ${task.title}`, '', `Status: **${task.status}**. Phase: ${task.phase}. Priority: ${task.priority}.`, '',
      `Depends on: ${task.depends_on.join(', ') || 'None'}. Acceptance: ${task.acceptance_tests.join(', ')}.`, '',
      task.implementation_note, '');
    if (task.completed_scope?.length) lines.push('Implemented scope:', '', ...task.completed_scope.map(item => `- ${item}`), '');
    if (task.remaining_scope?.length) lines.push('Remaining scope:', '', ...task.remaining_scope.map(item => `- ${item}`), '');
    lines.push('Full task deliverables:', '', ...task.deliverables.map(item => `- ${item}`), '', `Boundary: ${task.guardrail}`, '');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const root = new URL('../', import.meta.url);
  const plan = JSON.parse(await readFile(new URL('docs/workplan.json', root), 'utf8'));
  await writeFile(new URL('docs/workplan.md', root), renderWorkplan(plan));
  console.log(`Rendered ${plan.tasks.length} current tasks.`);
}
