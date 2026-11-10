import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(
  scriptDirectory,
  '../../test-fixtures/accessibility-known-cases',
);

function page(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
</head>
<body>
  <main>
    ${body}
  </main>
</body>
</html>
`;
}

const cases = [
  {
    id: 'IMG-ALT-RELEVANCE',
    name: 'Image alternative-text relevance',
    violation: page('Checkout', `
      <h1>Place your order</h1>
      <form aria-label="Order checkout">
        <button type="submit">
          <img src="place-order.svg" alt="Company logo">
        </button>
      </form>`),
    noViolation: page('Decorative flourish', `
      <h1>Welcome</h1>
      <img src="flourish.svg" alt="" role="presentation">`),
  },
  {
    id: 'IMG-ALT-CLARITY',
    name: 'Image alternative-text clarity',
    violation: page('Rainfall comparison', `
      <h1>Monthly rainfall in three cities</h1>
      <figure>
        <img src="rainfall-chart.svg" alt="Thing">
        <figcaption>
          A chart compares monthly rainfall across three cities.
        </figcaption>
      </figure>`),
    noViolation: page('Quarterly revenue', `
      <h1>Quarterly revenue</h1>
      <figure>
        <img src="revenue-chart.svg" alt="Quarterly revenue by region, 2024">
        <figcaption>Revenue by region for each quarter of 2024.</figcaption>
      </figure>`),
  },
  {
    id: 'IMG-ALT-REDUNDANCY',
    name: 'Unnecessary alternative-text wording',
    violation: page('Picture', `
      <figure>
        <img src="picture.svg" alt="Image, image of a picture">
        <figcaption>A picture of a red bicycle.</figcaption>
      </figure>`),
    noViolation: page('Process diagram', `
      <figure>
        <img src="process.svg" alt="Diagram: three steps from signup to approval">
        <figcaption>The diagram shows the account approval process.</figcaption>
      </figure>`),
  },
  {
    id: 'BUTTON-PURPOSE-CLARITY',
    name: 'Button purpose clarity',
    violation: page('Draft settings', `
      <h1>Draft settings</h1>
      <p>This action permanently deletes the current draft.</p>
      <button type="button">Thing</button>`),
    noViolation: page('Edit settings', `
      <h1>Edit settings</h1>
      <p>Save the changes made to your account settings.</p>
      <button type="submit">Save changes</button>`),
  },
  {
    id: 'BUTTON-NAME-AMBIGUITY',
    name: 'Ambiguous button names',
    violation: page('Publish options', `
      <h1>Publish options</h1>
      <fieldset>
        <legend>Choose what happens to this document</legend>
        <label><input type="radio" name="publish" value="draft"> Save as draft</label>
        <label><input type="radio" name="publish" value="publish"> Publish now</label>
      </fieldset>
      <button type="button">Continue</button>`),
    noViolation: page('Invoices', `
      <h1>Invoices</h1>
      <section aria-labelledby="invoice-4821">
        <h2 id="invoice-4821">Invoice 4821</h2>
        <button type="button" aria-label="Delete invoice 4821">Delete</button>
      </section>
      <section aria-labelledby="invoice-7350">
        <h2 id="invoice-7350">Invoice 7350</h2>
        <button type="button" aria-label="Delete invoice 7350">Delete</button>
      </section>`),
  },
  {
    id: 'BUTTON-ACTION-CONSISTENCY',
    name: 'Button action-name consistency',
    violation: page('Order confirmation', `
      <h1>Confirm order</h1>
      <p>Activating the following action permanently places your order.</p>
      <button type="button">Cancel order</button>`),
    noViolation: page('Profile drafts', `
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
      </section>`),
  },
  {
    id: 'LINK-PURPOSE-CLARITY',
    name: 'Link purpose clarity',
    violation: page('Account actions', `
      <h1>Account actions</h1>
      <p>Choose an action for your account.</p>
      <a href="/account/delete">Click here</a>`),
    noViolation: page('Invoice download', `
      <h1>Invoice 4821</h1>
      <p>Download the accessible invoice as a PDF.</p>
      <a href="/invoices/4821/accessible.pdf">Download the accessible invoice (PDF)</a>`),
  },
  {
    id: 'LINK-GENERIC-TEXT',
    name: 'Generic link text',
    violation: page('Articles', `
      <h1>Articles</h1>
      <h2>Passport renewal</h2>
      <h2>Applying for a visa</h2>
      <ul>
        <li><a href="/passport">Read more</a></li>
        <li><a href="/visa">Read more</a></li>
      </ul>`),
    noViolation: page('Passport guide', `
      <h1>Passport services</h1>
      <h2 id="renewal">How to renew your passport</h2>
      <a href="/passport/renew" aria-labelledby="renewal">Read more</a>`),
  },
  {
    id: 'LINK-SIMILAR-CHOICES',
    name: 'Similar-looking links with unclear purposes',
    violation: page('Account choices', `
      <h1>Choose an account action</h1>
      <nav aria-label="Account actions">
        <a style="display:inline-block;padding:1rem;border:1px solid" href="/delete">Open</a>
        <a style="display:inline-block;padding:1rem;border:1px solid" href="/suspend">Open</a>
      </nav>`),
    noViolation: page('Account choices', `
      <h1>Choose an account action</h1>
      <nav aria-label="Account actions">
        <a href="/delete">Delete account</a>
        <a href="/suspend">Temporarily suspend account</a>
      </nav>`),
  },
  {
    id: 'FORM-LABEL-RELEVANCE',
    name: 'Form label relevance',
    violation: page('Contact details', `
      <h1>Contact details</h1>
      <form>
        <label for="contact-email">Favorite color</label>
        <input id="contact-email" name="email" type="email">
      </form>`),
    noViolation: page('Contact details', `
      <h1>Contact details</h1>
      <form>
        <label for="contact-email">Email address</label>
        <input id="contact-email" name="email" type="email">
      </form>`),
  },
  {
    id: 'FORM-LABEL-AMBIGUITY',
    name: 'Ambiguous form labels',
    violation: page('Personal information', `
      <h1>Personal and invoice information</h1>
      <form>
        <label for="birth-date">Date</label>
        <input id="birth-date" name="birth-date" type="date">
        <label for="invoice-date">Date</label>
        <input id="invoice-date" name="invoice-date" type="date">
      </form>`),
    noViolation: page('Personal information', `
      <h1>Personal information</h1>
      <form>
        <fieldset>
          <legend>Date of birth</legend>
          <label for="birth-date">Date</label>
          <input id="birth-date" name="birth-date" type="date">
        </fieldset>
      </form>`),
  },
  {
    id: 'FORM-PLACEHOLDER-ONLY',
    name: 'Placeholder-only guidance',
    violation: page('Sign in', `
      <h1>Sign in</h1>
      <form>
        <input id="email" name="email" type="email" placeholder="Email">
      </form>`),
    noViolation: page('Sign in', `
      <h1>Sign in</h1>
      <form>
        <label for="email">Email address</label>
        <input id="email" name="email" type="email" placeholder="name@example.com">
      </form>`),
  },
  {
    id: 'ARIA-NAME-CLARITY',
    name: 'Accessible-name clarity',
    violation: page('Draft actions', `
      <h1>Draft actions</h1>
      <p>The action below deletes the current draft.</p>
      <div role="button" tabindex="0" aria-label="Thing"></div>`),
    noViolation: page('Notification settings', `
      <h1>Notification settings</h1>
      <p>Control whether email notifications are sent.</p>
      <div role="switch" tabindex="0" aria-checked="true" aria-label="Email notifications"></div>`),
  },
  {
    id: 'ARIA-NAMING-CONSISTENCY',
    name: 'Naming consistency',
    violation: page('Saved items', `
      <h1>Saved items</h1>
      <p>Both controls remove the same saved item from this collection.</p>
      <button type="button" aria-label="Remove saved item">Remove</button>
      <button type="button" aria-label="Remove saved item">Cancel</button>`),
    noViolation: page('Shopping lists', `
      <h1>Shopping lists</h1>
      <section>
        <h2>Cart</h2>
        <p>Remove this product from the cart.</p>
        <button type="button" aria-label="Remove product from cart">Remove</button>
      </section>
      <section>
        <h2>Wishlist</h2>
        <p>Remove this product from the wishlist.</p>
        <button type="button" aria-label="Remove product from wishlist">Remove</button>
      </section>`),
  },
  {
    id: 'ARIA-NAME-CONFLICT',
    name: 'Conflicting naming information',
    violation: page('Payment', `
      <h1>Payment</h1>
      <button type="button" aria-label="Delete account">Pay now</button>`),
    noViolation: page('Site search', `
      <h1>Site search</h1>
      <button type="button" aria-label="Search site">Search</button>`),
  },
  {
    id: 'HEADING-CLARITY',
    name: 'Heading clarity',
    violation: page('Procedures', `
      <h1>Procedures</h1>
      <h2>Other</h2>
      <ul>
        <li>Renew a passport</li>
        <li>Request a tax transcript</li>
        <li>Replace a health card</li>
      </ul>`),
    noViolation: page('Payment options', `
      <h1>Payment options</h1>
      <h2>Payment methods</h2>
      <ul>
        <li>Credit and debit cards</li>
        <li>Bank transfer</li>
        <li>Digital wallet</li>
      </ul>`),
  },
  {
    id: 'HEADING-CONTENT-RELEVANCE',
    name: 'Heading relevance to surrounding content',
    violation: page('Policies', `
      <h1>Policies</h1>
      <section>
        <h2>Refund policy</h2>
        <p>Use a unique password and enable two-factor authentication.</p>
        <p>Review recent account activity for unfamiliar sign-ins.</p>
      </section>`),
    noViolation: page('Policies', `
      <h1>Policies</h1>
      <section>
        <h2>Refund policy</h2>
        <p>Check whether your purchase is eligible for a refund.</p>
        <p>Submit a refund request and allow five business days for review.</p>
      </section>`),
  },
  {
    id: 'CONTENT-INSTRUCTION-AMBIGUITY',
    name: 'Ambiguous instructions',
    violation: page('Choose an option', `
      <h1>Choose an option</h1>
      <p>Select the correct one.</p>
      <label><input type="radio" name="plan" value="basic"> Basic</label>
      <label><input type="radio" name="plan" value="premium"> Premium</label>`),
    noViolation: page('Verification code', `
      <h1>Verification code</h1>
      <p>Enter the six-digit code sent to your email.</p>
      <label for="code">Six-digit verification code</label>
      <input id="code" name="code" inputmode="numeric" autocomplete="one-time-code">`),
  },
  {
    id: 'CONTENT-ERROR-CLARITY',
    name: 'Unclear error messages',
    violation: page('Email address', `
      <h1>Email address</h1>
      <form>
        <label for="email">Email address</label>
        <input id="email" name="email" type="email" value="alice@" aria-invalid="true" aria-describedby="email-error">
        <p id="email-error" role="alert">Invalid.</p>
      </form>`),
    noViolation: page('Postal code', `
      <h1>Postal code</h1>
      <form>
        <label for="postal-code">Postal code</label>
        <input id="postal-code" name="postal-code" required aria-invalid="true" aria-describedby="postal-error">
        <p id="postal-error" role="alert">Enter a postal code.</p>
      </form>`),
  },
  {
    id: 'CONTENT-TERM-CONSISTENCY',
    name: 'Inconsistent terminology',
    violation: page('Saved items', `
      <h1>Saved items</h1>
      <p>Your saved items are called Bookmarks in this section.</p>
      <nav aria-label="Saved item sections">
        <a href="/saved">Saved items</a>
        <a href="/bookmarks">Bookmarks</a>
      </nav>`),
    noViolation: page('Shopping lists', `
      <h1>Shopping lists</h1>
      <section>
        <h2>Cart</h2>
        <p>Products you intend to purchase.</p>
        <a href="/cart">View cart</a>
      </section>
      <section>
        <h2>Wishlist</h2>
        <p>Products you saved for later.</p>
        <a href="/wishlist">View wishlist</a>
      </section>`),
  },
];

const combinedCases = [
  {
    id: 'multi-01',
    title: 'Form labels, buttons, and headings',
    body: `
      <h1>Account settings</h1>
      <h2>Other</h2>
      <form>
        <label for="email">Favorite color</label>
        <input id="email" type="email">
        <button type="button">Thing</button>
      </form>`,
  },
  {
    id: 'multi-02',
    title: 'Ambiguous links and unclear instructions',
    body: `
      <h1>Choose a service</h1>
      <p>Select the correct one.</p>
      <a href="/renew">Click here</a>
      <a href="/replace">Click here</a>
      <label><input type="radio" name="service" value="renew"> Renew</label>
      <label><input type="radio" name="service" value="replace"> Replace</label>`,
  },
  {
    id: 'multi-03',
    title: 'Image descriptions and form guidance',
    body: `
      <h1>Monthly report</h1>
      <figure>
        <img src="report-chart.svg" alt="Thing">
        <figcaption>A chart compares monthly totals across three regions.</figcaption>
      </figure>
      <form>
        <label for="month">Favorite color</label>
        <input id="month" type="month" placeholder="Month">
      </form>`,
  },
  {
    id: 'multi-04',
    title: 'Conflicting names and error guidance',
    body: `
      <h1>Payment details</h1>
      <button type="button" aria-label="Delete account">Pay now</button>
      <form>
        <label for="email">Email address</label>
        <input id="email" type="email" value="alice@" aria-invalid="true" aria-describedby="email-error">
        <p id="email-error" role="alert">Invalid.</p>
      </form>`,
  },
  {
    id: 'multi-05',
    title: 'Action wording and heading relevance',
    body: `
      <h1>Order management</h1>
      <section>
        <h2>Refund policy</h2>
        <p>Enable two-factor authentication and review account sign-ins.</p>
      </section>
      <p>Activating this button permanently places the order.</p>
      <button type="button">Cancel order</button>`,
  },
];

await mkdir(outputDirectory, { recursive: true });

for (const [index, item] of cases.entries()) {
  const prefix = String(index + 1).padStart(2, '0');
  const slug = item.id.toLowerCase();
  await writeFile(
    join(outputDirectory, `${prefix}-${slug}-violation.html`),
    item.violation,
    'utf8',
  );
  await writeFile(
    join(outputDirectory, `${prefix}-${slug}-no-violation.html`),
    item.noViolation,
    'utf8',
  );
}

for (const item of combinedCases) {
  await writeFile(
    join(outputDirectory, `${item.id}-multiple-candidates.html`),
    page(item.title, item.body),
    'utf8',
  );
}

const rulesManifest = cases
  .map(
    (item, index) =>
      `${String(index + 1).padStart(2, '0')}. \`${item.id}\` — ${item.name}: ` +
      `\`${String(index + 1).padStart(2, '0')}-${item.id.toLowerCase()}-violation.html\` ` +
      `(violation candidate) and \`${String(index + 1).padStart(2, '0')}-${item.id.toLowerCase()}-no-violation.html\` (no-violation candidate).`,
  )
  .join('\n');

