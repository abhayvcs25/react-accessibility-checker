# Sample React Test Projects with Contextual Accessibility Violations

This directory contains two standalone, realistic React test projects created to validate and test the **React Accessibility Checker**:
1. Single-file React source analysis mode (`.jsx` / `.tsx` upload via `POST /api/analyze-source`).
2. Multi-file React project analysis and AST indexing.

---

## Projects Overview

| Project | Domain | Key Rule Violations Included |
| :--- | :--- | :--- |
| **`ecommerce-store`** | Online Store & Shopping Cart | `IMG-ALT-*`, `BUTTON-*`, `LINK-*`, `FORM-PLACEHOLDER-ONLY`, `FORM-LABEL-*` |
| **`analytics-dashboard`** | Admin Metrics & Settings Portal | `ARIA-NAME-*`, `HEADING-*`, `CONTENT-*`, `LINK-SIMILAR-CHOICES` |

---

## 1. `ecommerce-store/`
A modern React e-commerce application (TypeScript + JSX) with catalog browsing, shopping cart, and checkout flow.

### Intentional Rule Violations Mapped by File:
- **`src/components/ProductCard.tsx`**:
  - **`IMG-ALT-RELEVANCE`**: Product image has alt text `"geometric rectangle with pixels"` completely irrelevant to the actual leather shoe.
  - **`IMG-ALT-CLARITY`**: Product image has alt text `"IMG_2026_09_12_FINAL_EDIT_v2.png"` (raw filename).
  - **`IMG-ALT-REDUNDANCY`**: Product image has alt text `"Wireless Noise-Canceling Headphones"` directly adjacent to `<h3>Wireless Noise-Canceling Headphones</h3>`.
  - **`BUTTON-NAME-AMBIGUITY`**: Multiple product cards render identical `<button>Quick View</button>` and `<button>Buy</button>` with no distinguishing accessible name or aria-label.
- **`src/components/ProductList.tsx`**:
  - **`BUTTON-PURPOSE-CLARITY`**: Icon-only filter and sort buttons with no text and no `aria-label`: `<button><svg ... /></button>`.
  - **`LINK-GENERIC-TEXT`**: Category and promotion links labeled `"click here"`, `"learn more"`, and `"read more"`.
  - **`LINK-PURPOSE-CLARITY`**: Navigation links with vague destinations: `<a href="/deals/item">Go</a>`.
- **`src/components/CheckoutForm.tsx`**:
  - **`FORM-PLACEHOLDER-ONLY`**: Shipping address and postal code inputs lack `<label>`, relying solely on `placeholder="123 Main St"`.
  - **`FORM-LABEL-AMBIGUITY`**: Two different input fields in the same section both labeled `<label>Address</label>` without distinguishing billing vs shipping.
  - **`FORM-LABEL-RELEVANCE`**: Security code field labeled `<label>Information</label>`.
- **`src/components/CartDrawer.tsx`**:
  - **`BUTTON-ACTION-CONSISTENCY`**: Two buttons labeled `"Cancel"`: one closes the cart drawer without modifications, while another in the promo-code subpanel clears the active discount.

---

## 2. `analytics-dashboard/`
An enterprise analytics and administration workspace (TypeScript + JSX) with metrics cards, sidebar navigation, notification modals, and system settings.

### Intentional Rule Violations Mapped by File:
- **`src/components/Sidebar.tsx`**:
  - **`ARIA-NAME-CLARITY`**: Navigation toggles and items with cryptic internal labels like `aria-label="nav-item-4-collapsed"`.
  - **`ARIA-NAMING-CONSISTENCY`**: Gear settings icon in sidebar labeled `aria-label="System Tools"` while the identical gear icon in the header profile menu is labeled `aria-label="User Preferences"`.
  - **`LINK-SIMILAR-CHOICES`**: Multiple links with confusingly similar labels pointing to different destinations: `<a href="/reports/monthly">Monthly Summary Reports</a>` vs `<a href="/analytics/monthly">Monthly Reports Summary</a>`.
- **`src/components/NotificationModal.tsx`**:
  - **`ARIA-NAME-CONFLICT`**: Button with visible text `"Delete Workspace"` but `aria-label="Close dialog without saving"`.
  - **`CONTENT-INSTRUCTION-AMBIGUITY`**: User instruction relying purely on visual position and color: `"Click the circular red button on the bottom right to proceed."`.
- **`src/components/MetricCard.tsx`**:
  - **`HEADING-CLARITY`**: Heading tags with generic non-descriptive text: `<h2>Details</h2>` and `<h3>Section 2</h3>`.
  - **`HEADING-CONTENT-RELEVANCE`**: Heading titled `<h2>Active User Demographics</h2>` followed entirely by database query latency metrics.
- **`src/components/SettingsForm.tsx`**:
  - **`CONTENT-ERROR-CLARITY`**: Vague, non-actionable error messages: `<p className="error">Error occurred</p>` and `<span className="alert">Invalid value entered</span>`.
  - **`CONTENT-TERM-CONSISTENCY`**: Inconsistently calls the primary organizational unit `"Workspace"`, `"Project"`, `"Account"`, and `"Tenant"` across the same configuration page.

---

## How to Test with the Accessibility Checker

### Testing in Single-File Mode:
1. Open the React Accessibility Checker in your browser (`http://localhost:5173`).
2. Switch to **React Source (.jsx, .tsx)** mode.
3. Upload or choose any file from either project (e.g., `ecommerce-store/src/components/ProductCard.tsx` or `analytics-dashboard/src/components/NotificationModal.tsx`).
4. Click **Analyze**.
5. Observe the static AST extraction, the 20 contextual rules evaluation, and the exact source line locations in the advisory report.

