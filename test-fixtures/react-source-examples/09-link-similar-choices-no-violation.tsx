export function AccountChoicesDistinctLinks() {
  return (
    <main>
      <h1>Choose an account action</h1>
      <nav aria-label="Account actions">
        <a href="/delete">Delete account</a>
        <a href="/suspend">Temporarily suspend account</a>
      </nav>
    </main>
  );
}