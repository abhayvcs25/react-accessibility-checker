export function ProfileDrafts() {
  return (
    <main>
      <h1>Profile drafts</h1>
      <section>
        <h2>Unpublished profile</h2>
        <p>Save this version without publishing it.</p>
        <button type="button">Save draft</button>
      </section>
      <section>
        <h2>Published profile</h2>
        <p>Save the changes to the live profile.</p>
        <button type="button">Save changes</button>
      </section>
    </main>
  );
}