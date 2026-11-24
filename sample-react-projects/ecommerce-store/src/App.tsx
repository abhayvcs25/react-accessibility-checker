import React, { useState } from 'react';
import type { CartItem, Product } from './types.js';
import { Header } from './components/Header.js';
import { ProductList } from './components/ProductList.js';
import { CartDrawer } from './components/CartDrawer.js';
import { CheckoutForm } from './components/CheckoutForm.js';

const INITIAL_PRODUCTS: Product[] = [
  {
    id: 'prod-1',
    name: 'Trail Cruiser Leather Boot',
    price: 185.0,
    category: 'Footwear',
    image: '/images/leather-boot.jpg',
    // Violation: IMG-ALT-RELEVANCE - Alt describes something completely irrelevant
    altText: 'blue circle graphic',
    description: 'Full-grain waterproof leather boot built for rugged hiking trails.',
  },
  {
    id: 'prod-2',
    name: 'Field Minimalist Chronograph',
    price: 240.0,
    category: 'Accessories',
    image: '/images/watch.jpg',
    // Violation: IMG-ALT-CLARITY - Raw filename instead of descriptive alt
    altText: 'IMG_2026_09_12_FINAL_EDIT_v2.png',
    description: 'Stainless steel case with sapphire crystal and quick-release strap.',
  },
  {
    id: 'prod-3',
    name: 'Wireless Noise-Canceling Headphones',
    price: 320.0,
    category: 'Electronics',
    image: '/images/headphones.jpg',
    // Violation: IMG-ALT-REDUNDANCY - Exact duplicate of the adjacent h3 heading
    altText: 'Wireless Noise-Canceling Headphones',
    description: 'Adaptive active noise cancellation with 38-hour battery longevity.',
  },
];

export const App: React.FC = () => {
  const [products] = useState<Product[]>(INITIAL_PRODUCTS);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isCheckoutView, setIsCheckoutView] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  const handleAddToCart = (product: Product) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item,
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
    setNotification(`Added ${product.name} to cart.`);
  };

  const handleQuickView = (product: Product) => {
    alert(`Quick View: ${product.name}`);
  };

  return (
    <div className="store-app">
      <Header
        cartCount={cart.reduce((sum, i) => sum + i.quantity, 0)}
        onOpenCart={() => setIsCartOpen(true)}
      />

      {notification && <div className="toast-notification">{notification}</div>}

      <main className="main-content">
        {isCheckoutView ? (
          <CheckoutForm
            onBackToCart={() => {
              setIsCheckoutView(false);
              setIsCartOpen(true);
            }}
            onSubmitOrder={() => {
              alert('Order placed successfully!');
              setCart([]);
              setIsCheckoutView(false);
            }}
          />
        ) : (
          <ProductList
            products={products}
            onAddToCart={handleAddToCart}
            onQuickView={handleQuickView}
          />
        )}
      </main>

      <CartDrawer
        isOpen={isCartOpen}
        items={cart}
        onClose={() => setIsCartOpen(false)}
        onProceedToCheckout={() => {
          setIsCartOpen(false);
          setIsCheckoutView(true);
        }}
      />
    </div>
  );
};

export default App;

