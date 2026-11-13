export function PublishOptions() {
  return (
    <main>
      <h1>Publish options</h1>
      <fieldset>
        <legend>Choose what happens to this document</legend>
        <label><input type="radio" name="publish" value="draft" /> Save as draft</label>
        <label><input type="radio" name="publish" value="publish" /> Publish now</label>
      </fieldset>
      <button type="button">Continue</button>
    </main>
  );
}