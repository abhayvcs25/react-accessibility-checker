export function NotificationSettings() {
  return (
    <main>
      <h1>Notification settings</h1>
      <p>Control whether email notifications are sent.</p>
      <div role="switch" tabIndex={0} aria-checked="true" aria-label="Email notifications" />
    </main>
  );
}