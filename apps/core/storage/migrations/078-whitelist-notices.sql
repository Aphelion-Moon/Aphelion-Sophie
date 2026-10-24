-- Owner request, 24 October 2026: Sophie says in the staff bot channel each time her grant of Whitelist is confirmed. The
-- notice is queued in the transaction that confirms the grant, so it is sent once the grant holds and never without it.
ALTER TABLE sophie_core.outbox DROP CONSTRAINT outbox_kind_check;
ALTER TABLE sophie_core.outbox ADD CONSTRAINT outbox_kind_check CHECK
  (kind IN ('whitelist.grant','whitelist.reconcile','member.reconcile','case.provision','shuttle.render','shuttle.alert','case.intake','case.dm','case.reply','automation.dispatch','whitelist.notice'));
