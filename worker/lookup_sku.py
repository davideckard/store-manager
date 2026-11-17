"""
Quick lookup: fetch a WooCommerce variation by SKU and print its blank metadata.

Usage:
    SITE_ID=<slug> python lookup_sku.py <SKU>
"""

import json
import sys
import os

# Ensure upload.py helpers are importable from the same directory
sys.path.insert(0, os.path.dirname(__file__))
import upload as u


def main():
    if len(sys.argv) < 2:
        print("Usage: SITE_ID=<slug> python lookup_sku.py <SKU>")
        sys.exit(1)

    sku = sys.argv[1].strip().upper()

    _, site = u.load_site_config()
    wcapi = u.get_wcapi(site)

    # Search for the variation directly by SKU
    results = u.fetch_paginated(wcapi, f"products/variations?sku={sku}")

    if not results:
        # WC variation search can be unreliable — fall back to parent product lookup
        parent_results = u.fetch_paginated(wcapi, f"products?sku={sku}")
        if parent_results:
            print(json.dumps(parent_results[0], indent=2))
            return
        print(f"No product or variation found for SKU: {sku}")
        sys.exit(1)

    variation = results[0]
    meta = {m["key"]: m["value"] for m in variation.get("meta_data", [])}

    print(f"\nSKU:        {variation.get('sku')}")
    print(f"Price:      {variation.get('regular_price')}")
    print(f"Status:     {variation.get('status')}")
    print(f"Product ID: {variation.get('parent_id', 'n/a')}")
    print(f"\nblank metadata:")
    blank = meta.get("blank")
    if blank:
        if isinstance(blank, str):
            blank = json.loads(blank)
        print(json.dumps(blank, indent=2))
    else:
        print("  (no 'blank' meta key found)")

    print(f"\nAll meta_data:")
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()
