import React, { useState } from 'react';

interface CheckoutFormProps {
  onBackToCart: () => void;
  onSubmitOrder: () => void;
}

/**
 * CheckoutForm component with intentional accessibility violations:
 * - FORM-PLACEHOLDER-ONLY: Crucial inputs (street address, apt number) rely only on placeholder without <label>.
 * - FORM-LABEL-AMBIGUITY: Multiple inputs labeled with the exact same text ("Address") without distinction.
 * - FORM-LABEL-RELEVANCE: Uninformative/irrelevant label text ("Information" for CVV / security code).
 */
export const CheckoutForm: React.FC<CheckoutFormProps> = ({ onBackToCart, onSubmitOrder }) => {
  const [formData, setFormData] = useState({
    shippingAddress: '',
    billingAddress: '',
    apartment: '',
    cardholder: '',
    cardNumber: '',
    cvv: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmitOrder();
  };

  return (
    <section className="checkout-panel">
      <h2>Complete Your Purchase</h2>

      <form onSubmit={handleSubmit} className="checkout-form">
        <fieldset>
          <legend>Delivery Details</legend>

          {/* Violation: FORM-LABEL-AMBIGUITY - First input with generic label "Address" */}
          <div className="form-group">
            <label htmlFor="shipping-address-input">Address</label>
            <input
              type="text"
              id="shipping-address-input"
              name="shippingAddress"
              value={formData.shippingAddress}
              onChange={handleChange}
            />
          </div>

          {/* Violation: FORM-LABEL-AMBIGUITY - Second input in same form ALSO labeled "Address" */}
          <div className="form-group">
            <label htmlFor="billing-address-input">Address</label>
            <input
              type="text"
              id="billing-address-input"
              name="billingAddress"
              value={formData.billingAddress}
              onChange={handleChange}
            />
          </div>

          {/* Violation: FORM-PLACEHOLDER-ONLY - No <label> element or aria-label, only placeholder */}
          <div className="form-group">
            <input
              type="text"
              id="apartment-suite"
              name="apartment"
              placeholder="Apartment, suite, unit (optional)"
              value={formData.apartment}
              onChange={handleChange}
            />
          </div>
        </fieldset>

        <fieldset>
          <legend>Payment Information</legend>

          <div className="form-group">
            <label htmlFor="cardholder-name">Cardholder Full Name</label>
            <input
              type="text"
              id="cardholder-name"
              name="cardholder"
              value={formData.cardholder}
              onChange={handleChange}
            />
          </div>

          <div className="form-group">
            <label htmlFor="card-number">Card Number</label>
            <input
              type="text"
              id="card-number"
              name="cardNumber"
              value={formData.cardNumber}
              onChange={handleChange}
            />
          </div>

          {/* Violation: FORM-LABEL-RELEVANCE - Label says "Information" which has no semantic connection to CVV/security code */}
          <div className="form-group">
            <label htmlFor="security-code">Information</label>
            <input
              type="text"
              id="security-code"
              name="cvv"
              maxLength={4}
              value={formData.cvv}
              onChange={handleChange}
            />
          </div>
        </fieldset>

        <div className="form-buttons">
          <button type="button" className="btn-secondary" onClick={onBackToCart}>
            Back
          </button>
          <button type="submit" className="btn-primary">
            Place Order
          </button>
        </div>
      </form>
    </section>
  );
};

