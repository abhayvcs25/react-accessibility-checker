export function SavedItemsNamingConflict() {
  return (
    <main>
      <h1>Saved items</h1>
      <p>Both controls remove the same saved item from this collection.</p>
      <button type="button" aria-label="Remove saved item">Remove</button>
      <button type="button" aria-label="Remove saved item">Cancel</button>
    </main>
  );
}