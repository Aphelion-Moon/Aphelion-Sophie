ALTER TABLE sophie_core.case_replies ADD COLUMN answer_reference jsonb;
ALTER TABLE sophie_core.case_replies ADD CONSTRAINT case_reply_answer_reference_check CHECK (
  answer_reference IS NULL OR (
    jsonb_typeof(answer_reference) = 'object' AND
    answer_reference - ARRAY['name','revision','sha256']::text[] = '{}'::jsonb AND
    jsonb_typeof(answer_reference->'name') = 'string' AND answer_reference->>'name' ~ '^[a-z][a-z0-9-]{0,39}$' AND
    jsonb_typeof(answer_reference->'sha256') = 'string' AND answer_reference->>'sha256' ~ '^[a-f0-9]{64}$' AND
    jsonb_typeof(answer_reference->'revision') = 'number' AND answer_reference->>'revision' ~ '^[1-9][0-9]{0,9}$' AND
    (answer_reference->>'revision')::numeric BETWEEN 1 AND 2147483646
  ) IS TRUE
);
