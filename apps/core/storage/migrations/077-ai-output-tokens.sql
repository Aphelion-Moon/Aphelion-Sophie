-- Owner decision, 23 October 2026: a context may budget up to 2,048 output tokens for longer replies. The provider
-- attempt keeps the reserved budget it was charged against, so its bound follows the qualified profile's largest output.
ALTER TABLE sophie_ai.provider_attempts DROP CONSTRAINT provider_attempts_output_tokens_check,
  ADD CONSTRAINT provider_attempts_output_tokens_check CHECK (output_tokens BETWEEN 1 AND 2048);
