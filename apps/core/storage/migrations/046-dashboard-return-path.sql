ALTER TABLE sophie_core.dashboard_login_flows ADD COLUMN return_path text NOT NULL DEFAULT '/'
  CHECK (return_path IN ('/', '/ticket-forms', '/automation', '/permissions', '/contacts', '/contact-entry',
    '/answers', '/cases', '/manage-cases', '/case-replies', '/staff-notes', '/case-labels'));
