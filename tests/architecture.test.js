import test from 'node:test';
import assert from 'node:assert/strict';
import { checkModuleImports } from '../scripts/lib/repository-checks.mjs';

test('T46 case access, hidden storage writes and runtime escape hatches fail module lint', () => {
  for (const [path, source] of [
    ['modules/assistant/index.js', "import { read } from '../tickets/index.js';"],
    ['modules/integrations/index.js', "import { save } from '../membership/storage.js';"],
    ['modules/onboarding/index.js', "import { writeFile } from 'node:fs/promises';"],
    ['modules/assistant/index.js', "const load = import('../tickets/index.js');"],
    ['apps/knowledge-worker/index.js', "import x from '../core/secrets.js';"],
    ['apps/knowledge-worker/index.js', "import x from '../core/storage/core-store.js';"],
    ['apps/knowledge/mediawiki.js', "import x from '../core/storage/core-store.js';"],
    ['apps/knowledge-worker/main.mjs', "import x from '../core/secrets.js';"],
    ['apps/knowledge-worker/inference-dialer.js', "import x from '../../modules/tickets/index.js';"],
    ['apps/installation/configuration.js', "import x from '../core/storage/core-store.js';"],
    ['apps/installation/context.js', "import x from '../core/runtime/staging.js';"],
    ['apps/knowledge-worker/runtime.js', "import x from '../core/storage/ai-controls.js';"],
    ['modules/onboarding/index.js', "import pg from 'pg';"],
  ]) assert.ok(checkModuleImports(path, source).length > 0);
  assert.deepEqual(checkModuleImports('modules/onboarding/index.js', "import { requireShuttleEligibility } from '../membership/index.js';"), []);
});
