-- Index only foreign keys not covered by an existing index's leading column.
-- Full indexes also support referential checks across every queue status.
create index admin_memberships_user_id_idx
  on portal_private.admin_memberships (user_id);

create index mail_resolutions_admin_id_idx
  on portal_private.mail_resolutions (admin_id);

create index mail_resolutions_mail_id_idx
  on portal_private.mail_resolutions (mail_id);

create index mail_resolutions_team_id_idx
  on portal_private.mail_resolutions (team_id);

create index outbox_subscription_id_idx
  on portal_private.outbox (subscription_id);
