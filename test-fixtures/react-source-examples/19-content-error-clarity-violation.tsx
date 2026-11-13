export function EmailAddressViolation() {
  return (
    <main>
      <h1>Email address</h1>
      <form>
        <label htmlFor="email">Email address</label>
        <input id="email" name="email" type="email" value="alice@" aria-invalid="true" aria-describedby="email-error" />
        <p id="email-error" role="alert">Invalid.</p>
      </form>
    </main>
  );
}