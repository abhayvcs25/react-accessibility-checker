import React from 'react';

interface HeaderProps {
  cartCount: number;
  onOpenCart: () => void;
}

export const Header: React.FC<HeaderProps> = ({ cartCount, onOpenCart }) => {
  return (
    <header className="site-header">
      <div className="site-brand">
        <a href="/" className="logo-text">
          AURA GOODS
        </a>
      </div>

      <nav className="site-nav">
        <ul>
          <li><a href="/catalog">All Products</a></li>
          <li><a href="/about">About Us</a></li>
          <li><a href="/contact">Support</a></li>
        </ul>
      </nav>

      <div className="header-actions">
        <button type="button" className="cart-trigger-btn" onClick={onOpenCart}>
          Cart ({cartCount})
        </button>
      </div>
    </header>
  );
};

