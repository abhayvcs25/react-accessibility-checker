export function SignInWithLabel() {
  return (
    <main>
      <h1>Sign in</h1>
      <form>
        <label htmlFor="email">Email address</label>
        <input id="email" name="email" type="email" placeholder="name@example.com" />
      </form>
    </main>
  );
}