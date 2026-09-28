import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkModuleImports, checkWorkplan } from '../scripts/lib/repository-checks.mjs';

test('T46 case access, hidden storage writes and runtime escape hatches fail module lint', () => {
  for (const [path, source] of [
    ['modules/assistant/index.js', "import { read } from '../tickets/index.js';"],
    ['modules/integrations/index.js', "import { save } from '../membership/storage.js';"],
    ['modules/onboarding/index.js', "import { writeFile } from 'node:fs/promises';"],
    ['modules/assistant/index.js', "const load = import('../tickets/index.js');"],
    ['apps/knowledge-worker/index.js', "import x from '../core/secrets.js';"],
    ['apps/knowledge-worker/index.js', "import x from '../core/storage/core-store.js';"],
    ['apps/knowledge/mediawiki.js', "import x from '../core/storage/core-store.js';"],
    ['apps/ai-egress/runtime.js', "import x from '../core/secrets.js';"],
    ['apps/ai-egress/runtime.js', "import x from '../../modules/tickets/index.js';"],
    ['apps/ai-supervisor/runtime.js', "import x from '../core/secrets.js';"],
    ['apps/ai-control/server.js', "import x from '../core/secrets.js';"],
    ['apps/ai-control/client.js', "import x from '../ai-supervisor/docker.js';"],
    ['apps/core/runtime/ai-lifecycle.js', "import x from '../../ai-supervisor/docker.js';"],
    ['apps/ai-egress/runtime.js', "import x from '../ai-supervisor/docker.js';"],
    ['modules/onboarding/index.js', "import pg from 'pg';"],
  ]) assert.ok(checkModuleImports(path, source).length > 0);
  assert.deepEqual(checkModuleImports('modules/onboarding/index.js', "import { requireShuttleEligibility } from '../membership/index.js';"), []);
});

test('T60 work ordering rejects cycles, missing references and accidental model gates', async () => {
  const plan = JSON.parse(await readFile(new URL('../docs/workplan.json', import.meta.url), 'utf8'));
  const cases = JSON.parse(await readFile(new URL('../docs/acceptance-cases.json', import.meta.url), 'utf8'));
  assert.deepEqual(checkWorkplan(plan, cases), { tasks: 40, acceptanceSpecifications: 60 });
  const cyclic = structuredClone(plan);
  cyclic.tasks.find(task => task.id === 'P00').depends_on = ['P04'];
  assert.throws(() => checkWorkplan(cyclic, cases), /CYCLIC_TASK_DEPENDENCY/);
  const coupled = structuredClone(plan);
  coupled.tasks.find(task => task.id === 'P39').depends_on.push('P23');
  assert.throws(() => checkWorkplan(coupled, cases), /MODEL_INDEPENDENCE_VIOLATION/);
  const missing = structuredClone(plan);
  missing.tasks[0].acceptance_tests.push('T999');
  assert.throws(() => checkWorkplan(missing, cases), /MISSING_TASK_OR_TEST_REFERENCE/);
});
