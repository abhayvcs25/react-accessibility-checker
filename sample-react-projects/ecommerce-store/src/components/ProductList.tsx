import React, { useState } from 'react';
import type { Product } from '../types.js';
import { ProductCard } from './ProductCard.js';

interface ProductListProps {
  products: Product[];
  onAddToCart: (p: Product) => void;
  onQuickView: (p: Product) => void;
}

/**
 * ProductList component with intentional accessibility violations:
 * - BUTTON-PURPOSE-CLARITY: Icon-only buttons with no text and no aria-label.
 * - LINK-GENERIC-TEXT: Links with text "click here", "read more", "learn more".
 * - LINK-PURPOSE-CLARITY: Non-descriptive destination links like "Go".
 */
export const ProductList: React.FC<ProductListProps> = ({ products, onAddToCart, onQuickView }) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  return (
    <section className="product-catalog-section">
      <div className="catalog-toolbar">
        <h2>Seasonal Collection</h2>

        <div className="toolbar-controls">
          {/* Violation: BUTTON-PURPOSE-CLARITY - Icon-only button with no accessible name or text */}
          <button type="button" className="toolbar-icon-btn" onClick={() => setSelectedCategory('grid')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
            </svg>
          </button>

          {/* Violation: BUTTON-PURPOSE-CLARITY - Filter button has an icon with no text or aria-label */}
          <button type="button" className="toolbar-icon-btn" onClick={() => setSelectedCategory('filter')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
          </button>
        </div>
      </div>

      <div className="promo-banner">
        <p>Spring discount up to 40% off across select styles!</p>
        {/* Violation: LINK-GENERIC-TEXT - "click here" fails WCAG link purpose criteria */}
        <a href="/seasonal-discounts" className="promo-link">
          click here
        </a>
        <span> for full details or </span>
        {/* Violation: LINK-GENERIC-TEXT - "read more" */}
        <a href="/warranty-policy" className="promo-link">
          read more
        </a>
        <span> about our guarantee.</span>
      </div>

      <div className="quick-links-strip">
        <span>Browse deals:</span>
        {/* Violation: LINK-PURPOSE-CLARITY - "Go" provides no indication of target page */}
        <a href="/flash-sale" className="tag-link">
          Go
        </a>
      </div>

      <div className="product-grid">
        {products.map((p) => (
          <ProductCard
            key={p.id}
            product={p}
            onAddToCart={onAddToCart}
            onQuickView={onQuickView}
          />
        ))}
      </div>
    </section>
  );
};

