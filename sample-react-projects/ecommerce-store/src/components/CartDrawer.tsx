import React, { useState } from 'react';
import type { CartItem } from '../types.js';

interface CartDrawerProps {
  isOpen: boolean;
  items: CartItem[];
  onClose: () => void;
  onProceedToCheckout: () => void;
}

/**
 * CartDrawer component with intentional accessibility violations:
 * - BUTTON-ACTION-CONSISTENCY: Multiple buttons with identical text "Cancel" perform completely different actions
 *   (one dismisses the entire drawer, another clears an optional coupon code in a child section).
 */
export const CartDrawer: React.FC<CartDrawerProps> = ({
  isOpen,
  items,
  onClose,
  onProceedToCheckout,
}) => {
  const [couponCode, setCouponCode] = useState<string>('SPRING20');
  const [discountApplied, setDiscountApplied] = useState<boolean>(true);

  if (!isOpen) return null;

  const total = items.reduce((sum, i) => sum + i.product.price * i.quantity, 0);

  const handleClearDiscount = () => {
    setCouponCode('');
    setDiscountApplied(false);
  };

  return (
    <aside className="cart-drawer-overlay">
      <div className="cart-drawer" role="dialog" aria-modal="true">
        <div className="cart-header">
          <h2>Your Cart ({items.length})</h2>
          {/* Action 1: "Cancel" button that closes the cart drawer */}
          <button type="button" className="close-btn" onClick={onClose}>
            Cancel
          </button>
        </div>

        <div className="cart-items-list">
          {items.length === 0 ? (
            <p>Your shopping basket is empty.</p>
          ) : (
            <ul>
              {items.map(({ product, quantity }) => (
                <li key={product.id} className="cart-item-row">
                  <span>{product.name} (x{quantity})</span>
                  <span>${(product.price * quantity).toFixed(2)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="discount-section">
          <h4>Promo Code</h4>
          <div className="promo-input-group">
            <input
              type="text"
              value={couponCode}
              onChange={(e) => setCouponCode(e.target.value)}
              placeholder="Enter coupon"
            />
            {/* Action 2: BUTTON-ACTION-CONSISTENCY - Identical text "Cancel" but resets coupon, does NOT close drawer */}
            <button
              type="button"
              className="btn-outline"
              onClick={handleClearDiscount}
            >
              Cancel
            </button>
          </div>
          {discountApplied && <span className="discount-badge">20% Discount Active</span>}
        </div>

        <div className="cart-footer">
          <p className="cart-total">Total: ${total.toFixed(2)}</p>
          <button
            type="button"
            className="btn-checkout"
            onClick={onProceedToCheckout}
            disabled={items.length === 0}
          >
            Proceed to Checkout
          </button>
        </div>
      </div>
    </aside>
  );
};

