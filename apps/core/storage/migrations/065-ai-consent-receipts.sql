-- Legacy consent remains readable and withdrawable, but cannot authorize remote processing.
ALTER TABLE sophie_ai.consents ADD COLUMN receipt jsonb;
ALTER TABLE sophie_ai.consents ADD CONSTRAINT ai_consent_receipt_object
  CHECK (receipt IS NULL OR jsonb_typeof(receipt) = 'object');
