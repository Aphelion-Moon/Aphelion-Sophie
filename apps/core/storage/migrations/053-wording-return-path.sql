-- Keep the database allowlist aligned with the fixed dashboard navigation routes.
ALTER TABLE sophie_core.dashboard_login_flows
  DROP CONSTRAINT dashboard_login_flows_return_path_check,
  ADD CONSTRAINT dashboard_login_flows_return_path_check CHECK (
    return_path IN ('/', '/localizations', '/ticket-forms', '/automation', '/permissions', '/contacts', '/contact-entry',
      '/answers', '/cases', '/manage-cases', '/case-replies', '/staff-notes', '/case-labels')
  );
