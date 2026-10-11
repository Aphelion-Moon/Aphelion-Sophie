-- Member-authored notes share the existing self-service preference row, its expiry, journal fence and erasure.
ALTER TABLE sophie_ai.response_preferences DROP CONSTRAINT response_preferences_settings_check;
ALTER TABLE sophie_ai.response_preferences ADD CONSTRAINT response_preferences_settings_check
  CHECK(jsonb_typeof(settings)='object' AND octet_length(settings::text)<=8192);
