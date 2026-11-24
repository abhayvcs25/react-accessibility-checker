import React from 'react';
import type { Product } from '../types.js';

interface ProductCardProps {
  product: Product;
  onAddToCart: (p: Product) => void;
  onQuickView: (p: Product) => void;
}

/**
 * ProductCard component with intentional accessibility violations:
 * - IMG-ALT-RELEVANCE: Image alt contains irrelevant descriptions (e.g. "blue circle graphic" for a shoe).
 * - IMG-ALT-CLARITY: Image alt contains raw file names (e.g. "IMG_2026_09_12_FINAL_EDIT_v2.png").
 * - IMG-ALT-REDUNDANCY: Image alt repeats the exact product title right above/below it.
 * - BUTTON-NAME-AMBIGUITY: Generic "Buy" and "Quick View" buttons repeated for multiple cards without product context.
 */
export const ProductCard: React.FC<ProductCardProps> = ({ product, onAddToCart, onQuickView }) => {
  return (
    <article className="product-card">
      <div className="card-image-wrap">
        {/* Violation: IMG-ALT-RELEVANCE, IMG-ALT-CLARITY, or IMG-ALT-REDUNDANCY depending on product */}
        <img
          src={product.image}
          alt={product.altText}
          className="product-thumbnail"
        />
      </div>

      <div className="card-content">
        <span className="product-category">{product.category}</span>
        {/* The alt attribute often repeats this title word-for-word, triggering IMG-ALT-REDUNDANCY */}
        <h3 className="product-title">{product.name}</h3>
        <p className="product-price">${product.price.toFixed(2)}</p>
        <p className="product-desc">{product.description}</p>
      </div>

      <div className="card-actions">
        {/* Violation: BUTTON-NAME-AMBIGUITY - Multiple items share the exact same button text */}
        <button
          type="button"
          className="btn-secondary"
          onClick={() => onQuickView(product)}
        >
          Quick View
        </button>

        {/* Violation: BUTTON-NAME-AMBIGUITY - Ambiguous "Buy" without accessible name identifying the product */}
        <button
          type="button"
          className="btn-primary"
          onClick={() => onAddToCart(product)}
        >
          Buy
        </button>
      </div>
    </article>
  );
};

