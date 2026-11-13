export function ShoppingListsNaming() {
  return (
    <main>
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
      </section>
    </main>
  );
}