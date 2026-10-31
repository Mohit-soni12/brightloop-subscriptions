# Brightloop Software — Unified Subscription Management System

A high-performance, unified subscription, recurring billing, and revenue management platform built specifically to address the business operations of **Brightloop Software**.

---

## 🚀 Key Features Implemented

### 1. Multi-Role RBAC & Secure Auth
- **Admin**: Full system control — manage plans, tax brackets, discount rules, and staff accounts.
- **Internal Staff / Sales Reps**: Day-to-day operations — quotation drafting, subscription progression, invoice generation, payment recording, and collection chasing. (Strictly prohibited from adding staff or modifying global policies).
- **Customer Self-Service Portal**: Customers log in to view active subscriptions, check upcoming renewals, view/print invoices, and request pauses or renewals without emailing support.
- **Password & Account Policy**: Strong password requirements (`>8` characters, uppercase, lowercase, special character), unique email enforcement, and tokenized password reset.

### 2. Products, Variants & Pricing Engine
- **Catalog Management**: Base products with cost price, sales price, and notes.
- **Variant Price Modifiers**: Fully supported (e.g., selecting the **Odoo Brand Edition** adds `+$560` to base software price).

### 3. Plans & Recurrence Policies
- **Billing Frequencies**: Daily, Weekly, Monthly, and Yearly.
- **Lifecycle Policies**: Configurable per plan (`auto_close_on_end`, `can_pause`, `can_renew`, `can_close_early`).

### 4. Quotations & Subscription State Machine
- Seamless progression across finite states:
  $$\text{Draft} \longrightarrow \text{Quotation} \longrightarrow \text{Confirmed} \longrightarrow \text{Active} \longrightarrow [\text{Paused}] \longrightarrow \text{Closed}$$
- Quotation templates with pre-configured products, variants, and validity periods.

### 5. Automated Billing Day Engine
- One-click or scheduled recurring invoice generation for all subscriptions due today.
- Automatic tax computation based on admin rules (e.g. 18% VAT/GST).
- **Zero Double-Billing Guarantee**: Database uniqueness constraints and idempotency checks prevent duplicate invoices for the same cycle.
- Invoice lifecycle: `Draft` $\to$ `Confirmed` $\to$ `Paid` (or `Cancelled`).
- Printable, branded invoice views with export/print capability.

### 6. Admin Discount Engine
- Fixed dollar amounts or percentage discounts.
- Constraints: minimum seat quantity, minimum purchase spend, effective date windows, and usage caps (e.g. first 50 customers).
- Automatically applies to recurring billing invoices and auto-expires when exhausted.

### 7. Multi-Method Payments & Aging Chase List
- Record payments across methods: Bank Transfer, Credit Card, Cash, Online.
- Full and partial settlement reconciliation.
- Dedicated **Overdue Invoices Chase List** for the finance team with aging calculation.

### 8. Executive Finance Dashboard (< 2s SLA)
- Real-time KPIs: Active Subscriptions, Total Revenue Cleared, Outstanding Receivables, and Overdue Balances.
- Optimized SQLite queries and indexes guaranteeing sub-second response times under heavy loads.

---

## 🏃 Running the Application

### 1. Run the Server
From the project folder:
```bash
node server.js
```
The server will start at `http://localhost:3000`. Open this in any web browser.

### 2. Run Automated Test Suite
To verify all business rules, password policies, idempotency, variants, and performance SLA:
```bash
npm test
```

### 3. Pre-Seeded Personas for Testing
The application includes a persona switcher in the top bar:
- **Admin**: `admin@brightloop.com` (Alex Vance)
- **Sales Staff**: `staff@brightloop.com` (Sarah Jenkins)
- **Finance Lead**: `finance@brightloop.com` (David Miller)
- **Customer (Enterprise)**: `elena@globaltech.com` (Elena Rostova - GlobalTech)
- **Customer (Small Shop)**: `john@acme.com` (John Doe - Acme)
