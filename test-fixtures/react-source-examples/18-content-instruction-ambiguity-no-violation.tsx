export function VerificationCode() {
  return (
    <main>
      <h1>Verification code</h1>
      <p>Enter the six-digit code sent to your email.</p>
      <label htmlFor="code">Six-digit verification code</label>
      <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" />
    </main>
  );
}