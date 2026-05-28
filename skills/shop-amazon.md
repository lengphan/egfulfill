---
name: shop-amazon
description: Browse and purchase items on Amazon.ca via Chrome DevTools MCP. Use when the user asks to find, compare, or buy products on Amazon.
scripts: []
---

# Amazon Shopping via Chrome DevTools

## Goal
Search, browse, and purchase products on Amazon.ca using the Chrome DevTools MCP server. The agent drives a real Chrome browser to navigate Amazon, find products, add them to cart, and complete checkout — with explicit user approval before any purchase.

## CRITICAL RULES

1. **NEVER place an order without explicit user approval.** Always stop before clicking "Place your order" and confirm with the user. No exceptions.
2. **NEVER store or log payment information, passwords, or personal details.**
3. **NEVER auto-fill payment methods or shipping addresses** — let Amazon's saved defaults handle this.
4. **Always show the user what you're about to buy** (product name, price, quantity) before adding to cart.
5. **Always show the order total** (including tax/shipping) before final purchase confirmation.

## Inputs
- **Search query**: What the user wants to buy (e.g., "RG6 coax cable 6ft")
- **Preferences**: Any filters like price range, brand, Prime-only, ratings, etc.
- **Quantity**: How many to order (default: 1)

## Tools
- **Chrome DevTools MCP** (`mcp__chrome-devtools__*`): All browser interaction
  - `new_page` / `list_pages`: Open/manage browser tabs
  - `navigate`: Go to a URL
  - `screenshot`: See current page state
  - `click` / `type` / `execute_javascript`: Interact with page elements
  - `get_page_content`: Read page text/structure

## Process

### 1. Start Chrome / Connect to Existing Session

Check if Chrome is already running:
```
mcp__chrome-devtools__list_pages
```

If it errors with "browser is already running", kill stale processes first:
```bash
pkill -f "chrome-devtools-mcp" || true
pkill -f "Google Chrome.*chrome-devtools-mcp" || true
sleep 1
```

Then open Amazon:
```
mcp__chrome-devtools__new_page → url: "https://www.amazon.ca"
```

### 2. Verify Login Status

Take a screenshot to check if the user is logged in:
```
mcp__chrome-devtools__screenshot
```

Look for "Hello, [Name]" in the top nav. If not logged in:
- Navigate to the sign-in page: `https://www.amazon.ca/ap/signin`
- **Tell the user to log in manually** — never type credentials yourself
- Wait for user confirmation that they're signed in
- Take another screenshot to verify

### 3. Search for Products

Navigate to search or use the search bar:
```
mcp__chrome-devtools__navigate → url: "https://www.amazon.ca/s?k=<search+terms>"
```

Take a screenshot to see results. Present the top options to the user with:
- Product name
- Price
- Rating and review count
- Prime eligibility
- Delivery estimate

Ask the user which product they want, or if they want to refine the search.

### 4. View Product Details

Click into the selected product. Take a screenshot. Confirm with the user:
- Correct product
- Correct size/color/variant
- Price
- Quantity

### 5. Add to Cart

Only after user confirms the product:
```
Click "Add to cart" button
```

Take a screenshot to confirm it was added. Show the user the cart summary.

### 6. Proceed to Checkout

Navigate to cart: `https://www.amazon.ca/gp/cart/view.html`

Take a screenshot. Show the user:
- All items in cart
- Quantities
- Subtotal
- Shipping address (confirm it's correct)
- Delivery estimates

### 7. STOP — Get Purchase Approval

**This is mandatory. Do not skip this step.**

Show the user the complete order summary:
- Items and quantities
- Subtotal
- Shipping cost
- Tax
- **Order total**
- Delivery date

Ask: "Should I place this order for $X.XX total?"

**Only proceed if the user explicitly says yes.**

### 8. Place Order

Click "Place your order" only after explicit approval. Take a screenshot of the order confirmation. Share the order number with the user.

## Outputs (Deliverables)
- **Order confirmation**: Order number and expected delivery date reported to user
- **No local files are created** — this is a browser-only workflow

## Edge Cases

- **Item out of stock**: Inform the user, suggest alternatives or "Notify when available"
- **Price changed since discussion**: Alert the user to the new price before proceeding
- **Multiple sellers**: Default to Amazon-fulfilled/shipped. Flag third-party sellers to user
- **Cart already has items**: Show existing cart contents to user before adding new items — don't clear their cart without asking
- **Shipping address prompt**: If Amazon asks to select an address, take a screenshot and let the user choose — don't select for them
- **CAPTCHA or verification**: Take a screenshot, ask user to solve it manually
- **Session expired mid-flow**: Ask user to log in again, restart from step 2

## Error Handling

- **Chrome not responding**: Kill processes (`pkill -f chrome-devtools-mcp`), restart, re-navigate
- **Page not loading**: Wait 3 seconds, retry navigation once. If still failing, inform user
- **Element not found (button, field)**: Take a screenshot to assess page state. Try scrolling down. If still not found, ask user for guidance
- **MCP connection error**: Restart the MCP server, reconnect

## Notes

- Amazon.ca is the target site (user is in Calgary, Canada)
- User has Prime (look for Prime delivery options)
- The user's Chrome profile at `~/.cache/chrome-devtools-mcp/chrome-profile` may retain login sessions between uses
- Always prefer screenshot-driven navigation — take a screenshot after every major action to verify state
- This workflow uses NO execution scripts — it's entirely browser-driven via MCP
- When comparing products for the user, focus on: price per unit, review count + rating, Prime eligibility, and delivery speed
