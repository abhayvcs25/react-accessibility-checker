export function ContactDetailsViolation() {
  return (
    <main>
      <h1>Contact details</h1>
      <form>
        <label htmlFor="contact-email">Favorite color</label>
        <input id="contact-email" name="email" type="email" />
      </form>
    </main>
  );
}