const combinedManifest = combinedCases
  .map((item) => `- \`${item.id}-multiple-candidates.html\` — ${item.title}.`)
  .join('\n');

const readme = `# Accessibility known-case HTML fixtures

This folder contains 40 paired single-rule HTML cases (one violation candidate
and one no-violation candidate for each proposed rule), plus five pages with
multiple candidate issues.

## Important limits

- The 20 rules and these expected case labels come from
  [the contextual rule specification](../../docs/contextual-accessibility-rules.md).
  They are evaluation stimuli, not proof that an uploaded page violates WCAG.
- The live contextual assessment path currently implements only
  \`BUTTON-PURPOSE-CLARITY\`, \`FORM-LABEL-RELEVANCE\`, and \`ARIA-NAME-CLARITY\`.
  The other 17 proposed rules are not dispatched by the current application.
- Some rules require evidence static HTML cannot provide, such as computed
  accessible names, rendered visibility across states, verified handlers,
  actual image pixels, complete project coverage, and validated destinations.
  Those cases are labeled candidates; evaluate them with the additional
  evidence described by the rule specification. Static markup alone may
  correctly result in insufficient context.
- The files contain no embedded expected answers, to avoid leaking labels into
  the model prompt. Use the filenames and this manifest to track the intended
  case. Each page is standalone and can be uploaded individually.
- These are not integrated into an automated test runner. No AI provider calls
  or changes to the live-server opt-in were made when generating them.

## Paired cases

${rulesManifest}

## Multiple-candidate cases

${combinedManifest}
`;

await writeFile(join(outputDirectory, 'README.md'), readme, 'utf8');
console.log(`Created ${cases.length * 2 + combinedCases.length} HTML fixtures in ${outputDirectory}`);
