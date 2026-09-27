import test from 'node:test';
import assert from 'node:assert/strict';
import { createPermissionsController } from '../apps/dashboard/permissions-controller.js';
import { createSyntheticPermissionsApi } from './fixtures/dashboard-permissions.js';
import { STAFF, LEAD } from './fixtures/domain.js';

const fixture=()=>{const f=createSyntheticPermissionsApi();let n=0;return {...f,c:createPermissionsController({api:f.api,onChange:()=>{},newRequestId:()=>(++n).toString(16).padStart(64,'0')})};};
test('permission editor saves independent roles and reviews running versus proposed mappings before candidate approval',async()=>{
  const {c,state}=fixture();await c.start();c.roles('grants','shuttle.publish',[STAFF]);await c.save();await c.review();
  assert.deepEqual(c.snapshot().review.candidate.capabilityPolicy.grants['shuttle.publish'],[STAFF]);
  assert.deepEqual(c.snapshot().review.running.capabilityPolicy.grants['shuttle.publish'],[LEAD]);await c.publish();
  assert.equal(state.publications.length,1);assert.match(c.snapshot().notice,/Review and apply/);
});
test('permission editor preserves exact uncertain requests and clears private selections on authority loss',async()=>{
  const {c,state}=fixture();await c.start();await c.save();await c.review();state.loseResponse=true;await c.publish();
  const pending=c.snapshot().pending;assert.ok(pending);assert.equal(state.publications.length,1);c.mapping('staff','999');
  assert.deepEqual(c.snapshot().pending,pending);await c.retry();assert.equal(state.publications.length,1);
  state.allowed=false;await c.checkAccess();assert.equal(c.snapshot().phase,'denied');assert.equal(c.snapshot().document,null);assert.equal(c.snapshot().overview,null);
  await c.logout();assert.equal(c.snapshot().phase,'signed-out');assert.equal(c.snapshot().identity,null);
});
test('permission editor retains local edits during conflict and requires explicit withdrawal review',async()=>{
  const {c,state,api}=fixture();await c.start();await c.save();c.roles('grants','answers.publish',[STAFF]);
  await api.permissionSave({requestId:'f'.repeat(64),expectedRevision:1,document:state.drafts[0].document});await c.save();
  assert.equal(c.snapshot().stale,true);await c.reload();assert.ok(c.snapshot().conflict);c.resolveConflict('local');await c.save();await c.review();await c.publish();
  await c.history();await c.inspect('publications',1);await c.withdraw();assert.equal(state.publications[0].status,'published');c.reviewWithdrawal();await c.withdraw();
  assert.equal(state.publications[0].status,'withdrawn');await c.logout();assert.equal(c.snapshot().document,null);
});

test('website apply uses a reviewed exact request and recovers an interrupted response without duplicate application',async()=>{
  const {c,state}=fixture();await c.start();await c.save();await c.review();await c.publish();await c.reviewApply();
  assert.ok(c.snapshot().applicationReview);state.loseResponse=true;await c.applyConfiguration();
  const request=c.snapshot().applicationPending;assert.ok(request);assert.equal(state.applyCalls,1);
  c.mapping('crew','100000000000000777');assert.notEqual(c.snapshot().document.crew,'100000000000000777');
  await c.applyConfiguration();assert.equal(state.applyCalls,1);assert.equal(c.snapshot().application.state,'queued');
  state.application.state='blocked';await c.refreshApplication();await c.retryBlocked();assert.equal(c.snapshot().application.state,'applying');
  state.allowed=false;await c.checkAccess();assert.equal(c.snapshot().application,null);assert.equal(c.snapshot().applicationReview,null);
});
