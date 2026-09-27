ALTER TABLE sophie_core.shuttle_delivery_rechecks
  ADD COLUMN action text NOT NULL DEFAULT 'recheck' CHECK (action IN ('recheck', 'adopt_message')),
  ADD COLUMN result_id text,
  ADD CONSTRAINT shuttle_recovery_result CHECK (
    (action = 'recheck' AND result_id IS NULL) OR
    (action = 'adopt_message' AND result_id IS NOT NULL AND result_id ~ '^[1-9][0-9]{0,19}$')
  );

-- Discover retained parked artifacts without attempting any Discord operation. Prefer
-- an existing issue's session binding when a private case has multiple repeat visits.
INSERT INTO sophie_core.shuttle_delivery_issues (id, guild_id, operation_id, user_id, session_id, parked_fence, created_at)
SELECT md5('sophie-shuttle-issue:' || o.guild_id || ':' || o.operation_id), o.guild_id, o.operation_id, o.user_id, s.id, o.fence, o.created_at
FROM sophie_core.outbox o
LEFT JOIN sophie_core.shuttle_delivery_issues retained ON retained.guild_id = o.guild_id AND retained.operation_id = o.operation_id
JOIN LATERAL (
  SELECT candidate.session_id FROM (
    SELECT m.session_id FROM sophie_core.shuttle_screens m WHERE o.kind = 'shuttle.render'
      AND m.id = o.effect->>'screenId' AND m.guild_id = o.guild_id AND m.user_id = o.user_id
    UNION ALL
    SELECT a.session_id FROM sophie_core.shuttle_alerts a WHERE o.kind = 'shuttle.alert'
      AND a.id = o.effect->>'alertId' AND a.guild_id = o.guild_id AND a.user_id = o.user_id
    UNION ALL
    SELECT c.session_id FROM sophie_core.shuttle_cases c WHERE o.kind = 'case.provision' AND o.effect->>'type' = 'shuttle'
      AND c.case_id = o.effect->>'caseId' AND c.guild_id = o.guild_id AND c.user_id = o.user_id
  ) candidate ORDER BY (candidate.session_id = retained.session_id) DESC NULLS LAST, candidate.session_id LIMIT 1
) picked ON true
JOIN sophie_core.sessions s ON s.id = picked.session_id AND s.guild_id = o.guild_id AND s.user_id = o.user_id
JOIN sophie_core.shuttle_cases b ON b.session_id = s.id AND b.guild_id = s.guild_id AND b.user_id = s.user_id
JOIN sophie_core.case_reservations r ON r.id = b.case_id AND r.guild_id = b.guild_id AND r.user_id = b.user_id
WHERE o.status = 'parked' AND r.type = 'shuttle'
ON CONFLICT (guild_id, operation_id) DO NOTHING;
