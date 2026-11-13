export function ChooseOptionViolation() {
  return (
    <main>
      <h1>Choose an option</h1>
      <p>Select the correct one.</p>
      <label><input type="radio" name="plan" value="basic" /> Basic</label>
      <label><input type="radio" name="plan" value="premium" /> Premium</label>
    </main>
  );
}