export function ContactDetailsValid() {
  return (
    <main>
      <h1>Contact details</h1>
      <form>
        <label htmlFor="contact-email">Email address</label>
        <input id="contact-email" name="email" type="email" />
      </form>
    </main>
  );
}