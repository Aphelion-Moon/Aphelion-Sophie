-- Retain metadata for reply work parked before its operator workflow was installed.
-- This does not reset attempts, send flags, fences or confirmed delivery state.
INSERT INTO sophie_core.case_delivery_issues (id, guild_id, operation_id, user_id, case_id, parked_fence, created_at)
SELECT md5('sophie-case-issue:' || o.guild_id || ':' || o.operation_id), o.guild_id, o.operation_id, o.user_id, r.id, o.fence, o.created_at
FROM sophie_core.outbox o
JOIN sophie_core.case_reservations r ON r.id = o.effect->>'caseId' AND r.guild_id = o.guild_id AND r.user_id = o.user_id
JOIN sophie_core.case_provisions p ON p.case_id = r.id AND p.guild_id = r.guild_id
JOIN sophie_core.case_replies reply ON reply.id = o.effect->>'replyId' AND reply.case_id = r.id
  AND reply.guild_id = r.guild_id AND reply.user_id = r.user_id
WHERE o.kind = 'case.reply' AND o.status = 'parked' AND r.type <> 'shuttle'
  AND o.effect->>'kind' = o.kind AND o.effect->>'guildId' = o.guild_id
  AND o.effect->>'userId' = o.user_id AND o.effect->>'operationId' = o.operation_id
ON CONFLICT (guild_id, operation_id) DO NOTHING;
