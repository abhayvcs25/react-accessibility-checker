export function PersonalInfoAmbiguous() {
  return (
    <main>
      <h1>Personal and invoice information</h1>
      <form>
        <label htmlFor="birth-date">Date</label>
        <input id="birth-date" name="birth-date" type="date" />
        <label htmlFor="invoice-date">Date</label>
        <input id="invoice-date" name="invoice-date" type="date" />
      </form>
    </main>
  );
}