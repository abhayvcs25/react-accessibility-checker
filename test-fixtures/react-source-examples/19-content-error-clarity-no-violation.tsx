export function PostalCode() {
  return (
    <main>
      <h1>Postal code</h1>
      <form>
        <label htmlFor="postal-code">Postal code</label>
        <input id="postal-code" name="postal-code" required aria-invalid="true" aria-describedby="postal-error" />
        <p id="postal-error" role="alert">Enter a postal code.</p>
      </form>
    </main>
  );
}