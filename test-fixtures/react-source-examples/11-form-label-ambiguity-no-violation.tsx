export function PersonalInfoDisambiguated() {
  return (
    <main>
      <h1>Personal information</h1>
      <form>
        <fieldset>
          <legend>Date of birth</legend>
          <label htmlFor="birth-date">Date</label>
          <input id="birth-date" name="birth-date" type="date" />
        </fieldset>
      </form>
    </main>
  );
}